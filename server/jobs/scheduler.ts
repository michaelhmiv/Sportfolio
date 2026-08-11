/**
 * Cron Job Scheduler
 *
 * Owns cron tasks, overlap protection, execution logging, and lifecycle control.
 * Immutable registry jobs live in job-registry.ts; analytics snapshots are
 * scheduler-owned because they are infrastructure history checkpoints rather
 * than sports-provider jobs.
 */

import * as cron from "node-cron";
import { storage } from "../storage";
import { info, warn, error, createThrottledLogger } from "../lib/log-utility";
import type { ProgressCallback } from "../lib/admin-stream";
import {
  getAdvertisedManualJobNames,
  getManualJobHandler,
  getScheduledJobDefinitions,
} from "./job-registry";
import { dailySnapshot } from "./daily-snapshot";
import { takeMarketSnapshot } from "./market-snapshot";
import { refreshPlayerMarketMetricsJob } from "./refresh-player-metrics";
import type { JobResult } from "./types";
import { withJobAdvisoryLock } from "./job-lock";

export type { JobResult } from "./types";

const logJobEvent = createThrottledLogger();
const JOB_TIMEZONE = "America/New_York";

const ANALYTICS_SNAPSHOT_JOBS: readonly JobConfig[] = [
  {
    name: "market_snapshot",
    schedule: "5 0 * * *",
    enabled: true,
    handler: () => takeMarketSnapshot(),
  },
  {
    name: "portfolio_snapshot",
    schedule: "10 0 * * *",
    enabled: true,
    handler: () => dailySnapshot(),
  },
] as const;

export interface JobConfig {
  name: string;
  schedule: string;
  enabled: boolean;
  handler: () => Promise<JobResult>;
}

export class JobScheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private jobConfigs: Map<string, JobConfig> = new Map();
  private runningJobs: Set<string> = new Set();
  private isInitialized = false;

  private scheduleJob(jobConfig: JobConfig) {
    if (!jobConfig.enabled) {
      info(`Job ${jobConfig.name} is disabled, skipping...`);
      return;
    }

    const task = cron.schedule(
      jobConfig.schedule,
      async () => {
        if (this.runningJobs.has(jobConfig.name)) {
          warn(`[${jobConfig.name}] Skipping scheduled run because a previous run is still active`);
          return;
        }

        this.runningJobs.add(jobConfig.name);
        try {
          const lockResult = await withJobAdvisoryLock(jobConfig.name, async () => {
            logJobEvent(`[${jobConfig.name}] Starting scheduled run...`);

            let jobLog: { id: string } | null = null;
            try {
              jobLog = await storage.createJobLog({
                jobName: jobConfig.name,
                scheduledFor: new Date(),
                status: "running",
              });
            } catch (err: any) {
              warn(`[${jobConfig.name}] Failed to create job log: ${err?.message || err}`);
            }

            try {
              const result = await jobConfig.handler();
              const status = result.errorCount > 0 ? "degraded" : "success";

              if (jobLog) {
                try {
                  await storage.updateJobLog(jobLog.id, {
                    status,
                    finishedAt: new Date(),
                    requestCount: result.requestCount || 0,
                    recordsProcessed: result.recordsProcessed || 0,
                    errorCount: result.errorCount || 0,
                  });
                } catch (err: any) {
                  warn(`[${jobConfig.name}] Failed to update job log: ${err?.message || err}`);
                }
              }

              if (status === "degraded") {
                warn(
                  `[${jobConfig.name}] Completed with errors - ${result.recordsProcessed} records processed, ${result.errorCount} failed, ${result.requestCount} requests`,
                );
              } else {
                logJobEvent(
                  `[${jobConfig.name}] Completed successfully - ${result.recordsProcessed} records, ${result.requestCount} requests`,
                );
              }
            } catch (err: any) {
              error(`[${jobConfig.name}] Failed:`, err?.message || err);

              if (jobLog) {
                try {
                  await storage.updateJobLog(jobLog.id, {
                    status: "failed",
                    errorMessage: err?.message || String(err),
                    finishedAt: new Date(),
                  });
                } catch (logErr: any) {
                  warn(
                    `[${jobConfig.name}] Failed to update failed job log: ${logErr?.message || logErr}`,
                  );
                }
              }
            }
          });

          if (!lockResult.acquired) {
            warn(
              `[${jobConfig.name}] Skipping scheduled run because another process holds the job lock`,
            );
          }
        } finally {
          this.runningJobs.delete(jobConfig.name);
        }
      },
      { timezone: JOB_TIMEZONE },
    );

    this.jobs.set(jobConfig.name, task);
    this.jobConfigs.set(jobConfig.name, jobConfig);
    info(`Job ${jobConfig.name} scheduled: ${jobConfig.schedule}`);
  }

  /** Initialize jobs that do not depend on a sports API. */
  async initializeCoreJobs() {
    info("Initializing core jobs...");

    for (const definition of getScheduledJobDefinitions("core")) {
      this.scheduleJob({
        name: definition.name,
        schedule: definition.schedule,
        enabled: definition.enabled,
        handler: definition.scheduledHandler,
      });
    }

    for (const analyticsJob of ANALYTICS_SNAPSHOT_JOBS) {
      this.scheduleJob(analyticsJob);
    }

    // Warm complex-sort metrics at startup so first requests are accurate.
    refreshPlayerMarketMetricsJob().catch((err: any) => {
      warn("[refresh_player_metrics] Startup warm-up failed:", err?.message || err);
    });

    info("Core jobs initialized successfully");
  }

  /** Initialize sports API-dependent jobs. */
  async initializeApiJobs() {
    info("Initializing API-dependent jobs...");

    for (const definition of getScheduledJobDefinitions("api")) {
      this.scheduleJob({
        name: definition.name,
        schedule: definition.schedule,
        enabled: definition.enabled,
        handler: definition.scheduledHandler,
      });
    }

    info("API-dependent jobs initialized successfully");
  }

  async initialize() {
    if (this.isInitialized) {
      info("Job scheduler already initialized");
      return;
    }

    info("Initializing job scheduler...");
    await this.initializeCoreJobs();
    await this.initializeApiJobs();
    this.isInitialized = true;
    info("Job scheduler initialized successfully");
  }

  start() {
    if (this.jobs.size === 0) {
      info("No jobs to start - initialize jobs first");
      return;
    }

    info("Starting all cron jobs...");
    Array.from(this.jobs.entries()).forEach(([name, task]) => {
      task.start();
      info(`Job ${name} started`);
    });
  }

  stop() {
    info("Stopping all cron jobs...");
    Array.from(this.jobs.entries()).forEach(([name, task]) => {
      task.stop();
      info(`Job ${name} stopped`);
    });
  }

  /** Manually trigger a registry job for testing or admin operations. */
  async triggerJob(jobName: string, progressCallback?: ProgressCallback): Promise<JobResult> {
    const handler = getManualJobHandler(jobName);
    if (!handler) {
      throw new Error(`Unknown job: ${jobName}`);
    }

    if (this.runningJobs.has(jobName)) {
      const alreadyRunningError = new Error(`Job ${jobName} is already running`);
      (alreadyRunningError as any).statusCode = 409;
      throw alreadyRunningError;
    }

    this.runningJobs.add(jobName);
    try {
      const lockResult = await withJobAdvisoryLock(jobName, async () => {
        info(
          `[${jobName}] Manual trigger started${progressCallback ? " with live logging" : ""}...`,
        );

        let jobLog: { id: string } | null = null;
        try {
          jobLog = await storage.createJobLog({
            jobName,
            scheduledFor: new Date(),
            status: "running",
          });
        } catch (err: any) {
          warn(`[${jobName}] Failed to create job log: ${err?.message || err}`);
        }

        try {
          const result = await handler(progressCallback);
          const status = result.errorCount > 0 ? "degraded" : "success";

          if (jobLog) {
            try {
              await storage.updateJobLog(jobLog.id, {
                status,
                finishedAt: new Date(),
                requestCount: result.requestCount,
                recordsProcessed: result.recordsProcessed,
                errorCount: result.errorCount,
              });
            } catch (err: any) {
              warn(`[${jobName}] Failed to update job log: ${err?.message || err}`);
            }
          }

          if (status === "degraded") {
            warn(
              `[${jobName}] Manual trigger completed with errors - ${result.recordsProcessed} records processed, ${result.errorCount} failed, ${result.requestCount} requests`,
            );
          } else {
            logJobEvent(
              `[${jobName}] Manual trigger completed - ${result.recordsProcessed} records, ${result.requestCount} requests`,
            );
          }
          return result;
        } catch (err: any) {
          error(`[${jobName}] Manual trigger failed:`, err.message);

          if (jobLog) {
            try {
              await storage.updateJobLog(jobLog.id, {
                status: "failed",
                errorMessage: err?.message || String(err),
                finishedAt: new Date(),
              });
            } catch (logErr: any) {
              warn(`[${jobName}] Failed to update failed job log: ${logErr?.message || logErr}`);
            }
          }

          throw err;
        }
      });

      if (!lockResult.acquired) {
        const alreadyRunningError = new Error(`Job ${jobName} is already running`);
        (alreadyRunningError as any).statusCode = 409;
        throw alreadyRunningError;
      }

      return lockResult.value;
    } finally {
      this.runningJobs.delete(jobName);
    }
  }

  getStatus(): Array<{ name: string; running: boolean }> {
    return Array.from(this.jobs.keys()).map((name) => ({
      name,
      running: this.runningJobs.has(name),
    }));
  }

  getConfiguredJobs(): Array<{ name: string; schedule: string; enabled: boolean }> {
    return Array.from(this.jobConfigs.values()).map((job) => ({
      name: job.name,
      schedule: job.schedule,
      enabled: job.enabled,
    }));
  }

  getConfiguredJobNames(): string[] {
    return Array.from(this.jobConfigs.keys());
  }

  getAvailableManualJobNames(): string[] {
    return getAdvertisedManualJobNames();
  }
}

export const jobScheduler = new JobScheduler();

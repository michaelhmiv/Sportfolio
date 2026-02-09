/**
 * Cron Job Scheduler
 *
 * Manages automated sync jobs for MySportsFeeds data ingestion.
 * Jobs run on staggered schedules to avoid overwhelming the API.
 *
 * OPTIMIZATION: Uses throttled logging to reduce disk I/O from verbose output.
 */

import * as cron from "node-cron";
import { storage } from "../storage";
import { info, warn, error, createThrottledLogger } from "../lib/log-utility";

// Throttled logger for job events - reduces I/O
const logJobEvent = createThrottledLogger();

import { syncRoster } from "./sync-roster";
import { syncSchedule } from "./sync-schedule";
import { syncStats } from "./sync-stats";
import { syncStatsLive } from "./sync-stats-live";
import { syncAllLiveStats } from "./sync-all-live-stats";
import { syncPlayerGameLogs } from "./sync-player-game-logs";
import { settleContests } from "./settle-contests";
import { createContests } from "./create-contests";
import { updateContestStatuses } from "./update-contest-statuses";

import { distributeScoutShares } from "./scout-distribution";
import { dailySnapshot } from "./daily-snapshot";
import { backfillContestStats } from "./backfill-contest-stats";
import { generateWeeklyRoundup } from "./weekly-roundup";
import { backfillMarketSnapshots } from "./market-snapshot";
import { syncNFLSchedule } from "./sync-nfl-schedule";
import { syncNFLStats } from "./sync-nfl-stats";
import { syncNFLRoster } from "./sync-nfl-roster";
import { syncPlayerInjuries } from "./sync-injuries";
import { fetchNews } from "./fetch-news";
import { compileAllDigests } from "./compile-digest";
import { lockBoostShares } from "./lock-boost-shares";
import { settleBoosts } from "./settle-boosts";
import { settleCommunityBoosts } from "./settle-community-boosts";
import { cleanupJobLogs } from "./cleanup-job-logs";
import { prunePriceHistory } from "./prune-price-history";
import { updateCollectionsJob } from "./update-collections";
import { checkMilestonesJob } from "./check-milestones";
import { refreshPlayerMarketMetricsJob } from "./refresh-player-metrics";
import { refreshPlayerVolume24hJob } from "./refresh-player-volume-24h";
import type { ProgressCallback } from "../lib/admin-stream";

export interface JobResult {
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
}

export interface JobConfig {
  name: string;
  schedule: string; // Cron expression
  enabled: boolean;
  handler: () => Promise<JobResult>;
}

export class JobScheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private jobConfigs: Map<string, JobConfig> = new Map();
  private isInitialized = false;

  constructor() {}

  /**
   * Helper method to schedule a job
   */
  private scheduleJob(jobConfig: JobConfig) {
    if (!jobConfig.enabled) {
      info(`Job ${jobConfig.name} is disabled, skipping...`);
      return;
    }

    const task = cron.schedule(
      jobConfig.schedule,
      async () => {
        logJobEvent(`[${jobConfig.name}] Starting scheduled run...`);

        // Best-effort job execution logging: job failures should never crash the server.
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
      },
      {
        timezone: "America/New_York", // ET timezone
      },
    );

    this.jobs.set(jobConfig.name, task);
    this.jobConfigs.set(jobConfig.name, jobConfig);
    info(`Job ${jobConfig.name} scheduled: ${jobConfig.schedule}`);
  }

  /**
   * Initialize contest-related jobs (database-only, no API required)
   */
  async initializeContestJobs() {
    info("Initializing contest jobs...");

    const contestJobs: JobConfig[] = [
      {
        name: "update_contest_statuses",
        schedule: "1-59/5 * * * *", // Every 5 minutes (offset 1m) - transition contests from open to live
        enabled: true,
        handler: updateContestStatuses,
      },
      {
        name: "settle_contests",
        schedule: "2-59/5 * * * *", // Every 5 minutes (offset 2m) - check for contests to settle
        enabled: true,
        handler: settleContests,
      },
      {
        name: "scout_distribution",
        schedule: "0 * * * *", // Every hour at :00 - distribute scout shares based on Scout-Minute ratio
        enabled: true,
        handler: distributeScoutShares,
      },
      {
        name: "news_fetch",
        schedule: "0 * * * *", // Every hour at :00 - fetch breaking news via Perplexity
        enabled: true,
        handler: async () => {
          const result = await fetchNews();
          return {
            requestCount: 1,
            recordsProcessed: result.storiesProcessed,
            errorCount: result.success ? 0 : 1,
          };
        },
      },
      {
        name: "compile_digest",
        schedule: "0 6 * * *", // Daily at 6:00 AM ET - compile personalized digests
        enabled: true,
        handler: async () => {
          const result = await compileAllDigests();
          return {
            requestCount: 0,
            recordsProcessed: result.usersProcessed,
            errorCount: result.errors,
          };
        },
      },
      {
        name: "lock_boost_shares",
        schedule: "*/5 * * * *", // Every 5 minutes - lock shares when games start
        enabled: true,
        handler: lockBoostShares,
      },
      {
        name: "settle_boosts",
        schedule: "*/10 * * * *", // Every 10 minutes - settle completed boosts
        enabled: true,
        handler: settleBoosts,
      },
      {
        name: "settle_community_boosts",
        schedule: "*/10 * * * *", // Every 10 minutes - settle community boosts
        enabled: true,
        handler: settleCommunityBoosts,
      },
      // Maintenance jobs (lower frequency)
      {
        name: "cleanup_job_logs",
        schedule: "0 2 * * 0", // Weekly on Sunday at 2 AM - clean up old job execution logs
        enabled: true,
        handler: cleanupJobLogs,
      },
      {
        name: "prune_price_history",
        schedule: "0 3 * * 0", // Weekly on Sunday at 3 AM - prune old price history
        enabled: true,
        handler: prunePriceHistory,
      },
      // Collection and milestone jobs
      {
        name: "update_collections",
        schedule: "*/15 * * * *", // Every 15 minutes - update user collection progress
        enabled: true,
        handler: async () => {
          await updateCollectionsJob();
          return {
            requestCount: 0,
            recordsProcessed: 0,
            errorCount: 0,
          };
        },
      },
      {
        name: "check_milestones",
        schedule: "*/5 * * * *", // Every 5 minutes - check for milestone achievements
        enabled: true,
        handler: async () => {
          await checkMilestonesJob();
          return {
            requestCount: 0,
            recordsProcessed: 0,
            errorCount: 0,
          };
        },
      },
      {
        name: "refresh_player_metrics",
        schedule: "*/15 * * * *", // Every 15 minutes - keep list-sort metrics fresh at scale
        enabled: true,
        handler: () => refreshPlayerMarketMetricsJob(),
      },
      {
        name: "refresh_player_volume_24h",
        schedule: "*/5 * * * *", // Every 5 minutes - rolling 24h shares volume for marketplace sorting
        enabled: true,
        handler: () => refreshPlayerVolume24hJob(),
      },
    ];

    for (const jobConfig of contestJobs) {
      this.scheduleJob(jobConfig);
    }

    // Warm complex-sort metrics at startup so first requests are accurate.
    refreshPlayerMarketMetricsJob().catch((err: any) => {
      warn("[refresh_player_metrics] Startup warm-up failed:", err?.message || err);
    });

    info("Contest jobs initialized successfully");
  }

  /**
   * Initialize API-dependent jobs (requires MYSPORTSFEEDS_API_KEY)
   */
  async initializeApiJobs() {
    info("Initializing API-dependent jobs...");

    const apiJobs: JobConfig[] = [
      {
        name: "roster_sync",
        schedule: "30 5 * * *", // Daily at 5:30 AM ET
        enabled: true,
        handler: syncRoster,
      },
      {
        name: "sync_player_game_logs",
        schedule: "30 6 * * *", // Daily at 6:30 AM ET - after games finalize
        enabled: true,
        handler: () => syncPlayerGameLogs({ mode: "daily" }),
      },
      {
        name: "schedule_sync",
        schedule: "5 * * * *", // Every hour at minute 5 for live score updates
        enabled: true,
        handler: syncSchedule,
      },
      {
        name: "stats_sync",
        schedule: "10 * * * *", // Every hour at minute 10
        enabled: true,
        handler: syncStats,
      },
      {
        name: "injury_sync",
        schedule: "0,30 * * * *", // Every 30 minutes (at :00 and :30)
        enabled: true,
        handler: async () => {
          const result = await syncPlayerInjuries();
          return {
            requestCount: 1,
            recordsProcessed: result.synced + result.cleared,
            errorCount: 0,
          };
        },
      },
      {
        name: "stats_sync_live",
        schedule: "*/5 * * * *", // Every 5 minutes for live games (all sports)
        enabled: true,
        handler: async () => {
          // Unified live stats sync for all sports (NBA + NFL)
          const result = await syncAllLiveStats();
          return result;
        },
      },
      {
        name: "create_contests",
        schedule: "20 0 * * *", // Daily at 00:20 - create contests for upcoming games
        enabled: true,
        handler: createContests,
      },
      {
        name: "daily_snapshot",
        schedule: "30 1 * * *", // Daily at 1:30 AM ET - after contests are created
        enabled: true,
        handler: dailySnapshot,
      },
      {
        name: "weekly_roundup",
        schedule: "0 6 * * 1", // Weekly on Monday at 6:00 AM ET
        enabled: true,
        handler: generateWeeklyRoundup,
      },
      {
        name: "nfl_roster_sync",
        schedule: "30 4 * * *", // Daily at 4:30 AM ET
        enabled: true,
        handler: async () => {
          const result = await syncNFLRoster();
          return {
            requestCount: 0,
            recordsProcessed: result.playersAdded + result.playersUpdated,
            errorCount: result.errors.length,
          };
        },
      },
      {
        name: "nfl_schedule_sync",
        schedule: "45 * * * *", // Hourly at :45 - must run frequently to update game statuses (scores, inprogress/completed)
        enabled: true,
        handler: async () => {
          const result = await syncNFLSchedule();
          return {
            requestCount: 0,
            recordsProcessed: result.gamesProcessed,
            errorCount: result.errors.length,
          };
        },
      },
      // NFL stats sync is now handled by unified 'stats_sync_live' job above
    ];

    for (const jobConfig of apiJobs) {
      this.scheduleJob(jobConfig);
    }

    info("API-dependent jobs initialized successfully");
  }

  /**
   * Initialize all cron jobs (convenience method)
   */
  async initialize() {
    if (this.isInitialized) {
      info("Job scheduler already initialized");
      return;
    }

    info("Initializing job scheduler...");

    await this.initializeContestJobs();
    await this.initializeApiJobs();

    this.isInitialized = true;
    info("Job scheduler initialized successfully");
  }

  /**
   * Start all scheduled jobs
   */
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

  /**
   * Stop all scheduled jobs
   */
  stop() {
    info("Stopping all cron jobs...");
    Array.from(this.jobs.entries()).forEach(([name, task]) => {
      task.stop();
      info(`Job ${name} stopped`);
    });
  }

  /**
   * Manually trigger a job (for testing/admin purposes)
   */
  async triggerJob(jobName: string, progressCallback?: ProgressCallback): Promise<JobResult> {
    // Job handlers with progress callback support
    const jobConfigs: Record<string, (callback?: ProgressCallback) => Promise<JobResult>> = {
      roster_sync: (callback) => syncRoster(callback),
      sync_player_game_logs: (callback) => syncPlayerGameLogs({ progressCallback: callback }),
      schedule_sync: (callback) => syncSchedule(callback),
      stats_sync: (callback) => syncStats(callback),
      stats_sync_live: (callback) => syncStatsLive(callback),
      injury_sync: async () => {
        const result = await syncPlayerInjuries();
        return { requestCount: 1, recordsProcessed: result.synced + result.cleared, errorCount: 0 };
      },
      create_contests: (callback) => createContests(callback),
      update_contest_statuses: (callback) => updateContestStatuses(callback),
      settle_contests: (callback) => settleContests(callback),
      daily_snapshot: (callback) => dailySnapshot(callback),
      backfill_contest_stats: (callback) => backfillContestStats(callback),
      weekly_roundup: (callback) => generateWeeklyRoundup(callback),
      backfill_market_snapshots: (callback) => backfillMarketSnapshots(callback),
      scout_distribution: async () => {
        return await distributeScoutShares();
      },
      news_fetch: async (callback) => {
        const result = await fetchNews(callback);
        return {
          requestCount: 1,
          recordsProcessed: result.storiesProcessed,
          errorCount: result.success ? 0 : 1,
          // Additional fields for frontend feedback
          stories: result.stories || [],
          error: result.error || null,
        };
      },
      compile_digest: async (callback) => {
        const result = await compileAllDigests(callback);
        return {
          requestCount: 0,
          recordsProcessed: result.usersProcessed,
          errorCount: result.errors,
        };
      },
      lock_boost_shares: (callback) => lockBoostShares(callback),
      settle_boosts: (callback) => settleBoosts(callback),
      settle_community_boosts: (callback) => settleCommunityBoosts(callback),
      cleanup_job_logs: (callback) => cleanupJobLogs(callback),
      prune_price_history: (callback) => prunePriceHistory(callback),
      update_collections: async () => {
        await updateCollectionsJob();
        return {
          requestCount: 0,
          recordsProcessed: 0,
          errorCount: 0,
        };
      },
      check_milestones: async () => {
        await checkMilestonesJob();
        return {
          requestCount: 0,
          recordsProcessed: 0,
          errorCount: 0,
        };
      },
      refresh_player_metrics: (callback) => refreshPlayerMarketMetricsJob(callback),
      refresh_player_volume_24h: (callback) => refreshPlayerVolume24hJob(callback),
      nfl_schedule_sync: async () => {
        const result = await syncNFLSchedule();
        return { requestCount: 0, recordsProcessed: result.gamesProcessed, errorCount: result.errors.length };
      },
      nfl_stats_sync: async () => {
        const result = await syncNFLStats();
        return { requestCount: 0, recordsProcessed: result.statsProcessed, errorCount: result.errors.length };
      },
      nfl_roster_sync: async () => {
        const result = await syncNFLRoster();
        return { requestCount: 0, recordsProcessed: result.playersAdded + result.playersUpdated, errorCount: result.errors.length };
      },
    };

    const handler = jobConfigs[jobName];
    if (!handler) {
      throw new Error(`Unknown job: ${jobName}`);
    }

    info(`[${jobName}] Manual trigger started${progressCallback ? " with live logging" : ""}...`);

    // Best-effort job logging; manual triggers should still run if logs fail.
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

      // Determine job status: degraded if some records failed, success if all succeeded
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
  }

  /**
   * Get status of all jobs
   */
  getStatus(): Array<{ name: string; running: boolean }> {
    return Array.from(this.jobs.entries()).map(([name, task]) => ({
      name,
      running: task.getStatus() === "running",
    }));
  }

  getConfiguredJobs(): Array<{ name: string; schedule: string; enabled: boolean }> {
    return Array.from(this.jobConfigs.values()).map((j) => ({
      name: j.name,
      schedule: j.schedule,
      enabled: j.enabled,
    }));
  }

  getConfiguredJobNames(): string[] {
    return Array.from(this.jobConfigs.keys());
  }

  getAvailableManualJobNames(): string[] {
    // Keep in sync with triggerJob() map
    return [
      "roster_sync",
      "sync_player_game_logs",
      "schedule_sync",
      "stats_sync",
      "stats_sync_live",
      "create_contests",
      "update_contest_statuses",
      "settle_contests",
      "daily_snapshot",
      "backfill_contest_stats",
      "weekly_roundup",
      "backfill_market_snapshots",
      "scout_distribution",
      "news_fetch",
      "compile_digest",
      "lock_boost_shares",
      "settle_boosts",
      "settle_community_boosts",
      "cleanup_job_logs",
      "prune_price_history",
      "update_collections",
      "check_milestones",
      "refresh_player_metrics",
      "refresh_player_volume_24h",
      "nfl_schedule_sync",
      "nfl_stats_sync",
      "nfl_roster_sync",
    ];
  }
}

// Global scheduler instance
export const jobScheduler = new JobScheduler();

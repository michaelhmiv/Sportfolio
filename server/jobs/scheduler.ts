/**
 * Cron Job Scheduler
 *
 * Manages automated sync jobs for sports data ingestion.
 * Jobs run on staggered schedules to avoid overwhelming upstream APIs.
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
import { syncNascarRoster, syncNascarActiveRoster } from "./sync-nascar-roster";
import { syncNascarSchedule } from "./sync-nascar-schedule";
import { syncNascarLive } from "./sync-nascar-live";
import { syncPlayerInjuries } from "./sync-injuries";
import { fetchNews } from "./fetch-news";
import { compileAllDigests } from "./compile-digest";
import { lockBoostShares } from "./lock-boost-shares";
import { settleBoosts } from "./settle-boosts";
import { settleCommunityBoosts } from "./settle-community-boosts";
import { snapshotSharePayouts } from "./snapshot-share-payouts";
import { settleSharePayouts } from "./settle-share-payouts";
import { cleanupJobLogs } from "./cleanup-job-logs";
import { prunePriceHistory } from "./prune-price-history";
import { updateCollectionsJob } from "./update-collections";
import { checkMilestonesJob } from "./check-milestones";
import { refreshPlayerMarketMetricsJob } from "./refresh-player-metrics";
import { refreshPlayerVolume24hJob } from "./refresh-player-volume-24h";
import { runBotEngineTick } from "../bot/bot-engine";
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
  private runningJobs: Set<string> = new Set();
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
        if (this.runningJobs.has(jobConfig.name)) {
          warn(`[${jobConfig.name}] Skipping scheduled run because a previous run is still active`);
          return;
        }

        this.runningJobs.add(jobConfig.name);
        try {
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
        } finally {
          this.runningJobs.delete(jobConfig.name);
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
        enabled: false, // DISABLED - contests feature removed
        handler: updateContestStatuses,
      },
      {
        name: "settle_contests",
        schedule: "2-59/5 * * * *", // Every 5 minutes (offset 2m) - check for contests to settle
        enabled: false, // DISABLED - contests feature removed
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
        name: "bot_engine",
        schedule: "*/15 * * * *", // Every 15 minutes - run bot strategies (scout, trade, add liquidity)
        enabled: true,
        handler: async () => {
          const result = await runBotEngineTick();
          return {
            requestCount: 1,
            recordsProcessed: result.botsProcessed,
            errorCount: result.errors,
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
        schedule: "0-59/5 * * * *", // Every 5 minutes - lock shares when games start
        enabled: true,
        handler: lockBoostShares,
      },
      {
        name: "snapshot_share_payouts",
        schedule: "1-59/5 * * * *", // Every 5 minutes (offset 1m) - snapshot started-game holdings for payout settlement
        enabled: true,
        handler: snapshotSharePayouts,
      },
      {
        name: "settle_boosts",
        schedule: "5-59/10 * * * *", // Every 10 minutes (offset 5m) - settle completed boosts
        enabled: true,
        handler: settleBoosts,
      },
      {
        name: "settle_share_payouts",
        schedule: "7-59/10 * * * *", // Every 10 minutes (offset 7m) - settle processed game-based share payouts
        enabled: true,
        handler: settleSharePayouts,
      },
      {
        name: "settle_community_boosts",
        schedule: "9-59/10 * * * *", // Every 10 minutes (offset 9m) - settle community boosts
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
        schedule: "7-59/15 * * * *", // Every 15 minutes (offset 7m) - update user collection progress
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
        schedule: "3-59/15 * * * *", // Every 15 minutes (offset 3m) - check for milestone achievements
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
        schedule: "12-59/15 * * * *", // Every 15 minutes (offset 12m) - keep list-sort metrics fresh at scale
        enabled: true,
        handler: () => refreshPlayerMarketMetricsJob(),
      },
      {
        name: "refresh_player_volume_24h",
        schedule: "4-59/10 * * * *", // Every 10 minutes (offset 4m) - rolling 24h shares volume for marketplace sorting
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
   * Initialize sports API-dependent jobs (requires BALLDONTLIE_API_KEY)
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
        schedule: "4-59/5 * * * *", // Every 5 minutes (offset 4m) for live games (all sports; NFL throttled in handler)
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
        enabled: false, // DISABLED - contests feature removed
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
      {
        name: "nascar_roster_sync",
        schedule: "30 3 * * *", // Daily at 3:30 AM ET - sync driver rosters for all series
        enabled: true,
        handler: async () => {
          const result = await syncNascarRoster();
          return {
            requestCount: result.requestCount,
            recordsProcessed: result.recordsProcessed,
            errorCount: result.errorCount,
          };
        },
      },
      {
        // Sync active drivers from upcoming/recent races (filters out old/inactive drivers)
        name: "nascar_active_roster_sync",
        schedule: "0 4 * * *", // Daily at 4:00 AM ET - sync active drivers from race entry lists
        enabled: true,
        handler: async () => {
          const result = await syncNascarActiveRoster(14, 7);
          return {
            requestCount: result.requestCount,
            recordsProcessed: result.recordsProcessed,
            errorCount: result.errorCount,
          };
        },
      },
      {
        name: "nascar_schedule_sync",
        schedule: "45 3 * * *", // Daily at 3:45 AM ET - sync race schedule
        enabled: true,
        handler: async () => {
          const result = await syncNascarSchedule();
          return {
            requestCount: result.requestCount,
            recordsProcessed: result.recordsProcessed,
            errorCount: result.errorCount,
          };
        },
      },
      {
        name: "nascar_live_sync",
        schedule: "*/5 * * * *", // Every 5 minutes - sync live race data during events
        enabled: true,
        handler: async () => {
          const result = await syncNascarLive();
          return {
            requestCount: result.requestCount,
            recordsProcessed: result.recordsProcessed,
            errorCount: result.errorCount,
          };
        },
      },
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
      // Contest jobs disabled - feature removed
      // create_contests, update_contest_statuses, settle_contests, backfill_contest_stats
      daily_snapshot: (callback) => dailySnapshot(callback),
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
      snapshot_share_payouts: (callback) => snapshotSharePayouts(callback),
      settle_boosts: (callback) => settleBoosts(callback),
      settle_share_payouts: (callback) => settleSharePayouts(callback),
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
      bot_engine: async () => {
        const result = await runBotEngineTick();
        return {
          requestCount: 1,
          recordsProcessed: result.botsProcessed,
          errorCount: result.errors,
        };
      },
      nfl_schedule_sync: async () => {
        const result = await syncNFLSchedule();
        return {
          requestCount: 0,
          recordsProcessed: result.gamesProcessed,
          errorCount: result.errors.length,
        };
      },
      nfl_stats_sync: async () => {
        const result = await syncNFLStats();
        return {
          requestCount: 0,
          recordsProcessed: result.statsProcessed,
          errorCount: result.errors.length,
        };
      },
      nfl_roster_sync: async () => {
        const result = await syncNFLRoster();
        return {
          requestCount: 0,
          recordsProcessed: result.playersAdded + result.playersUpdated,
          errorCount: result.errors.length,
        };
      },
      nascar_roster_sync: async () => {
        const result = await syncNascarRoster();
        return {
          requestCount: result.requestCount,
          recordsProcessed: result.recordsProcessed,
          errorCount: result.errorCount,
        };
      },
      // Sync active drivers from upcoming/recent races (filters out old/inactive drivers)
      nascar_active_roster_sync: async () => {
        // Look at races from past 7 days and upcoming 14 days
        const result = await syncNascarActiveRoster(14, 7);
        return {
          requestCount: result.requestCount,
          recordsProcessed: result.recordsProcessed,
          errorCount: result.errorCount,
        };
      },
      nascar_schedule_sync: async () => {
        const result = await syncNascarSchedule();
        return {
          requestCount: result.requestCount,
          recordsProcessed: result.recordsProcessed,
          errorCount: result.errorCount,
        };
      },
      nascar_live_sync: async () => {
        const result = await syncNascarLive();
        return {
          requestCount: result.requestCount,
          recordsProcessed: result.recordsProcessed,
          errorCount: result.errorCount,
        };
      },
    };

    const handler = jobConfigs[jobName];
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
    } finally {
      this.runningJobs.delete(jobName);
    }
  }

  /**
   * Get status of all jobs
   */
  getStatus(): Array<{ name: string; running: boolean }> {
    return Array.from(this.jobs.keys()).map((name) => ({
      name,
      running: this.runningJobs.has(name),
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
      // Contest jobs removed - feature disabled
      "daily_snapshot",
      "weekly_roundup",
      "backfill_market_snapshots",
      "scout_distribution",
      "news_fetch",
      "compile_digest",
      "lock_boost_shares",
      "snapshot_share_payouts",
      "settle_boosts",
      "settle_share_payouts",
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
      "nascar_roster_sync",
      "nascar_schedule_sync",
      "nascar_live_sync",
    ];
  }
}

// Global scheduler instance
export const jobScheduler = new JobScheduler();

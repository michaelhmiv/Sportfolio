/**
 * Unified Live Stats Sync Job
 *
 * Handles live stats for MLB (via public StatsAPI) and NASCAR.
 * NBA and NFL are disabled during the MLB/NASCAR-only migration.
 */
import { storage } from "../storage";
import { syncMLBStats } from "./sync-mlb-stats";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";
import { getTodayETBoundaries, getETDayBoundaries, getGameDay } from "../lib/time";

interface UnifiedResult extends JobResult {
  mlbResult?: JobResult;
  gamesProcessed?: number;
  skippedMissingPlayers?: number;
}

/**
 * Unified live stats sync for MLB only.
 * Called every 5 minutes (cron cadence is the throttle).
 *
 * NBA and NFL are excluded during the MLB/NASCAR-only migration.
 * Uses the public MLB StatsAPI (no auth required).
 */
export async function syncAllLiveStats(
  progressCallback?: ProgressCallback,
): Promise<UnifiedResult> {
  console.log("[live_stats_sync] Starting live stats sync (MLB only)...");

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting live stats sync (MLB only)",
  });

  const result: UnifiedResult = {
    requestCount: 0,
    recordsProcessed: 0,
    errorCount: 0,
    skippedMissingPlayers: 0,
  };

  try {
    const now = new Date();

    // Get yesterday's and today's games
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const { startOfDay } = getETDayBoundaries(getGameDay(yesterday));
    const { endOfDay } = getTodayETBoundaries();
    const allGames = await storage.getDailyGames(startOfDay, endOfDay);

    const mlbGames = allGames.filter((g) => g.sport === "MLB");

    console.log(`[live_stats_sync] Games in window: MLB=${mlbGames.length}`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Games found: MLB=${mlbGames.length}`,
      data: { mlbCount: mlbGames.length },
    });

    // Process MLB games via StatsAPI
    if (mlbGames.length > 0) {
      console.log(`[live_stats_sync] Processing MLB live sync via StatsAPI...`);
      try {
        const mlbResult = await syncMLBStats();
        result.mlbResult = {
          requestCount: 0,
          recordsProcessed: mlbResult.statsProcessed,
          errorCount: mlbResult.errors.length,
        };
        result.recordsProcessed += mlbResult.statsProcessed;
        result.gamesProcessed = (result.gamesProcessed || 0) + mlbResult.gamesProcessed;
        result.skippedMissingPlayers =
          (result.skippedMissingPlayers || 0) + Number(mlbResult.skippedMissingPlayers || 0);
        if (mlbResult.errors.length > 0) {
          result.errorCount += mlbResult.errors.length;
        }
      } catch (error: any) {
        console.error("[live_stats_sync] MLB sync failed:", error.message);
        result.errorCount++;
      }
    }

    // NBA and NFL are disabled during MLB/NASCAR-only migration.

    if (mlbGames.length === 0) {
      console.log("[live_stats_sync] No MLB games in window, skipping");

      progressCallback?.({
        type: "complete",
        timestamp: new Date().toISOString(),
        message: "No MLB games in window, skipping",
        data: {
          success: true,
          summary: {
            statsProcessed: 0,
            errors: 0,
            apiCalls: 0,
            gamesProcessed: 0,
            skippedMissingPlayers: 0,
          },
        },
      });

      return result;
    }

    console.log(
      `[live_stats_sync] Completed: ${result.recordsProcessed} stats processed, ${result.errorCount} errors, ${result.skippedMissingPlayers || 0} missing-player skips`,
    );

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message:
        result.errorCount > 0
          ? `Live stats sync completed with ${result.errorCount} errors`
          : "Live stats sync completed successfully",
      data: {
        success: result.errorCount === 0,
        summary: {
          statsProcessed: result.recordsProcessed,
          errors: result.errorCount,
          apiCalls: result.requestCount,
          mlbGames: mlbGames.length,
          skippedMissingPlayers: result.skippedMissingPlayers || 0,
        },
      },
    });

    return result;
  } catch (error: any) {
    console.error("[live_stats_sync] Fatal error:", error.message);

    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Live stats sync failed: ${error.message}`,
      data: { error: error.message },
    });

    return { ...result, errorCount: result.errorCount + 1 };
  }
}

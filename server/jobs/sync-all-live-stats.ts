/**
 * Unified Live Stats Sync Job
 *
 * A single job that handles live stats for all sports.
 * Dispatches to sport-specific sync logic based on which games are active.
 *
 * Sports supported:
 * - NBA: Uses Ball Don't Lie API
 * - NFL: Uses Ball Don't Lie API
 */

import { storage } from "../storage";
import { syncStatsLive as syncNBAStatsLive } from "./sync-stats-live";
import { syncNFLStats } from "./sync-nfl-stats";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";
import { getTodayETBoundaries, getETDayBoundaries, getGameDay } from "../lib/time";

interface UnifiedResult extends JobResult {
  nbaResult?: JobResult;
  nflResult?: JobResult;
  gamesProcessed?: number;
}

let lastNflSyncMinuteKey: string | null = null;

/**
 * Unified live stats sync that handles all sports
 * Called every minute to update player stats for active games
 */
export async function syncAllLiveStats(
  progressCallback?: ProgressCallback,
): Promise<UnifiedResult> {
  console.log("[live_stats_sync] Starting unified live stats sync for all sports...");

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting unified live stats sync for all sports",
  });

  const result: UnifiedResult = {
    requestCount: 0,
    recordsProcessed: 0,
    errorCount: 0,
  };

  try {
    const now = new Date();

    // Get yesterday's and today's games to check which sports have active games.
    // Looking back 1 day ensures we catch games from the previous evening
    // (e.g. Super Bowl on Sunday when this runs Monday morning).
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const { startOfDay } = getETDayBoundaries(getGameDay(yesterday));
    const { endOfDay } = getTodayETBoundaries();
    const allGames = await storage.getDailyGames(startOfDay, endOfDay);

    // Check for games by sport
    // NOTE: NBA sync refreshes scores/statuses itself from the API, so we do NOT gate on DB status.
    const nbaGames = allGames.filter((g) => g.sport === "NBA");
    // Include NFL games with ANY status (including "scheduled") so that syncNFLStats
    // can fetch fresh statuses from the API and break the chicken-and-egg problem where
    // games stuck at "scheduled" never get updated because the updater only ran for
    // already-active games.
    const nflGames = allGames.filter((g) => g.sport === "NFL");

    console.log(`[live_stats_sync] Games in window: NBA=${nbaGames.length}, NFL=${nflGames.length}`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Games found: NBA=${nbaGames.length}, NFL=${nflGames.length}`,
      data: { nbaCount: nbaGames.length, nflCount: nflGames.length },
    });

    // Process NBA games if any exist in the window.
    if (nbaGames.length > 0) {
      console.log(`[live_stats_sync] Processing NBA live sync...`);
      try {
        const nbaResult = await syncNBAStatsLive(progressCallback);
        result.nbaResult = nbaResult;
        result.requestCount += nbaResult.requestCount;
        result.recordsProcessed += nbaResult.recordsProcessed;
        result.errorCount += nbaResult.errorCount;
      } catch (error: any) {
        console.error("[live_stats_sync] NBA sync failed:", error.message);
        result.errorCount++;
      }
    }

    // Process NFL games if any exist in the window.
    // Throttle to once per 5 minutes to avoid excessive API usage.
    const minuteKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
    const shouldRunNfl = now.getUTCMinutes() % 5 === 0 && lastNflSyncMinuteKey !== minuteKey;

    if (nflGames.length > 0 && shouldRunNfl) {
      lastNflSyncMinuteKey = minuteKey;
      console.log(`[live_stats_sync] Processing NFL live sync (throttled)...`);
      try {
        const nflResult = await syncNFLStats();
        result.nflResult = {
          requestCount: 0, // NFL uses Ball Don't Lie rate limiter separately
          recordsProcessed: nflResult.statsProcessed,
          errorCount: nflResult.errors.length,
        };
        result.recordsProcessed += nflResult.statsProcessed;
        result.gamesProcessed = (result.gamesProcessed || 0) + nflResult.gamesProcessed;
        if (nflResult.errors.length > 0) {
          result.errorCount += nflResult.errors.length;
        }
      } catch (error: any) {
        console.error("[live_stats_sync] NFL sync failed:", error.message);
        result.errorCount++;
      }
    }

    // If no games for any sport, short-circuit
    if (nbaGames.length === 0 && nflGames.length === 0) {
      console.log("[live_stats_sync] No games in window for any sport, skipping");

      progressCallback?.({
        type: "complete",
        timestamp: new Date().toISOString(),
        message: "No games in window for any sport, skipping",
        data: {
          success: true,
          summary: {
            statsProcessed: 0,
            errors: 0,
            apiCalls: 0,
            gamesProcessed: 0,
          },
        },
      });

      return result;
    }

    console.log(
      `[live_stats_sync] ✓ Completed: ${result.recordsProcessed} stats processed, ${result.errorCount} errors`,
    );

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message:
        result.errorCount > 0
          ? `Unified live stats sync completed with ${result.errorCount} errors`
          : `Unified live stats sync completed successfully`,
      data: {
        success: result.errorCount === 0,
        summary: {
          statsProcessed: result.recordsProcessed,
          errors: result.errorCount,
          apiCalls: result.requestCount,
          nbaGames: nbaGames.length,
          nflGames: nflGames.length,
        },
      },
    });

    return result;
  } catch (error: any) {
    console.error("[live_stats_sync] Fatal error:", error.message);

    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Unified live stats sync failed: ${error.message}`,
      data: { error: error.message },
    });

    return { ...result, errorCount: result.errorCount + 1 };
  }
}

/**
 * Schedule Sync Job
 *
 * Fetches daily NBA game schedules from BallDontLie API.
 * Caches game data for slate and boost timing.
 * Broadcasts updates when game scores change.
 */

import { storage } from "../storage";
import { fetchDailyGames, normalizeGameStatus } from "../balldontlie-nba";
import { balldontlieRateLimiter } from "./rate-limiter";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";
import { broadcast } from "../websocket";
import { getGameDay, getETDayBoundaries } from "../lib/time";

export async function syncSchedule(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[schedule_sync] Starting game schedule sync...");

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting schedule sync job",
  });

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;
  const gamesWithUpdates = new Set<string>(); // Track games that had score updates

  try {
    // Fetch games for a wider range: 7 days back to 14 days forward (covers current and upcoming slates)
    const today = new Date();
    const dates: string[] = [];

    for (let i = -7; i <= 14; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push(date.toISOString().split("T")[0]); // YYYY-MM-DD format
    }

    console.log(`[schedule_sync] Fetching games for dates range`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Fetching games for ${dates.length} dates (7 days back to 14 days forward)`,
      data: { totalDates: dates.length },
    });

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      try {
        const games = await balldontlieRateLimiter.executeWithRetry(async () => {
          requestCount++;
          return await fetchDailyGames(date);
        });

        // Progress update every 5 dates
        if ((i + 1) % 5 === 0) {
          progressCallback?.({
            type: "progress",
            timestamp: new Date().toISOString(),
            message: `Fetched ${i + 1}/${dates.length} dates`,
            data: {
              current: i + 1,
              total: dates.length,
              percentage: Math.round(((i + 1) / dates.length) * 100),
              stats: { gamesStored: recordsProcessed, errors: errorCount },
            },
          });
        }

        // Store games in database
        for (const game of games) {
          try {
            // BallDontLie uses different status values
            const gameId = game.id.toString();
            const startTime = new Date(game.datetime);

            // Calculate game day in Eastern Time for the date field
            // NOTE: All queries should use start_time, not this date field
            const gameDay = getGameDay(startTime); // e.g., "2025-11-22"
            const { startOfDay } = getETDayBoundaries(gameDay);

            // Extract scores for completed/in-progress games
            const homeScore = game.home_team_score;
            const awayScore = game.visitor_team_score;

            // Handle postponed games - BDL sets postponed=true and status=datetime string
            let normalizedStatus = normalizeGameStatus(game.status);
            if (game.postponed === true) {
              normalizedStatus = "postponed";
            }

            await storage.upsertDailyGame({
              gameId,
              sport: "NBA", // Multi-sport support
              date: startOfDay, // Store midnight UTC on the game's ET day (for auditing only)
              homeTeam: game.home_team?.abbreviation || "UNK",
              awayTeam: game.visitor_team?.abbreviation || "UNK",
              venue: undefined, // BDL doesn't include venue in games endpoint
              status: normalizedStatus,
              startTime, // SINGLE SOURCE OF TRUTH - use this for all queries
              homeScore,
              awayScore,
            });

            recordsProcessed++;

            // Track games that have scores (live or completed) for broadcasting
            if (
              (normalizedStatus === "inprogress" || normalizedStatus === "completed") &&
              (homeScore !== null || awayScore !== null)
            ) {
              gamesWithUpdates.add(gameId);
            }
          } catch (error: any) {
            console.error(`[schedule_sync] Failed to store game ${game.id}:`, error.message);
            errorCount++;
          }
        }
      } catch (error: any) {
        console.error(`[schedule_sync] Failed to fetch games for ${date}:`, error.message);
        errorCount++; // Count fetch failures to track upstream outages
      }
    }

    // Broadcast updates for games with scores
    if (gamesWithUpdates.size > 0) {
      console.log(
        `[schedule_sync] Broadcasting updates for ${gamesWithUpdates.size} games with scores`,
      );

      progressCallback?.({
        type: "info",
        timestamp: new Date().toISOString(),
        message: `Broadcasting updates for ${gamesWithUpdates.size} games with score changes`,
        data: { gamesWithUpdates: gamesWithUpdates.size },
      });

      const gameIds = Array.from(gamesWithUpdates);
      for (const gameId of gameIds) {
        broadcast({
          type: "liveStats",
          gameId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    console.log(
      `[schedule_sync] Successfully processed ${recordsProcessed} games, ${errorCount} errors`,
    );
    console.log(`[schedule_sync] API requests made: ${requestCount}`);

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message:
        errorCount > 0
          ? `Schedule sync completed with ${errorCount} errors: ${recordsProcessed} games processed`
          : `Schedule sync completed successfully: ${recordsProcessed} games processed`,
      data: {
        success: errorCount === 0,
        summary: {
          gamesProcessed: recordsProcessed,
          errors: errorCount,
          apiCalls: requestCount,
          broadcasts: gamesWithUpdates.size,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
    console.error("[schedule_sync] Failed:", error.message);

    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Schedule sync failed: ${error.message}`,
      data: { error: error.message, stack: error.stack },
    });

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `Schedule sync failed: ${error.message}`,
      data: {
        success: false,
        summary: {
          error: error.message,
          gamesProcessed: recordsProcessed,
          errors: errorCount + 1,
          apiCalls: requestCount,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount: errorCount + 1 };
  }
}

/**
 * Stats Sync Job
 *
 * Fetches player game statistics from BallDontLie API for completed games.
 * Used for historical performance tracking and settlements.
 */

import { storage } from "../storage";
import {
  fetchPlayerGameStats,
  calculateFantasyPoints,
  createNBAPlayerId,
  getCurrentNBASeasonString,
  convertToGameStats,
} from "../balldontlie-nba";
import { balldontlieRateLimiter } from "./rate-limiter";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

export async function syncStats(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[stats_sync] Starting game stats sync...");

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting stats sync job",
  });

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;
  let missingPlayerSkips = 0;
  const missingPlayerSamples = new Set<string>();

  try {
    // Get games from last 24 hours (catches late-night games from previous day)
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - 24);

    const endDate = new Date();
    endDate.setHours(endDate.getHours() + 6); // Include upcoming games

    const games = await storage.getDailyGames(startDate, endDate);
    // Process games with scores (completed OR in-progress)
    const relevantGames = games.filter(
      (g) =>
        g.sport === "NBA" &&
        (g.status === "inprogress" ||
          g.status === "completed" ||
          (g.status === "scheduled" && g.homeScore !== null && g.awayScore !== null)),
    );

    console.log(`[stats_sync] Found ${relevantGames.length} games to process`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Found ${relevantGames.length} games to process (last 24 hours)`,
      data: { totalGames: relevantGames.length },
    });

    for (let i = 0; i < relevantGames.length; i++) {
      const game = relevantGames[i];

      try {
        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Processing game ${i + 1}/${relevantGames.length}: ${game.awayTeam} @ ${game.homeTeam}`,
          data: {
            current: i + 1,
            total: relevantGames.length,
            gameId: game.gameId,
          },
        });

        const stats = await balldontlieRateLimiter.executeWithRetry(async () => {
          requestCount++;
          return await fetchPlayerGameStats(game.gameId);
        });

        if (!stats || stats.length === 0) {
          console.log(`[stats_sync] No stats data for game ${game.gameId}`);
          continue;
        }

        const candidatePlayerIds = Array.from(
          new Set(stats.map((stat) => createNBAPlayerId(stat.player.id))),
        );
        const existingPlayers =
          candidatePlayerIds.length > 0 ? await storage.getPlayersByIds(candidatePlayerIds) : [];
        const existingPlayerIds = new Set(existingPlayers.map((player) => player.id));

        // Process player stats from BallDontLie response
        for (const stat of stats) {
          try {
            const playerId = createNBAPlayerId(stat.player.id);
            if (!existingPlayerIds.has(playerId)) {
              missingPlayerSkips++;
              if (missingPlayerSamples.size < 8) {
                missingPlayerSamples.add(String(stat.player.id));
              }
              continue;
            }

            // BDL stats are flat - directly accessible
            const points = stat.pts || 0;
            const rebounds = stat.reb || 0;
            const assists = stat.ast || 0;
            const steals = stat.stl || 0;
            const blocks = stat.blk || 0;
            const turnovers = stat.turnover || 0;
            const threePointersMade = stat.fg3m || 0;

            // Calculate double-double and triple-double
            const categories = [points, rebounds, assists, steals, blocks];
            const doubleDigitCategories = categories.filter((c) => c >= 10).length;
            const isDoubleDouble = doubleDigitCategories >= 2;
            const isTripleDouble = doubleDigitCategories >= 3;

            const fantasyPoints = calculateFantasyPoints(convertToGameStats(stat));

            // Parse minutes from string format (e.g., "38")
            const minutes = stat.min ? parseInt(stat.min) : 0;

            await storage.upsertPlayerGameStats({
              playerId, // Prefix with sport for multi-sport support
              gameId: game.gameId,
              sport: "NBA",
              gameDate: game.date,
              season: getCurrentNBASeasonString(),
              opponentTeam:
                stat.team.abbreviation === game.homeTeam ? game.awayTeam : game.homeTeam,
              homeAway: stat.team.abbreviation === game.homeTeam ? "home" : "away",
              minutes,
              points,
              fieldGoalsMade: stat.fgm || 0,
              fieldGoalsAttempted: stat.fga || 0,
              threePointersMade,
              threePointersAttempted: stat.fg3a || 0,
              freeThrowsMade: stat.ftm || 0,
              freeThrowsAttempted: stat.fta || 0,
              rebounds,
              assists,
              steals,
              blocks,
              turnovers,
              isDoubleDouble,
              isTripleDouble,
              fantasyPoints: fantasyPoints.toString(),
            });

            recordsProcessed++;
          } catch (error: any) {
            console.error(`[stats_sync] Failed to store player stats:`, error.message);
            errorCount++;
          }
        }
      } catch (error: any) {
        console.error(`[stats_sync] Failed to process game ${game.gameId}:`, error.message);
        errorCount++; // Count boxscore fetch failures to track upstream issues
      }
    }

    console.log(
      `[stats_sync] Successfully processed ${recordsProcessed} player stats, ${errorCount} errors`,
    );
    console.log(`[stats_sync] API requests made: ${requestCount}`);
    if (missingPlayerSkips > 0) {
      console.log(
        `[stats_sync] Skipped ${missingPlayerSkips} NBA stat rows for players missing from the local roster` +
          (missingPlayerSamples.size > 0
            ? ` (sample player ids: ${Array.from(missingPlayerSamples).join(", ")})`
            : ""),
      );
    }

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message:
        errorCount > 0
          ? `Stats sync completed with ${errorCount} errors: ${recordsProcessed} player stats processed`
          : `Stats sync completed successfully: ${recordsProcessed} player stats processed`,
      data: {
        success: errorCount === 0,
        summary: {
          statsProcessed: recordsProcessed,
          errors: errorCount,
          missingPlayerSkips,
          apiCalls: requestCount,
          gamesProcessed: relevantGames.length,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
    console.error("[stats_sync] Failed:", error.message);

    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Stats sync failed: ${error.message}`,
      data: { error: error.message, stack: error.stack },
    });

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `Stats sync failed: ${error.message}`,
      data: {
        success: false,
        summary: {
          error: error.message,
          statsProcessed: recordsProcessed,
          errors: errorCount + 1,
          apiCalls: requestCount,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount: errorCount + 1 };
  }
}

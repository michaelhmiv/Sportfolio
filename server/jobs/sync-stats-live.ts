/**
 * Live Stats Sync Job
 *
 * Runs every 1 minute to fetch real-time stats for in-progress NBA games.
 * Only processes games with status='inprogress'.
 * Broadcasts updates via WebSocket when stats change.
 */

import { storage } from "../storage";
import {
  fetchPlayerGameStats,
  fetchLiveBoxScores,
  calculateFantasyPoints,
  createNBAPlayerId,
  getCurrentNBASeasonString,
  convertToGameStats,
} from "../balldontlie-nba";
import { balldontlieRateLimiter } from "./rate-limiter";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";
import { broadcast } from "../websocket";

/**
 * Update live game scores from Ball Don't Lie box scores
 */
async function updateLiveGameScores(): Promise<number> {
  try {
    console.log("[stats_sync_live] Fetching live box scores for score updates...");
    const boxScores = await balldontlieRateLimiter.executeWithRetry(async () => {
      return await fetchLiveBoxScores();
    });

    if (!boxScores || boxScores.length === 0) {
      console.log("[stats_sync_live] No live box scores available");
      return 0;
    }

    let scoresUpdated = 0;
    for (const boxScore of boxScores) {
      // Find the matching game in our database by teams and date
      const gameId =
        boxScore.home_team?.abbreviation && boxScore.visitor_team?.abbreviation
          ? boxScore.home_team.abbreviation + "-" + boxScore.visitor_team.abbreviation
          : null;

      if (gameId) {
        // Try to find game by matching teams
        const games = await storage.getDailyGamesBySport(
          "NBA",
          new Date(boxScore.date),
          new Date(boxScore.date),
        );
        const matchingGame = games.find(
          (g) =>
            (g.homeTeam === boxScore.home_team?.abbreviation &&
              g.awayTeam === boxScore.visitor_team?.abbreviation) ||
            (g.homeTeam === boxScore.visitor_team?.abbreviation &&
              g.awayTeam === boxScore.home_team?.abbreviation),
        );

        if (matchingGame) {
          const homeScore = boxScore.home_team_score ?? 0;
          const awayScore = boxScore.visitor_team_score ?? 0;

          await storage.updateDailyGameScore(
            matchingGame.gameId,
            homeScore,
            awayScore,
            "inprogress",
          );

          scoresUpdated++;
          console.log(
            `[stats_sync_live] Updated score: ${boxScore.visitor_team?.abbreviation} ${awayScore} @ ${boxScore.home_team?.abbreviation} ${homeScore}`,
          );
        }
      }
    }

    console.log(`[stats_sync_live] Updated ${scoresUpdated} game scores`);
    return scoresUpdated;
  } catch (error: any) {
    console.error("[stats_sync_live] Failed to update live scores:", error.message);
    return 0;
  }
}

export async function syncStatsLive(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[stats_sync_live] Starting live game stats sync...");

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting live stats sync job",
  });

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;
  const processedGames = new Set<string>(); // Track which games had stats updates

  try {
    // Get today's games only
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const games = await storage.getDailyGames(startOfDay, endOfDay);
    const liveGames = games.filter((g) => g.status === "inprogress");

    // Short-circuit if no live games - but still try to update scores for any in-progress games
    if (liveGames.length === 0) {
      console.log(`[stats_sync_live] No live games in progress, checking for score updates...`);

      // Try to fetch live box scores to update any games that started
      const scoresUpdated = await updateLiveGameScores();
      requestCount++;

      progressCallback?.({
        type: "complete",
        timestamp: new Date().toISOString(),
        message:
          scoresUpdated > 0
            ? `Score sync: ${scoresUpdated} game scores updated`
            : "No live games in progress, skipping",
        data: {
          success: true,
          summary: {
            statsProcessed: 0,
            errors: 0,
            apiCalls: requestCount,
            gamesProcessed: 0,
            scoresUpdated,
          },
        },
      });

      return { requestCount, recordsProcessed: 0, errorCount: 0 };
    }

    console.log(`[stats_sync_live] Found ${liveGames.length} live games to process`);

    // First, update live game scores from Ball Don't Lie box scores
    const scoresUpdated = await updateLiveGameScores();
    requestCount++;

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Found ${liveGames.length} live games to process`,
      data: { totalGames: liveGames.length, scoresUpdated },
    });

    // Rate limit budget: if >6 concurrent games, we might need to back off
    if (liveGames.length > 6) {
      console.warn(
        `[stats_sync_live] Warning: ${liveGames.length} concurrent live games may strain rate limits`,
      );

      progressCallback?.({
        type: "warning",
        timestamp: new Date().toISOString(),
        message: `Warning: ${liveGames.length} concurrent live games may strain rate limits`,
      });
    }

    for (let i = 0; i < liveGames.length; i++) {
      const game = liveGames[i];

      try {
        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Processing live game ${i + 1}/${liveGames.length}: ${game.awayTeam} @ ${game.homeTeam}`,
          data: {
            current: i + 1,
            total: liveGames.length,
            gameId: game.gameId,
          },
        });

        const stats = await balldontlieRateLimiter.executeWithRetry(async () => {
          requestCount++;
          return await fetchPlayerGameStats(game.gameId);
        });

        if (!stats || stats.length === 0) {
          console.log(`[stats_sync_live] No stats data for game ${game.gameId}`);
          continue;
        }

        // Process player stats from BallDontLie response
        for (const stat of stats) {
          try {
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

            // Parse minutes from string format
            const minutes = stat.min ? parseInt(stat.min) : 0;

            await storage.upsertPlayerGameStats({
              playerId: createNBAPlayerId(stat.player.id),
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
            processedGames.add(game.gameId); // Mark that this game had updates
          } catch (error: any) {
            console.error(`[stats_sync_live] Failed to store player stats:`, error.message);
            errorCount++;
          }
        }

        // Only broadcast if this game actually had stat updates
        if (processedGames.has(game.gameId)) {
          broadcast({
            type: "liveStats",
            gameId: game.gameId,
            status: game.status,
            timestamp: new Date().toISOString(),
          });

          // Also broadcast contest update since player stats changed
          broadcast({
            type: "contestUpdate",
            gameId: game.gameId,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error: any) {
        console.error(`[stats_sync_live] Failed to process game ${game.gameId}:`, error.message);
        errorCount++;
      }
    }

    console.log(
      `[stats_sync_live] ✓ Processed ${recordsProcessed} player stats from ${liveGames.length} live games, ${errorCount} errors`,
    );
    console.log(`[stats_sync_live] API requests made: ${requestCount}`);

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message:
        errorCount > 0
          ? `Live stats sync completed with ${errorCount} errors: ${recordsProcessed} player stats from ${liveGames.length} games`
          : `Live stats sync completed successfully: ${recordsProcessed} player stats, ${scoresUpdated} scores updated from ${liveGames.length} games`,
      data: {
        success: errorCount === 0,
        summary: {
          statsProcessed: recordsProcessed,
          errors: errorCount,
          apiCalls: requestCount,
          gamesProcessed: liveGames.length,
          broadcasts: processedGames.size,
          scoresUpdated,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
    console.error("[stats_sync_live] Failed:", error.message);

    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Live stats sync failed: ${error.message}`,
      data: { error: error.message, stack: error.stack },
    });

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `Live stats sync failed: ${error.message}`,
      data: {
        success: false,
        summary: {
          statsProcessed: recordsProcessed,
          errors: errorCount + 1,
          apiCalls: requestCount,
          error: error.message,
        },
      },
    });

    // Degrade gracefully - log but don't throw hard
    return { requestCount, recordsProcessed, errorCount: errorCount + 1 };
  }
}

/**
 * Live Stats Sync Job (NBA)
 *
 * Near-real-time NBA score + player stat sync using Ball Don't Lie.
 *
 * Data sources:
 * - `/games` (free tier): real-time scores + status
 * - `/stats` (ALL-STAR+ tier): real-time per-player stat lines for in-progress games
 *
 * This job:
 * 1) Refreshes yesterday+today NBA games from `/games` and upserts into `daily_games`
 * 2) Fetches live player stats from `/stats` for active games and upserts into `player_game_stats`
 * 3) Broadcasts `liveStats` + `contestUpdate` via WebSocket for affected games
 */

import { storage } from "../storage";
import {
  fetchDailyGames,
  fetchPlayerGameStats,
  isNBAApiConfigured,
  calculateFantasyPoints,
  createNBAPlayerId,
  getCurrentNBASeasonString,
  convertToGameStats,
  normalizeGameStatus,
  type NBAGame,
} from "../balldontlie-nba";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";
import { broadcast } from "../websocket";
import { getETDayBoundaries, getGameDay, getTodayET, getTodayETBoundaries } from "../lib/time";

function getLikelyLiveStatus(normalizedApiStatus: string, startTime: Date, now: Date): string {
  if (normalizedApiStatus !== "scheduled") return normalizedApiStatus;

  const msSinceStart = now.getTime() - startTime.getTime();
  const fourHoursMs = 4 * 60 * 60 * 1000;
  if (msSinceStart > 0 && msSinceStart < fourHoursMs) return "inprogress";

  return normalizedApiStatus;
}

function normalizeStatusFromApi(apiGame: NBAGame): string {
  let status = normalizeGameStatus(apiGame.status);
  if (apiGame.postponed === true) status = "postponed";
  return status;
}

export async function syncStatsLive(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[stats_sync_live] Starting NBA live stats sync...");

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting NBA live stats sync job",
  });

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;

  const gamesToBroadcast = new Set<string>();
  let gamesUpserted = 0;
  let scoreOrStatusUpdates = 0;

  try {
    if (!isNBAApiConfigured()) {
      progressCallback?.({
        type: "complete",
        timestamp: new Date().toISOString(),
        message: "NBA live stats sync skipped - BALLDONTLIE_API_KEY not configured",
        data: { success: true, summary: { statsProcessed: 0, errors: 0, apiCalls: 0 } },
      });
      return { requestCount: 0, recordsProcessed: 0, errorCount: 0 };
    }

    const now = new Date();
    const todayET = getTodayET();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayET = getGameDay(yesterday);

    // Only fetch yesterday's games during the late-night ET window when games can cross midnight.
    const nowEt = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const includeYesterday = nowEt.getHours() < 6;

    const { startOfDay: windowStart } = getETDayBoundaries(includeYesterday ? yesterdayET : todayET);
    const { endOfDay: windowEnd } = getTodayETBoundaries();

    // Snapshot existing games for change detection.
    const existingGames = await storage.getDailyGames(windowStart, windowEnd, "NBA");
    const existingById = new Map(existingGames.map((g) => [g.gameId, g]));

    // STEP 1: Refresh yesterday+today games from `/games` and upsert into DB
    const apiDates = includeYesterday ? [yesterdayET, todayET] : [todayET];
    const apiGamesById = new Map<string, NBAGame>();

    for (const dateStr of apiDates) {
      try {
        console.log(`[stats_sync_live] Fetching fresh NBA games for ${dateStr}...`);
        const apiGames = await fetchDailyGames(dateStr);
        requestCount++;

        for (const apiGame of apiGames) {
          apiGamesById.set(String(apiGame.id), apiGame);
        }
      } catch (err: any) {
        errorCount++;
        console.error(`[stats_sync_live] Failed to fetch NBA games for ${dateStr}:`, err?.message);
        progressCallback?.({
          type: "warning",
          timestamp: new Date().toISOString(),
          message: `Failed to fetch NBA games for ${dateStr}: ${err?.message || err}`,
        });
      }
    }

    if (apiGamesById.size === 0) {
      progressCallback?.({
        type: "complete",
        timestamp: new Date().toISOString(),
        message: "No NBA games returned from API for yesterday/today",
        data: {
          success: errorCount === 0,
          summary: { statsProcessed: 0, errors: errorCount, apiCalls: requestCount },
        },
      });
      return { requestCount, recordsProcessed: 0, errorCount };
    }

    for (const apiGame of apiGamesById.values()) {
      try {
        const gameId = String(apiGame.id);
        const startTime = new Date(apiGame.datetime);
        const gameDay = getGameDay(startTime);
        const { startOfDay } = getETDayBoundaries(gameDay);

        const status = normalizeStatusFromApi(apiGame);
        const homeScore = apiGame.home_team_score;
        const awayScore = apiGame.visitor_team_score;

        const prev = existingById.get(gameId);
        const changed =
          !prev ||
          prev.status !== status ||
          prev.homeScore !== homeScore ||
          prev.awayScore !== awayScore;

        await storage.upsertDailyGame({
          gameId,
          sport: "NBA",
          date: startOfDay, // midnight UTC for the game's ET day
          homeTeam: apiGame.home_team?.abbreviation || "UNK",
          awayTeam: apiGame.visitor_team?.abbreviation || "UNK",
          venue: undefined,
          status,
          startTime,
          homeScore,
          awayScore,
        });

        if (!prev) gamesUpserted++;
        if (changed) {
          scoreOrStatusUpdates++;
          gamesToBroadcast.add(gameId);
        }
      } catch (err: any) {
        errorCount++;
        console.error("[stats_sync_live] Failed to upsert NBA game:", err?.message || err);
      }
    }

    // STEP 2: Determine active games (treat "scheduled but started" as inprogress for polling)
    const activeGames = Array.from(apiGamesById.values())
      .map((g) => {
        const startTime = new Date(g.datetime);
        const normalizedApiStatus = normalizeStatusFromApi(g);
        return {
          gameId: String(g.id),
          startTime,
          homeTeam: g.home_team?.abbreviation || "UNK",
          awayTeam: g.visitor_team?.abbreviation || "UNK",
          gameDay: getGameDay(startTime),
          normalizedApiStatus,
          likelyStatus: getLikelyLiveStatus(normalizedApiStatus, startTime, now),
        };
      })
      .filter((g) => g.likelyStatus === "inprogress");

    if (activeGames.length === 0) {
      if (gamesToBroadcast.size > 0) {
        for (const gameId of gamesToBroadcast) {
          broadcast({ type: "liveStats", gameId, timestamp: new Date().toISOString() });
          broadcast({ type: "contestUpdate", gameId, timestamp: new Date().toISOString() });
        }
      }

      progressCallback?.({
        type: "complete",
        timestamp: new Date().toISOString(),
        message:
          scoreOrStatusUpdates > 0
            ? `NBA live sync: ${scoreOrStatusUpdates} score/status updates`
            : "NBA live sync: no active games",
        data: {
          success: errorCount === 0,
          summary: {
            statsProcessed: 0,
            errors: errorCount,
            apiCalls: requestCount,
            activeGames: 0,
            gamesUpserted,
            scoreOrStatusUpdates,
            broadcasts: gamesToBroadcast.size,
          },
        },
      });

      return { requestCount, recordsProcessed: 0, errorCount };
    }

    console.log(`[stats_sync_live] Found ${activeGames.length} active NBA games to process`);

    if (activeGames.length > 10) {
      console.warn(
        `[stats_sync_live] Warning: ${activeGames.length} concurrent live games may strain rate limits`,
      );
      progressCallback?.({
        type: "warning",
        timestamp: new Date().toISOString(),
        message: `Warning: ${activeGames.length} concurrent live games may strain rate limits`,
      });
    }

    // STEP 3: Fetch player stat lines for active games and upsert into `player_game_stats`
    for (let i = 0; i < activeGames.length; i++) {
      const game = activeGames[i];

      try {
        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Processing live NBA game ${i + 1}/${activeGames.length}: ${game.awayTeam} @ ${game.homeTeam}`,
          data: { current: i + 1, total: activeGames.length, gameId: game.gameId },
        });

        requestCount++;
        const stats = await fetchPlayerGameStats(game.gameId);

        if (!stats || stats.length === 0) {
          console.log(`[stats_sync_live] No stats data for game ${game.gameId}`);
          continue;
        }

        const { startOfDay } = getETDayBoundaries(game.gameDay);

        for (const stat of stats) {
          try {
            const points = stat.pts || 0;
            const rebounds = stat.reb || 0;
            const assists = stat.ast || 0;
            const steals = stat.stl || 0;
            const blocks = stat.blk || 0;
            const turnovers = stat.turnover || 0;
            const threePointersMade = stat.fg3m || 0;

            const categories = [points, rebounds, assists, steals, blocks];
            const doubleDigitCategories = categories.filter((c) => c >= 10).length;
            const isDoubleDouble = doubleDigitCategories >= 2;
            const isTripleDouble = doubleDigitCategories >= 3;

            const fantasyPoints = calculateFantasyPoints(convertToGameStats(stat));
            const minutes = stat.min ? parseInt(stat.min) : 0;

            await storage.upsertPlayerGameStats({
              playerId: createNBAPlayerId(stat.player.id),
              gameId: game.gameId,
              sport: "NBA",
              gameDate: startOfDay,
              season: getCurrentNBASeasonString(),
              opponentTeam: stat.team.abbreviation === game.homeTeam ? game.awayTeam : game.homeTeam,
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
            gamesToBroadcast.add(game.gameId);
          } catch (err: any) {
            errorCount++;
            console.error("[stats_sync_live] Failed to upsert player stats:", err?.message || err);
          }
        }
      } catch (err: any) {
        // If /stats is unauthorized for the key tier, all games will fail. Stop early.
        if (err?.response?.status === 401) {
          errorCount++;
          console.error(
            "[stats_sync_live] Unauthorized calling /stats. Check NBA tier includes Game Player Stats (ALL-STAR+).",
          );
          progressCallback?.({
            type: "error",
            timestamp: new Date().toISOString(),
            message:
              "BallDontLie NBA /stats unauthorized. Confirm your API key has NBA ALL-STAR/GOAT tier for Game Player Stats and BALLDONTLIE_API_KEY is set correctly.",
          });
          break;
        }

        errorCount++;
        console.error(`[stats_sync_live] Failed to process game ${game.gameId}:`, err?.message || err);
      }
    }

    // STEP 4: Broadcast updates once per affected game
    if (gamesToBroadcast.size > 0) {
      for (const gameId of gamesToBroadcast) {
        broadcast({ type: "liveStats", gameId, timestamp: new Date().toISOString() });
        broadcast({ type: "contestUpdate", gameId, timestamp: new Date().toISOString() });
      }
    }

    console.log(
      `[stats_sync_live] Completed: ${recordsProcessed} player stat lines, ${errorCount} errors (active games: ${activeGames.length})`,
    );

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message:
        errorCount > 0
          ? `NBA live stats sync completed with ${errorCount} errors`
          : "NBA live stats sync completed successfully",
      data: {
        success: errorCount === 0,
        summary: {
          statsProcessed: recordsProcessed,
          errors: errorCount,
          apiCalls: requestCount,
          activeGames: activeGames.length,
          gamesUpserted,
          scoreOrStatusUpdates,
          broadcasts: gamesToBroadcast.size,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
    console.error("[stats_sync_live] Fatal failure:", error?.message || error);

    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `NBA live stats sync failed: ${error?.message || error}`,
      data: { error: error?.message || String(error), stack: error?.stack },
    });

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `NBA live stats sync failed: ${error?.message || error}`,
      data: {
        success: false,
        summary: {
          statsProcessed: recordsProcessed,
          errors: errorCount + 1,
          apiCalls: requestCount,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount: errorCount + 1 };
  }
}

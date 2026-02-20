/**
 * MLB Stats Sync Job
 *
 * Fetches MLB player game statistics from Ball Don't Lie API for in-progress
 * and completed games, then updates player_game_stats.
 */

import { storage } from "../storage";
import {
  fetchGames,
  fetchGameStats,
  calculateMLBFantasyPoints,
  parseStatsToJson,
  isMLBApiConfigured,
  createMLBPlayerId,
  normalizeGameStatus,
  getCurrentMLBSeason,
  getMLBAwayScore,
  getMLBAwayTeam,
} from "../balldontlie-mlb";
import { getTodayETBoundaries, getGameDay, getETDayBoundaries } from "../lib/time";

interface SyncResult {
  success: boolean;
  statsProcessed: number;
  gamesProcessed: number;
  errors: string[];
}

export async function syncMLBStats(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    statsProcessed: 0,
    gamesProcessed: 0,
    errors: [],
  };

  if (!isMLBApiConfigured()) {
    result.errors.push("BALLDONTLIE_API_KEY not configured");
    console.error("[MLB Stats Sync] API key not configured");
    return result;
  }

  console.log("[MLB Stats Sync] Starting stats synchronization...");
  const startTime = Date.now();

  try {
    // Fetch yesterday + today to catch late finishes and active games.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const { startOfDay: yesterdayStart } = getETDayBoundaries(getGameDay(yesterday));
    const { endOfDay: todayEnd } = getTodayETBoundaries();

    const yesterdayDate = getGameDay(yesterday);
    const todayDate = getGameDay(new Date());

    console.log(
      `[MLB Stats Sync] Fetching fresh game data from API for ${yesterdayDate} and ${todayDate}...`,
    );

    const apiGames = await fetchGames({ dates: [yesterdayDate, todayDate] });
    console.log(`[MLB Stats Sync] API returned ${apiGames.length} games`);

    let gamesUpdated = 0;
    for (const apiGame of apiGames) {
      try {
        const gameId = `mlb_${apiGame.id}`;
        const gameStatus = normalizeGameStatus(apiGame.status);

        if (
          gameStatus !== "scheduled" &&
          (apiGame.home_team_score != null || getMLBAwayScore(apiGame) != null)
        ) {
          await storage.updateDailyGameScore(
            gameId,
            apiGame.home_team_score ?? 0,
            getMLBAwayScore(apiGame) ?? 0,
            gameStatus,
          );
          gamesUpdated++;
        }
      } catch (error: any) {
        console.log(`[MLB Stats Sync] Could not update game ${apiGame.id}: ${error.message}`);
      }
    }
    console.log(`[MLB Stats Sync] Updated ${gamesUpdated} games with fresh scores from API`);

    const games = await storage.getDailyGamesBySport("MLB", yesterdayStart, todayEnd);
    const relevantGames = games.filter(
      (g) => g.status === "inprogress" || g.status === "completed",
    );

    console.log(
      `[MLB Stats Sync] Found ${relevantGames.length} relevant MLB games (inprogress or completed)`,
    );

    if (relevantGames.length === 0) {
      result.success = true;
      return result;
    }

    const apiGameIds = relevantGames
      .map((g) => Number.parseInt(g.gameId.replace("mlb_", ""), 10))
      .filter((id) => Number.isFinite(id) && id > 0);

    const allApiStats = await fetchGameStats(apiGameIds);
    console.log(`[MLB Stats Sync] Fetched ${allApiStats.length} stat lines from API`);

    const uniqueGames = new Map<string, (typeof allApiStats)[0]["game"]>();
    allApiStats.forEach((stat) => {
      if (!uniqueGames.has(String(stat.game.id))) {
        uniqueGames.set(String(stat.game.id), stat.game);
      }
    });

    for (const [gameIdStr, game] of Array.from(uniqueGames)) {
      try {
        const gameId = `mlb_${gameIdStr}`;
        const gameStatus = normalizeGameStatus(game.status || "");
        await storage.updateDailyGameScore(
          gameId,
          game.home_team_score ?? 0,
          getMLBAwayScore(game) ?? 0,
          gameStatus,
        );
        result.gamesProcessed++;
      } catch (error: any) {
        console.error(
          `[MLB Stats Sync] Error updating score for game ${gameIdStr}:`,
          error.message,
        );
      }
    }

    for (const apiStat of allApiStats) {
      try {
        const playerId = createMLBPlayerId(apiStat.player.id);
        const gameId = `mlb_${apiStat.game.id}`;
        const fantasyPoints = calculateMLBFantasyPoints(apiStat);
        const statsJson = parseStatsToJson(apiStat);

        const isHome = apiStat.team.abbreviation === apiStat.game.home_team.abbreviation;
        const awayTeam = getMLBAwayTeam(apiStat.game);
        const opponentTeam = isHome
          ? awayTeam?.abbreviation || "UNK"
          : apiStat.game.home_team.abbreviation;

        await storage.upsertPlayerGameStats({
          playerId,
          gameId,
          sport: "MLB",
          gameDate: new Date(apiStat.game.date),
          season: (apiStat.game.season || getCurrentMLBSeason()).toString(),
          opponentTeam,
          homeAway: isHome ? "home" : "away",
          statsJson,
          fantasyPoints: fantasyPoints.toString(),
        });

        result.statsProcessed++;
      } catch (error: any) {
        console.error(
          `[MLB Stats Sync] Error processing stat for player ${apiStat.player.id}:`,
          error.message,
        );
        result.errors.push(`Stat error (Player ${apiStat.player.id}): ${error.message}`);
      }
    }

    result.success = result.errors.length === 0;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[MLB Stats Sync] Completed in ${duration}s. Processed ${result.statsProcessed} stats across ${result.gamesProcessed} games.`,
    );
  } catch (error: any) {
    result.errors.push(`Fatal error: ${error.message}`);
    console.error("[MLB Stats Sync] Fatal error:", error);
  }

  return result;
}

export default syncMLBStats;

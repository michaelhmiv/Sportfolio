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
  getMLBHomeScore,
  getMLBAwayScore,
  getMLBAwayTeam,
  getMLBHomeTeamName,
  getMLBAwayTeamName,
  getMLBTeamDisplayName,
  getMLBStatGameId,
  getMLBStatTeamAbbreviation,
  getMLBStatTeamName,
  type MLBGame,
  type MLBGameStats,
} from "../balldontlie-mlb";
import { getTodayETBoundaries, getGameDay, getETDayBoundaries } from "../lib/time";

interface SyncResult {
  success: boolean;
  statsProcessed: number;
  gamesProcessed: number;
  errors: string[];
}

const normalizeTeamKey = (value: string | null | undefined): string =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

function resolveStatGameSide(apiGame: MLBGame, apiStat: MLBGameStats): "home" | "away" | null {
  const homeTeam = apiGame.home_team;
  const awayTeam = getMLBAwayTeam(apiGame);
  const homeAbbreviation = normalizeTeamKey(homeTeam?.abbreviation);
  const awayAbbreviation = normalizeTeamKey(awayTeam?.abbreviation);

  const statAbbreviation = normalizeTeamKey(getMLBStatTeamAbbreviation(apiStat));
  if (statAbbreviation) {
    if (homeAbbreviation && statAbbreviation === homeAbbreviation) return "home";
    if (awayAbbreviation && statAbbreviation === awayAbbreviation) return "away";
  }

  const statTeamName = normalizeTeamKey(getMLBStatTeamName(apiStat));
  if (!statTeamName) return null;

  const homeNames = new Set(
    [
      getMLBHomeTeamName(apiGame),
      getMLBTeamDisplayName(homeTeam),
      homeTeam?.name,
      homeTeam?.display_name,
      homeTeam?.short_display_name,
    ]
      .map(normalizeTeamKey)
      .filter(Boolean),
  );
  if (homeNames.has(statTeamName)) return "home";

  const awayNames = new Set(
    [
      getMLBAwayTeamName(apiGame),
      getMLBTeamDisplayName(awayTeam),
      awayTeam?.name,
      awayTeam?.display_name,
      awayTeam?.short_display_name,
    ]
      .map(normalizeTeamKey)
      .filter(Boolean),
  );
  if (awayNames.has(statTeamName)) return "away";

  return null;
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
        const homeScore = getMLBHomeScore(apiGame);
        const awayScore = getMLBAwayScore(apiGame);

        if (gameStatus !== "scheduled" && (homeScore != null || awayScore != null)) {
          await storage.updateDailyGameScore(gameId, homeScore ?? 0, awayScore ?? 0, gameStatus);
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

    const apiGamesById = new Map<number, (typeof apiGames)[0]>();
    apiGames.forEach((apiGame) => {
      apiGamesById.set(apiGame.id, apiGame);
    });

    for (const relevantGame of relevantGames) {
      try {
        const gameIdStr = relevantGame.gameId.startsWith("mlb_")
          ? relevantGame.gameId.slice(4)
          : relevantGame.gameId;
        const gameIdNum = Number.parseInt(gameIdStr, 10);
        if (!Number.isFinite(gameIdNum) || gameIdNum <= 0) continue;

        const game = apiGamesById.get(gameIdNum);
        if (!game) continue;

        const gameId = `mlb_${gameIdStr}`;
        const gameStatus = normalizeGameStatus(game.status || "");
        await storage.updateDailyGameScore(
          gameId,
          getMLBHomeScore(game) ?? 0,
          getMLBAwayScore(game) ?? 0,
          gameStatus,
        );
        result.gamesProcessed++;
      } catch (error: any) {
        console.error(
          `[MLB Stats Sync] Error updating score for game ${relevantGame.gameId}:`,
          error.message,
        );
      }
    }

    for (const apiStat of allApiStats) {
      try {
        const gameNumericId = getMLBStatGameId(apiStat);
        if (!gameNumericId) {
          result.errors.push(
            `Missing game_id for MLB stat row (player ${apiStat.player?.id || "?"})`,
          );
          continue;
        }

        const apiGame = apiGamesById.get(gameNumericId);
        if (!apiGame) {
          result.errors.push(`Missing API game snapshot for MLB game ${gameNumericId}`);
          continue;
        }

        const playerId = createMLBPlayerId(apiStat.player.id);
        const gameId = `mlb_${gameNumericId}`;
        const fantasyPoints = calculateMLBFantasyPoints(apiStat);
        const statsJson = parseStatsToJson(apiStat);

        const homeTeam = apiGame.home_team?.abbreviation || "UNK";
        const awayTeam = getMLBAwayTeam(apiGame)?.abbreviation || "UNK";
        const gameSide = resolveStatGameSide(apiGame, apiStat);
        const homeAway = gameSide || "away";
        const opponentTeam = homeAway === "home" ? awayTeam : homeTeam;

        await storage.upsertPlayerGameStats({
          playerId,
          gameId,
          sport: "MLB",
          gameDate: new Date(apiGame.date),
          season: (apiGame.season || getCurrentMLBSeason()).toString(),
          opponentTeam,
          homeAway,
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

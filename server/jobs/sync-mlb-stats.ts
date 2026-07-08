/**
 * MLB Stats Sync Job
 *
 * Fetches MLB player game statistics from the public MLB StatsAPI (no auth)
 * for in-progress and completed games, then updates player_game_stats.
 *
 * Data source: /api/v1/game/{gamePk}/boxscore — per-player batting/pitching stats.
 */
import { storage } from "../storage";
import {
  fetchGamesByDate,
  fetchBoxscore,
  calculateFantasyPoints,
  parseStatsToJson,
  normalizeGameStatus,
  createPlayerId,
  getCurrentSeason,
  getOpponentTeam,
  resolvePlayerGameSide,
  extractBoxscorePlayerStats,
} from "../mlb-statsapi";
import { getGameDay, getETDayBoundaries } from "../lib/time";

interface SyncResult {
  success: boolean;
  statsProcessed: number;
  gamesProcessed: number;
  errors: string[];
  skippedMissingPlayers: number;
}

const MLB_MISSING_PLAYER_SAMPLE_LIMIT = 8;

export async function syncMLBStats(): Promise<SyncResult> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return syncMLBStatsForDates([getGameDay(yesterday), getGameDay(new Date())]);
}

export async function syncMLBStatsForDates(dates: string[]): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    statsProcessed: 0,
    gamesProcessed: 0,
    errors: [],
    skippedMissingPlayers: 0,
  };

  console.log("[MLB Stats Sync] Starting stats synchronization via StatsAPI...");
  const startTime = Date.now();

  try {
    const uniqueDates = Array.from(
      new Set(
        dates
          .map((date) => String(date || "").trim())
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
      ),
    ).sort();

    if (uniqueDates.length === 0) {
      result.success = true;
      return result;
    }

    const firstBoundary = getETDayBoundaries(uniqueDates[0]);
    const lastBoundary = getETDayBoundaries(uniqueDates[uniqueDates.length - 1]);
    const dbWindowStart = firstBoundary.startOfDay;
    const dbWindowEnd = lastBoundary.endOfDay || lastBoundary.startOfDay;

    console.log(
      `[MLB Stats Sync] Fetching fresh game data from StatsAPI for ${uniqueDates.join(", ")}...`,
    );

    // Fetch games directly from StatsAPI for every requested date.
    const apiGames = (await Promise.all(uniqueDates.map((date) => fetchGamesByDate(date)))).flat();
    console.log(`[MLB Stats Sync] StatsAPI returned ${apiGames.length} games`);

    // Update scores/statuses for all games in the window
    let gamesUpdated = 0;
    for (const apiGame of apiGames) {
      try {
        const gameId = `mlb_${apiGame.gamePk}`;
        const gameStatus = normalizeGameStatus(apiGame);
        const homeScore = apiGame.teams.home.score;
        const awayScore = apiGame.teams.away.score;

        if (gameStatus !== "scheduled" && (homeScore != null || awayScore != null)) {
          await storage.updateDailyGameScore(gameId, homeScore ?? 0, awayScore ?? 0, gameStatus);
          gamesUpdated++;
        }
      } catch (error: any) {
        console.log(`[MLB Stats Sync] Could not update game ${apiGame.gamePk}: ${error.message}`);
      }
    }
    console.log(`[MLB Stats Sync] Updated ${gamesUpdated} games with fresh scores from StatsAPI`);

    // Get games from DB that are in-progress or completed
    const games = await storage.getDailyGamesBySport("MLB", dbWindowStart, dbWindowEnd);
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

    // Build a map of gamePk → MlbGame for fast lookup
    const apiGamesByPk = new Map<number, (typeof apiGames)[0]>();
    apiGames.forEach((g) => apiGamesByPk.set(g.gamePk, g));

    // Process each relevant game — fetch boxscore directly from StatsAPI
    for (const relevantGame of relevantGames) {
      try {
        const gameIdStr = relevantGame.gameId.startsWith("mlb_")
          ? relevantGame.gameId.slice(4)
          : relevantGame.gameId;
        const gamePk = Number.parseInt(gameIdStr, 10);
        if (!Number.isFinite(gamePk) || gamePk <= 0) continue;

        // Fetch fresh boxscore from StatsAPI
        let boxscore;
        try {
          boxscore = await fetchBoxscore(gamePk);
        } catch (fetchErr: any) {
          // Boxscore may fail for games that haven't started yet, skip gracefully
          console.log(
            `[MLB Stats Sync] Boxscore not available for game ${gamePk} (${fetchErr.message})`,
          );
          continue;
        }

        // Update score/status using schedule payload; the boxscore endpoint does not include linescore.
        const apiGame = apiGamesByPk.get(gamePk);
        if (apiGame) {
          await storage.updateDailyGameScore(
            relevantGame.gameId,
            apiGame.teams.home.score ?? 0,
            apiGame.teams.away.score ?? 0,
            normalizeGameStatus(apiGame),
          );
        }
        result.gamesProcessed++;

        // Extract per-player stats
        const playerStatsMap = extractBoxscorePlayerStats(boxscore);

        // Pre-load known player IDs for filtering
        const uniquePlayerIds = Array.from(playerStatsMap.keys()).map(createPlayerId);
        const knownPlayerIds = new Set(
          uniquePlayerIds.length > 0
            ? (await storage.getPlayersByIds(uniquePlayerIds)).map((p) => p.id)
            : [],
        );

        let missingPlayerSkips = 0;
        const missingPlayerSamples = new Set<string>();

        for (const [mlbamId, stats] of Array.from(playerStatsMap.entries())) {
          const playerId = createPlayerId(mlbamId);

          if (!knownPlayerIds.has(playerId)) {
            missingPlayerSkips++;
            if (missingPlayerSamples.size < MLB_MISSING_PLAYER_SAMPLE_LIMIT) {
              missingPlayerSamples.add(String(mlbamId));
            }
            continue;
          }

          const gameId = `mlb_${gamePk}`;
          const fantasyResult = calculateFantasyPoints(stats);
          const statsJson = parseStatsToJson(stats);

          const homeTeamAbbr = boxscore.teams.home.team.abbreviation;
          const awayTeamAbbr = boxscore.teams.away.team.abbreviation;
          const gameSide = resolvePlayerGameSide(boxscore, mlbamId);
          const homeAway = gameSide || "away";
          const opponentTeam = gameSide === "home" ? awayTeamAbbr : homeTeamAbbr;

          const gameDate = apiGame ? new Date(apiGame.gameDate) : new Date();

          await storage.upsertPlayerGameStats({
            playerId,
            gameId,
            sport: "MLB",
            gameDate,
            season: getCurrentSeason().toString(),
            opponentTeam,
            homeAway,
            statsJson,
            fantasyPoints: fantasyResult.points.toString(),
          });

          result.statsProcessed++;
        }

        if (missingPlayerSkips > 0) {
          result.skippedMissingPlayers += missingPlayerSkips;
        }
      } catch (error: any) {
        console.error(
          `[MLB Stats Sync] Error processing game ${relevantGame.gameId}:`,
          error.message,
        );
        result.errors.push(`Game error (${relevantGame.gameId}): ${error.message}`);
      }
    }

    result.success = result.errors.length === 0;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (result.skippedMissingPlayers > 0) {
      console.log(
        `[MLB Stats Sync] Skipped ${result.skippedMissingPlayers} stat rows for players missing from the local roster`,
      );
    }
    console.log(
      `[MLB Stats Sync] Completed in ${duration}s. Processed ${result.statsProcessed} stats across ${result.gamesProcessed} games with ${result.errors.length} hard errors.`,
    );
  } catch (error: any) {
    result.errors.push(`Fatal error: ${error.message}`);
    console.error("[MLB Stats Sync] Fatal error:", error);
  }

  return result;
}

export default syncMLBStats;

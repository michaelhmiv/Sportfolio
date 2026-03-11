/**
 * NFL Stats Sync Job
 *
 * Fetches NFL player game statistics from Ball Don't Lie API for completed games.
 * Updates player_stats table and calculates fantasy points.
 */

import { storage } from "../storage";
import {
  fetchGames,
  fetchGameStats,
  calculateNFLFantasyPoints,
  parseStatsToJson,
  isNFLApiConfigured,
  createNFLPlayerId,
  type NFLGameStats,
} from "../balldontlie-nfl";
import { getTodayETBoundaries, getGameDay, getETDayBoundaries } from "../lib/time";

interface SyncResult {
  success: boolean;
  statsProcessed: number;
  gamesProcessed: number;
  errors: string[];
  skippedMissingPlayers: number;
}

const NFL_MISSING_PLAYER_SAMPLE_LIMIT = 8;

/**
 * Sync NFL stats for games occurring today and yesterday
 */
export async function syncNFLStats(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    statsProcessed: 0,
    gamesProcessed: 0,
    errors: [],
    skippedMissingPlayers: 0,
  };

  if (!isNFLApiConfigured()) {
    result.errors.push("BALLDONTLIE_API_KEY not configured");
    console.error("[NFL Stats Sync] API key not configured");
    return result;
  }

  console.log("[NFL Stats Sync] Starting stats synchronization...");
  const startTime = Date.now();

  try {
    // Fetch games from yesterday and today to catch all recent stats
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const { startOfDay: yesterdayStart } = getETDayBoundaries(getGameDay(yesterday));

    const { endOfDay: todayEnd } = getTodayETBoundaries();

    // STEP 1: First, fetch FRESH game data from the Ball Don't Lie API
    // This ensures we have current scores and statuses, not stale database values
    const yesterdayDate = getGameDay(yesterday);
    const todayDate = getGameDay(new Date());
    console.log(
      `[NFL Stats Sync] Fetching fresh game data from API for ${yesterdayDate} and ${todayDate}...`,
    );

    const apiGames = await fetchGames({ dates: [yesterdayDate, todayDate] });
    console.log(`[NFL Stats Sync] API returned ${apiGames.length} games`);

    // Update database with fresh scores and statuses from API
    let gamesUpdated = 0;
    for (const apiGame of apiGames) {
      try {
        const gameId = `nfl_${apiGame.id}`;

        // Determine game status from API
        let gameStatus = "scheduled";
        const rawStatus = apiGame.status?.toLowerCase() || "";

        if (rawStatus === "final") {
          gameStatus = "completed";
        } else if (
          rawStatus === "in progress" ||
          rawStatus === "in_progress" ||
          rawStatus === "live" ||
          rawStatus.includes("half") ||
          rawStatus.includes("qtr") ||
          rawStatus.includes("ot")
        ) {
          gameStatus = "inprogress";
        }

        // Only update if game has started (has scores or is live/completed)
        if (
          gameStatus !== "scheduled" &&
          (apiGame.home_team_score != null || apiGame.visitor_team_score != null)
        ) {
          console.log(
            `[NFL Stats Sync] Updating ${gameId}: status=${gameStatus}, scores=${apiGame.visitor_team_score}-${apiGame.home_team_score}`,
          );
          await storage.updateDailyGameScore(
            gameId,
            apiGame.home_team_score ?? 0,
            apiGame.visitor_team_score ?? 0,
            gameStatus,
          );
          gamesUpdated++;
        }
      } catch (error: any) {
        // Game might not exist in database yet, that's OK
        console.log(`[NFL Stats Sync] Could not update game ${apiGame.id}: ${error.message}`);
      }
    }
    console.log(`[NFL Stats Sync] Updated ${gamesUpdated} games with fresh scores from API`);

    // STEP 2: Now get games from database with updated statuses
    const games = await storage.getDailyGamesBySport("NFL", yesterdayStart, todayEnd);

    // DEBUG: Log all games found and their statuses
    console.log(`[NFL Stats Sync] DEBUG: Found ${games.length} total NFL games in date range`);
    if (games.length > 0) {
      const statusCounts = games.reduce(
        (acc, g) => {
          acc[g.status] = (acc[g.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      console.log(`[NFL Stats Sync] DEBUG: Game status breakdown:`, statusCounts);

      // Log first few games for debugging
      games.slice(0, 5).forEach((g) => {
        console.log(
          `[NFL Stats Sync] DEBUG: Game ${g.gameId}: ${g.awayTeam}@${g.homeTeam}, status=${g.status}, homeScore=${g.homeScore}, awayScore=${g.awayScore}`,
        );
      });
    }

    // Filter to games that are in progress or completed
    const relevantGames = games.filter(
      (g) => g.status === "inprogress" || g.status === "completed",
    );

    console.log(
      `[NFL Stats Sync] Found ${relevantGames.length} relevant NFL games (inprogress or completed) out of ${games.length} total`,
    );

    if (relevantGames.length === 0) {
      console.log(
        `[NFL Stats Sync] No active/completed NFL games to process. If games should be active, check if nfl_schedule_sync is updating game statuses.`,
      );
      result.success = true;
      return result;
    }

    // Get API game IDs (stripping 'nfl_' prefix)
    const apiGameIds = relevantGames.map((g) => parseInt(g.gameId.replace("nfl_", "")));

    // Fetch stats from API
    const allApiStats = await fetchGameStats(apiGameIds);
    console.log(`[NFL Stats Sync] Fetched ${allApiStats.length} stat lines from API`);
    const knownPlayerIds = new Set(
      (
        await storage.getPlayersByIds(
          Array.from(new Set(allApiStats.map((apiStat) => createNFLPlayerId(apiStat.player.id)))),
        )
      ).map((player) => player.id),
    );
    const missingPlayerSamples = new Set<string>();

    // Update game scores first (independent of player stats success)
    const uniqueGames = new Map<string, (typeof allApiStats)[0]["game"]>();
    allApiStats.forEach((stat) => {
      if (!uniqueGames.has(String(stat.game.id))) {
        uniqueGames.set(String(stat.game.id), stat.game);
      }
    });

    console.log(`[NFL Stats Sync] Updating scores for ${uniqueGames.size} games...`);
    for (const [gameIdStr, game] of Array.from(uniqueGames)) {
      try {
        const gameId = `nfl_${gameIdStr}`;
        let gameStatus = "scheduled";
        if (game.status === "Final" || game.status === "final") {
          gameStatus = "completed";
        } else if (game.status === "In Progress" || game.status === "in_progress") {
          gameStatus = "inprogress";
        }

        // DEBUG: Log score update details
        console.log(
          `[NFL Stats Sync] DEBUG: Updating ${gameId}: homeScore=${game.home_team_score ?? 0}, awayScore=${game.visitor_team_score ?? 0}, apiStatus="${game.status}" -> dbStatus="${gameStatus}"`,
        );

        await storage.updateDailyGameScore(
          gameId,
          game.home_team_score ?? 0,
          game.visitor_team_score ?? 0,
          gameStatus,
        );
        result.gamesProcessed++;
      } catch (error: any) {
        console.error(
          `[NFL Stats Sync] Error updating score for game ${gameIdStr}:`,
          error.message,
        );
      }
    }

    // Process each stat line
    for (const apiStat of allApiStats) {
      try {
        const playerId = createNFLPlayerId(apiStat.player.id);
        if (!knownPlayerIds.has(playerId)) {
          result.skippedMissingPlayers++;
          if (missingPlayerSamples.size < NFL_MISSING_PLAYER_SAMPLE_LIMIT) {
            missingPlayerSamples.add(String(apiStat.player.id));
          }
          continue;
        }

        const gameId = `nfl_${apiStat.game.id}`;
        const fantasyPoints = calculateNFLFantasyPoints(apiStat);
        const statsJson = parseStatsToJson(apiStat);

        // Upsert into database
        await storage.upsertPlayerGameStats({
          playerId,
          gameId,
          sport: "NFL",
          gameDate: new Date(apiStat.game.date),
          week: apiStat.game.week,
          season: apiStat.game.season.toString(),
          opponentTeam:
            apiStat.team.abbreviation === apiStat.game.home_team.abbreviation
              ? apiStat.game.visitor_team.abbreviation
              : apiStat.game.home_team.abbreviation,
          homeAway:
            apiStat.team.abbreviation === apiStat.game.home_team.abbreviation ? "home" : "away",
          statsJson,
          fantasyPoints: fantasyPoints.toString(),
        });

        result.statsProcessed++;
      } catch (error: any) {
        console.error(
          `[NFL Stats Sync] Error processing stat for player ${apiStat.player.id}:`,
          error.message,
        );
        result.errors.push(`Stat error (Player ${apiStat.player.id}): ${error.message}`);
      }
    }

    result.success = result.errors.length === 0;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    if (result.skippedMissingPlayers > 0) {
      console.warn(
        `[NFL Stats Sync] Skipped ${result.skippedMissingPlayers} stat rows for players missing from the local roster` +
          (missingPlayerSamples.size > 0
            ? ` (sample player ids: ${Array.from(missingPlayerSamples).join(", ")})`
            : ""),
      );
    }
    console.log(
      `[NFL Stats Sync] Completed in ${duration}s. Processed ${result.statsProcessed} stats across ${result.gamesProcessed} games.`,
    );
  } catch (error: any) {
    result.errors.push(`Fatal error: ${error.message}`);
    console.error("[NFL Stats Sync] Fatal error:", error);
  }

  return result;
}

export default syncNFLStats;

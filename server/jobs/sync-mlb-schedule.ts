/**
 * MLB Schedule Sync Job
 *
 * Fetches MLB games from the public MLB StatsAPI (no auth required)
 * and syncs to the daily_games table.
 */
import { storage } from "../storage";
import { fetchGamesByDateRange, normalizeGameStatus } from "../mlb-statsapi";

interface SyncResult {
  success: boolean;
  gamesProcessed: number;
  gamesAdded: number;
  gamesUpdated: number;
  errors: string[];
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function teamCode(team: any): string {
  return (
    team?.abbreviation ||
    team?.teamCode?.toUpperCase?.() ||
    team?.fileCode?.toUpperCase?.() ||
    team?.clubName ||
    team?.teamName ||
    team?.name ||
    "TBD"
  );
}

export async function syncMLBSchedule(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    gamesProcessed: 0,
    gamesAdded: 0,
    gamesUpdated: 0,
    errors: [],
  };

  console.log("[MLB Schedule Sync] Starting schedule synchronization via StatsAPI...");
  const startTime = Date.now();

  try {
    // Fetch 3 days back to 14 days forward for robust status/score updates.
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 3);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 14);

    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);

    console.log(`[MLB Schedule Sync] Fetching games from ${startStr} to ${endStr}...`);

    const apiGames = await fetchGamesByDateRange(startStr, endStr);
    console.log(`[MLB Schedule Sync] Fetched ${apiGames.length} games from StatsAPI`);

    for (const apiGame of apiGames) {
      result.gamesProcessed++;

      try {
        const gameId = `mlb_${apiGame.gamePk}`;
        const status = normalizeGameStatus(apiGame);

        const parsedStartTime = new Date(apiGame.gameDate);
        const startTime = Number.isNaN(parsedStartTime.getTime()) ? new Date() : parsedStartTime;

        const homeTeam = teamCode(apiGame.teams.home.team);
        const awayTeam = teamCode(apiGame.teams.away.team);
        const homeScore = apiGame.teams.home.score;
        const awayScore = apiGame.teams.away.score;
        const venue = apiGame.venue?.name || null;

        const gameData = {
          gameId,
          sport: "MLB",
          date: startTime,
          week: null,
          homeTeam,
          awayTeam,
          venue,
          status,
          startTime,
          homeScore,
          awayScore,
        };

        const existingGame = await storage.getDailyGameByGameId(gameId);

        if (existingGame) {
          await storage.updateDailyGame(existingGame.id, gameData);
          result.gamesUpdated++;
        } else {
          await storage.createDailyGame(gameData);
          result.gamesAdded++;
        }
      } catch (error: any) {
        result.errors.push(`Failed to sync game ${apiGame.gamePk}: ${error.message}`);
        console.error(`[MLB Schedule Sync] Error syncing game ${apiGame.gamePk}:`, error.message);
      }
    }

    result.success = result.errors.length === 0;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[MLB Schedule Sync] Completed in ${duration}s`);
    console.log(`  - Games processed: ${result.gamesProcessed}`);
    console.log(`  - Games added: ${result.gamesAdded}`);
    console.log(`  - Games updated: ${result.gamesUpdated}`);
    if (result.errors.length > 0) {
      console.log(`  - Errors: ${result.errors.length}`);
    }
  } catch (error: any) {
    result.errors.push(`Fatal error: ${error.message}`);
    console.error("[MLB Schedule Sync] Fatal error:", error);
  }

  return result;
}

export default syncMLBSchedule;

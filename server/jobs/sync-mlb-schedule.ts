/**
 * MLB Schedule Sync Job
 *
 * Fetches MLB games from Ball Don't Lie API and syncs to daily_games table.
 */

import { storage } from "../storage";
import {
  fetchGames,
  normalizeGameStatus,
  isMLBApiConfigured,
  getMLBAwayScore,
  getMLBAwayTeam,
} from "../balldontlie-mlb";

interface SyncResult {
  success: boolean;
  gamesProcessed: number;
  gamesAdded: number;
  gamesUpdated: number;
  errors: string[];
}

export async function syncMLBSchedule(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    gamesProcessed: 0,
    gamesAdded: 0,
    gamesUpdated: 0,
    errors: [],
  };

  if (!isMLBApiConfigured()) {
    result.errors.push("BALLDONTLIE_API_KEY not configured");
    console.error("[MLB Schedule Sync] API key not configured");
    return result;
  }

  console.log("[MLB Schedule Sync] Starting schedule synchronization...");
  const startTime = Date.now();

  try {
    // Fetch 3 days back to 14 days forward for robust status/score updates.
    const today = new Date();
    const dates: string[] = [];
    for (let i = -3; i <= 14; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push(date.toISOString().split("T")[0]);
    }

    console.log(
      `[MLB Schedule Sync] Fetching games for dates: ${dates[0]} to ${dates[dates.length - 1]}`,
    );

    const apiGames = await fetchGames({ dates });
    console.log(`[MLB Schedule Sync] Fetched ${apiGames.length} games from API`);

    for (const apiGame of apiGames) {
      result.gamesProcessed++;

      try {
        const gameId = `mlb_${apiGame.id}`;
        const status = normalizeGameStatus(apiGame.status);

        const parsedStartTime = new Date(apiGame.date);
        const startTime = Number.isNaN(parsedStartTime.getTime()) ? new Date() : parsedStartTime;

        const gameData = {
          gameId,
          sport: "MLB",
          date: startTime,
          week: null,
          homeTeam: apiGame.home_team?.abbreviation || "TBD",
          awayTeam: getMLBAwayTeam(apiGame)?.abbreviation || "TBD",
          venue: apiGame.venue || null,
          status,
          startTime,
          homeScore: apiGame.home_team_score ?? null,
          awayScore: getMLBAwayScore(apiGame),
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
        result.errors.push(`Failed to sync game ${apiGame.id}: ${error.message}`);
        console.error(`[MLB Schedule Sync] Error syncing game ${apiGame.id}:`, error.message);
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

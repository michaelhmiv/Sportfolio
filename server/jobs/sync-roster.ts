/**
 * Roster Sync Job
 * 
 * Fetches NBA player rosters from BallDontLie API and updates the database.
 * Updates: active status, team assignments, and vesting eligibility.
 */

import { storage } from "../storage";
import { fetchActivePlayers, createNBAPlayerId } from "../balldontlie-nba";
import { balldontlieRateLimiter } from "./rate-limiter";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

export async function syncRoster(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[roster_sync] Starting player roster sync...");

  progressCallback?.({
    type: 'info',
    timestamp: new Date().toISOString(),
    message: 'Starting roster sync job',
  });

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;

  try {
    // Fetch players with rate limiting
    progressCallback?.({
      type: 'info',
      timestamp: new Date().toISOString(),
      message: 'Fetching active players from BallDontLie API',
    });

    const players = await balldontlieRateLimiter.executeWithRetry(async () => {
      requestCount++;
      return await fetchActivePlayers();
    });

    console.log(`[roster_sync] Fetched ${players.length} players from BallDontLie`);

    progressCallback?.({
      type: 'info',
      timestamp: new Date().toISOString(),
      message: `Fetched ${players.length} players from API, updating database`,
      data: { totalPlayers: players.length, apiCalls: requestCount },
    });

    // Update players in database
    for (const player of players) {
      try {
        // BallDontLie /players/active endpoint returns only active players
        // All players from this endpoint are on active rosters
        const isActive = true;
        const isEligibleForVesting = isActive;

        await storage.upsertPlayer({
          id: createNBAPlayerId(player.id), // Prefix with sport for multi-sport support
          sport: "NBA",
          firstName: player.first_name,
          lastName: player.last_name,
          team: player.team?.abbreviation || "UNK",
          position: player.position || "G",
          jerseyNumber: player.jersey_number || "",
          isActive,
          isEligibleForVesting,
        });

        recordsProcessed++;

        // Progress update every 50 players
        if (recordsProcessed % 50 === 0) {
          progressCallback?.({
            type: 'progress',
            timestamp: new Date().toISOString(),
            message: `Updated ${recordsProcessed}/${players.length} players`,
            data: {
              current: recordsProcessed,
              total: players.length,
              percentage: Math.round((recordsProcessed / players.length) * 100),
              stats: { updated: recordsProcessed, errors: errorCount },
            },
          });
        }
      } catch (error: any) {
        console.error(`[roster_sync] Failed to update player ${player.id}:`, error.message);
        errorCount++;

        if (errorCount <= 5) { // Only log first 5 errors to avoid spam
          progressCallback?.({
            type: 'warning',
            timestamp: new Date().toISOString(),
            message: `Failed to update player ${player.first_name} ${player.last_name}: ${error.message}`,
          });
        }
      }
    }

    console.log(`[roster_sync] Successfully processed ${recordsProcessed}/${players.length} players, ${errorCount} errors`);
    console.log(`[roster_sync] API requests made: ${requestCount}`);

    progressCallback?.({
      type: 'complete',
      timestamp: new Date().toISOString(),
      message: errorCount > 0
        ? `Roster sync completed with ${errorCount} errors: ${recordsProcessed}/${players.length} players updated`
        : `Roster sync completed successfully: ${recordsProcessed} players updated`,
      data: {
        success: errorCount === 0,
        summary: {
          playersUpdated: recordsProcessed,
          errors: errorCount,
          apiCalls: requestCount,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
    console.error("[roster_sync] Failed:", error.message);

    progressCallback?.({
      type: 'error',
      timestamp: new Date().toISOString(),
      message: `Roster sync failed: ${error.message}`,
      data: { error: error.message, stack: error.stack },
    });

    progressCallback?.({
      type: 'complete',
      timestamp: new Date().toISOString(),
      message: `Roster sync failed: ${error.message}`,
      data: {
        success: false,
        summary: {
          error: error.message,
          playersUpdated: recordsProcessed,
          errors: errorCount + 1,
          apiCalls: requestCount,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount: errorCount + 1 };
  }
}

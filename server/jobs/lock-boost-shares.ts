/**
 * Lock Boost Shares Job
 * 
 * Runs frequently to lock shares for boosts when their game starts.
 * This transitions boosts from "active" to "locked" status and creates
 * holdings locks to prevent users from selling boosted shares during games.
 */

import { storage } from "../storage";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

export async function lockBoostShares(progressCallback?: ProgressCallback): Promise<JobResult> {
    console.log("[lock_boost_shares] Starting boost share locking...");

    progressCallback?.({
        type: 'info',
        timestamp: new Date().toISOString(),
        message: 'Starting boost share locking job',
    });

    let boostsLocked = 0;
    let errorCount = 0;

    try {
        // Get all active boosts that haven't been locked yet
        const activeBoosts = await storage.getDailyBoostsByStatus("active");

        console.log(`[lock_boost_shares] Found ${activeBoosts.length} active boosts to check`);

        progressCallback?.({
            type: 'info',
            timestamp: new Date().toISOString(),
            message: `Checking ${activeBoosts.length} active boosts for game start`,
        });

        const now = new Date();

        for (const boost of activeBoosts) {
            try {
                // Check if game has started
                if (!boost.gameId) {
                    console.warn(`[lock_boost_shares] Boost ${boost.id} has no gameId, skipping`);
                    continue;
                }

                const game = await storage.getDailyGameByGameId(boost.gameId);
                if (!game) {
                    console.warn(`[lock_boost_shares] Game ${boost.gameId} not found for boost ${boost.id}`);
                    continue;
                }

                const gameStart = new Date(game.startTime);

                // Lock if game has started or is about to start (within 1 minute buffer)
                if (gameStart <= new Date(now.getTime() + 60000)) {
                    console.log(`[lock_boost_shares] Locking boost ${boost.id} - game ${boost.gameId} started at ${gameStart.toISOString()}`);

                    await storage.lockBoostShares(boost.id);
                    boostsLocked++;

                    progressCallback?.({
                        type: 'info',
                        timestamp: new Date().toISOString(),
                        message: `Locked boost ${boost.id} for player game`,
                    });
                }
            } catch (boostError: any) {
                console.error(`[lock_boost_shares] Error locking boost ${boost.id}:`, boostError.message);
                errorCount++;
                progressCallback?.({
                    type: 'error',
                    timestamp: new Date().toISOString(),
                    message: `Error locking boost ${boost.id}: ${boostError.message}`,
                });
            }
        }

        console.log(`[lock_boost_shares] Complete: ${boostsLocked} boosts locked, ${errorCount} errors`);

        progressCallback?.({
            type: 'complete',
            timestamp: new Date().toISOString(),
            message: `Boost locking complete: ${boostsLocked} locked, ${errorCount} errors`,
            data: { boostsLocked, errorCount },
        });

        return {
            requestCount: 0,
            recordsProcessed: boostsLocked,
            errorCount,
        };
    } catch (error: any) {
        console.error("[lock_boost_shares] Fatal error:", error);

        progressCallback?.({
            type: 'error',
            timestamp: new Date().toISOString(),
            message: `Fatal error: ${error.message}`,
        });

        return {
            requestCount: 0,
            recordsProcessed: boostsLocked,
            errorCount: errorCount + 1,
        };
    }
}

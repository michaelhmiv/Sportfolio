/**
 * Sync Player Injuries Job
 * 
 * Fetches injury data from BallDontLie API and updates player records.
 * Requires ALL-STAR tier or higher for the injuries endpoint.
 * 
 * Runs every 30 minutes to keep injury data fresh.
 */

import "dotenv/config";
import { db } from "../db";
import { players } from "@shared/schema";
import { eq, isNotNull, and, notInArray } from "drizzle-orm";
import { fetchPlayerInjuries, createNBAPlayerId, isNBAApiConfigured } from "../balldontlie-nba";

export async function syncPlayerInjuries(): Promise<{ synced: number; cleared: number }> {
    if (!isNBAApiConfigured()) {
        console.log("[SYNC INJURIES] NBA API not configured, skipping");
        return { synced: 0, cleared: 0 };
    }

    console.log("[SYNC INJURIES] Starting injury sync...");

    try {
        // Fetch all injuries from API
        const { injuries, hasAccess } = await fetchPlayerInjuries();

        if (!hasAccess) {
            console.log("[SYNC INJURIES] Injuries endpoint unavailable (may need ALL-STAR tier), skipping");
            return { synced: 0, cleared: 0 };
        }

        // Build a map of player IDs to injury data
        const injuryMap = new Map<string, {
            status: string;
            description: string;
            returnDate: string;
        }>();

        for (const injury of injuries) {
            const playerId = createNBAPlayerId(injury.player.id);
            injuryMap.set(playerId, {
                status: injury.status,
                description: injury.description,
                returnDate: injury.return_date,
            });
        }

        const injuredPlayerIds = Array.from(injuryMap.keys());
        console.log(`[SYNC INJURIES] Processing ${injuredPlayerIds.length} injured players`);

        // Update injured players
        let synced = 0;
        const now = new Date();

        for (const [playerId, injuryData] of injuryMap) {
            try {
                const result = await db
                    .update(players)
                    .set({
                        injuryStatus: injuryData.status,
                        injuryDescription: injuryData.description,
                        injuryReturnDate: injuryData.returnDate,
                        injuryUpdatedAt: now,
                    })
                    .where(eq(players.id, playerId))
                    .returning({ id: players.id });
                
                if (result.length > 0) {
                    synced++;
                }
            } catch (err) {
                // Player might not exist in our DB - that's fine
            }
        }

        // Clear injury status for NBA players no longer on injury report
        let cleared = 0;
        // If the endpoint is accessible but returns an empty list (e.g., offseason), clear stale flags.
        const clearWhere = injuredPlayerIds.length > 0
            ? and(
                eq(players.sport, "NBA"),
                isNotNull(players.injuryStatus),
                notInArray(players.id, injuredPlayerIds)
            )
            : and(
                eq(players.sport, "NBA"),
                isNotNull(players.injuryStatus)
            );

        const clearResult = await db
            .update(players)
            .set({
                injuryStatus: null,
                injuryDescription: null,
                injuryReturnDate: null,
                injuryUpdatedAt: now,
            })
            .where(clearWhere)
            .returning({ id: players.id });

        cleared = clearResult.length;

        console.log(`[SYNC INJURIES] Synced ${synced} injured players, cleared ${cleared}`);
        return { synced, cleared };

    } catch (error: any) {
        console.error("[SYNC INJURIES] Error:", error.message);
        throw error;
    }
}

// Note: Do not add a "run directly" block (process.exit) in this module.
// This file is imported by the web server; when bundled, ESM main-module
// detection becomes unreliable and can terminate the production server.

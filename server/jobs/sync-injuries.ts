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
import { fetchInjuries as fetchMLBInjuries, createMLBPlayerId } from "../balldontlie-mlb";

export async function syncPlayerInjuries(): Promise<{ synced: number; cleared: number }> {
  if (!isNBAApiConfigured()) {
    console.log("[SYNC INJURIES] BALLDONTLIE_API_KEY not configured, skipping");
    return { synced: 0, cleared: 0 };
  }

  console.log("[SYNC INJURIES] Starting injury sync...");
  const now = new Date();
  let totalSynced = 0;
  let totalCleared = 0;

  try {
    // Fetch all injuries from API
    const { injuries, hasAccess } = await fetchPlayerInjuries();

    if (!hasAccess) {
      console.log(
        "[SYNC INJURIES] Injuries endpoint unavailable (may need ALL-STAR tier), skipping",
      );
      return { synced: 0, cleared: 0 };
    }

    // Build a map of NBA player IDs to injury data
    const nbaInjuryMap = new Map<
      string,
      {
        status: string;
        description: string;
        returnDate: string;
      }
    >();

    for (const injury of injuries) {
      const playerId = createNBAPlayerId(injury.player.id);
      nbaInjuryMap.set(playerId, {
        status: injury.status,
        description: injury.description,
        returnDate: injury.return_date,
      });
    }

    const injuredNbaPlayerIds = Array.from(nbaInjuryMap.keys());
    console.log(`[SYNC INJURIES] Processing ${injuredNbaPlayerIds.length} NBA injured players`);

    // Update injured players
    for (const [playerId, injuryData] of nbaInjuryMap) {
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
          totalSynced++;
        }
      } catch (err) {
        // Player might not exist in our DB - that's fine
      }
    }

    // Clear injury status for NBA players no longer on injury report
    // If the endpoint is accessible but returns an empty list (e.g., offseason), clear stale flags.
    const clearNbaWhere =
      injuredNbaPlayerIds.length > 0
        ? and(
            eq(players.sport, "NBA"),
            isNotNull(players.injuryStatus),
            notInArray(players.id, injuredNbaPlayerIds),
          )
        : and(eq(players.sport, "NBA"), isNotNull(players.injuryStatus));

    const clearNbaResult = await db
      .update(players)
      .set({
        injuryStatus: null,
        injuryDescription: null,
        injuryReturnDate: null,
        injuryUpdatedAt: now,
      })
      .where(clearNbaWhere)
      .returning({ id: players.id });

    totalCleared += clearNbaResult.length;

    try {
      const mlbInjuries = await fetchMLBInjuries();

      const mlbInjuryMap = new Map<
        string,
        {
          status: string;
          description: string;
          returnDate: string | null;
        }
      >();

      for (const injury of mlbInjuries) {
        const playerId = createMLBPlayerId(injury.player.id);
        mlbInjuryMap.set(playerId, {
          status: injury.status,
          description: injury.description || injury.injury || "Injury report",
          returnDate: injury.return_date || null,
        });
      }

      const injuredMlbPlayerIds = Array.from(mlbInjuryMap.keys());
      console.log(`[SYNC INJURIES] Processing ${injuredMlbPlayerIds.length} MLB injured players`);

      for (const [playerId, injuryData] of mlbInjuryMap) {
        try {
          const updateResult = await db
            .update(players)
            .set({
              injuryStatus: injuryData.status,
              injuryDescription: injuryData.description,
              injuryReturnDate: injuryData.returnDate,
              injuryUpdatedAt: now,
            })
            .where(eq(players.id, playerId))
            .returning({ id: players.id });

          if (updateResult.length > 0) {
            totalSynced++;
          }
        } catch {
          // Player might not exist in our DB - that's fine
        }
      }

      const clearMlbWhere =
        injuredMlbPlayerIds.length > 0
          ? and(
              eq(players.sport, "MLB"),
              isNotNull(players.injuryStatus),
              notInArray(players.id, injuredMlbPlayerIds),
            )
          : and(eq(players.sport, "MLB"), isNotNull(players.injuryStatus));

      const clearMlbResult = await db
        .update(players)
        .set({
          injuryStatus: null,
          injuryDescription: null,
          injuryReturnDate: null,
          injuryUpdatedAt: now,
        })
        .where(clearMlbWhere)
        .returning({ id: players.id });

      totalCleared += clearMlbResult.length;
    } catch (error: any) {
      console.warn("[SYNC INJURIES] MLB injury sync skipped:", error.message);
    }

    console.log(`[SYNC INJURIES] Synced ${totalSynced} injured players, cleared ${totalCleared}`);
    return { synced: totalSynced, cleared: totalCleared };
  } catch (error: any) {
    console.error("[SYNC INJURIES] Error:", error.message);
    throw error;
  }
}

// Note: Do not add a "run directly" block (process.exit) in this module.
// This file is imported by the web server; when bundled, ESM main-module
// detection becomes unreliable and can terminate the production server.

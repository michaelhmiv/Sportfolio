#!/usr/bin/env tsx
/**
 * Seed player pools for all active players
 * Run this after AMM migration if pools don't exist
 */

import { db } from "../server/db";
import { players, playerPools } from "../shared/schema";
import { eq } from "drizzle-orm";

async function seedPlayerPools() {
  console.log("[SEED] Starting player pool creation...");

  try {
    // Get all active players without pools
    const activePlayers = await db
      .select({ id: players.id, firstName: players.firstName, lastName: players.lastName })
      .from(players)
      .where(eq(players.isActive, true));

    console.log(`[SEED] Found ${activePlayers.length} active players`);

    let createdCount = 0;
    let existingCount = 0;
    let errorCount = 0;

    for (const player of activePlayers) {
      try {
        // Check if pool already exists
        const [existingPool] = await db
          .select({ playerId: playerPools.playerId })
          .from(playerPools)
          .where(eq(playerPools.playerId, player.id));

        if (existingPool) {
          existingCount++;
          continue;
        }

        // Create pool for this player
        await db.insert(playerPools).values({
          playerId: player.id,
          shares: "1000",
          playMoney: "10000",
          k: "10000000",
          lpSharesTotal: "1000",
          feesAccumulated: "0",
          totalVolume: "0",
          totalTrades: 0,
        });

        createdCount++;

        if (createdCount % 100 === 0) {
          console.log(`[SEED] Created ${createdCount} pools...`);
        }
      } catch (err: any) {
        errorCount++;
        console.error(`[SEED] Error creating pool for ${player.id}:`, err.message);
      }
    }

    console.log(
      `[SEED] Complete! Created: ${createdCount}, Existing: ${existingCount}, Errors: ${errorCount}`,
    );
    process.exit(0);
  } catch (error: any) {
    console.error("[SEED] Fatal error:", error.message);
    process.exit(1);
  }
}

seedPlayerPools();

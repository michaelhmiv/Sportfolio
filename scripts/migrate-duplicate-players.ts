/**
 * Migration script to merge duplicate player entries
 *
 * This script:
 * 1. Identifies players with duplicate (first_name, last_name, sport)
 * 2. Chooses the canonical ID (prefers BallDontLie nba_XXX format)
 * 3. Migrates all references from old IDs to canonical ID
 * 4. Deletes duplicate entries
 */

import "dotenv/config";
import { db } from "../server/db";
import {
  players,
  orders,
  trades,
  playerGameStats,
  priceHistory,
  contestLineups,
  scoutAssignments,
  scoutDistributions,
  scoutHistory,
  vesting,
  vestingSplits,
  vestingClaims,
  watchList,
  playerPools,
  lpPositions,
  lpTransactions,
  dailyBoosts,
  boostPayouts,
  communityBoosts,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

interface PlayerDuplicate {
  firstName: string;
  lastName: string;
  sport: string;
  count: number;
  playerIds: string[];
  canonicalId: string;
  oldIds: string[];
}

async function migrateDuplicatePlayers() {
  console.log("=== Player Duplicate Migration Script ===");

  try {
    // Step 1: Find all duplicate players
    console.log("\n[STEP 1] Finding duplicate players...");
    const duplicateResults = await db.execute(sql`
      SELECT
        first_name,
        last_name,
        sport,
        COUNT(*) as player_count,
        array_agg(id ORDER BY id) as player_ids
      FROM players
      GROUP BY first_name, last_name, sport
      HAVING COUNT(*) > 1
      ORDER BY player_count DESC, last_name, first_name
    `);

    const duplicates: PlayerDuplicate[] = duplicateResults.rows.map((row) => {
      const ids = row.player_ids as string[];
      // Choose canonical ID: prefer nba_XXX or nfl_XXX format
      const canonicalId =
        ids.find((id) => id.startsWith("nba_") || id.startsWith("nfl_")) || ids[0];
      const oldIds = ids.filter((id) => id !== canonicalId);

      return {
        firstName: row.first_name,
        lastName: row.last_name,
        sport: row.sport,
        count: row.player_count,
        playerIds: ids,
        canonicalId,
        oldIds,
      };
    });

    console.log(`Found ${duplicates.length} players with duplicates:`);

    if (duplicates.length === 0) {
      console.log("No duplicate players found. Migration not needed.");
      return;
    }

    // Display duplicates found
    for (const dup of duplicates) {
      console.log(`- ${dup.firstName} ${dup.lastName} (${dup.sport}): ${dup.count} entries`);
      console.log(`  Canonical ID: ${dup.canonicalId}`);
      console.log(`  Old IDs: ${dup.oldIds.join(", ")}`);
    }

    console.log("\n[STEP 2] Migrating data to canonical player IDs...");

    const migrationResults = {
      orders: 0,
      trades: 0,
      playerGameStats: 0,
      priceHistory: 0,
      contestLineups: 0,
      scoutAssignments: 0,
      scoutDistributions: 0,
      scoutHistory: 0,
      vesting: 0,
      vestingSplits: 0,
      vestingClaims: 0,
      watchList: 0,
      playerPools: 0,
      lpPositions: 0,
      lpTransactions: 0,
      dailyBoosts: 0,
      boostPayouts: 0,
      communityBoosts: 0,
    };

    // Collect all old IDs and create ID mapping
    const idMap = new Map<string, string>();
    for (const dup of duplicates) {
      for (const oldId of dup.oldIds) {
        idMap.set(oldId, dup.canonicalId);
      }
    }

    // Migrate each table
    console.log("\nMigrating orders...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(orders)
        .set({ playerId: newId })
        .where(eq(orders.playerId, oldId))
        .returning();
      migrationResults.orders += result.length;
    }

    console.log("Migrating trades...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(trades)
        .set({ playerId: newId })
        .where(eq(trades.playerId, oldId))
        .returning();
      migrationResults.trades += result.length;
    }

    console.log("Migrating playerGameStats...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(playerGameStats)
        .set({ playerId: newId })
        .where(eq(playerGameStats.playerId, oldId))
        .returning();
      migrationResults.playerGameStats += result.length;
    }

    console.log("Migrating priceHistory...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(priceHistory)
        .set({ playerId: newId })
        .where(eq(priceHistory.playerId, oldId))
        .returning();
      migrationResults.priceHistory += result.length;
    }

    console.log("Migrating contestLineups...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(contestLineups)
        .set({ playerId: newId })
        .where(eq(contestLineups.playerId, oldId))
        .returning();
      migrationResults.contestLineups += result.length;
    }

    console.log("Migrating scoutAssignments...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(scoutAssignments)
        .set({ playerId: newId })
        .where(eq(scoutAssignments.playerId, oldId))
        .returning();
      migrationResults.scoutAssignments += result.length;
    }

    console.log("Migrating scoutDistributions...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(scoutDistributions)
        .set({ playerId: newId })
        .where(eq(scoutDistributions.playerId, oldId))
        .returning();
      migrationResults.scoutDistributions += result.length;
    }

    console.log("Migrating scoutHistory...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(scoutHistory)
        .set({ playerId: newId })
        .where(eq(scoutHistory.playerId, oldId))
        .returning();
      migrationResults.scoutHistory += result.length;
    }

    console.log("Migrating vesting...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(vesting)
        .set({ playerId: newId })
        .where(eq(vesting.playerId, oldId))
        .returning();
      migrationResults.vesting += result.length;
    }

    console.log("Migrating vestingSplits...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(vestingSplits)
        .set({ playerId: newId })
        .where(eq(vestingSplits.playerId, oldId))
        .returning();
      migrationResults.vestingSplits += result.length;
    }

    console.log("Migrating vestingClaims...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(vestingClaims)
        .set({ playerId: newId })
        .where(eq(vestingClaims.playerId, oldId))
        .returning();
      migrationResults.vestingClaims += result.length;
    }

    console.log("Migrating watchList...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(watchList)
        .set({ playerId: newId })
        .where(eq(watchList.playerId, oldId))
        .returning();
      migrationResults.watchList += result.length;
    }

    console.log("Migrating playerPools...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(playerPools)
        .set({ playerId: newId })
        .where(eq(playerPools.playerId, oldId))
        .returning();
      migrationResults.playerPools += result.length;
    }

    console.log("Migrating lpPositions...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(lpPositions)
        .set({ playerId: newId })
        .where(eq(lpPositions.playerId, oldId))
        .returning();
      migrationResults.lpPositions += result.length;
    }

    console.log("Migrating lpTransactions...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(lpTransactions)
        .set({ playerId: newId })
        .where(eq(lpTransactions.playerId, oldId))
        .returning();
      migrationResults.lpTransactions += result.length;
    }

    console.log("Migrating dailyBoosts...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(dailyBoosts)
        .set({ playerId: newId })
        .where(eq(dailyBoosts.playerId, oldId))
        .returning();
      migrationResults.dailyBoosts += result.length;
    }

    console.log("Migrating boostPayouts...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(boostPayouts)
        .set({ playerId: newId })
        .where(eq(boostPayouts.playerId, oldId))
        .returning();
      migrationResults.boostPayouts += result.length;
    }

    console.log("Migrating communityBoosts...");
    for (const [oldId, newId] of idMap.entries()) {
      const result = await db
        .update(communityBoosts)
        .set({ playerId: newId })
        .where(eq(communityBoosts.playerId, oldId))
        .returning();
      migrationResults.communityBoosts += result.length;
    }

    console.log("\n[STEP 3] Deleting duplicate player entries...");
    let deletedCount = 0;
    for (const oldId of idMap.keys()) {
      const result = await db.delete(players).where(eq(players.id, oldId)).returning();
      deletedCount += result.length;
    }
    console.log(`Deleted ${deletedCount} duplicate player entries`);

    console.log("\n=== Migration Summary ===");
    console.log(`Duplicates found: ${duplicates.length} players`);
    console.log(`Entries deleted: ${deletedCount}`);
    console.log("\nMigrated records:");
    console.log(`  - orders: ${migrationResults.orders}`);
    console.log(`  - trades: ${migrationResults.trades}`);
    console.log(`  - playerGameStats: ${migrationResults.playerGameStats}`);
    console.log(`  - priceHistory: ${migrationResults.priceHistory}`);
    console.log(`  - contestLineups: ${migrationResults.contestLineups}`);
    console.log(`  - scoutAssignments: ${migrationResults.scoutAssignments}`);
    console.log(`  - scoutDistributions: ${migrationResults.scoutDistributions}`);
    console.log(`  - scoutHistory: ${migrationResults.scoutHistory}`);
    console.log(`  - vesting: ${migrationResults.vesting}`);
    console.log(`  - vestingSplits: ${migrationResults.vestingSplits}`);
    console.log(`  - vestingClaims: ${migrationResults.vestingClaims}`);
    console.log(`  - watchList: ${migrationResults.watchList}`);
    console.log(`  - playerPools: ${migrationResults.playerPools}`);
    console.log(`  - lpPositions: ${migrationResults.lpPositions}`);
    console.log(`  - lpTransactions: ${migrationResults.lpTransactions}`);
    console.log(`  - dailyBoosts: ${migrationResults.dailyBoosts}`);
    console.log(`  - boostPayouts: ${migrationResults.boostPayouts}`);
    console.log(`  - communityBoosts: ${migrationResults.communityBoosts}`);

    console.log("\n== Migration Complete Successfully! ==");
  } catch (error: any) {
    console.error("\n!!! Migration Failed !!!");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

migrateDuplicatePlayers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

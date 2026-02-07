/**
 * Debug script to check share locks for a user/player
 */

import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users, holdings, holdingsLocks, players } from "../shared/schema";
import { eq, and } from "drizzle-orm";

async function debug() {
  console.log("\n=== Share Lock Debug Script ===\n");

  // Get dev user
  const [devUser] = await db.select().from(users).limit(1);
  if (!devUser) {
    console.log("❌ No users found");
    return;
  }
  console.log(`User: ${devUser.username || devUser.id}`);

  // Get all user holdings
  console.log("\n--- User Holdings ---");
  const userHoldings = await db
    .select({
      holding: holdings,
      player: players,
    })
    .from(holdings)
    .innerJoin(players, eq(holdings.assetId, players.id))
    .where(eq(holdings.userId, devUser.id));

  for (const h of userHoldings) {
    console.log(
      `  ${h.player.firstName} ${h.player.lastName} (${h.player.team}): ${h.holding.quantity} shares, powerLevel: ${h.holding.powerLevel}`,
    );
  }

  // Check locks for each holding
  console.log("\n--- Locks per Holding ---");
  for (const h of userHoldings) {
    const locks = await db
      .select()
      .from(holdingsLocks)
      .where(and(eq(holdingsLocks.userId, devUser.id), eq(holdingsLocks.assetId, h.player.id)));

    const totalLocked = locks.reduce((sum, l) => sum + l.lockedQuantity, 0);
    const available = h.holding.quantity - totalLocked;

    console.log(`\n  ${h.player.firstName} ${h.player.lastName}:`);
    console.log(`    Total shares: ${h.holding.quantity}`);
    console.log(`    Total locked: ${totalLocked}`);
    console.log(`    Available: ${available}`);

    if (locks.length > 0) {
      console.log(`    Lock details:`);
      for (const lock of locks) {
        console.log(
          `      - ${lock.lockType}: ${lock.lockedQuantity} (ref: ${lock.lockReferenceId})`,
        );
      }
    }
  }

  // Check getTotalLockedQuantity vs direct sum
  console.log("\n--- Compare getTotalLockedQuantity vs Direct Sum ---");
  for (const h of userHoldings.slice(0, 3)) {
    const lockedQty = await storage.getTotalLockedQuantity(devUser.id, "player", h.player.id);
    console.log(
      `  ${h.player.firstName} ${h.player.lastName}: getTotalLockedQuantity=${lockedQty}`,
    );
  }

  // Check getAvailableShares
  console.log("\n--- getAvailableShares ---");
  for (const h of userHoldings.slice(0, 3)) {
    const available = await storage.getAvailableShares(devUser.id, "player", h.player.id);
    console.log(`  ${h.player.firstName} ${h.player.lastName}: available=${available}`);
  }

  console.log("\n=== Debug Complete ===\n");
}

debug().catch(console.error);

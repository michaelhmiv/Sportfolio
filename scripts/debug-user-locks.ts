/**
 * Debug script - Check locks for a specific user
 * Usage: npx tsx scripts/debug-user-locks.ts [user_id]
 */

import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users, holdings, holdingsLocks, players } from "../shared/schema";
import { eq, and } from "drizzle-orm";

async function debug() {
  const userId = process.argv[2];
  if (!userId) {
    console.log("Usage: npx tsx scripts/debug-user-locks.ts [user_id]");
    return;
  }

  console.log("\n=== User Locks Debug ===\n");

  // Get user
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    console.log("User not found");
    return;
  }
  console.log(`User: ${user.username || user.id}`);

  // Get all holdings
  console.log("\n--- All Holdings ---");
  const userHoldings = await db
    .select({
      holding: holdings,
      player: players,
    })
    .from(holdings)
    .leftJoin(players, eq(holdings.assetId, players.id))
    .where(eq(holdings.userId, userId));

  for (const h of userHoldings) {
    console.log(
      `  ${h.player?.firstName || "N/A"} ${h.player?.lastName || "N/A"} (${h.player?.team || "N/A"}): ${h.holding.quantity} shares, powerLevel: ${h.holding.powerLevel || "0"}`,
    );
  }

  // Get all locks for user
  console.log("\n--- All Locks ---");
  const userLocks = await db.select().from(holdingsLocks).where(eq(holdingsLocks.userId, userId));

  console.log(`Found ${userLocks.length} lock records\n`);

  for (const lock of userLocks) {
    // Try to get player name
    const [player] = await db.select().from(players).where(eq(players.id, lock.assetId));
    const playerName = player ? `${player.firstName} ${player.lastName}` : "Unknown";

    console.log(
      `  ${playerName} (${lock.assetType}): ${lock.lockType} - ${lock.lockedQuantity} locked (ref: ${lock.lockReferenceId})`,
    );
  }

  // Check available shares for players with holdings
  console.log("\n--- Available Shares Calculation ---");
  for (const h of userHoldings.filter((h) => h.holding.quantity > 0)) {
    const available = await storage.getAvailableShares(userId, "player", h.holding.assetId);
    const totalLocked = await storage.getTotalLockedQuantity(userId, "player", h.holding.assetId);
    const playerName = h.player ? `${h.player.firstName} ${h.player.lastName}` : h.holding.assetId;

    console.log(`${playerName}:`);
    console.log(
      `  Total: ${h.holding.quantity} | Locked: ${totalLocked} | Available: ${available}`,
    );
  }

  console.log("\n=== Debug Complete ===\n");
}

debug().catch(console.error);

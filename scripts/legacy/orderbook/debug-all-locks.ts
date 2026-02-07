/**
 * Debug script - Check all locks across the system
 */

import "dotenv/config";
import { db } from "../../../server/db";
import { holdingsLocks, orders, holdings } from "../../../shared/schema";
import { eq, and, desc } from "drizzle-orm";

async function debug() {
  console.log("\n=== All Holdings Locks Debug ===\n");

  // Check all locks
  const allLocks = await db
    .select()
    .from(holdingsLocks)
    .orderBy(desc(holdingsLocks.createdAt))
    .limit(50);

  console.log(`Found ${allLocks.length} lock records (showing latest 50):\n`);

  const lockByType: Record<string, number> = {};
  const lockByUser: Record<string, { count: number; total: number }> = {};

  for (const lock of allLocks) {
    console.log(
      `User: ${lock.userId.substring(0, 8)}... | Asset: ${lock.assetId.substring(0, 8)}... | Type: ${lock.lockType} | Qty: ${lock.lockedQuantity}`,
    );

    // Group by type
    lockByType[lock.lockType] = (lockByType[lock.lockType] || 0) + lock.lockedQuantity;

    // Group by user
    if (!lockByUser[lock.userId]) {
      lockByUser[lock.userId] = { count: 0, total: 0 };
    }
    lockByUser[lock.userId].count++;
    lockByUser[lock.userId].total += lock.lockedQuantity;
  }

  console.log("\n--- Summary by Lock Type ---");
  for (const [type, qty] of Object.entries(lockByType)) {
    console.log(`  ${type}: ${qty} total locked`);
  }

  console.log("\n--- Users with most locked ---");
  const sortedUsers = Object.entries(lockByUser)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);
  for (const [userId, data] of sortedUsers) {
    console.log(`  ${userId.substring(0, 8)}...: ${data.count} locks, ${data.total} total locked`);
  }

  // Check open orders that might have locked shares
  console.log("\n--- Open Orders (for reference) ---");
  const openOrders = await db.select().from(orders).where(eq(orders.status, "open")).limit(20);
  console.log(`Found ${openOrders.length} open orders`);

  console.log("\n=== Debug Complete ===\n");
}

debug().catch(console.error);

/**
 * Debug script - Check Cade Cunningham shares for dev-user-12345678
 */

import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users, holdings, holdingsLocks, players, dailyBoosts, dailyGames } from "../shared/schema";
import { eq, and, gte, lt, or } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function debug() {
  console.log("\n=== Debug: dev-user-12345678 Cade Cunningham ===\n");

  const userId = "dev-user-12345678";

  // Find the user
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    console.log("User not found");
    return;
  }
  console.log(`User: ${user.username} (${user.id})`);

  // Find Cade Cunningham (DET)
  const [cade] = await db
    .select()
    .from(players)
    .where(and(eq(players.lastName, "Cunningham"), eq(players.team, "DET")));

  if (!cade) {
    console.log("Cade Cunningham not found");
    return;
  }
  console.log(`Player: ${cade.firstName} ${cade.lastName} (${cade.team}) - ID: ${cade.id}`);

  // Check all user holdings with player names
  console.log("\n--- All User Holdings ---");
  const userHoldings = await db
    .select({
      holding: holdings,
      player: players,
    })
    .from(holdings)
    .innerJoin(players, eq(holdings.assetId, players.id))
    .where(eq(holdings.userId, userId));

  for (const h of userHoldings) {
    console.log(
      `  ${h.player.firstName} ${h.player.lastName} (${h.player.team}): ${h.holding.quantity} shares, PL: ${h.holding.powerLevel || "0"}`,
    );
  }

  // Check Cade's holding
  console.log("\n--- Cade Cunningham Holding ---");
  const [cadeHolding] = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, user.id), eq(holdings.assetId, cade.id)));

  if (cadeHolding) {
    console.log(`  Quantity: ${cadeHolding.quantity}`);
    console.log(`  Power Level: ${cadeHolding.powerLevel || "0"}`);
  } else {
    console.log("  No holding for Cade found!");
  }

  // Check locks for Cade
  console.log("\n--- Cade Locks ---");
  const locks = await db
    .select()
    .from(holdingsLocks)
    .where(and(eq(holdingsLocks.userId, user.id), eq(holdingsLocks.assetId, cade.id)));

  if (locks.length > 0) {
    console.log(`Found ${locks.length} lock(s):`);
    for (const lock of locks) {
      console.log(
        `  - Type: ${lock.lockType}, Qty: ${lock.lockedQuantity}, Ref: ${lock.lockReferenceId}`,
      );
    }
  } else {
    console.log("No locks found for Cade");
  }

  // Calculate available shares
  console.log("\n--- Available Shares Calculation ---");
  const totalLocked = await storage.getTotalLockedQuantity(user.id, "player", cade.id);
  const available = await storage.getAvailableShares(user.id, "player", cade.id);

  console.log(`  Total holding: ${cadeHolding?.quantity || 0}`);
  console.log(`  Total locked: ${totalLocked}`);
  console.log(`  Available (formula): ${(cadeHolding?.quantity || 0) - totalLocked}`);
  console.log(`  Available (storage.getAvailableShares): ${available}`);

  // Check if Cade has a game today
  console.log("\n--- Today's Games for DET ---");
  const todayET = getTodayET();
  const { startOfDay, endOfDay } = getETDayBoundaries(todayET);

  const todaysGames = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        eq(dailyGames.sport, "NBA"),
        or(eq(dailyGames.homeTeam, cade.team), eq(dailyGames.awayTeam, cade.team)),
        gte(dailyGames.startTime, startOfDay),
        lt(dailyGames.startTime, endOfDay),
      ),
    );

  console.log(`Games for ${cade.team} today: ${todaysGames.length}`);
  for (const g of todaysGames) {
    console.log(`  ${g.awayTeam} @ ${g.homeTeam} at ${new Date(g.startTime).toLocaleString()}`);
  }

  // Check all NBA games today
  const allNbaGames = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        eq(dailyGames.sport, "NBA"),
        gte(dailyGames.startTime, startOfDay),
        lt(dailyGames.startTime, endOfDay),
      ),
    );
  console.log(`\nTotal NBA games today: ${allNbaGames.length}`);
  for (const g of allNbaGames) {
    console.log(`  ${g.awayTeam} @ ${g.homeTeam}`);
  }

  // Check eligible players for this user
  console.log("\n--- getEligiblePlayersForBoost ---");
  const eligible = await storage.getEligiblePlayersForBoost(user.id, "NBA", new Date());
  console.log(`Total eligible players: ${eligible.length}`);

  const cadeEligible = eligible.find((e) => e.player.id === cade.id);
  if (cadeEligible) {
    console.log(`Cade Cunningham IS eligible:`);
    console.log(`  Available shares: ${cadeEligible.availableShares}`);
    console.log(`  Power level: ${cadeEligible.powerLevel}`);
    console.log(`  Game ID: ${cadeEligible.gameId}`);
  } else {
    console.log("Cade Cunningham is NOT in the eligible list");
    console.log("\nAll eligible players:");
    for (const e of eligible) {
      console.log(
        `  - ${e.player.firstName} ${e.player.lastName} (${e.player.team}): ${e.availableShares} shares, PL: ${e.powerLevel}`,
      );
    }
  }

  console.log("\n=== Debug Complete ===\n");
}

debug().catch(console.error);

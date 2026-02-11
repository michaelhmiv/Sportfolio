/**
 * Debug script - Check API response for eligible players
 */

import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users, holdings, holdingsLocks, players, dailyBoosts, dailyGames } from "../shared/schema";
import { eq, and, gte, lt, or } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function debug() {
  console.log("\n=== Check API Response for dev-user-12345678 ===\n");

  const userId = "dev-user-12345678";

  // Find the user
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    console.log("User not found");
    return;
  }
  console.log(`User: ${user.username} (${user.id})`);

  // Find Jalen Brunson (NYK)
  const [brunson] = await db
    .select()
    .from(players)
    .where(and(eq(players.lastName, "Brunson"), eq(players.team, "NYK")));

  if (!brunson) {
    console.log("Jalen Brunson not found");
    return;
  }
  console.log(
    `Player: ${brunson.firstName} ${brunson.lastName} (${brunson.team}) - ID: ${brunson.id}`,
  );

  // Simulate what the API does
  const todayET = getTodayET();
  const { startOfDay, endOfDay } = getETDayBoundaries(todayET);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

  console.log(`\nDate: ${todayET}`);
  console.log(`Target date for API: ${targetDate.toISOString()}`);

  // Get eligible players (same as API does)
  const eligiblePlayers = await storage.getEligiblePlayersForBoost(userId, "NBA", targetDate);

  // Get current boosts (same as API does)
  const currentBoosts = await storage.getDailyBoosts(userId, "NBA", targetDate);
  const boostedPlayerIds = new Set(currentBoosts.map((b) => b.playerId));

  // Get community boosts
  const communityBoosts = await storage.getCommunityBoostsForDate("NBA", targetDate);
  const communityBoostMap = new Map<string, number>();
  communityBoosts.forEach((cb) => {
    const current = communityBoostMap.get(cb.playerId) || 0;
    communityBoostMap.set(cb.playerId, current + 1);
  });

  // Get user's premium shares
  const userHoldings = await db.select().from(holdings).where(eq(holdings.userId, userId));
  const premiumHolding = userHoldings.find((h) => h.assetType === "premium");
  const userPremiumShares = premiumHolding?.quantity || 0;

  // Build the result (same as API does)
  const result = eligiblePlayers.map((ep) => ({
    playerId: ep.player.id,
    player: ep.player,
    availableShares: ep.availableShares,
    powerLevel: ep.powerLevel,
    totalShares: ep.quantity,
    gameId: ep.gameId,
    gameStartTime: ep.gameStartTime,
    isAlreadyBoosted: boostedPlayerIds.has(ep.player.id),
    gameStarted: ep.gameStartTime ? new Date(ep.gameStartTime) <= new Date() : false,
    communityBoostCount: communityBoostMap.get(ep.player.id) || 0,
    hasCommunityBoost: communityBoostMap.has(ep.player.id),
    userPremiumShares,
  }));

  // Find Brunson in the result
  const brunsonResult = result.find((r) => r.playerId === brunson.id);

  console.log("\n--- API Response for Jalen Brunson ---");
  if (brunsonResult) {
    console.log(JSON.stringify(brunsonResult, null, 2));
  } else {
    console.log("Jalen Brunson NOT in result!");
    console.log("\nAll eligible players:");
    for (const r of result) {
      console.log(
        `  - ${r.player.firstName} ${r.player.lastName} (${r.player.team}): ${r.availableShares} shares`,
      );
    }
  }

  console.log("\n=== Debug Complete ===\n");
}

debug().catch(console.error);

/**
 * Debug script for Daily Boosts issues - Verbose version
 */

import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users, players, holdings, dailyGames } from "../shared/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { getTodayET, getETDayBoundaries, getGameDay } from "../server/lib/time";

async function debug() {
  console.log("\n=== Daily Boosts Debug Script (Verbose) ===\n");

  // 1. Check today's date in ET
  const todayET = getTodayET();
  const { startOfDay, endOfDay } = getETDayBoundaries(todayET);

  console.log("Date Info:");
  console.log(`  Today ET: ${todayET}`);
  console.log(`  Start of Day (UTC): ${startOfDay.toISOString()}`);
  console.log(`  End of Day (UTC): ${endOfDay.toISOString()}`);
  console.log(`  Current time (UTC): ${new Date().toISOString()}`);

  // 2. Check NBA games in dailyGames for today
  console.log("\n--- NBA Games Today ---");
  const todaysGames = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        eq(dailyGames.sport, "NBA"),
        gte(dailyGames.startTime, startOfDay),
        lt(dailyGames.startTime, endOfDay),
      ),
    );

  console.log(`Found ${todaysGames.length} NBA games for today`);

  // Create team set
  const teamsWithGames = new Set<string>();
  todaysGames.forEach((game, i) => {
    teamsWithGames.add(game.homeTeam);
    teamsWithGames.add(game.awayTeam);
    console.log(
      `  ${i + 1}. ${game.awayTeam} @ ${game.homeTeam} (${new Date(game.startTime).toLocaleTimeString()})`,
    );
  });
  console.log(`Teams with games: ${Array.from(teamsWithGames).sort().join(", ")}`);

  // 3. Get test user
  const [testUser] = await db.select().from(users).limit(1);
  if (!testUser) {
    console.log("\n❌ No users found in database");
    return;
  }
  console.log(`\n--- User: ${testUser.username || testUser.id} ---`);

  // 4. Check user's NBA holdings
  console.log("\n--- User's NBA Holdings ---");
  const userHoldings = await db
    .select({
      holding: holdings,
      player: players,
    })
    .from(holdings)
    .innerJoin(players, eq(holdings.assetId, players.id))
    .where(
      and(
        eq(holdings.userId, testUser.id),
        eq(holdings.assetType, "player"),
        eq(players.sport, "NBA"),
      ),
    );

  console.log(`User has ${userHoldings.length} NBA player holdings`);

  if (userHoldings.length === 0) {
    console.log("❌ NO NBA HOLDINGS - This is why no eligible players appear!");
    return;
  }

  // 5. Check each holding against games
  console.log("\n--- Eligibility Analysis ---");
  let matchCount = 0;
  for (const h of userHoldings) {
    const team = h.player.team;
    const hasGame = teamsWithGames.has(team);
    const hasShares = h.holding.quantity > 0 || parseFloat(h.holding.powerLevel || "0") > 0;

    const status = hasGame && hasShares ? "✅ ELIGIBLE" : !hasGame ? "❌ No game" : "❌ No shares";

    if (hasGame) matchCount++;

    console.log(
      `  ${h.player.firstName} ${h.player.lastName} (${team}) | Qty: ${h.holding.quantity} PL: ${h.holding.powerLevel || "0.00"} | ${status}`,
    );
  }

  console.log(`\n${matchCount} of ${userHoldings.length} holdings have teams playing today`);

  // 6. List all unique teams in user's holdings
  const userTeams = new Set(userHoldings.map((h) => h.player.team));
  console.log(`\nUser's teams: ${Array.from(userTeams).sort().join(", ")}`);

  // Check for overlap
  const overlap = Array.from(userTeams).filter((t) => teamsWithGames.has(t));
  console.log(`Teams with games today: ${overlap.length > 0 ? overlap.join(", ") : "NONE"}`);

  // 7. Final call to storage method
  console.log("\n--- storage.getEligiblePlayersForBoost() ---");
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
  const eligible = await storage.getEligiblePlayersForBoost(testUser.id, "NBA", targetDate);
  console.log(`Returned ${eligible.length} eligible players`);

  if (eligible.length > 0) {
    eligible.forEach((ep) => {
      console.log(
        `  ✅ ${ep.player.firstName} ${ep.player.lastName} | Shares: ${ep.availableShares} | PL: ${ep.powerLevel}`,
      );
    });
  }

  console.log("\n=== Debug Complete ===\n");
}

debug().catch((err) => {
  console.error("Debug failed:", err);
  process.exit(1);
});

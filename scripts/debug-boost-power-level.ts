import "dotenv/config";
import { db } from "../server/db";
import { holdings, dailyBoosts, players } from "../shared/schema";
import { eq, and } from "drizzle-orm";

async function checkUserHoldingsAndBoosts() {
  console.log("=== Checking dev-user holdings and boosts ===\n");

  // Your user ID
  const userId = "dev-user-12345678";

  // 1. Get all holdings for dev-user
  console.log("--- Holdings ---");
  const userHoldings = await db
    .select({
      holding: holdings,
    })
    .from(holdings)
    .where(eq(holdings.userId, userId));

  console.log(`Total holdings: ${userHoldings.length}\n`);

  for (const h of userHoldings) {
    console.log(`  Asset: ${h.holding.assetId}`);
    console.log(`    Quantity: ${h.holding.quantity}`);
    console.log(`    Power: ${h.holding.power}`);
    console.log(`    PowerLevel: ${h.holding.powerLevel}`);
    console.log();
  }

  // 2. Get all boosts (any date)
  console.log("--- All Boosts ---");
  const allBoosts = await db
    .select({
      boost: dailyBoosts,
      player: players,
    })
    .from(dailyBoosts)
    .innerJoin(players, eq(dailyBoosts.playerId, players.id))
    .where(eq(dailyBoosts.userId, userId))
    .orderBy(dailyBoosts.boostDate);

  console.log(`Total boosts: ${allBoosts.length}\n`);

  // Show last 10 boosts
  const recentBoosts = allBoosts.slice(-10);
  console.log("Last 10 boosts:");
  for (const b of recentBoosts) {
    console.log(`  Player: ${b.player.firstName} ${b.player.lastName} (${b.player.team})`);
    console.log(`    Date: ${b.boost.boostDate}`);
    console.log(`    Slot Tier: ${b.boost.slotTier}x`);
    console.log(`    Shares Entered: ${b.boost.sharesEntered}`);
    console.log(`    Boost PowerLevel: ${b.boost.powerLevel}`);
    console.log(`    Status: ${b.boost.status}`);
    console.log();
  }
}

checkUserHoldingsAndBoosts().catch(console.error);

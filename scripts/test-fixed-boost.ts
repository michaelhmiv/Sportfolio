import "dotenv/config";
import { storage } from "../server/storage";
import { getTodayET } from "../server/lib/time";

async function test() {
  console.log("=== Testing fixed getEligiblePlayersForBoost ===\n");

  const userId = "dev-user-12345678"; // Dev user
  const sport = "NBA";
  const todayET = getTodayET();
  const targetDate = new Date(todayET + "T12:00:00.000Z"); // Noon ET

  console.log(`Querying for user: ${userId}`);
  console.log(`Sport: ${sport}`);
  console.log(`Date: ${todayET}`);
  console.log(`Target date (UTC): ${targetDate.toISOString()}`);

  const eligible = await storage.getEligiblePlayersForBoost(userId, sport, targetDate);

  console.log(`\n✅ Returned ${eligible.length} eligible players:\n`);

  if (eligible.length === 0) {
    console.log("No eligible players found!");
  } else {
    for (const ep of eligible) {
      console.log(`  ${ep.player.firstName} ${ep.player.lastName} (${ep.player.team})`);
      console.log(`    - Available shares: ${ep.availableShares}`);
      console.log(`    - Power Level: ${ep.powerLevel}`);
      console.log(`    - Game: ${ep.gameId || "N/A"} at ${ep.gameStartTime || "N/A"}`);
      console.log(
        `    - Game started: ${ep.gameStartTime ? new Date(ep.gameStartTime) <= new Date() : "N/A"}`,
      );
      console.log();
    }
  }
}

test().catch(console.error);

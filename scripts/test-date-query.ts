import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "../shared/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function test() {
  console.log("=== Testing game query with date field ===\n");

  const { startOfDay, endOfDay } = getETDayBoundaries(getTodayET());

  console.log(`Query for date: ${getTodayET()}`);
  console.log(`startOfDay (UTC): ${startOfDay.toISOString()}`);
  console.log(`endOfDay (UTC): ${endOfDay.toISOString()}`);

  // Query using the date field (like the fix does)
  const todaysGames = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        eq(dailyGames.sport, "NBA"),
        gte(dailyGames.date, startOfDay),
        lt(dailyGames.date, endOfDay),
      ),
    );

  console.log(`\nGames found: ${todaysGames.length}`);
  const teams = new Set<string>();
  for (const g of todaysGames) {
    teams.add(g.homeTeam);
    teams.add(g.awayTeam);
    console.log(`  ${g.awayTeam} @ ${g.homeTeam} | date: ${g.date} | startTime: ${g.startTime}`);
  }

  console.log(`\nTeams with games today: ${[...teams].sort().join(", ")}`);

  // Now test with DET specifically
  console.log("\n=== DET game on Jan 20? ===");
  const detGames = todaysGames.filter((g) => g.homeTeam === "DET" || g.awayTeam === "DET");
  console.log(`DET games found: ${detGames.length}`);
  for (const g of detGames) {
    console.log(`  ${g.awayTeam} @ ${g.homeTeam}`);
  }
}

test().catch(console.error);

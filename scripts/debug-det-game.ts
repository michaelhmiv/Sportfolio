import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "../shared/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function debug() {
  const { startOfDay, endOfDay } = getETDayBoundaries(getTodayET());

  console.log("=== Checking DET game query ===");
  console.log("Query range:", startOfDay.toISOString(), "to", endOfDay.toISOString());

  // Query with exact same filters as the eligible players function
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

  console.log("\nGames returned by query:", todaysGames.length);
  for (const g of todaysGames) {
    console.log(
      `  ${g.awayTeam} @ ${g.homeTeam} | ${g.status} | start: ${new Date(g.startTime).toISOString()}`,
    );
  }

  // Check specifically for DET games
  console.log("\n=== DET games in query range ===");
  const detGames = todaysGames.filter((g) => g.homeTeam === "DET" || g.awayTeam === "DET");
  console.log("DET games found:", detGames.length);

  // Check ALL games for today regardless of status filter
  console.log("\n=== All games with startTime today (any status) ===");
  const allToday = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        eq(dailyGames.sport, "NBA"),
        gte(dailyGames.startTime, startOfDay),
        lt(dailyGames.startTime, endOfDay),
      ),
    );
  console.log("Total games:", allToday.length);
  for (const g of allToday) {
    console.log(`  ${g.awayTeam} @ ${g.homeTeam} | ${g.status}`);
  }

  // Check for BOS @ DET specifically
  console.log("\n=== BOS @ DET game ===");
  const bosDet = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        eq(dailyGames.sport, "NBA"),
        eq(dailyGames.homeTeam, "DET"),
        eq(dailyGames.awayTeam, "BOS"),
      ),
    );
  console.log("BOS @ DET games:", bosDet.length);
  for (const g of bosDet) {
    console.log(`  ID: ${g.id}`);
    console.log(`  Game: ${g.awayTeam} @ ${g.homeTeam}`);
    console.log(`  Status: ${g.status}`);
    console.log(`  StartTime: ${new Date(g.startTime).toISOString()}`);
    console.log(`  In today's range: ${g.startTime >= startOfDay && g.startTime < endOfDay}`);
  }
}

debug().catch(console.error);

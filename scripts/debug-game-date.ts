import 'dotenv/config';
import { db } from "../server/db";
import { dailyGames } from "../shared/schema";
import { eq, and } from "drizzle-orm";

async function debug() {
  console.log("=== Checking date vs startTime fields ===\n");

  // Get BOS @ DET games
  const games = await db.select().from(dailyGames).where(
    and(
      eq(dailyGames.sport, "NBA"),
      eq(dailyGames.homeTeam, "DET"),
      eq(dailyGames.awayTeam, "BOS")
    )
  );

  for (const g of games) {
    console.log(`Game: ${g.awayTeam} @ ${g.homeTeam}`);
    console.log(`  date field: ${g.date}`);
    console.log(`  startTime field: ${g.startTime}`);
    console.log(`  startTime (local): ${new Date(g.startTime).toString()}`);
    console.log(`  ---`);
    console.log(`  UTC time: ${new Date(g.startTime).toISOString()}`);
    console.log(`  EST time: ${new Date(g.startTime).toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    console.log(`  \n`);
  }

  // Check the date field for games around the boundary
  console.log("\n=== Games with date = Jan 20 but startTime before 5 AM UTC ===");
  const boundaryGames = await db.select().from(dailyGames).where(
    eq(dailyGames.date, new Date("2026-01-20T00:00:00.000Z"))
  );

  console.log(`Found ${boundaryGames.length} games with date = Jan 20`);
  for (const g of boundaryGames) {
    const startHourUTC = new Date(g.startTime).getUTCHours();
    if (startHourUTC < 5) { // Before 5 AM UTC = before midnight EST
      console.log(`  ${g.awayTeam} @ ${g.homeTeam}: startTime=${g.startTime} (${startHourUTC} UTC)`);
    }
  }
}

debug().catch(console.error);

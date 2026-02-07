import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "../shared/schema";
import { gte, lt, and } from "drizzle-orm";
import { getETDayBoundaries, getTodayET } from "../server/lib/time";

async function check() {
  const todayET = getTodayET();
  const { startOfDay, endOfDay } = getETDayBoundaries(todayET);

  const games = await db
    .select()
    .from(dailyGames)
    .where(and(gte(dailyGames.date, startOfDay), lt(dailyGames.date, endOfDay)));

  console.log("All games today:");
  for (const g of games) {
    console.log(
      `  ${g.awayTeam} @ ${g.homeTeam} - ${g.sport} - Start: ${new Date(g.startTime).toISOString()}`,
    );
  }

  // Check for ORL
  const orlGame = games.find((g) => g.homeTeam === "ORL" || g.awayTeam === "ORL");
  console.log("\nORL game:", orlGame ? "Found" : "NOT FOUND");
}

check().catch(console.error);

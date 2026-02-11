import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "../shared/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function check() {
  const { startOfDay, endOfDay } = getETDayBoundaries(getTodayET());

  console.log("=== NFL Games Today ===\n");

  const nflGames = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        eq(dailyGames.sport, "NFL"),
        gte(dailyGames.startTime, startOfDay),
        lt(dailyGames.startTime, endOfDay),
      ),
    );

  console.log(`NFL games today: ${nflGames.length}`);

  if (nflGames.length === 0) {
    // Check if there are any NFL games in the database at all
    const allNfl = await db.select().from(dailyGames).where(eq(dailyGames.sport, "NFL"));
    console.log(`Total NFL games in DB: ${allNfl.length}`);

    if (allNfl.length > 0) {
      const latest = allNfl.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      )[0];
      console.log(`Latest NFL game: ${latest.awayTeam} @ ${latest.homeTeam} on ${latest.date}`);
    }
  } else {
    for (const g of nflGames) {
      console.log(`  ${g.awayTeam} @ ${g.homeTeam} - ${g.status}`);
    }
  }
}

check().catch(console.error);

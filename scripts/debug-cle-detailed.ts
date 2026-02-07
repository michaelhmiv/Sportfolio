import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "@shared/schema";
import { fetchDailyGames } from "../server/mysportsfeeds";
import { eq, or, desc, and, gte, lte } from "drizzle-orm";

async function run() {
  const startAndEnd = {
    start: new Date("2026-01-20T00:00:00-05:00"),
    end: new Date("2026-01-26T00:00:00-05:00"),
  };

  console.log(`Searching for ALL CLE games from Jan 20 to Jan 26...`);

  const games = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        or(eq(dailyGames.homeTeam, "CLE"), eq(dailyGames.awayTeam, "CLE")),
        gte(dailyGames.startTime, startAndEnd.start),
        lte(dailyGames.startTime, startAndEnd.end),
      ),
    )
    .orderBy(dailyGames.startTime);

  console.log(`[DB FOUND]: ${games.length}`);
  games.forEach((g) => {
    console.log(`ID: ${g.gameId} | ${g.homeTeam} vs ${g.awayTeam}`);
    console.log(`  ISO:   ${g.startTime.toISOString()}`);
    console.log(
      `  Local: ${g.startTime.toLocaleString("en-US", { timeZone: "America/New_York" })}`,
    );
    console.log(`  Date:  ${g.date}`);
  });

  // Check API for Jan 21 specifically
  try {
    console.log(`\n[API CHECK JAN 21]`);
    const apiGames = await fetchDailyGames("2026-01-21");
    const cleGame = apiGames.find(
      (g: any) =>
        g.schedule.homeTeam.abbreviation === "CLE" || g.schedule.awayTeam.abbreviation === "CLE",
    );
    if (cleGame) {
      console.log(`API Game ID: ${cleGame.schedule.id}`);
      console.log(`API StartTime (Raw): ${JSON.stringify(cleGame.schedule.startTime)}`);
    } else {
      console.log("No CLE game found in API for Jan 21");
    }
  } catch (e) {
    console.error(e);
  }

  process.exit(0);
}

run();

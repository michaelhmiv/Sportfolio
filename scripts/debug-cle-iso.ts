import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "@shared/schema";
import { eq, or, desc, and, gte, lte } from "drizzle-orm";

async function run() {
  const start = new Date("2026-01-20T00:00:00-05:00"); // Jan 20 00:00 ET
  const end = new Date("2026-01-20T23:59:59-05:00"); // Jan 20 23:59 ET

  console.log(`Searching for CLE game between ${start.toISOString()} and ${end.toISOString()}...`);

  const games = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        or(eq(dailyGames.homeTeam, "CLE"), eq(dailyGames.awayTeam, "CLE")),
        gte(dailyGames.startTime, start),
        lte(dailyGames.startTime, end),
      ),
    );

  console.log(`[FOUND]: ${games.length}`);
  games.forEach((g) => {
    console.log(`GAME: ${g.homeTeam} vs ${g.awayTeam}`);
    console.log(`ISO: ${g.startTime.toISOString()}`);
  });

  if (games.length === 0) {
    // Fallback: search ALL CLE games
    const all = await db
      .select()
      .from(dailyGames)
      .where(or(eq(dailyGames.homeTeam, "CLE"), eq(dailyGames.awayTeam, "CLE")))
      .limit(5)
      .orderBy(desc(dailyGames.startTime));
    console.log("--- RECENT CLE GAMES ---");
    all.forEach((g) => {
      console.log(`GAME: ${g.homeTeam} vs ${g.awayTeam}`);
      console.log(`ISO: ${g.startTime.toISOString()}`);
    });
  }

  process.exit(0);
}

run();

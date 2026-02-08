import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "@shared/schema";
import { eq, or, and, gte, lte } from "drizzle-orm";

async function run() {
  // Check Jan 21st
  const start = new Date("2026-01-21T00:00:00-05:00");
  const end = new Date("2026-01-21T23:59:59-05:00");

  console.log(`Searching for CLE game on Jan 21 (Tomorrow)...`);

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
    console.log(`Local String: ${g.startTime.toLocaleString()}`);
  });

  process.exit(0);
}

run();

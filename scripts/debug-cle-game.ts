import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "@shared/schema";
import { eq, or, desc } from "drizzle-orm";

async function run() {
  console.log(`Searching for ANY CLE game...`);

  const games = await db
    .select()
    .from(dailyGames)
    .where(or(eq(dailyGames.homeTeam, "CLE"), eq(dailyGames.awayTeam, "CLE")))
    .orderBy(desc(dailyGames.startTime))
    .limit(5);

  console.log(`[DATABASE MATCHES]: ${games.length}`);
  games.forEach((g) => {
    console.log(`Game ID: ${g.gameId} (${g.homeTeam} vs ${g.awayTeam})`);
    console.log(`  Date:         ${g.date}`);
    console.log(`  Stored UTC:   ${g.startTime.toISOString()}`);
    console.log(
      `  Local (ET):   ${g.startTime.toLocaleString("en-US", { timeZone: "America/New_York" })}`,
    );
    console.log(`  Status:       ${g.status}`);
    console.log("---");
  });

  process.exit(0);
}

run();

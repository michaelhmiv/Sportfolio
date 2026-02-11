import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "@shared/schema";
import { sql } from "drizzle-orm";

async function run() {
  console.log("Scanning for games with XX:30 start times...");

  // Find games where minute part of start_time is 30
  const games = await db.execute(sql`
    SELECT * FROM ${dailyGames}
    WHERE EXTRACT(MINUTE FROM start_time) = 30
    AND start_time > NOW() - INTERVAL '7 days'
    AND start_time < NOW() + INTERVAL '7 days'
    ORDER BY start_time DESC
  `);

  console.log(`[FOUND]: ${games.rows.length}`);
  games.rows.forEach((g: any) => {
    const d = new Date(g.start_time);
    console.log(`ID: ${g.game_id} | ${g.home_team} vs ${g.away_team}`);
    console.log(`  ISO:   ${d.toISOString()}`);
    console.log(`  Local: ${d.toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    console.log(`  Date:  ${g.date}`);
  });

  process.exit(0);
}

run();

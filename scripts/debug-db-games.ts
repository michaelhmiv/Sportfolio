
import 'dotenv/config';
import { db } from "../server/db";
import { dailyGames } from "@shared/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

async function run() {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    console.log(`QUERY_RANGE: ${startOfDay.toISOString()} TO ${endOfDay.toISOString()}`);

    // Query for games today (UTC window)
    // We widen the window slightly to catch games that might be stored weirdly
    const searchStart = new Date(startOfDay.getTime() - 12 * 60 * 60 * 1000); // -12h
    const searchEnd = new Date(endOfDay.getTime() + 12 * 60 * 60 * 1000); // +12h

    const games = await db.select()
        .from(dailyGames)
        .where(and(
            gte(dailyGames.startTime, searchStart),
            lte(dailyGames.startTime, searchEnd)
        ))
        .orderBy(desc(dailyGames.startTime));

    console.log(`FOUND_GAMES: ${games.length}`);
    games.forEach(g => {
        console.log(`GAME: ${g.homeTeam} vs ${g.awayTeam} (ID: ${g.gameId})`);
        console.log(`  DB_TIME:    ${g.startTime.toISOString()}`);
        console.log(`  HOME_SCORE: ${g.homeScore}`);
        console.log(`  STATUS:     ${g.status}`);
        console.log(`  LOCAL_EST:  ${g.startTime.toLocaleString("en-US", { timeZone: "America/New_York" })}`);
        console.log('---');
    });

    process.exit(0);
}

run().catch(console.error);

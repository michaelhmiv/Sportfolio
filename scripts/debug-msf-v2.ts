
import 'dotenv/config';
import { fetchDailyGames } from "../server/mysportsfeeds";

async function run() {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    console.log(`FETCHING_DATE: ${dateStr}`);
    console.log(`SERVER_TIME: ${today.toISOString()}`);

    try {
        const games = await fetchDailyGames(dateStr);
        console.log(`GAMES_COUNT: ${games.length}`);

        games.slice(0, 3).forEach((g: any) => {
            console.log(`GAME: ${g.schedule.id} (${g.schedule.homeTeam.abbreviation} vs ${g.schedule.awayTeam.abbreviation})`);
            console.log(`RAW_START: ${JSON.stringify(g.schedule.startTime)}`);
            // console.log(`STATUS: ${g.schedule.playedStatus}`);
        });
    } catch (err) {
        console.error(err);
    }
}

run();

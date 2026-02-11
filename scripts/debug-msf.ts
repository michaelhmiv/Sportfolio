import "dotenv/config";
import { fetchDailyGames } from "../server/mysportsfeeds";

async function run() {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];
  console.log(`Fetching games for: ${dateStr}`);

  try {
    const games = await fetchDailyGames(dateStr);
    console.log(`Fetched ${games.length} games`);

    if (games.length === 0) {
      console.log("No games found today.");
    }

    games.forEach((g: any) => {
      console.log(
        `Game ID: ${g.schedule.id} (${g.schedule.homeTeam.abbreviation} vs ${g.schedule.awayTeam.abbreviation})`,
      );
      console.log(`  Raw Status:    ${g.schedule.playedStatus}`);
      console.log(`  Raw StartTime: ${g.schedule.startTime}`);
      const d = new Date(g.schedule.startTime);
      console.log(`  Parsed String: ${d.toString()}`);
      console.log(`  Parsed ISO:    ${d.toISOString()}`);
      console.log(`  Now (Server):  ${new Date().toString()}`);
      console.log(`  Started Check: ${d <= new Date()}`);
      console.log("---");
    });
  } catch (err) {
    console.error(err);
  }
}

run();

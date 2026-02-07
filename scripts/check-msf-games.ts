/**
 * Check MySportsFeeds API directly for today's games
 * To verify what the API returns vs what's in database
 */
import axios from "axios";

const date = "20260120"; // Jan 20, 2026 in YYYYMMDD format
const SEASON = "2025-2026-regular";
const apiKey = process.env.MYSPORTSFEEDS_API_KEY;

async function main() {
  if (!apiKey) {
    console.log("ERROR: MYSPORTSFEEDS_API_KEY not set");
    process.exit(1);
  }

  console.log("Calling MySportsFeeds API for date:", date);
  console.log(`URL: /pull/nba/${SEASON}/date/${date}/games.json\n`);

  try {
    const response = await axios.get(
      `https://api.mysportsfeeds.com/v2.1/pull/nba/${SEASON}/date/${date}/games.json`,
      {
        auth: { username: apiKey, password: "MYSPORTSFEEDS" },
        headers: { "Accept-Encoding": "gzip" },
        timeout: 15000,
      },
    );

    const games = response.data.games || [];
    console.log("Games found:", games.length);

    // Look for CLE games specifically
    let cleFound = false;
    for (const g of games) {
      const home = g.schedule?.homeTeam?.abbreviation;
      const away = g.schedule?.awayTeam?.abbreviation;
      const startTime = g.schedule?.startTime;

      if (home === "CLE" || away === "CLE") {
        cleFound = true;
        console.log("\n*** CLE GAME FOUND ***");
        console.log("Matchup:", away, "@", home);
        console.log("Start Time (raw):", startTime);
      }
    }

    if (!cleFound) {
      console.log("\n*** NO CLE GAME FOUND FOR THIS DATE ***");
    }

    console.log("\n--- All games for", date, "---");
    for (const g of games) {
      const home = g.schedule?.homeTeam?.abbreviation;
      const away = g.schedule?.awayTeam?.abbreviation;
      const startTime = g.schedule?.startTime;
      console.log(`${away} @ ${home} at ${startTime}`);
    }
  } catch (e: any) {
    console.error("API Error:", e.response?.status, e.message);
  }

  process.exit(0);
}

main();

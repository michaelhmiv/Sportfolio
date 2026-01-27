/**
 * Test script for BallDontLie NBA API
 */

import "dotenv/config";
import {
    fetchActivePlayers,
    fetchDailyGames,
    isNBAApiConfigured,
    normalizeGameStatus
} from "../server/balldontlie-nba";

async function testApi() {
    console.log("=== Testing BallDontLie NBA API ===");
    console.log("API configured:", isNBAApiConfigured());

    try {
        // Test 1: Fetch active players
        console.log("\n[TEST 1] Fetching active players...");
        const players = await fetchActivePlayers();
        console.log("Total players fetched:", players.length);
        if (players.length > 0) {
            console.log("Sample player:", {
                id: players[0].id,
                name: `${players[0].first_name} ${players[0].last_name}`,
                team: players[0].team?.abbreviation,
                position: players[0].position
            });
        }

        // Test 2: Fetch today's games
        console.log("\n[TEST 2] Fetching games for 2026-01-20...");
        const games = await fetchDailyGames("2026-01-20");
        console.log("Games found:", games.length);
        if (games.length > 0) {
            console.log("Sample game:", {
                id: games[0].id,
                status: games[0].status,
                normalizedStatus: normalizeGameStatus(games[0].status),
                home: games[0].home_team?.abbreviation,
                away: games[0].visitor_team?.abbreviation,
                homeScore: games[0].home_team_score,
                awayScore: games[0].visitor_team_score
            });
        }

        // Test 3: Status normalization
        console.log("\n[TEST 3] Testing status normalization...");
        const testStatuses = ["Final", "Scheduled", "In Progress", "1st Qtr", "Halftime", "Final/OT"];
        for (const status of testStatuses) {
            console.log(`  "${status}" => "${normalizeGameStatus(status)}"`);
        }

        console.log("\n=== All API tests passed! ===");
    } catch (error: any) {
        console.error("API Test failed:", error.message);
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", error.response.data);
        }
        process.exit(1);
    }
}

testApi();

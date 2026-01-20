/**
 * Test script for Phase 2: Daily Boosts Integration
 * Tests: getEligiblePlayersForBoost with Power Level
 * 
 * Run with: npx tsx scripts/test-boosts.ts
 */

import 'dotenv/config';
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users, players, holdings, dailyGames } from "../shared/schema";
import { eq, and } from "drizzle-orm";

async function testBoostEligibility() {
    console.log("\n=== Testing Daily Boosts Eligibility with Power Level ===\n");

    // 1. Setup: Find a user and a player
    const [testUser] = await db.select().from(users).limit(1);
    if (!testUser) {
        console.log("❌ No users found");
        return false;
    }

    // Find a player to test with
    const [player] = await db.select().from(players).limit(1);
    if (!player) {
        console.log("❌ No players found");
        return false;
    }

    console.log(`User: ${testUser.username || testUser.id}`);
    console.log(`Player: ${player.firstName} ${player.lastName} (${player.sport})`);

    // 2. Ensure we have a game for this player usage 'today' so they show up in eligible list
    // For testing, we mock the query by just ensuring a holding exists with Power Level

    // Create/Update a holding with Power Level but 0 raw shares
    // This validates that Power Level alone is sufficient for eligibility
    console.log("Setting up holding: 0 raw shares, 2.00 Power Level");

    const existingHolding = await storage.getHolding(testUser.id, "player", player.id);

    if (existingHolding) {
        await db.update(holdings)
            .set({
                quantity: 0,
                powerLevel: "2.00",
                lastUpdated: new Date()
            })
            .where(eq(holdings.id, existingHolding.id));
    } else {
        await db.insert(holdings).values({
            userId: testUser.id,
            assetType: "player",
            assetId: player.id,
            quantity: 0,
            powerLevel: "2.00",
            avgCostBasis: "10.00",
            totalCostBasis: "0.00"
        });
    }

    // 3. Insert a mock game for today so getEligiblePlayersForBoost finds it
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(today.getHours() + 1); // Mock game in future today

    // We need to ensure we don't violate unique constraints, so check first
    const [existingGame] = await db.select().from(dailyGames).where(
        and(
            eq(dailyGames.sport, player.sport),
            eq(dailyGames.homeTeam, player.team)
        )
    ).limit(1);

    if (!existingGame) {
        await db.insert(dailyGames).values({
            gameId: `test_game_${Date.now()}`,
            sport: player.sport,
            homeTeam: player.team,
            awayTeam: "TEST_OPP",
            startTime: startOfDay,
            status: "scheduled",
            homeScore: 0,
            awayScore: 0
        });
        console.log("Created mock game for testing");
    } else {
        // Update existing game to be today
        await db.update(dailyGames)
            .set({ startTime: startOfDay })
            .where(eq(dailyGames.id, existingGame.id));
        console.log("Updated existing game to occur today");
    }

    // 4. Test eligibility
    console.log("Fetching eligible players...");
    const eligible = await storage.getEligiblePlayersForBoost(testUser.id, player.sport, today);

    const found = eligible.find(p => p.player.id === player.id);

    if (found) {
        console.log(`✅ Player found in eligible list!`);
        console.log(`   Available Shares: ${found.availableShares}`);
        console.log(`   Power Level: ${found.powerLevel}`);

        if (found.availableShares === 0 && parseFloat(found.powerLevel) === 2.00) {
            console.log("✅ verified: Player eligible via Power Level despite 0 raw shares");
            return true;
        } else {
            console.log("⚠️ Data mismatch (expected 0 shares / 2.00 PL)");
            return false;
        }
    } else {
        console.log("❌ Player NOT found in eligible list. Check Date/Game logic.");
        return false;
    }
}

async function main() {
    try {
        const passed = await testBoostEligibility();
        if (passed) {
            console.log("\n✅ Phase 2 Test Passed: Daily Boosts Integration working");
            process.exit(0);
        } else {
            console.log("\n❌ Phase 2 Test Failed");
            process.exit(1);
        }
    } catch (err: any) {
        console.error("Fatal error:", err);
        process.exit(1);
    }
}

main();

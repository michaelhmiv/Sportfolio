/**
 * Test the /api/daily-boosts/eligible-all endpoint logic
 */

import 'dotenv/config';
import { db } from "../server/db";
import { storage } from "../server/storage";
import { holdings, players, dailyGames, dailyBoosts, communityBoosts } from "../shared/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function testEligibleAll() {
    console.log("\n=== Testing /api/daily-boosts/eligible-all logic ===\n");

    const userId = 'dev-user-12345678';

    // Parse date query param (YYYY-MM-DD), default to today in ET
    const todayET = getTodayET();
    let dateStr = todayET;
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
    const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

    console.log("Date:", dateStr);
    console.log("Start:", startOfDay.toISOString());
    console.log("End:", endOfDay.toISOString());

    // Get all holdings with players
    const allHoldings = await storage.getAllHoldingsWithPlayers(userId);
    console.log("\nAll holdings:", allHoldings.length);

    for (const h of allHoldings) {
        console.log(`  - ${h.player.firstName} ${h.player.lastName} (${h.player.team}): ${h.quantity} shares, PL: ${h.powerLevel}`);
    }

    // Get all games today for all sports
    const todaysGames = await db.select().from(dailyGames)
        .where(and(
            gte(dailyGames.date, startOfDay),
            lt(dailyGames.date, endOfDay)
        ));

    console.log("\nGames today:", todaysGames.length);
    for (const g of todaysGames) {
        console.log(`  - ${g.awayTeam} @ ${g.homeTeam} (${g.sport})`);
    }

    // Build a map of team -> game info
    const teamGameMap = new Map<string, { gameId: string; startTime: Date; sport: string }>();
    for (const game of todaysGames) {
        teamGameMap.set(game.homeTeam, { gameId: game.gameId, startTime: new Date(game.startTime), sport: game.sport });
        teamGameMap.set(game.awayTeam, { gameId: game.gameId, startTime: new Date(game.startTime), sport: game.sport });
    }

    const now = new Date();
    console.log("\nCurrent time:", now.toISOString());

    // Get current boosts to show which players are already boosted
    const currentBoosts = await storage.getDailyBoostsAllSports(userId, targetDate);
    const boostedPlayerIds = new Set(currentBoosts.map(b => b.playerId));
    console.log("Current boosts:", currentBoosts.length);
    for (const b of currentBoosts) {
        console.log(`  - ${b.playerId} (${b.sport}): ${b.sharesEntered} shares`);
    }

    // Get community boosts for this sport/date
    const communityBoostsList = await storage.getCommunityBoostsAllSports(targetDate);
    const communityBoostMap = new Map<string, number>();
    communityBoostsList.forEach(cb => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
    });

    // Get user's premium shares
    // const userHoldings = await storage.getHoldings(userId);
    // Using direct DB query instead
    const userHoldingsRaw = await db.select().from(holdings).where(eq(holdings.userId, userId));
    const premiumHolding = userHoldingsRaw.find(h => h.assetType === "premium");
    const userPremiumShares = premiumHolding?.quantity || 0;

    // Pre-fetch all locked quantities
    const lockedQuantities = new Map<string, number>();
    for (const holding of allHoldings) {
        const totalLocked = await storage.getTotalLockedQuantity(userId, "player", holding.player.id);
        lockedQuantities.set(holding.player.id, totalLocked);
    }

    // Build result (same as API does)
    const result = allHoldings.map(holding => {
        const teamGame = teamGameMap.get(holding.player.team);
        const totalLocked = lockedQuantities.get(holding.player.id) || 0;
        const availableShares = holding.quantity - totalLocked;
        const powerLevel = holding.powerLevel || "0.00";
        const hasPowerLevel = parseFloat(powerLevel) > 0;

        const gameStartTime = teamGame?.startTime;
        const gameStarted = gameStartTime ? gameStartTime <= now : false;
        const hasGameToday = !!teamGame;

        // Game status: 'none' | 'upcoming' | 'live' | 'ended'
        let gameStatus: 'none' | 'upcoming' | 'live' | 'ended' = 'none';
        if (teamGame) {
            if (gameStarted) {
                gameStatus = 'ended';
            } else {
                gameStatus = 'upcoming';
            }
        }

        return {
            playerId: holding.player.id,
            player: holding.player,
            availableShares,
            powerLevel,
            totalShares: holding.quantity,
            gameId: teamGame?.gameId || null,
            gameStartTime: gameStartTime || null,
            hasGameToday,
            gameStatus,
            isAlreadyBoosted: boostedPlayerIds.has(holding.player.id),
            communityBoostCount: communityBoostMap.get(holding.player.id) || 0,
            hasCommunityBoost: communityBoostMap.has(holding.player.id),
            userPremiumShares,
        };
    });

    console.log("\n=== API Result ===");
    console.log("Total eligiblePlayers:", result.length);

    for (const r of result) {
        console.log(`\n  ${r.player.firstName} ${r.player.lastName} (${r.player.team}):`);
        console.log(`    availableShares: ${r.availableShares}`);
        console.log(`    powerLevel: ${r.powerLevel}`);
        console.log(`    hasGameToday: ${r.hasGameToday}`);
        console.log(`    gameStatus: ${r.gameStatus}`);
        console.log(`    isAlreadyBoosted: ${r.isAlreadyBoosted}`);
    }

    console.log("\n=== Done ===\n");
}

testEligibleAll().catch(console.error);

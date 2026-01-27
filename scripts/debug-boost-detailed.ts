/**
 * Debug script to check share availability for boosting
 */

import 'dotenv/config';
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users, holdings, holdingsLocks, players, dailyBoosts, dailyGames } from "../shared/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function debug() {
    console.log("\n=== Boost Share Availability Debug ===\n");

    // Get dev user (or use provided user ID)
    const [devUser] = await db.select().from(users).limit(1);
    if (!devUser) {
        console.log("❌ No users found");
        return;
    }
    console.log(`User: ${devUser.username || devUser.id} (${devUser.id})`);

    // Get today's date boundaries
    const todayET = getTodayET();
    const { startOfDay, endOfDay } = getETDayBoundaries(todayET);
    console.log(`Date: ${todayET} (${startOfDay.toISOString()} to ${endOfDay.toISOString()})`);

    // Get all NBA holdings
    console.log("\n--- NBA Holdings ---");
    const nbaHoldings = await db.select({
        holding: holdings,
        player: players
    })
        .from(holdings)
        .innerJoin(players, eq(holdings.assetId, players.id))
        .where(and(
            eq(holdings.userId, devUser.id),
            eq(holdings.assetType, "player"),
            eq(players.sport, "NBA")
        ));

    console.log(`Found ${nbaHoldings.length} NBA holdings`);

    // Get NBA games today
    const todaysGames = await db.select().from(dailyGames)
        .where(and(
            eq(dailyGames.sport, "NBA"),
            gte(dailyGames.startTime, startOfDay),
            lt(dailyGames.startTime, endOfDay)
        ));
    console.log(`NBA games today: ${todaysGames.length}`);

    const teamsWithGames = new Set<string>();
    todaysGames.forEach(g => {
        teamsWithGames.add(g.homeTeam);
        teamsWithGames.add(g.awayTeam);
    });
    console.log(`Teams with games: ${Array.from(teamsWithGames).sort().join(', ')}`);

    // Check each NBA holding
    console.log("\n--- Detailed Analysis ---");
    for (const h of nbaHoldings) {
        const team = h.player.team;
        const hasGame = teamsWithGames.has(team);
        const holdingQty = h.holding.quantity;

        // Check locks
        const locks = await db.select().from(holdingsLocks)
            .where(and(
                eq(holdingsLocks.userId, devUser.id),
                eq(holdingsLocks.assetId, h.player.id)
            ));
        const totalLocked = locks.reduce((sum, l) => sum + l.lockedQuantity, 0);
        const availableCalc = holdingQty - totalLocked;

        // Check via storage method
        const availableStorage = await storage.getAvailableShares(devUser.id, "player", h.player.id);

        // Check daily boosts
        const activeBoosts = await db.select().from(dailyBoosts)
            .where(and(
                eq(dailyBoosts.userId, devUser.id),
                eq(dailyBoosts.playerId, h.player.id),
                eq(dailyBoosts.status, "active")
            ));

        console.log(`\n${h.player.firstName} ${h.player.lastName} (${team}):`);
        console.log(`  Holding quantity: ${holdingQty}`);
        console.log(`  Power level: ${h.holding.powerLevel}`);
        console.log(`  Has game today: ${hasGame}`);
        console.log(`  Locks: ${locks.length} lock(s), ${totalLocked} total locked`);
        if (locks.length > 0) {
            locks.forEach(l => console.log(`    - ${l.lockType}: ${l.lockedQuantity} (ref: ${l.lockReferenceId})`));
        }
        console.log(`  Available (calc): ${availableCalc}`);
        console.log(`  Available (storage): ${availableStorage}`);
        console.log(`  Active boosts: ${activeBoosts.length}`);
        if (activeBoosts.length > 0) {
            activeBoosts.forEach(b => console.log(`    - ${b.slotTier}x slot with ${b.sharesEntered} shares`));
        }
    }

    // Check what storage.getEligiblePlayersForBoost returns
    console.log("\n--- getEligiblePlayersForBoost Result ---");
    const eligible = await storage.getEligiblePlayersForBoost(devUser.id, "NBA", new Date());
    console.log(`Returned ${eligible.length} eligible players`);
    for (const e of eligible) {
        console.log(`  ${e.player.firstName} ${e.player.lastName}: ${e.availableShares} shares available`);
    }

    console.log("\n=== Debug Complete ===\n");
}

debug().catch(console.error);

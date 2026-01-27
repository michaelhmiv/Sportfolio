/**
 * Debug script - Find correct Cade Cunningham player ID
 */

import 'dotenv/config';
import { db } from "../server/db";
import { users, holdings, players } from "../shared/schema";
import { eq, like, and } from "drizzle-orm";

async function debug() {
    console.log("\n=== Find Cade Cunningham ===\n");

    // Search for any Cunningham in players
    console.log("Searching for 'Cunningham' in players:");
    const cunninghamPlayers = await db.select().from(players)
        .where(like(players.lastName, 'Cunningham%'));

    for (const p of cunninghamPlayers) {
        console.log(`  ${p.firstName} ${p.lastName} (${p.team}) - ${p.id} - Sport: ${p.sport}`);
    }

    // Check holdings with ID nba_31030
    console.log("\n--- Checking holding nba_31030 ---");
    const [holdingPlayer] = await db.select().from(players)
        .where(eq(players.id, 'nba_31030'));

    if (holdingPlayer) {
        console.log(`Found: ${holdingPlayer.firstName} ${holdingPlayer.lastName} (${holdingPlayer.team}) - ${holdingPlayer.id}`);
    } else {
        console.log("Player nba_31030 not found!");
    }

    // Search for Cade by first name
    console.log("\nSearching for 'Cade' in players:");
    const cadePlayers = await db.select().from(players)
        .where(like(players.firstName, 'Cade%'));

    for (const p of cadePlayers) {
        console.log(`  ${p.firstName} ${p.lastName} (${p.team}) - ${p.id} - Sport: ${p.sport}`);
    }

    console.log("\n=== Debug Complete ===\n");
}

debug().catch(console.error);

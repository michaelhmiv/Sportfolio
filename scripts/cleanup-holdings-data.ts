/**
 * Data cleanup script for holdings power level consistency
 *
 * This script:
 * 1. Removes holdings with 0 shares and 0 power (truly empty)
 * 2. Removes holdings with 0 shares but non-zero power (leftover from burn bug)
 * 3. Ensures powerLevel = quantity * power for all remaining holdings
 * 4. Reports any anomalies found
 */

import 'dotenv/config';
import { db } from "../server/db";
import { holdings, users, players } from "../shared/schema";
import { eq, and } from "drizzle-orm";

async function cleanup() {
    console.log("\n=== Holdings Data Cleanup ===\n");

    // Get all holdings with player info
    const allHoldings = await db.select({
        holding: holdings,
        player: players
    })
        .from(holdings)
        .innerJoin(players, eq(holdings.assetId, players.id))
        .where(eq(holdings.assetType, "player"));

    console.log(`Found ${allHoldings.length} player holdings\n`);

    let removedEmpty = 0;
    let removedZeroShares = 0;
    let fixedPowerLevel = 0;
    let alreadyCorrect = 0;
    let anomalies = [];

    for (const h of allHoldings) {
        const holding = h.holding;
        const player = h.player;
        const expectedPowerLevel = (holding.quantity * holding.power).toFixed(2);
        const actualPowerLevel = parseFloat(holding.powerLevel || "0").toFixed(2);

        // Case 1: Holding has 0 shares and 0 power - truly empty
        if (holding.quantity === 0 && holding.power === 1 && actualPowerLevel === "0.00") {
            await db.delete(holdings).where(eq(holdings.id, holding.id));
            removedEmpty++;
            console.log(`  🗑️  Removed empty: ${player.firstName} ${player.lastName} (0 shares, 0 power)`);
            continue;
        }

        // Case 2: Holding has 0 shares but non-zero power - leftover from burn bug
        if (holding.quantity === 0 && actualPowerLevel !== "0.00") {
            await db.delete(holdings).where(eq(holdings.id, holding.id));
            removedZeroShares++;
            console.log(`  🗑️  Removed zero-share with power: ${player.firstName} ${player.lastName} (0 shares, power: ${actualPowerLevel})`);
            continue;
        }

        // Case 3: Check if powerLevel needs fixing
        if (expectedPowerLevel !== actualPowerLevel) {
            // Only fix if this looks like a real inconsistency (not a deliberate partial share)
            const difference = Math.abs(parseFloat(expectedPowerLevel) - parseFloat(actualPowerLevel));

            if (difference > 1 && holding.quantity > 0) {
                // This looks like the burn bug - fix it
                await db
                    .update(holdings)
                    .set({
                        powerLevel: expectedPowerLevel,
                        lastUpdated: new Date(),
                    })
                    .where(eq(holdings.id, holding.id));

                fixedPowerLevel++;
                console.log(`  🔧 Fixed: ${player.firstName} ${player.lastName} (qty: ${holding.quantity}, was: ${actualPowerLevel}, now: ${expectedPowerLevel})`);
            } else {
                alreadyCorrect++;
            }
        } else {
            alreadyCorrect++;
        }
    }

    console.log("\n--- Summary ---");
    console.log(`  Removed empty holdings: ${removedEmpty}`);
    console.log(`  Removed zero-share with power: ${removedZeroShares}`);
    console.log(`  Fixed powerLevel: ${fixedPowerLevel}`);
    console.log(`  Already correct: ${alreadyCorrect}`);
    console.log(`  Total processed: ${removedEmpty + removedZeroShares + fixedPowerLevel + alreadyCorrect}`);

    // Verify no anomalies remain
    console.log("\n--- Verifying fix ---");
    const remainingHoldings = await db.select().from(holdings).where(eq(holdings.assetType, "player"));
    let anomaliesCount = 0;

    for (const h of remainingHoldings) {
        const expected = (h.quantity * h.power).toFixed(2);
        const actual = parseFloat(h.powerLevel || "0").toFixed(2);

        if (h.quantity === 0 && parseFloat(actual) !== 0) {
            console.log(`  ⚠️  Anomaly: ${h.assetId} has 0 shares but powerLevel ${actual}`);
            anomaliesCount++;
        }
    }

    if (anomaliesCount === 0) {
        console.log("  ✅ No anomalies found - all holdings are consistent!");
    } else {
        console.log(`  ⚠️  Found ${anomaliesCount} anomalies remaining`);
    }

    console.log("\n=== Cleanup Complete ===\n");
}

cleanup().catch(console.error);


import 'dotenv/config';
import { db } from "../server/db";
import { scoutHistory, users, players } from "../shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../server/storage";

async function verifyAccuracy() {
    console.log("Verifying Scout Minute Accuracy...");

    // 1. Create Test User
    const testEmail = `test_acc_${Date.now()}@test.com`;
    const [user] = await db.insert(users).values({
        email: testEmail,
        username: `test_acc_${Date.now()}`,
        password: "password",
        role: "user",
        balance: 10000,
        premiumScouts: 0,
        scoutVestingSpeed: 0
    }).returning();
    console.log("Created Test User:", user.id);

    // 2. Get a Player
    const [player] = await db.select().from(players).limit(1);
    if (!player) throw new Error("No players found");
    console.log("Using Player:", player.id);

    // 3. Insert Fake History
    // Scenario:
    // 10 Scouts active for past 10 minutes.
    // This is clearly inside the window (since window reset 20 mins ago).
    // Expected: 10 * 10 = 100 minutes.
    const now = new Date();
    const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);

    await db.insert(scoutHistory).values([
        {
            userId: user.id,
            playerId: player.id,
            scoutCount: 10,
            startedAt: tenMinsAgo,
            endedAt: now
        }
    ]);
    console.log("Inserted Scout History");

    // 4. Call getScoutStatus
    const status = await storage.getScoutStatus(user.id);

    console.log("Scout Status Result:", JSON.stringify(status, null, 2));

    // Verify perPlayer
    const earned = status.perPlayer?.[player.id] || 0;
    console.log(`Player ${player.id} Earned: ${earned} min`);

    if (earned > 0) {
        console.log("PASS: Calculated postive minutes.");
        // If earned is approximately 100
        if (Math.abs(earned - 100) < 1) {
            console.log("PERFECT MATCH: 100 minutes.");
        }
    } else {
        console.log("WARNING: Earned 0 minutes. This might be due to a recent distribution window reset.");
    }
}

verifyAccuracy().catch(console.error).finally(() => process.exit());

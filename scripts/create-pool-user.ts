/**
 * Creates the "pool" system user for AMM trades
 * This user is used as buyer/seller for pool trades to satisfy FK constraints
 */

import { db } from "../server/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

async function createPoolUser() {
    console.log("[Pool User] Checking if pool user exists...");

    // Check if pool user already exists
    const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.id, "pool"));

    if (existing) {
        console.log("[Pool User] Pool user already exists:", existing.username);
        return;
    }

    // Create pool user
    console.log("[Pool User] Creating pool user...");
    const [poolUser] = await db
        .insert(users)
        .values({
            id: "pool",
            username: "AMM Pool",
            email: "pool@system.internal",
            isBot: true,
        })
        .onConflictDoNothing()
        .returning();

    if (poolUser) {
        console.log("[Pool User] Created pool user successfully:", poolUser.id);
    } else {
        console.log("[Pool User] Pool user may have been created by conflict resolution");
    }
}

createPoolUser()
    .then(() => {
        console.log("[Pool User] Done");
        process.exit(0);
    })
    .catch((err) => {
        console.error("[Pool User] Error:", err);
        process.exit(1);
    });

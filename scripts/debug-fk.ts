/**
 * Debug script to check FK constraint issue
 */

import { db } from "../server/db";
import { users, trades } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

async function debugFK() {
    console.log("[Debug] Checking pool user...");

    // 1. Check pool user exists
    const [poolUser] = await db
        .select({ id: users.id, username: users.username, email: users.email })
        .from(users)
        .where(eq(users.id, "pool"));

    console.log("[Debug] Pool user:", poolUser);

    // 2. Check FK constraint on trades table
    const constraints = await db.execute(sql`
    SELECT 
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND tc.table_name = 'trades'
      AND kcu.column_name = 'seller_id'
  `);

    console.log("[Debug] FK constraints on trades.seller_id:", constraints.rows);

    // 3. Try to insert a test trade with sellerId = "pool" directly
    console.log("[Debug] Testing direct insert with sellerId='pool'...");
    try {
        const testResult = await db.execute(sql`
      INSERT INTO trades (player_id, buyer_id, seller_id, quantity, price)
      SELECT 
        (SELECT id FROM players LIMIT 1),
        (SELECT id FROM users WHERE id != 'pool' LIMIT 1),
        'pool',
        1.0000,
        10.00
      RETURNING id
    `);
        console.log("[Debug] Test insert succeeded:", testResult.rows);

        // Clean up test trade
        if (testResult.rows[0]) {
            await db.execute(sql`DELETE FROM trades WHERE id = ${testResult.rows[0].id}`);
            console.log("[Debug] Cleaned up test trade");
        }
    } catch (error: any) {
        console.error("[Debug] Test insert failed:", error.message);
    }
}

debugFK()
    .then(() => {
        console.log("[Debug] Done");
        process.exit(0);
    })
    .catch((err) => {
        console.error("[Debug] Error:", err);
        process.exit(1);
    });

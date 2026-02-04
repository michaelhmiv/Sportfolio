/**
 * Direct check and fix for pool user using raw SQL
 */

import pg from 'pg';
const { Pool } = pg;

// Use the same env var resolution as db.ts
const isProduction = process.env.NODE_ENV === 'production';
const databaseUrl = isProduction
    ? process.env.DATABASE_URL
    : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);

console.log(`[Check] Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`[Check] Using ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} database`);
console.log(`[Check] Database URL starts with: ${databaseUrl?.substring(0, 40)}...`);

if (!databaseUrl) {
    throw new Error("No database URL found");
}

const pool = new Pool({ connectionString: databaseUrl });

async function checkAndFixPoolUser() {
    const client = await pool.connect();
    try {
        // Check if pool user exists
        const result = await client.query("SELECT id, username, email FROM users WHERE id = 'pool'");
        console.log("[Check] Pool user query result:", result.rows);

        if (result.rows.length === 0) {
            console.log("[Check] Pool user NOT FOUND! Creating...");

            await client.query(`
        INSERT INTO users (id, username, email, is_bot)
        VALUES ('pool', 'AMM Pool', 'pool@system.internal', true)
      `);

            console.log("[Check] Pool user created!");

            // Verify creation
            const verify = await client.query("SELECT id, username, email FROM users WHERE id = 'pool'");
            console.log("[Check] Verification:", verify.rows);
        } else {
            console.log("[Check] Pool user EXISTS:", result.rows[0]);
        }

        // Test FK constraint works
        console.log("[Check] Testing FK constraint with direct insert...");
        try {
            const testPlayer = await client.query("SELECT id FROM players LIMIT 1");
            const testUser = await client.query("SELECT id FROM users WHERE id != 'pool' LIMIT 1");

            if (testPlayer.rows[0] && testUser.rows[0]) {
                const insertResult = await client.query(`
          INSERT INTO trades (player_id, buyer_id, seller_id, quantity, price)
          VALUES ($1, $2, 'pool', 1.0000, 10.00)
          RETURNING id
        `, [testPlayer.rows[0].id, testUser.rows[0].id]);

                console.log("[Check] Test insert SUCCEEDED:", insertResult.rows[0]);

                // Clean up
                await client.query("DELETE FROM trades WHERE id = $1", [insertResult.rows[0].id]);
                console.log("[Check] Cleaned up test trade");
            }
        } catch (err: any) {
            console.error("[Check] Test insert FAILED:", err.message);
        }

    } finally {
        client.release();
        await pool.end();
    }
}

checkAndFixPoolUser()
    .then(() => {
        console.log("[Check] Done");
        process.exit(0);
    })
    .catch((err) => {
        console.error("[Check] Error:", err);
        process.exit(1);
    });

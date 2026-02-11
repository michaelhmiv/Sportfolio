#!/usr/bin/env tsx
/**
 * Run migration 0013 to create player_pools table
 */

import { pool } from "../server/db";
import { readFileSync } from "fs";
import { join } from "path";

async function runMigration() {
  console.log("[MIGRATION] Running 0013_amm_migration.sql...");

  try {
    // Read the migration file
    const migrationPath = join(process.cwd(), "migrations", "0013_amm_migration.sql");
    const sql = readFileSync(migrationPath, "utf-8");

    // Execute the SQL
    await pool.query(sql);

    console.log("[MIGRATION] Successfully created player_pools table!");

    // Verify the table exists
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM player_pools
    `);

    console.log(`[MIGRATION] Player pools created: ${result.rows[0].count}`);

    process.exit(0);
  } catch (error: any) {
    console.error("[MIGRATION] Error:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();

/**
 * SQL Migration Script - Add transaction_type column
 *
 * This script adds the missing transaction_type column to lp_transactions table
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("[Migration] Starting...");

  try {
    // Add the transaction_type column
    console.log("[Migration] Adding transaction_type column...");
    await db.execute(sql`
      ALTER TABLE lp_transactions 
      ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'add'
    `);

    console.log("[Migration] Column added successfully");

    // Update any existing rows (shouldn't be any, but just in case)
    console.log("[Migration] Updating existing rows...");
    await db.execute(sql`
      UPDATE lp_transactions 
      SET transaction_type = 'add' 
      WHERE transaction_type IS NULL OR transaction_type = ''
    `);

    console.log("[Migration] Complete!");
    process.exit(0);
  } catch (error) {
    console.error("[Migration] Error:", error);
    process.exit(1);
  }
}

// Run if called directly
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  runMigration();
}

export { runMigration };

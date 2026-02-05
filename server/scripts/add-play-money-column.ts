/**
 * SQL Migration Script - Add play_money column to lp_transactions
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("[Migration] Adding play_money column to lp_transactions...");
  
  try {
    await db.execute(sql`
      ALTER TABLE lp_transactions 
      ADD COLUMN IF NOT EXISTS play_money DECIMAL(12, 2) NOT NULL DEFAULT '0'
    `);
    
    console.log("[Migration] play_money column added successfully!");
    console.log("[Migration] Complete!");
    process.exit(0);
  } catch (error) {
    console.error("[Migration] Error:", error);
    process.exit(1);
  }
}

// Run if called directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  runMigration();
}

export { runMigration };

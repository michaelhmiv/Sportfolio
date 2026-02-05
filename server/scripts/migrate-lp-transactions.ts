/**
 * SQL Migration Script - Add all missing columns to lp_transactions
 * 
 * This script adds all missing columns from the schema to the production database
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("[Migration] Starting comprehensive lp_transactions migration...");
  
  try {
    // Add all missing columns
    console.log("[Migration] Adding missing columns...");
    
    await db.execute(sql`
      ALTER TABLE lp_transactions 
      ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'add',
      ADD COLUMN IF NOT EXISTS shares_amount DECIMAL(12, 2) NOT NULL DEFAULT '0',
      ADD COLUMN IF NOT EXISTS play_money_amount DECIMAL(12, 2) NOT NULL DEFAULT '0',
      ADD COLUMN IF NOT EXISTS pool_shares_before DECIMAL(12, 2) NOT NULL DEFAULT '0',
      ADD COLUMN IF NOT EXISTS pool_play_money_before DECIMAL(12, 2) NOT NULL DEFAULT '0',
      ADD COLUMN IF NOT EXISTS pool_lp_shares_total_before DECIMAL(24, 2) NOT NULL DEFAULT '0'
    `);
    
    console.log("[Migration] All columns added successfully!");
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

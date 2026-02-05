/**
 * SQL Migration Script - Drop old columns from lp_transactions
 * 
 * These columns are not in our current schema and are causing conflicts
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("[Migration] Dropping old columns from lp_transactions...");
  
  try {
    // Drop the old columns that are not in our schema
    await db.execute(sql`
      ALTER TABLE lp_transactions 
      DROP COLUMN IF EXISTS shares,
      DROP COLUMN IF EXISTS play_money
    `);
    
    console.log("[Migration] Old columns dropped successfully!");
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

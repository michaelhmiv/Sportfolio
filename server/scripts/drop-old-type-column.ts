/**
 * SQL Migration Script - Drop old 'type' column from lp_transactions
 *
 * This column is not in our schema and is causing conflicts
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("[Migration] Dropping old 'type' column from lp_transactions...");

  try {
    await db.execute(sql`
      ALTER TABLE lp_transactions 
      DROP COLUMN IF EXISTS type
    `);

    console.log("[Migration] Old column dropped successfully!");
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

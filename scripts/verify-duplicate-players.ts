/**
 * Verification script to check if duplicate players were successfully removed
 */

import "dotenv/config";
import { db } from "../server/db";
import { eq, sql } from "drizzle-orm";

async function verifyNoDuplicates() {
  console.log("=== Verifying No Duplicate Players ===\n");

  try {
    const duplicateResults = await db.execute(sql`
      SELECT
        first_name,
        last_name,
        sport,
        COUNT(*) as player_count,
        array_agg(id ORDER BY id) as player_ids
      FROM players
      GROUP BY first_name, last_name, sport
      HAVING COUNT(*) > 1
      ORDER BY player_count DESC, last_name, first_name
    `);

    const duplicateCount = duplicateResults.rows.length;

    if (duplicateCount === 0) {
      console.log("Success: No duplicate players found!");
      console.log("Migration was successful.");
    } else {
      console.log(`Warning: Found ${duplicateCount} sets of duplicate players:`);
      duplicateResults.rows.forEach((row) => {
        console.log(
          `- ${row.first_name} ${row.last_name} (${row.sport}): ${row.player_count} entries`,
        );
        console.log(`  IDs: ${row.player_ids.join(", ")}`);
      });
    }
  } catch (error: any) {
    console.error("\n!!! Verification Failed !!!");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

verifyNoDuplicates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

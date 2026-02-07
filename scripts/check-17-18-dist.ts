import "dotenv/config";
import { db } from "../server/db";
import { scoutHistory, scoutDistributions } from "../shared/schema";
import { sql } from "drizzle-orm";

async function check() {
  // Check the 17:00-18:00 window distribution calculation
  const windowStart = "2026-01-20T17:00:00Z";
  const windowEnd = "2026-01-20T18:00:00Z";

  console.log(`=== Distribution Calculation for 17:00-18:00 Window ===\n`);

  // First, let's see what history overlaps with this window
  const historyResult = await db.execute(sql`
    SELECT
      sh.user_id,
      sh.player_id,
      sh.scout_count,
      GREATEST(sh.started_at, ${windowStart}::timestamp) as effective_start,
      LEAST(COALESCE(sh.ended_at, ${windowEnd}::timestamp), ${windowEnd}::timestamp) as effective_end,
      EXTRACT(EPOCH FROM (
        LEAST(COALESCE(sh.ended_at, ${windowEnd}::timestamp), ${windowEnd}::timestamp) -
        GREATEST(sh.started_at, ${windowStart}::timestamp)
      )) / 60.0 as overlap_minutes
    FROM scout_history sh
    WHERE sh.player_id = 'nba_31030'
      AND sh.started_at < ${windowEnd}::timestamp
      AND (sh.ended_at IS NULL OR sh.ended_at > ${windowStart}::timestamp)
  `);

  console.log("History overlapping with 17:00-18:00 for Cade (nba_31030):");
  const historyRows = historyResult.rows as any[];
  if (historyRows.length === 0) {
    console.log("  NO RECORDS FOUND!");
  } else {
    historyRows.forEach((h) => {
      console.log(
        `  ${h.user_id.substring(0, 8)}... | ${h.scout_count} scouts | Overlap: ${h.overlap_minutes || 0} min`,
      );
    });
  }

  // Now check if there's a distribution record for this window
  console.log("\n=== Distribution records for Cade at 18:00 ===");
  const dists = await db
    .select()
    .from(scoutDistributions)
    .where(
      sql`${scoutDistributions.playerId} = 'nba_31030' AND ${scoutDistributions.hourTimestamp} = ${windowEnd}::timestamp`,
    );

  console.log(`Found ${dists.length} distributions for 18:00 window:`);
  dists.forEach((d) => {
    console.log(`  ${d.userId.substring(0, 8)}... | ${d.sharesEarned} shares`);
  });

  if (dists.length === 0) {
    console.log("\n⚠️  NO DISTRIBUTIONS WERE CREATED FOR CADE AT 18:00!");
    console.log("This means the distribution job either:");
    console.log("  1. Found no valid history records for this window");
    console.log("  2. Found that global_scout_minutes was 0");
    console.log("  3. Hit an error during processing");
  }
}

check().catch(console.error);

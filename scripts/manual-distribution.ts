import "dotenv/config";
import { db } from "../server/db";
import { scoutDistributions } from "../shared/schema";
import { sql } from "drizzle-orm";

async function runManualDistribution() {
  const windowStart = "2026-01-20T17:00:00Z";
  const windowEnd = "2026-01-20T18:00:00Z";

  console.log(`=== Running Manual Distribution for 17:00-18:00 Window ===\n`);

  // Run the exact same query from scout-distribution.ts
  const result = await db.execute(sql`
    WITH active_users AS (
      SELECT id
      FROM users
      WHERE last_active_at > ${windowStart}::timestamp - INTERVAL '24 hours'
    ),
    history_periods AS (
      SELECT
        sh.user_id,
        sh.player_id,
        sh.scout_count,
        GREATEST(sh.started_at, ${windowStart}::timestamp) as effective_start,
        LEAST(COALESCE(sh.ended_at, ${windowEnd}::timestamp), ${windowEnd}::timestamp) as effective_end
      FROM scout_history sh
      JOIN active_users u ON sh.user_id = u.id
      WHERE sh.started_at < ${windowEnd}::timestamp
        AND (sh.ended_at IS NULL OR sh.ended_at > ${windowStart}::timestamp)
    ),
    calculated_minutes AS (
      SELECT
        user_id,
        player_id,
        scout_count,
        EXTRACT(EPOCH FROM (effective_end - effective_start)) / 60.0 as duration_minutes
      FROM history_periods
      WHERE effective_end > effective_start
    ),
    user_totals AS (
      SELECT
        user_id,
        player_id,
        SUM(scout_count * duration_minutes) as user_scout_minutes
      FROM calculated_minutes
      GROUP BY user_id, player_id
    ),
    player_totals AS (
      SELECT
        player_id,
        SUM(user_scout_minutes) as global_scout_minutes
      FROM user_totals
      GROUP BY player_id
    )
    SELECT
      ut.user_id as "userId",
      ut.player_id as "playerId",
      ut.user_scout_minutes as "userScoutMinutes",
      pt.global_scout_minutes as "globalScoutMinutes",
      FLOOR((60.0 * ut.user_scout_minutes / pt.global_scout_minutes) * 100) / 100 as "sharesEarned"
    FROM user_totals ut
    JOIN player_totals pt ON ut.player_id = pt.player_id
    WHERE pt.global_scout_minutes > 0
  `);

  const results = result.rows as any[];
  console.log(`Calculated ${results.length} distributions\n`);

  // Check what the distribution should be for Cade (nba_31030)
  console.log("Expected distributions:");
  for (const row of results) {
    if (row.playerId === "nba_31030") {
      console.log(`\n  Cade Cunningham (nba_31030):`);
      console.log(`    User: ${row.userId}`);
      console.log(`    User minutes: ${row.userScoutMinutes}`);
      console.log(`    Global minutes: ${row.globalScoutMinutes}`);
      console.log(`    Shares: ${row.sharesEarned}`);
    }
  }

  // Now insert the distributions
  console.log("\n=== Inserting Distributions ===\n");
  for (const row of results) {
    const sharesEarned = parseFloat(row.sharesEarned);
    if (sharesEarned > 0) {
      await db.insert(scoutDistributions).values({
        hourTimestamp: new Date(windowEnd),
        playerId: row.playerId,
        userId: row.userId,
        userScoutMinutes: Math.round(parseFloat(row.userScoutMinutes)),
        globalScoutMinutes: Math.round(parseFloat(row.globalScoutMinutes)),
        sharesEarned: row.sharesEarned.toString(),
      });
      console.log(
        `  Inserted: ${row.playerId} | ${row.userId.substring(0, 8)}... | ${row.sharesEarned} shares`,
      );
    }
  }

  console.log("\n=== Done ===");
}

runManualDistribution().catch(console.error);

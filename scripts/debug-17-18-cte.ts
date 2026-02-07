import "dotenv/config";
import { db } from "../server/db";
import { users, scoutHistory } from "../shared/schema";
import { sql } from "drizzle-orm";

async function check() {
  const windowStart = "2026-01-20T17:00:00Z";
  const windowEnd = "2026-01-20T18:00:00Z";

  console.log("=== Checking Active Users Filter ===\n");

  // Check which users are considered "active" for this window
  const activeCheck = await db.execute(sql`
    SELECT id, username, last_active_at
    FROM users
    WHERE id IN (
      SELECT DISTINCT user_id
      FROM scout_history
      WHERE player_id = 'nba_31030'
        AND started_at < ${windowEnd}::timestamp
        AND (ended_at IS NULL OR ended_at > ${windowStart}::timestamp)
    )
    AND last_active_at > ${windowStart}::timestamp - INTERVAL '24 hours'
  `);

  console.log("Users considered ACTIVE for Cade distribution:");
  activeCheck.rows.forEach((u: any) => {
    console.log(`  ${u.username}: lastActiveAt = ${u.last_active_at}`);
  });

  // Now check what the full CTE returns
  console.log("\n=== Full Distribution CTE for Cade ===\n");

  const fullResult = await db.execute(sql`
    WITH active_users AS (
      SELECT id
      FROM users
      WHERE id IN (
        SELECT DISTINCT user_id
        FROM scout_history
        WHERE player_id = 'nba_31030'
          AND started_at < ${windowEnd}::timestamp
          AND (ended_at IS NULL OR ended_at > ${windowStart}::timestamp)
      )
      AND last_active_at > ${windowStart}::timestamp - INTERVAL '24 hours'
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
      WHERE sh.player_id = 'nba_31030'
        AND sh.started_at < ${windowEnd}::timestamp
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
      ROUND((60.0 * ut.user_scout_minutes / pt.global_scout_minutes)::numeric, 2) as "sharesEarned"
    FROM user_totals ut
    JOIN player_totals pt ON ut.player_id = pt.player_id
    WHERE pt.global_scout_minutes > 0
  `);

  console.log("Expected distributions for Cade (17:00-18:00):");
  fullResult.rows.forEach((r: any) => {
    console.log(`  ${r.userId.substring(0, 8)}...: ${r.sharesEarned} shares`);
    console.log(
      `    User min: ${parseFloat(r.userScoutMinutes).toFixed(1)}, Global: ${parseFloat(r.globalScoutMinutes).toFixed(1)}`,
    );
  });

  if (fullResult.rows.length === 0) {
    console.log("\n⚠️  No distributions calculated! This is the bug.");
  }
}

check().catch(console.error);

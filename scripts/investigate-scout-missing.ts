import 'dotenv/config';
import { db } from "../server/db";
import { scoutAssignments, scoutHistory, scoutDistributions } from "../shared/schema";
import { eq, desc, sql } from "drizzle-orm";

async function investigate() {
  const userId = 'dev-user-12345678';
  const now = new Date();
  const hourEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
  const hourStart = new Date(hourEnd.getTime() - 60 * 60 * 1000);

  console.log(`Current time: ${now.toISOString()}`);
  console.log(`Window being calculated: ${hourStart.toISOString()} to ${hourEnd.toISOString()}\n`);

  // Get dev-user's assignments
  console.log('=== dev-user scout assignments ===');
  const assignments = await db.select().from(scoutAssignments)
    .where(eq(scoutAssignments.userId, userId));

  assignments.forEach(a => {
    console.log(`  ${a.playerId}: ${a.scoutCount} scouts`);
  });

  // Get open history for dev-user
  console.log('\n=== Open scout history for dev-user ===');
  const openHistory = await db.select().from(scoutHistory)
    .where(sql`${scoutHistory.userId} = ${userId} AND ${scoutHistory.endedAt} IS NULL`);

  openHistory.forEach(h => {
    console.log(`  ${h.playerId}: ${h.scoutCount} scouts since ${h.startedAt}`);
  });

  // Get distributions for dev-user
  console.log('\n=== Recent distributions for dev-user ===');
  const dists = await db.select().from(scoutDistributions)
    .where(eq(scoutDistributions.userId, userId))
    .orderBy(desc(scoutDistributions.hourTimestamp))
    .limit(10);

  dists.forEach(d => {
    console.log(`  ${d.hourTimestamp}: ${d.playerId} | ${d.sharesEarned} shares`);
  });

  // Run the distribution calculation manually for the current window
  console.log('\n=== Manual calculation for current window ===');
  const hourEndISO = hourEnd.toISOString();
  const hourStartISO = hourStart.toISOString();

  const result = await db.execute(sql`
    WITH history_periods AS (
      SELECT
        sh.user_id,
        sh.player_id,
        sh.scout_count,
        GREATEST(sh.started_at, ${hourStartISO}::timestamp) as effective_start,
        LEAST(COALESCE(sh.ended_at, ${hourEndISO}::timestamp), ${hourEndISO}::timestamp) as effective_end
      FROM scout_history sh
      WHERE sh.user_id = ${userId}
        AND sh.started_at < ${hourEndISO}::timestamp
        AND (sh.ended_at IS NULL OR sh.ended_at > ${hourStartISO}::timestamp)
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
      ut.player_id as "playerId",
      ut.user_scout_minutes as "userScoutMinutes",
      pt.global_scout_minutes as "globalScoutMinutes",
      ROUND((60.0 * ut.user_scout_minutes / pt.global_scout_minutes)::numeric, 2) as "sharesEarned"
    FROM user_totals ut
    JOIN player_totals pt ON ut.player_id = pt.player_id
    WHERE pt.global_scout_minutes > 0
  `);

  console.log('\nExpected earnings this hour:');
  const rows = result.rows as any[];
  if (rows.length === 0) {
    console.log('  No distributions calculated (this could be normal if window just started)');
  } else {
    rows.forEach(r => {
      console.log(`  ${r.playerId}: ${r.sharesEarned} shares`);
      console.log(`    Your minutes: ${parseFloat(r.userScoutMinutes).toFixed(1)}, Global: ${parseFloat(r.globalScoutMinutes).toFixed(1)}`);
    });
  }
}

investigate().catch(console.error);

import 'dotenv/config';
import { db } from "../server/db";
import { scoutHistory } from "../shared/schema";
import { sql } from "drizzle-orm";

async function check() {
  console.log('=== Raw scout_history for Cade (nba_31030) around 17:00-18:00 ===\n');

  // Get all history records for Cade
  const allHistory = await db.select().from(scoutHistory)
    .where(sql`${scoutHistory.playerId} = 'nba_31030'`)
    .orderBy(scoutHistory.startedAt);

  console.log('All history records for Cade:');
  allHistory.forEach(h => {
    console.log(`  ${h.id.substring(0,8)}... | ${h.userId.substring(0,8)}... | ${h.scoutCount} scouts`);
    console.log(`    started: ${h.startedAt} | ended: ${h.endedAt || 'NULL'}`);
  });

  // Now let's check what the actual distribution job query sees
  const windowStart = '2026-01-20T17:00:00Z';
  const windowEnd = '2026-01-20T18:00:00Z';

  console.log('\n=== What distribution job sees (with active_users filter) ===\n');

  const result = await db.execute(sql`
    WITH active_users AS (
      SELECT id
      FROM users
      WHERE last_active_at > ${windowStart}::timestamp - INTERVAL '24 hours'
    )
    SELECT
      sh.user_id,
      sh.player_id,
      sh.scout_count,
      sh.started_at,
      sh.ended_at,
      GREATEST(sh.started_at, ${windowStart}::timestamp) as effective_start,
      LEAST(COALESCE(sh.ended_at, ${windowEnd}::timestamp), ${windowEnd}::timestamp) as effective_end,
      EXTRACT(EPOCH FROM (
        LEAST(COALESCE(sh.ended_at, ${windowEnd}::timestamp), ${windowEnd}::timestamp) -
        GREATEST(sh.started_at, ${windowStart}::timestamp)
      )) / 60.0 as overlap_minutes
    FROM scout_history sh
    JOIN active_users u ON sh.user_id = u.id
    WHERE sh.player_id = 'nba_31030'
      AND sh.started_at < ${windowEnd}::timestamp
      AND (sh.ended_at IS NULL OR sh.ended_at > ${windowStart}::timestamp)
  `);

  console.log('Records found:');
  result.rows.forEach((r: any) => {
    console.log(`  ${r.user_id.substring(0,8)}... | ${r.scout_count} scouts | Overlap: ${r.overlap_minutes || 0} min`);
    console.log(`    started: ${r.started_at} | ended: ${r.ended_at || 'NULL'}`);
    console.log(`    effective_start: ${r.effective_start} | effective_end: ${r.effective_end}`);
  });
}

check().catch(console.error);

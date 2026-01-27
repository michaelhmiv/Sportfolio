import 'dotenv/config';
import { db } from "../server/db";
import { scoutHistory, scoutDistributions } from "../shared/schema";
import { eq, gte, lte, sql, desc } from "drizzle-orm";

async function check() {
  const playerId = 'nba_31030'; // Cade Cunningham
  const windowStart = new Date('2026-01-20T17:00:00Z');
  const windowEnd = new Date('2026-01-20T18:00:00Z');

  console.log(`=== Checking Cade Cunningham (${playerId}) during 17:00-18:00 window ===\n`);

  // Get all history that overlaps with this window
  const history = await db.select().from(scoutHistory)
    .where(eq(scoutHistory.playerId, playerId))
    .orderBy(desc(scoutHistory.startedAt));

  console.log('All history for Cade Cunningham:');
  history.slice(0, 10).forEach(h => {
    console.log(`  ${h.userId.substring(0,8)}... | ${h.scoutCount} scouts | ${h.startedAt} -> ${h.endedAt || 'OPEN'}`);
  });

  // Check the specific window
  console.log('\n=== History overlapping with 17:00-18:00 ===');
  const windowHistory = await db.select().from(scoutHistory)
    .where(sql`
      ${scoutHistory.playerId} = ${playerId}
      AND ${scoutHistory.started_at} < ${windowEnd.toISOString()}::timestamp
      AND (${scoutHistory.ended_at} IS NULL OR ${scoutHistory.ended_at} > ${windowStart.toISOString()}::timestamp)
    `);

  console.log(`Found ${windowHistory.length} records overlapping`);
  windowHistory.forEach(h => {
    console.log(`  ${h.userId.substring(0,8)}...: ${h.scoutCount} scouts | ${h.startedAt} -> ${h.endedAt || 'OPEN'}`);
  });

  // Check if there's a distribution for this window
  console.log('\n=== Distribution records for Cade ===');
  const dists = await db.select().from(scoutDistributions)
    .where(eq(scoutDistributions.playerId, playerId))
    .orderBy(desc(scoutDistributions.hourTimestamp))
    .limit(10);

  console.log(`Found ${dists.length} distribution records:`);
  dists.forEach(d => {
    console.log(`  ${d.hourTimestamp}: ${d.userId.substring(0,8)}... | ${d.sharesEarned} shares`);
    console.log(`    User min: ${d.userScoutMinutes}, Global min: ${d.globalScoutMinutes}`);
  });
}

check().catch(console.error);

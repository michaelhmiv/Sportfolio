import 'dotenv/config';
import { db } from "../server/db";
import { scoutAssignments, scoutHistory, scoutDistributions } from "../shared/schema";
import { eq, desc, gte, and, lte, sql } from "drizzle-orm";

async function analyzeDistribution() {
  console.log('=== Scout Distribution Math Analysis ===\n');

  // For the 17:00 distribution (which covers 16:00-17:00 window)
  const distributionHour = new Date('2026-01-20T17:00:00Z');
  const windowStart = new Date('2026-01-20T16:00:00Z');
  const windowEnd = new Date('2026-01-20T17:00:00Z');

  console.log(`Distribution hour: ${distributionHour.toISOString()}`);
  console.log(`Window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}\n`);

  // Get the actual distribution records
  console.log('=== Actual Distribution Records ===');
  const dists = await db.select({
    userId: scoutDistributions.userId,
    playerId: scoutDistributions.playerId,
    shares: scoutDistributions.sharesEarned,
    userMinutes: scoutDistributions.userScoutMinutes,
    globalMinutes: scoutDistributions.globalScoutMinutes,
  })
  .from(scoutDistributions)
  .where(eq(scoutDistributions.hourTimestamp, distributionHour));

  dists.forEach(d => {
    const expected = (60 * d.userMinutes / d.globalMinutes).toFixed(2);
    console.log(`User ${d.userId.substring(0,8)}... | Player ${d.playerId}`);
    console.log(`  Received: ${d.shares} | UserMin: ${d.userMinutes} | GlobalMin: ${d.globalMinutes}`);
    console.log(`  Formula check: (60 * ${d.userMinutes}) / ${d.globalMinutes} = ${expected}`);
  });

  // Now let's verify by looking at scout_history
  console.log('\n=== Scout History Overlap Analysis ===');

  // Get all history records that overlap with 16:00-17:00 window
  const history = await db.select().from(scoutHistory)
    .where(and(
      lte(scoutHistory.startedAt, windowEnd), // started before window ends
      sql`(${scoutHistory.endedAt} IS NULL OR ${scoutHistory.endedAt} > ${windowStart.toISOString()}::timestamp)` // not ended before window starts
    ));

  console.log(`Found ${history.length} history records overlapping with window`);

  // Group by player
  const byPlayer: Record<string, typeof history> = {};
  history.forEach(h => {
    if (!byPlayer[h.playerId]) byPlayer[h.playerId] = [];
    byPlayer[h.playerId].push(h);
  });

  console.log('\n=== Players with History ===');
  for (const [playerId, records] of Object.entries(byPlayer)) {
    console.log(`\nPlayer ${playerId}: ${records.length} records`);
    let totalPlayerScoutMinutes = 0;

    records.forEach(h => {
      const startTime = new Date(h.startedAt);
      const endTime = h.endedAt ? new Date(h.endedAt) : windowEnd;

      // Calculate overlap
      const overlapStart = startTime > windowStart ? startTime : windowStart;
      const overlapEnd = endTime < windowEnd ? endTime : windowEnd;

      if (overlapEnd > overlapStart) {
        const overlapMinutes = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60);
        const scoutMinutes = h.scoutCount * overlapMinutes;
        totalPlayerScoutMinutes += scoutMinutes;

        if (h.userId === 'dev-user-12345678' || h.userId.substring(0,8) === '83eeaf7' || scoutMinutes > 50) {
          console.log(`  User ${h.userId.substring(0,8)}...: ${h.scoutCount} scouts × ${overlapMinutes.toFixed(1)} min = ${scoutMinutes.toFixed(1)} scout-minutes`);
        }
      }
    });

    console.log(`  TOTAL: ${totalPlayerScoutMinutes.toFixed(1)} scout-minutes`);

    // Find dev-user's contribution
    const devUserRecord = records.find(h => h.userId === 'dev-user-12345678');
    if (devUserRecord) {
      const startTime = new Date(devUserRecord.startedAt);
      const endTime = devUserRecord.endedAt ? new Date(devUserRecord.endedAt) : windowEnd;
      const overlapStart = startTime > windowStart ? startTime : windowStart;
      const overlapEnd = endTime < windowEnd ? endTime : windowEnd;
      const overlapMinutes = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60);
      const devMinutes = devUserRecord.scoutCount * overlapMinutes;
      console.log(`  dev-user-12345678: ${devUserRecord.scoutCount} scouts × ${overlapMinutes.toFixed(1)} min = ${devMinutes.toFixed(1)} scout-minutes`);
      console.log(`  Your expected share: ${(devMinutes / totalPlayerScoutMinutes * 60).toFixed(2)} shares`);
    }

    // Check the distribution for this player
    const playerDist = dists.find(d => d.playerId === playerId);
    if (playerDist) {
      console.log(`  DISTRIBUTION: ${playerDist.shares} shares to user ${playerDist.userId.substring(0,8)}...`);
    }
  }
}

analyzeDistribution().catch(console.error);

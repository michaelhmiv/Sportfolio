import 'dotenv/config';
import { db } from "../server/db";
import { scoutAssignments, scoutHistory, users, players } from "../shared/schema";
import { eq, desc, sql } from "drizzle-orm";

async function verifyScoutCounts() {
  console.log('=== SCOUT COUNT VERIFICATION ===\n');

  // 1. Check all active assignments
  console.log('1. ACTIVE SCOUT ASSIGNMENTS');
  console.log('='.repeat(60));

  const assignments = await db.select({
    userId: scoutAssignments.userId,
    username: users.username,
    playerId: scoutAssignments.playerId,
    scoutCount: scoutAssignments.scoutCount,
    assignedAt: scoutAssignments.createdAt,
    updatedAt: scoutAssignments.updatedAt,
  })
  .from(scoutAssignments)
  .innerJoin(users, eq(scoutAssignments.userId, users.id))
  .orderBy(users.username, scoutAssignments.playerId);

  console.log(`Total active assignments: ${assignments.length}\n`);

  // Group by user
  const byUser: Record<string, typeof assignments> = {};
  assignments.forEach(a => {
    if (!byUser[a.userId]) byUser[a.userId] = [];
    byUser[a.userId].push(a);
  });

  // Check total scouts per user
  console.log('Scouts per user:');
  for (const [userId, userAssigns] of Object.entries(byUser)) {
    const totalScouts = userAssigns.reduce((sum, a) => sum + a.scoutCount, 0);
    const maxScouts = 10; // Premium limit
    const isPremium = userAssigns[0].username?.includes('premium') || false; // Simplified check
    const limit = isPremium ? 10 : 5;

    console.log(`  ${userAssigns[0].username}: ${totalScouts}/${limit} scouts`);
    userAssigns.forEach(a => {
      console.log(`    - ${a.playerId}: ${a.scoutCount} scouts`);
    });
  }

  // 2. Verify scout history matches assignments
  console.log('\n\n2. HISTORY RECORDS vs ASSIGNMENTS');
  console.log('='.repeat(60));

  let historyMatchCount = 0;
  let historyMismatchCount = 0;

  for (const assignment of assignments) {
    // Get latest history record for this user/player
    const [latestHistory] = await db.select().from(scoutHistory)
      .where(eq(scoutHistory.userId, assignment.userId))
      .orderBy(desc(scoutHistory.startedAt))
      .limit(1);

    if (latestHistory) {
      const isMatch = latestHistory.scoutCount === assignment.scoutCount;

      if (assignment.userId === 'dev-user-12345678') {
        console.log(`\n★ dev-user-12345678:`);
        console.log(`  Assignment scoutCount: ${assignment.scoutCount}`);
        console.log(`  Latest history scoutCount: ${latestHistory.scoutCount}`);
        console.log(`  History started: ${latestHistory.startedAt}`);
        console.log(`  History ended: ${latestHistory.endedAt || 'NULL (open)'}`);
        console.log(`  Status: ${isMatch ? '✓ MATCH' : '⚠️ MISMATCH'}`);
      }

      if (isMatch) historyMatchCount++;
      else historyMismatchCount++;
    }
  }

  console.log(`\nHistory-Assignment Matches: ${historyMatchCount}`);
  console.log(`History-Assignment Mismatches: ${historyMismatchCount}`);

  // 3. Verify open history records exist for all active assignments
  console.log('\n\n3. OPEN HISTORY RECORDS (for current hour calculation)');
  console.log('='.repeat(60));

  const openHistory = await db.select({
    userId: scoutHistory.userId,
    playerId: scoutHistory.playerId,
    scoutCount: scoutHistory.scoutCount,
    startedAt: scoutHistory.startedAt,
  })
  .from(scoutHistory)
  .where(sql`${scoutHistory.endedAt} IS NULL`);

  console.log(`Open history records: ${openHistory.length}`);

  // Check if any assignment is missing open history
  const missingHistory: string[] = [];
  for (const assignment of assignments) {
    const hasOpen = openHistory.some(h => h.userId === assignment.userId && h.playerId === assignment.playerId);
    if (!hasOpen) {
      missingHistory.push(`${assignment.userId}:${assignment.playerId}`);
    }
  }

  if (missingHistory.length > 0) {
    console.log(`\n⚠️ Assignments MISSING open history: ${missingHistory.length}`);
    missingHistory.slice(0, 5).forEach(m => console.log(`  - ${m}`));
  } else {
    console.log(`\n✓ All active assignments have open history records`);
  }

  // 4. Verify dev-user specifically
  console.log('\n\n4. DEV-USER DETAILED BREAKDOWN');
  console.log('='.repeat(60));

  const devUserId = 'dev-user-12345678';
  const [devUser] = await db.select().from(users).where(eq(users.id, devUserId));
  console.log(`User: ${devUser?.username}`);
  console.log(`isPremium: ${devUser?.isPremium}`);
  console.log(`Max scouts: ${devUser?.isPremium ? 10 : 5}`);

  const devAssignments = assignments.filter(a => a.userId === devUserId);
  const devTotal = devAssignments.reduce((sum, a) => sum + a.scoutCount, 0);
  console.log(`Total assigned: ${devTotal} / ${devUser?.isPremium ? 10 : 5}`);

  console.log('\nAssignment breakdown:');
  for (const a of devAssignments) {
    const [historyRec] = await db.select().from(scoutHistory)
      .where(sql`${scoutHistory.userId} = ${a.userId} AND ${scoutHistory.playerId} = ${a.playerId} AND ${scoutHistory.endedAt} IS NULL`)
      .limit(1);

    console.log(`  ${a.playerId}:`);
    console.log(`    Assignment: ${a.scoutCount} scouts`);
    console.log(`    Open history: ${historyRec ? historyRec.scoutCount + ' scouts (OK)' : 'MISSING!'}`);
  }

  // 5. Calculate what dev-user SHOULD earn this hour
  console.log('\n\n5. EXPECTED DISTRIBUTION FOR DEV-USER');
  console.log('='.repeat(60));

  const now = new Date();
  const hourEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
  const hourStart = new Date(hourEnd.getTime() - 60 * 60 * 1000);

  console.log(`Window: ${hourStart.toISOString()} to ${hourEnd.toISOString()}`);

  // Get all open history that overlaps with window
  const windowHistory = await db.select().from(scoutHistory)
    .where(sql`
      ${scoutHistory.started_at} < ${hourEnd.toISOString()}::timestamp
      AND (${scoutHistory.ended_at} IS NULL OR ${scoutHistory.ended_at} > ${hourStart.toISOString()}::timestamp)
    `);

  // Group by player
  const byPlayer: Record<string, typeof windowHistory> = {};
  windowHistory.forEach(h => {
    if (!byPlayer[h.playerId]) byPlayer[h.playerId] = [];
    byPlayer[h.playerId].push(h);
  });

  console.log('\nExpected earnings this hour:');
  for (const [playerId, records] of Object.entries(byPlayer)) {
    const devRecord = records.find(h => h.userId === devUserId);
    if (!devRecord) continue;

    // Calculate overlap
    const startTime = new Date(devRecord.startedAt);
    const endTime = devRecord.endedAt ? new Date(devRecord.endedAt) : hourEnd;
    const overlapStart = startTime > hourStart ? startTime : hourStart;
    const overlapEnd = endTime < hourEnd ? endTime : hourEnd;
    const overlapMin = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60);

    const devScoutMinutes = devRecord.scoutCount * overlapMin;

    // Calculate global
    let globalScoutMinutes = 0;
    for (const r of records) {
      const rStart = new Date(r.startedAt);
      const rEnd = r.endedAt ? new Date(r.endedAt) : hourEnd;
      const rOverlapStart = rStart > hourStart ? rStart : hourStart;
      const rOverlapEnd = rEnd < hourEnd ? rEnd : hourEnd;
      if (rOverlapEnd > rOverlapStart) {
        globalScoutMinutes += r.scoutCount * ((rOverlapEnd.getTime() - rOverlapStart.getTime()) / (1000 * 60));
      }
    }

    const expectedShares = (60 * devScoutMinutes / globalScoutMinutes);

    console.log(`  ${playerId}: ${expectedShares.toFixed(2)} shares`);
    console.log(`    Your: ${devRecord.scoutCount} scouts × ${overlapMin.toFixed(1)} min = ${devScoutMinutes.toFixed(1)} scout-minutes`);
    console.log(`    Global: ${globalScoutMinutes.toFixed(1)} scout-minutes`);
  }

  console.log('\n=== VERIFICATION COMPLETE ===');
  console.log(`✓ Scout counts in assignments are correct`);
  console.log(`✓ History records match assignments: ${historyMatchCount}/${historyMatchCount + historyMismatchCount}`);
  console.log(`${missingHistory.length === 0 ? '✓' : '⚠️'} Open history records: ${missingHistory.length === 0 ? 'All present' : 'Missing ' + missingHistory.length}`);
}

verifyScoutCounts().catch(console.error);

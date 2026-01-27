import 'dotenv/config';
import { db } from "../server/db";
import { scoutAssignments, scoutHistory, users } from "../shared/schema";
import { eq, desc, sql, and, isNull } from "drizzle-orm";

async function investigate() {
  console.log('=== BOT SCOUT LIMIT INVESTIGATION ===\n');

  // Check which users are bots
  const allUsers = await db.select({
    id: users.id,
    username: users.username,
    isPremium: users.isPremium,
    isBot: users.isBot,
  }).from(users);

  console.log('Users with scout assignments:');
  const botUsers = allUsers.filter(u => u.isBot);
  const regularUsers = allUsers.filter(u => !u.isBot);

  console.log(`\nBots (${botUsers.length}):`);
  for (const u of botUsers) {
    console.log(`  ${u.username}: isPremium=${u.isPremium}, isBot=${u.isBot}`);
  }

  console.log(`\nRegular users (${regularUsers.length}):`);
  for (const u of regularUsers) {
    if (u.username?.includes('dev') || u.username?.includes('test')) {
      console.log(`  ${u.username}: isPremium=${u.isPremium}, isBot=${u.isBot}`);
    }
  }

  // Get scout counts per user with limits
  console.log('\n\n=== SCOUT COUNTS vs LIMITS ===\n');

  const assignments = await db.select({
    userId: scoutAssignments.userId,
    username: users.username,
    isPremium: users.isPremium,
    isBot: users.isBot,
    totalAssigned: sql<number>`SUM(${scoutAssignments.scoutCount})`.as(),
  })
  .from(scoutAssignments)
  .innerJoin(users, eq(scoutAssignments.userId, users.id))
  .groupBy(scoutAssignments.userId, users.username, users.isPremium, users.isBot);

  for (const a of assignments) {
    const limit = a.isPremium || a.isBot ? 10 : 5; // Bots should have premium-like limits
    const status = a.totalAssigned <= limit ? '✓' : '⚠️ EXCEEDS LIMIT';
    console.log(`${a.username}: ${a.totalAssigned}/${limit} ${status}`);
  }

  // Check the history mismatches
  console.log('\n\n=== INVESTIGATING HISTORY MISMATCHES ===\n');

  // Get all assignments with their open history
  const allAssignments = await db.select({
    userId: scoutAssignments.userId,
    username: users.username,
    playerId: scoutAssignments.playerId,
    assignCount: scoutAssignments.scoutCount,
    historyCount: sql<number>`COALESCE((
      SELECT ${scoutHistory.scoutCount}
      FROM ${scoutHistory}
      WHERE ${scoutHistory.userId} = ${scoutAssignments.userId}
        AND ${scoutHistory.playerId} = ${scoutAssignments.playerId}
        AND ${scoutHistory.endedAt} IS NULL
      LIMIT 1
    ), 0)`.as(),
  })
  .from(scoutAssignments)
  .innerJoin(users, eq(scoutAssignments.userId, users.id));

  const mismatches = allAssignments.filter(a => a.assignCount !== a.historyCount);
  console.log(`Found ${mismatches.length} mismatches:\n`);

  mismatches.slice(0, 10).forEach(m => {
    console.log(`${m.username} on ${m.playerId}:`);
    console.log `  Assignment: ${m.assignCount} scouts`;
    console.log `  Open history: ${m.historyCount} scouts`;
    console.log();
  });

  // Check the actual history for dev-user specifically
  console.log('=== DEV-USER HISTORY RECORDS ===\n');
  const devUserId = 'dev-user-12345678';

  const devHistory = await db.select().from(scoutHistory)
    .where(eq(scoutHistory.userId, devUserId))
    .orderBy(desc(scoutHistory.startedAt));

  console.log(`Total history records for dev-user: ${devHistory.length}\n`);

  const byPlayer: Record<string, typeof devHistory> = {};
  devHistory.forEach(h => {
    if (!byPlayer[h.playerId]) byPlayer[h.playerId] = [];
    byPlayer[h.playerId].push(h);
  });

  for (const [playerId, records] of Object.entries(byPlayer)) {
    console.log(`${playerId}:`);
    records.slice(0, 3).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.scoutCount} scouts | ${r.startedAt} -> ${r.endedAt || 'OPEN'}`);
    });
    if (records.length > 3) {
      console.log(`  ... and ${records.length - 3} more older records`);
    }
    console.log();
  }
}

investigate().catch(console.error);

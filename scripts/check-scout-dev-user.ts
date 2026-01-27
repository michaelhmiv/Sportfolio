import 'dotenv/config';
import { db } from "../server/db";
import { users, players, scoutAssignments, scoutHistory, scoutDistributions } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function debug() {
  const userId = 'dev-user-12345678';
  console.log('=== Scout System Debug for dev-user-12345678 ===\n');

  // Check user
  const [devUser] = await db.select().from(users).where(eq(users.id, userId));
  console.log('1. User:', devUser?.username, '| isPremium:', devUser?.isPremium, '| lastActive:', devUser?.lastActiveAt);

  // Check scout assignments
  console.log('\n2. Scout Assignments:');
  const assignments = await db.select({
    id: scoutAssignments.id,
    playerId: scoutAssignments.playerId,
    scoutCount: scoutAssignments.scoutCount,
    updatedAt: scoutAssignments.updatedAt,
    player: { firstName: players.firstName, lastName: players.lastName, team: players.team }
  })
  .from(scoutAssignments)
  .innerJoin(players, eq(scoutAssignments.playerId, players.id))
  .where(eq(scoutAssignments.userId, userId));

  assignments.forEach(a => {
    console.log(`   - ${a.player.firstName} ${a.player.lastName} (${a.player.team}): ${a.scoutCount} scouts`);
  });

  // Check scout history (open records)
  console.log('\n3. Open Scout History:');
  const history = await db.select({
    id: scoutHistory.id,
    playerId: scoutHistory.playerId,
    scoutCount: scoutHistory.scoutCount,
    startedAt: scoutHistory.startedAt,
    endedAt: scoutHistory.endedAt,
  })
  .from(scoutHistory)
  .where(eq(scoutHistory.userId, userId));

  history.forEach(h => {
    console.log(`   - Player ${h.playerId}: ${h.scoutCount} scouts, started ${h.startedAt}, ended: ${h.endedAt || 'OPEN'}`);
  });

  // Check scout distributions (last 24 hours)
  console.log('\n4. Recent Scout Distributions (last 24h):');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const distributions = await db.select({
    id: scoutDistributions.id,
    hourTimestamp: scoutDistributions.hourTimestamp,
    playerId: scoutDistributions.playerId,
    sharesEarned: scoutDistributions.sharesEarned,
  })
  .from(scoutDistributions)
  .where(eq(scoutDistributions.userId, userId))
  .orderBy(desc(scoutDistributions.hourTimestamp))
  .limit(10);

  console.log('   Count:', distributions.length);
  distributions.forEach(d => {
    console.log(`   - ${d.hourTimestamp}: ${d.sharesEarned} shares for player ${d.playerId}`);
  });

  // Check job execution logs
  console.log('\n5. Job Execution Logs (last 10):');
  const { jobExecutionLogs } = require("../shared/schema");
  const logs = await db.select().from(jobExecutionLogs)
    .where(eq(jobExecutionLogs.jobName, 'scout_distribution'))
    .orderBy(desc(jobExecutionLogs.scheduledFor))
    .limit(10);

  logs.forEach(l => {
    console.log(`   - ${l.scheduledFor}: ${l.status} | ${l.recordsProcessed} records, ${l.errorCount} errors`);
    if (l.errorMessage) console.log(`     Error: ${l.errorMessage}`);
  });
}

debug().catch(console.error);

import "dotenv/config";
import { db } from "../server/db";
import {
  users,
  players,
  scoutAssignments,
  scoutHistory,
  scoutDistributions,
} from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function debug() {
  console.log("=== Checking scout system for dev_user ===\n");

  // Check if dev_user exists
  const [devUser] = await db.select().from(users).where(eq(users.id, "dev_user"));
  console.log("1. User lookup (dev_user):");
  console.log(
    "   Found:",
    devUser ? `YES - ${devUser.username} (lastActive: ${devUser.lastActiveAt})` : "NO",
  );

  // Check scout assignments for dev_user
  console.log("\n2. Scout assignments for dev_user:");
  const assignments = await db
    .select({
      id: scoutAssignments.id,
      playerId: scoutAssignments.playerId,
      scoutCount: scoutAssignments.scoutCount,
      updatedAt: scoutAssignments.updatedAt,
      player: { firstName: players.firstName, lastName: players.lastName, team: players.team },
    })
    .from(scoutAssignments)
    .innerJoin(players, eq(scoutAssignments.playerId, players.id))
    .where(eq(scoutAssignments.userId, "dev_user"));

  console.log("   Count:", assignments.length);
  assignments.forEach((a) => {
    console.log(`   - Player: ${a.player.firstName} ${a.player.lastName} (${a.player.team})`);
    console.log(`     Scout Count: ${a.scoutCount}, Updated: ${a.updatedAt}`);
  });

  // Check scout history for dev_user
  console.log("\n3. Scout history for dev_user:");
  const history = await db
    .select({
      id: scoutHistory.id,
      playerId: scoutHistory.playerId,
      scoutCount: scoutHistory.scoutCount,
      startedAt: scoutHistory.startedAt,
      endedAt: scoutHistory.endedAt,
    })
    .from(scoutHistory)
    .where(eq(scoutHistory.userId, "dev_user"))
    .orderBy(desc(scoutHistory.startedAt))
    .limit(10);

  console.log("   Count:", history.length);
  history.forEach((h) => {
    console.log(`   - Player: ${h.playerId}`);
    console.log(`     Scout Count: ${h.scoutCount}`);
    console.log(`     Started: ${h.startedAt}`);
    console.log(`     Ended: ${h.endedAt || "NULL (open)"}`);
  });

  // Check scout distributions for dev_user
  console.log("\n4. Scout distributions for dev_user:");
  const distributions = await db
    .select({
      id: scoutDistributions.id,
      hourTimestamp: scoutDistributions.hourTimestamp,
      playerId: scoutDistributions.playerId,
      sharesEarned: scoutDistributions.sharesEarned,
      userScoutMinutes: scoutDistributions.userScoutMinutes,
      globalScoutMinutes: scoutDistributions.globalScoutMinutes,
    })
    .from(scoutDistributions)
    .where(eq(scoutDistributions.userId, "dev_user"))
    .orderBy(desc(scoutDistributions.hourTimestamp))
    .limit(20);

  console.log("   Count:", distributions.length);
  distributions.forEach((d) => {
    console.log(`   - Hour: ${d.hourTimestamp}`);
    console.log(`     Player: ${d.playerId}`);
    console.log(`     Shares: ${d.sharesEarned}`);
    console.log(`     User Min: ${d.userScoutMinutes}, Global Min: ${d.globalScoutMinutes}`);
  });

  // Now check for dev-user-12345678 too
  console.log("\n\n=== Also checking dev-user-12345678 ===\n");

  const [devUser2] = await db.select().from(users).where(eq(users.id, "dev-user-12345678"));
  console.log("1. User lookup (dev-user-12345678):");
  console.log("   Found:", devUser2 ? `YES - ${devUser2.username}` : "NO");

  const assignments2 = await db
    .select({
      id: scoutAssignments.id,
      playerId: scoutAssignments.playerId,
      scoutCount: scoutAssignments.scoutCount,
    })
    .from(scoutAssignments)
    .where(eq(scoutAssignments.userId, "dev-user-12345678"));

  console.log("2. Scout assignments:", assignments2.length);
}

debug().catch(console.error);

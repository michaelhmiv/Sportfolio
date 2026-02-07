import { db } from "../server/db";
import { scoutAssignments, users, players } from "@shared/schema";
import { eq, gte, and, sql } from "drizzle-orm";

async function check() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  console.log("--- SCOUT SYSTEM STATUS ---");

  const assignments = await db
    .select({
      userId: scoutAssignments.userId,
      username: users.username,
      playerId: scoutAssignments.playerId,
      playerName: sql<string>`${players.firstName} || ' ' || ${players.lastName}`,
      count: scoutAssignments.scoutCount,
      lastActive: users.lastActiveAt,
    })
    .from(scoutAssignments)
    .innerJoin(users, eq(scoutAssignments.userId, users.id))
    .innerJoin(players, eq(scoutAssignments.playerId, players.id));

  console.log(`Found ${assignments.length} total assignments:`);
  assignments.forEach((a) => {
    const isActive = new Date(a.lastActive) >= twentyFourHoursAgo;
    console.log(
      `- User: ${a.username} | Player: ${a.playerName} | Count: ${a.count} | Active: ${isActive}`,
    );
  });

  const globalCounts = await db
    .select({
      playerId: scoutAssignments.playerId,
      total: sql<number>`SUM(${scoutAssignments.scoutCount})`,
    })
    .from(scoutAssignments)
    .groupBy(scoutAssignments.playerId);

  console.log("\nGlobal Player Counts:");
  globalCounts.forEach((g) => {
    console.log(`- Player ${g.playerId}: ${g.total} scouts total`);
  });
}

check().catch(console.error);

import "dotenv/config";
import { db } from "../server/db";
import { scoutAssignments, scoutHistory, scoutDistributions } from "../shared/schema";
import { eq, desc, gte } from "drizzle-orm";

async function analyzeDistribution() {
  console.log("=== Detailed Scout Distribution Analysis ===\n");

  // Look at the specific distribution that earned 30 shares
  const targetHour = new Date("2026-01-20T17:00:00Z");
  console.log("Target hour:", targetHour.toISOString());

  // Get the distribution record
  const dist = await db
    .select()
    .from(scoutDistributions)
    .where(eq(scoutDistributions.hourTimestamp, targetHour))
    .orderBy(scoutDistributions.playerId);

  console.log("\nAll distributions for 17:00 hour:");
  dist.forEach((d) => {
    console.log(
      `  Player ${d.playerId}: ${d.sharesEarned} shares | User min: ${d.userScoutMinutes} | Global min: ${d.globalScoutMinutes}`,
    );
  });

  // Now calculate what the math should be
  console.log("\n=== Math Verification ===");
  const playerGroups: Record<string, typeof dist> = {};
  dist.forEach((d) => {
    if (!playerGroups[d.playerId]) playerGroups[d.playerId] = [];
    playerGroups[d.playerId].push(d);
  });

  for (const [playerId, dists] of Object.entries(playerGroups)) {
    const totalShares = dists.reduce((sum, d) => sum + parseFloat(d.sharesEarned.toString()), 0);
    const totalUserMinutes = dists.reduce((sum, d) => sum + d.userScoutMinutes, 0);
    const totalGlobalMinutes = dists.reduce((sum, d) => sum + d.globalScoutMinutes, 0);

    console.log(`\nPlayer ${playerId}:`);
    console.log(`  Total shares distributed: ${totalShares}`);
    console.log(`  Sum of userScoutMinutes: ${totalUserMinutes}`);
    console.log(`  Sum of globalScoutMinutes: ${totalGlobalMinutes}`);
    console.log(
      `  Expected total (should be 60): ${((60 * totalUserMinutes) / totalGlobalMinutes).toFixed(2)}`,
    );
  }

  // Now let's look at the scout_history for the 16:00-17:00 window
  const hourStart = new Date("2026-01-20T16:00:00Z");
  const hourEnd = new Date("2026-01-20T17:00:00Z");

  console.log("\n=== Scout History for 16:00-17:00 Window ===");
  const history = await db
    .select()
    .from(scoutHistory)
    .where(gte(scoutHistory.startedAt, hourStart));

  console.log("History records started after 16:00:");
  history.forEach((h) => {
    console.log(
      `  User: ${h.userId} | Player: ${h.playerId} | Count: ${h.scoutCount} | Started: ${h.startedAt} | Ended: ${h.endedAt || "OPEN"}`,
    );
  });

  // Group by player
  console.log("\n=== By Player (16:00-17:00 window) ===");
  const playerHistory: Record<string, { userId: string; count: number; minutes: number }[]> = {};
  for (const h of history) {
    if (!playerHistory[h.playerId]) playerHistory[h.playerId] = [];

    // Calculate overlap with 16:00-17:00 window
    const startTime = new Date(h.startedAt);
    const endTime = h.endedAt ? new Date(h.endedAt) : hourEnd;
    const effectiveStart = startTime > hourStart ? startTime : hourStart;
    const effectiveEnd = endTime < hourEnd ? endTime : hourEnd;

    if (effectiveEnd > effectiveStart) {
      const overlapMinutes = (effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60);
      playerHistory[h.playerId].push({
        userId: h.userId,
        count: h.scoutCount,
        minutes: overlapMinutes,
      });
    }
  }

  for (const [playerId, entries] of Object.entries(playerHistory)) {
    console.log(`\nPlayer ${playerId}:`);
    let totalScoutMinutes = 0;
    entries.forEach((e) => {
      const scoutMinutes = e.count * e.minutes;
      totalScoutMinutes += scoutMinutes;
      console.log(
        `  User ${e.userId}: ${e.count} scouts × ${e.minutes.toFixed(1)} min = ${scoutMinutes.toFixed(1)} scout-minutes`,
      );
    });
    console.log(`  TOTAL: ${totalScoutMinutes.toFixed(1)} scout-minutes`);
    console.log(`  Expected shares if you are the only one: 60 (or less if splitting)`);

    // Find dev-user-12345678
    const devUser = entries.find((e) => e.userId === "dev-user-12345678");
    if (devUser) {
      const devMinutes = devUser.count * devUser.minutes;
      console.log(
        `  \n  dev-user-12345678: ${devUser.count} scouts × ${devUser.minutes.toFixed(1)} min = ${devMinutes.toFixed(1)} scout-minutes`,
      );
      console.log(`  Your share: ${((devMinutes / totalScoutMinutes) * 60).toFixed(2)} expected`);
    }
  }
}

analyzeDistribution().catch(console.error);

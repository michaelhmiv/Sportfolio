/**
 * Scout Velocity Tracker Job
 *
 * Periodically calculates scout velocity for all players and broadcasts updates.
 * Velocity = (current scouts - scouts 1 hour ago) / 1 hour
 *
 * Players with velocity >= 10 scouts/hour are marked as "trending"
 */

import { db } from "../db";
import { scoutAssignments, scoutHistory } from "@shared/schema";
import { sql, eq, and, lt } from "drizzle-orm";
import { broadcast } from "../websocket";
import { info } from "../lib/log-utility";

const VELOCITY_THRESHOLD = 10; // Scouts per hour to be considered "trending"
const CALCULATION_INTERVAL_MS = 5 * 60 * 1000; // Calculate every 5 minutes

interface ScoutVelocityData {
  playerId: string;
  velocity: number;
  totalScouts: number;
  isTrending: boolean;
}

export async function calculateScoutVelocity(): Promise<ScoutVelocityData[]> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Get all players with active scouts
  const playersWithScouts = await db
    .select({
      playerId: scoutAssignments.playerId,
      totalScouts: sql<number>`SUM(${scoutAssignments.scoutCount})`,
    })
    .from(scoutAssignments)
    .groupBy(scoutAssignments.playerId);

  const results: ScoutVelocityData[] = [];
  const trendingPlayers: string[] = [];

  for (const player of playersWithScouts) {
    // Get scout count from 1 hour ago
    const previousScouts = await db
      .select({
        total: sql<number>`COALESCE(SUM(${scoutHistory.scoutCount}), 0)`,
      })
      .from(scoutHistory)
      .where(
        and(
          eq(scoutHistory.playerId, player.playerId),
          lt(scoutHistory.startedAt, oneHourAgo),
          sql`${scoutHistory.endedAt} IS NULL OR ${scoutHistory.endedAt} > ${oneHourAgo}`,
        ),
      );

    const previousTotal = Number(previousScouts[0]?.total || 0);
    const currentTotal = Number(player.totalScouts || 0);
    const velocity = currentTotal - previousTotal;
    const isTrending = velocity >= VELOCITY_THRESHOLD;

    const data: ScoutVelocityData = {
      playerId: player.playerId,
      velocity,
      totalScouts: currentTotal,
      isTrending,
    };

    results.push(data);

    if (isTrending) {
      trendingPlayers.push(player.playerId);
    }

    // Broadcast individual player velocity update
    broadcast({
      type: "scout_velocity_update",
      playerId: player.playerId,
      velocity,
      totalScouts: currentTotal,
      isTrending,
    });
  }

  // Broadcast trending players list
  broadcast({
    type: "trending_players_update",
    playerIds: trendingPlayers,
    count: trendingPlayers.length,
    timestamp: new Date().toISOString(),
  });

  info(
    `[scout_velocity] Calculated velocity for ${results.length} players, ${trendingPlayers.length} trending`,
  );

  return results;
}

// Job runner for scheduler
export async function runScoutVelocityJob(): Promise<{
  recordsProcessed: number;
  errorCount: number;
}> {
  try {
    const results = await calculateScoutVelocity();
    return {
      recordsProcessed: results.length,
      errorCount: 0,
    };
  } catch (error: any) {
    console.error("[scout_velocity] Job failed:", error.message);
    return {
      recordsProcessed: 0,
      errorCount: 1,
    };
  }
}

// Start periodic calculation (if not using scheduler)
export function startScoutVelocityTracking(): void {
  info("[scout_velocity] Starting scout velocity tracking");

  // Initial calculation
  calculateScoutVelocity();

  // Set up interval
  setInterval(() => {
    calculateScoutVelocity();
  }, CALCULATION_INTERVAL_MS);
}

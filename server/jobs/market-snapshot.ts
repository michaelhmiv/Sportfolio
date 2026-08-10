/**
 * Market Snapshot Job
 *
 * Takes daily snapshots of platform-wide market metrics for analytics charts.
 * Event metrics are scoped to the completed Eastern Time business day while
 * snapshotDate remains a stable UTC-midnight date key for existing consumers.
 */

import { db } from "../db";
import { trades, vestingClaims, dailyBoosts, marketSnapshots } from "@shared/schema";
import { sql, gte, lt, and, inArray } from "drizzle-orm";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";
import { getETDayBoundaries, getGameDay, getTodayET } from "../lib/time";
import { getCanonicalMarketTotals } from "../valuation/canonical-valuation";

interface DailyMetrics {
  date: Date;
  marketCap: number;
  transactionsCount: number;
  volume: number;
  sharesVested: number;
  sharesBurned: number;
  totalShares: number;
}

function snapshotKeyForDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function getPreviousETBusinessDay(): string {
  const { startOfDay } = getETDayBoundaries(getTodayET());
  return getGameDay(new Date(startOfDay.getTime() - 1));
}

/** Calculate event metrics for a completed ET business day plus close-state canonical totals. */
async function calculateMetricsForDate(targetDate: string): Promise<DailyMetrics> {
  const { startOfDay, endOfDay } = getETDayBoundaries(targetDate);

  const [tradeStats, vestedStats, burnedBoostStats, canonicalTotals] = await Promise.all([
    db
      .select({
        count: sql<string>`COUNT(*)`,
        volume: sql<string>`COALESCE(SUM(${trades.price}::numeric * ${trades.quantity}::numeric), 0)`,
      })
      .from(trades)
      .where(and(gte(trades.executedAt, startOfDay), lt(trades.executedAt, endOfDay))),
    db
      .select({
        total: sql<string>`COALESCE(SUM(${vestingClaims.sharesClaimed}), 0)`,
      })
      .from(vestingClaims)
      .where(and(gte(vestingClaims.claimedAt, startOfDay), lt(vestingClaims.claimedAt, endOfDay))),
    db
      .select({
        total: sql<string>`COALESCE(SUM(${dailyBoosts.sharesEntered}), 0)`,
      })
      .from(dailyBoosts)
      .where(
        and(
          inArray(dailyBoosts.status, ["locked", "processed"]),
          gte(dailyBoosts.boostDate, startOfDay),
          lt(dailyBoosts.boostDate, endOfDay),
        ),
      ),
    getCanonicalMarketTotals(),
  ]);

  return {
    date: snapshotKeyForDate(targetDate),
    marketCap: canonicalTotals.marketCap,
    transactionsCount: parseInt(tradeStats[0]?.count || "0", 10),
    volume: parseFloat(tradeStats[0]?.volume || "0"),
    sharesVested: Math.floor(parseFloat(vestedStats[0]?.total || "0")),
    sharesBurned: Math.floor(parseFloat(burnedBoostStats[0]?.total || "0")),
    totalShares: Math.round(canonicalTotals.totalLiquidShares),
  };
}

/** Take or refresh the close snapshot for the just-completed ET business day. */
export async function takeMarketSnapshot(progressCallback?: ProgressCallback): Promise<JobResult> {
  const targetDate = getPreviousETBusinessDay();
  console.log(`[market_snapshot] Starting close snapshot for ${targetDate} ET...`);

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: `Starting market close snapshot for ${targetDate} ET`,
  });

  try {
    const metrics = await calculateMetricsForDate(targetDate);

    await db
      .insert(marketSnapshots)
      .values({
        snapshotDate: metrics.date,
        marketCap: metrics.marketCap.toFixed(2),
        transactionsCount: metrics.transactionsCount,
        volume: metrics.volume.toFixed(2),
        sharesVested: metrics.sharesVested,
        sharesBurned: metrics.sharesBurned,
        totalShares: metrics.totalShares,
      })
      .onConflictDoUpdate({
        target: marketSnapshots.snapshotDate,
        set: {
          marketCap: metrics.marketCap.toFixed(2),
          transactionsCount: metrics.transactionsCount,
          volume: metrics.volume.toFixed(2),
          sharesVested: metrics.sharesVested,
          sharesBurned: metrics.sharesBurned,
          totalShares: metrics.totalShares,
        },
      });

    console.log(
      `[market_snapshot] Saved ${targetDate}: cap=$${metrics.marketCap.toFixed(2)}, tx=${metrics.transactionsCount}, volume=$${metrics.volume.toFixed(2)}, vested=${metrics.sharesVested}, burned=${metrics.sharesBurned}, liquid=${metrics.totalShares}`,
    );

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `Market close snapshot saved for ${targetDate} ET`,
      data: metrics,
    });

    return { requestCount: 0, recordsProcessed: 1, errorCount: 0 };
  } catch (error: any) {
    console.error("[market_snapshot] Error:", error);
    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Market snapshot error: ${error.message}`,
    });
    return { requestCount: 0, recordsProcessed: 0, errorCount: 1 };
  }
}

/**
 * Historical event metrics can be reconstructed, but historical canonical AMM
 * market cap and liquid supply cannot be derived safely from today's reserves.
 * Refuse the legacy backfill rather than writing fabricated point-in-time state.
 */
export async function backfillMarketSnapshots(
  progressCallback?: ProgressCallback,
): Promise<JobResult> {
  const message =
    "Historical market snapshot backfill is disabled because point-in-time AMM reserves are not available. Existing historical rows are preserved.";
  console.warn(`[market_snapshot] ${message}`);
  progressCallback?.({
    type: "error",
    timestamp: new Date().toISOString(),
    message,
  });
  return { requestCount: 0, recordsProcessed: 0, errorCount: 1 };
}

export function getMarketSnapshotDateForInstant(instant: Date): string {
  return getGameDay(instant);
}

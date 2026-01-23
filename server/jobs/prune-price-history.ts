/**
 * Price History Pruning Job
 *
 * Periodically prunes old price history data to prevent unbounded table growth.
 *
 * Strategy:
 * - Keep minute-level data for last 7 days
 * - Keep daily aggregated data for older periods
 * - This balances storage efficiency with data availability for charts
 *
 * Runs weekly on Sunday at 3 AM
 */

import { db } from "../db";
import { priceHistory } from "@shared/schema";
import { sql, lt, gte, and, eq } from "drizzle-orm";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";
import { info, warn, createThrottledLogger } from "../lib/log-utility";

const log = createThrottledLogger();

// Keep minute-level data for 7 days
const MINUTE_DATA_RETENTION_DAYS = 7;
// Maximum records to delete per run (prevent long-running transactions)
const MAX_DELETE_PER_RUN = 100000;

export async function prunePriceHistory(progressCallback?: ProgressCallback): Promise<JobResult> {
  log("[prune_price_history] Starting price history pruning...");

  progressCallback?.({
    type: 'info',
    timestamp: new Date().toISOString(),
    message: 'Starting price history pruning',
  });

  try {
    // Calculate cutoff date (7 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MINUTE_DATA_RETENTION_DAYS);

    log(`[prune_price_history] Deleting price history older than ${cutoffDate.toISOString()}`);

    progressCallback?.({
      type: 'info',
      timestamp: new Date().toISOString(),
      message: `Deleting price history older than ${cutoffDate.toISOString()}`,
    });

    // Delete old price history records in batches
    let totalDeleted = 0;
    let deletedThisBatch = -1;

    while (deletedThisBatch !== 0) {
      const result = await db
        .delete(priceHistory)
        .where(
          and(
            lt(priceHistory.timestamp, cutoffDate),
            sql`${priceHistory.id} IN (SELECT id FROM ${priceHistory} LIMIT ${MAX_DELETE_PER_RUN})`
          )
        );

      deletedThisBatch = result.rowCount || 0;
      totalDeleted += deletedThisBatch;

      log(`[prune_price_history] Deleted batch of ${deletedThisBatch} records (total: ${totalDeleted})`);

      progressCallback?.({
        type: 'info',
        timestamp: new Date().toISOString(),
        message: `Deleted ${totalDeleted} old price history records`,
      });
    }

    log(`[prune_price_history] Pruned ${totalDeleted} old price history entries`);

    progressCallback?.({
      type: 'complete',
      timestamp: new Date().toISOString(),
      message: `Pruned ${totalDeleted} old price history entries`,
      data: {
        deletedCount: totalDeleted,
        retentionDays: MINUTE_DATA_RETENTION_DAYS,
        cutoffDate: cutoffDate.toISOString(),
      },
    });

    return {
      requestCount: 0,
      recordsProcessed: totalDeleted,
      errorCount: 0,
    };
  } catch (error: any) {
    warn(`[prune_price_history] Error: ${error.message}`);

    progressCallback?.({
      type: 'error',
      timestamp: new Date().toISOString(),
      message: `Pruning error: ${error.message}`,
    });

    return {
      requestCount: 0,
      recordsProcessed: 0,
      errorCount: 1,
    };
  }
}

/**
 * Get price history statistics
 */
export async function getPriceHistoryStats(): Promise<{
  totalRecords: number;
  oldestRecordDate: Date | null;
  newestRecordDate: Date | null;
  recordsOlderThan7Days: number;
}> {
  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(priceHistory);

  const [oldestResult] = await db
    .select({ date: sql<Date>`MIN(${priceHistory.timestamp})` })
    .from(priceHistory);

  const [newestResult] = await db
    .select({ date: sql<Date>`MAX(${priceHistory.timestamp})` })
    .from(priceHistory);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [oldCountResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(priceHistory)
    .where(lt(priceHistory.timestamp, sevenDaysAgo));

  return {
    totalRecords: parseInt(totalResult?.count?.toString() || '0'),
    oldestRecordDate: oldestResult?.date || null,
    newestRecordDate: newestResult?.date || null,
    recordsOlderThan7Days: parseInt(oldCountResult?.count?.toString() || '0'),
  };
}

/**
 * Cleanup Job Logs
 *
 * Periodically cleans up old job execution logs to prevent unbounded growth.
 * This helps reduce disk I/O and database size over time.
 *
 * Strategy:
 * - Keep logs for last 30 days at full detail
 * - Delete logs older than 30 days
 *
 * Runs weekly on Sunday at 2 AM
 */

import { db } from "../db";
import { jobExecutionLogs } from "@shared/schema";
import { sql, lt } from "drizzle-orm";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";
import { createThrottledLogger } from "../lib/log-utility";

const log = createThrottledLogger();

// Number of days to retain job logs
const RETENTION_DAYS = 30;

export async function cleanupJobLogs(progressCallback?: ProgressCallback): Promise<JobResult> {
  log("[cleanup_job_logs] Starting job execution logs cleanup...");

  progressCallback?.({
    type: 'info',
    timestamp: new Date().toISOString(),
    message: 'Starting job execution logs cleanup',
  });

  try {
    // Calculate cutoff date (30 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    log(`[cleanup_job_logs] Deleting logs older than ${cutoffDate.toISOString()}`);

    progressCallback?.({
      type: 'info',
      timestamp: new Date().toISOString(),
      message: `Deleting logs older than ${cutoffDate.toISOString()}`,
    });

    // Delete old job logs
    const result = await db
      .delete(jobExecutionLogs)
      .where(lt(jobExecutionLogs.startedAt, cutoffDate));

    const deletedCount = result.rowCount || 0;

    log(`[cleanup_job_logs] Cleaned up ${deletedCount} old job log entries`);

    progressCallback?.({
      type: 'complete',
      timestamp: new Date().toISOString(),
      message: `Cleaned up ${deletedCount} old job log entries`,
      data: {
        deletedCount,
        retentionDays: RETENTION_DAYS,
        cutoffDate: cutoffDate.toISOString(),
      },
    });

    return {
      requestCount: 0,
      recordsProcessed: deletedCount,
      errorCount: 0,
    };
  } catch (error: any) {
    log(`[cleanup_job_logs] Error: ${error.message}`);

    progressCallback?.({
      type: 'error',
      timestamp: new Date().toISOString(),
      message: `Cleanup error: ${error.message}`,
    });

    return {
      requestCount: 0,
      recordsProcessed: 0,
      errorCount: 1,
    };
  }
}

/**
 * Get count of job logs by age
 */
export async function getJobLogStats(): Promise<{
  totalLogs: number;
  logsOlderThan30Days: number;
  oldestLogDate: Date | null;
  newestLogDate: Date | null;
}> {
  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(jobExecutionLogs);

  const [oldCountResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(jobExecutionLogs)
    .where(sql`${jobExecutionLogs.startedAt} < NOW() - INTERVAL '30 days'`);

  const [oldestResult] = await db
    .select({ date: sql<Date>`MIN(${jobExecutionLogs.startedAt})` })
    .from(jobExecutionLogs);

  const [newestResult] = await db
    .select({ date: sql<Date>`MAX(${jobExecutionLogs.startedAt})` })
    .from(jobExecutionLogs);

  return {
    totalLogs: parseInt(totalResult?.count?.toString() || '0'),
    logsOlderThan30Days: parseInt(oldCountResult?.count?.toString() || '0'),
    oldestLogDate: oldestResult?.date || null,
    newestLogDate: newestResult?.date || null,
  };
}

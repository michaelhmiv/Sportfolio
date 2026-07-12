/**
 * Refresh Player Market Metrics Job
 *
 * Precomputes sortable player metrics used by large player-list endpoints:
 * - avg fantasy points (current competitive seasons)
 * - sentiment (24h buy pressure / order volume)
 * - value index
 * - best bid / best ask / top-of-book sizes
 */

import { storage } from "../storage";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

export async function refreshPlayerMarketMetricsJob(
  progressCallback?: ProgressCallback,
): Promise<JobResult> {
  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Refreshing player market metrics...",
  });

  const refreshed = await storage.refreshPlayerMarketMetrics();

  progressCallback?.({
    type: "complete",
    timestamp: new Date().toISOString(),
    message: `Refreshed ${refreshed} player market metric rows`,
    data: { refreshed },
  });

  return {
    requestCount: 0,
    recordsProcessed: refreshed,
    errorCount: 0,
  };
}

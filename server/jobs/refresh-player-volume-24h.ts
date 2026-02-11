/**
 * Refresh Player 24h Volume Job
 *
 * Keeps players.volume_24h accurate as a rolling 24h metric (shares traded).
 * This is used for marketplace sorting and display.
 */

import { storage } from "../storage";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

export async function refreshPlayerVolume24hJob(
  progressCallback?: ProgressCallback,
): Promise<JobResult> {
  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Refreshing player 24h volume from trades...",
  });

  const updated = await storage.refreshPlayerVolume24h();

  progressCallback?.({
    type: "complete",
    timestamp: new Date().toISOString(),
    message: "Updated " + updated + " player volume rows",
    data: { updated },
  });

  return {
    requestCount: 0,
    recordsProcessed: updated,
    errorCount: 0,
  };
}

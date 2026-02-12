import { storage } from "../storage";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

const SHARE_PAYOUT_BASE_RATE = "1.0000";
const SNAPSHOT_LOOKBACK_HOURS = 36;

export async function snapshotSharePayouts(
  progressCallback?: ProgressCallback,
): Promise<JobResult> {
  let gamesChecked = 0;
  let snapshotsCreated = 0;
  let errorCount = 0;

  try {
    const now = new Date();
    const start = new Date(now.getTime() - SNAPSHOT_LOOKBACK_HOURS * 60 * 60 * 1000);
    const candidateGames = await storage.getDailyGames(start, now);

    const gamesToSnapshot = candidateGames.filter((game) => {
      const status = (game.status || "").toLowerCase();
      if (status === "postponed" || status === "cancelled") return false;
      return new Date(game.startTime).getTime() <= now.getTime();
    });

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Share snapshot job checking ${gamesToSnapshot.length} started games`,
    });

    for (const game of gamesToSnapshot) {
      try {
        gamesChecked++;
        const created = await storage.createSharePayoutSnapshotsForGame(
          game,
          SHARE_PAYOUT_BASE_RATE,
        );
        snapshotsCreated += created;
      } catch (err: any) {
        errorCount++;
        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Share snapshot failed for game ${game.gameId}: ${err?.message || err}`,
        });
      }
    }

    return {
      requestCount: gamesChecked,
      recordsProcessed: snapshotsCreated,
      errorCount,
    };
  } catch (err: any) {
    return {
      requestCount: gamesChecked,
      recordsProcessed: snapshotsCreated,
      errorCount: errorCount + 1,
    };
  }
}

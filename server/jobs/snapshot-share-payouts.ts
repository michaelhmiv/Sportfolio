import { ensureGameShareSnapshots } from "../economy/repository";
import { resolveEconomySeasonPhase } from "../economy/config";
import { storage } from "../storage";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

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

    const gamesToSnapshot = [] as typeof candidateGames;
    for (const game of candidateGames) {
      if (resolveEconomySeasonPhase({ seasonType: game.seasonType }) === "preseason") continue;
      const status = (game.status || "").toLowerCase();
      if (["postponed", "cancelled", "canceled"].includes(status)) continue;

      const startTimeMs = new Date(game.startTime).getTime();
      if (!Number.isFinite(startTimeMs)) {
        errorCount++;
        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Share snapshot skipped game ${game.gameId}: invalid startTime`,
        });
        continue;
      }
      if (startTimeMs <= now.getTime()) gamesToSnapshot.push(game);
    }

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Economy V2 snapshot checking ${gamesToSnapshot.length} started games`,
    });

    for (const game of gamesToSnapshot) {
      try {
        gamesChecked++;
        const created = await ensureGameShareSnapshots(game);
        snapshotsCreated += created.userSnapshots;
      } catch (err: any) {
        errorCount++;
        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Share snapshot failed for game ${game.gameId}: ${err?.message || err}`,
        });
      }
    }

    return { requestCount: gamesChecked, recordsProcessed: snapshotsCreated, errorCount };
  } catch {
    return {
      requestCount: gamesChecked,
      recordsProcessed: snapshotsCreated,
      errorCount: errorCount + 1,
    };
  }
}

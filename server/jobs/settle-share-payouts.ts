import { settleBaseEarningsForGame } from "../economy/repository";
import { storage } from "../storage";
import { broadcast } from "../websocket";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

export async function settleSharePayouts(progressCallback?: ProgressCallback): Promise<JobResult> {
  let processed = 0;
  let requestCount = 0;
  let errorCount = 0;

  try {
    const pending = await storage.getPendingSharePayouts(5000);
    requestCount++;
    const gameIds = [...new Set(pending.map((payout) => payout.gameId))];

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Economy V2 base settlement checking ${pending.length} user snapshots across ${gameIds.length} games`,
    });

    for (const gameId of gameIds) {
      try {
        const game = await storage.getDailyGameByGameId(gameId);
        requestCount++;
        if (!game) continue;
        const status = (game.status || "").toLowerCase();
        if (status !== "completed" && status !== "ended") continue;

        const result = await settleBaseEarningsForGame(game);
        requestCount++;
        processed += result.userPayouts;

        if (result.userPayouts > 0) {
          broadcast({
            type: "portfolio",
            reason: "base_player_earnings",
            gameId,
            payoutCount: result.userPayouts,
            sbIssued: result.sbIssued.toFixed(2),
          });
          progressCallback?.({
            type: "info",
            timestamp: new Date().toISOString(),
            message: `Settled ${result.userPayouts} capped base payouts for ${gameId} (${result.sbIssued.toFixed(2)} SB issued)`,
          });
        }
      } catch (err: any) {
        errorCount++;
        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Economy V2 base settlement failed for game ${gameId}: ${err?.message || err}`,
        });
      }
    }

    return { requestCount, recordsProcessed: processed, errorCount };
  } catch {
    return { requestCount, recordsProcessed: processed, errorCount: errorCount + 1 };
  }
}

import { storage } from "../storage";
import { broadcastToUser } from "../websocket";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSettlableNascarStats(
  sport: unknown,
  stats: { statsJson?: unknown } | null | undefined,
): boolean {
  if (String(sport || "").toUpperCase() !== "NASCAR") return true;

  const statsJson = stats?.statsJson;
  if (!statsJson || typeof statsJson !== "object") return true;

  const runType = Number(
    (statsJson as Record<string, unknown>).runType ??
      (statsJson as Record<string, unknown>).run_type,
  );
  if (Number.isFinite(runType)) {
    return runType === 3;
  }

  const runName = String(
    (statsJson as Record<string, unknown>).runName ??
      (statsJson as Record<string, unknown>).run_name ??
      "",
  ).toLowerCase();
  if (!runName) return true;

  return !runName.includes("qualifying") && !runName.includes("practice");
}

export async function settleSharePayouts(progressCallback?: ProgressCallback): Promise<JobResult> {
  let processed = 0;
  let requestCount = 0;
  let errorCount = 0;

  try {
    const pending = await storage.getPendingSharePayouts(5000);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Share payout settlement checking ${pending.length} pending rows`,
    });

    for (const payout of pending) {
      requestCount++;

      try {
        const game = await storage.getDailyGameByGameId(payout.gameId);
        if (!game) continue;

        const gameStatus = (game.status || "").toLowerCase();
        if (gameStatus !== "completed" && gameStatus !== "ended") continue;

        const stats = await storage.getPlayerGameStats(payout.playerId, payout.gameId);
        if (!stats) continue;
        if (!isSettlableNascarStats(game.sport, stats)) continue;

        const fantasyPoints = toFiniteNumber(stats.fantasyPoints, 0);
        const earningUnits = toFiniteNumber(payout.earningUnits, 0);
        const baseRate = toFiniteNumber(payout.baseRate, 1);
        const amount = Math.max(0, earningUnits * fantasyPoints * baseRate);

        const credited = await storage.processSharePayoutCredit(
          payout.id,
          payout.userId,
          fantasyPoints.toFixed(2),
          amount.toFixed(2),
        );

        if (!credited) continue;

        processed++;

        broadcastToUser(payout.userId, {
          type: "portfolio",
          reason: "share_payout",
          gameId: payout.gameId,
          playerId: payout.playerId,
          amount: amount.toFixed(2),
        });
      } catch (err: any) {
        errorCount++;
        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Share payout settlement failed for row ${payout.id}: ${err?.message || err}`,
        });
      }
    }

    return {
      requestCount,
      recordsProcessed: processed,
      errorCount,
    };
  } catch (err: any) {
    return {
      requestCount,
      recordsProcessed: processed,
      errorCount: errorCount + 1,
    };
  }
}

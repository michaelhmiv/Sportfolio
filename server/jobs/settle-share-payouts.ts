import { storage } from "../storage";
import { broadcastToUser } from "../websocket";
import { sendUserNotification } from "../services/notification-dispatcher";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";
import { isNflPreseasonGame } from "../nfl/season";
import { getSharePayoutStats, loadSharePayoutSettlementContext } from "./share-payout-read-model";

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
    requestCount += 1;

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Share payout settlement checking ${pending.length} pending rows`,
    });

    if (pending.length === 0) {
      return { requestCount, recordsProcessed: 0, errorCount: 0 };
    }

    const settlementContext = await loadSharePayoutSettlementContext(pending);
    requestCount += settlementContext.readCount;

    for (const payout of pending) {
      try {
        const game = settlementContext.gamesById.get(payout.gameId);
        if (!game) continue;
        if (isNflPreseasonGame(game)) continue;

        const gameStatus = (game.status || "").toLowerCase();
        if (gameStatus !== "completed" && gameStatus !== "ended") continue;

        const stats = getSharePayoutStats(settlementContext, payout.playerId, payout.gameId);
        if (!stats) continue;
        if (!isSettlableNascarStats(game.sport, stats)) continue;

        const fantasyPoints = toFiniteNumber(stats.fantasyPoints, 0);
        const earningUnits = toFiniteNumber(payout.earningUnits, 0);
        const baseRate = toFiniteNumber(payout.baseRate, 1);
        const amount = Math.max(0, earningUnits * fantasyPoints * baseRate);

        requestCount += 1;
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

        void sendUserNotification({
          userId: payout.userId,
          category: "portfolio_changes",
          title: "Share Payout Credited",
          body: `You received $${amount.toFixed(2)} from a completed game.`,
          deepLink: "/portfolio",
          data: {
            gameId: payout.gameId,
            playerId: payout.playerId,
            payoutId: payout.id,
            amount: amount.toFixed(2),
          },
          dedupeKey: `share_payout:${payout.id}`,
        }).catch((error) => {
          console.error("[settle_share_payouts] Failed to send push:", error);
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
  } catch (_err: any) {
    return {
      requestCount,
      recordsProcessed: processed,
      errorCount: errorCount + 1,
    };
  }
}

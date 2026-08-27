import { resolveEconomySeasonPhase } from "../economy/config";
import { settleBaseEarningsForGame } from "../economy/repository";
import { storage } from "../storage";
import { broadcast } from "../websocket";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

function serializeSettlementError(error: unknown) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const databaseError = error as Error & {
    code?: string;
    detail?: string;
    constraint?: string;
    table?: string;
    column?: string;
  };

  return {
    name: databaseError.name,
    message: databaseError.message,
    code: databaseError.code,
    detail: databaseError.detail,
    constraint: databaseError.constraint,
    table: databaseError.table,
    column: databaseError.column,
    stack: databaseError.stack,
  };
}

function reportSettlementError(
  message: string,
  error: unknown,
  progressCallback?: ProgressCallback,
  context: Record<string, unknown> = {},
) {
  const serialized = serializeSettlementError(error);
  const detail = serialized.message || String(error);

  // Scheduled jobs do not receive an admin progress callback, so this log is the
  // authoritative production error path. Keep it structured for Railway/Sentry searchability.
  console.error(
    JSON.stringify({
      level: "error",
      job: "settle_share_payouts",
      message,
      ...context,
      error: serialized,
    }),
  );

  progressCallback?.({
    type: "error",
    timestamp: new Date().toISOString(),
    message: `${message}: ${detail}`,
  });
}

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
      message: `Base payout settlement checking ${pending.length} user snapshots across ${gameIds.length} games`,
    });

    for (const gameId of gameIds) {
      let game: Awaited<ReturnType<typeof storage.getDailyGameByGameId>> | undefined;
      try {
        game = await storage.getDailyGameByGameId(gameId);
        requestCount++;
        if (!game) continue;
        if (resolveEconomySeasonPhase({ seasonType: game.seasonType }) === "preseason") continue;
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
            message: `Settled ${result.userPayouts} base payouts for ${gameId} (${result.sbIssued.toFixed(2)} SB issued)`,
          });
        }
      } catch (error: unknown) {
        errorCount++;
        reportSettlementError("Base payout settlement failed for game", error, progressCallback, {
          gameId,
          sport: game?.sport,
          status: game?.status,
          seasonType: game?.seasonType,
        });
      }
    }

    return { requestCount, recordsProcessed: processed, errorCount };
  } catch (error: unknown) {
    reportSettlementError(
      "Base payout settlement failed before game processing",
      error,
      progressCallback,
    );
    return { requestCount, recordsProcessed: processed, errorCount: errorCount + 1 };
  }
}

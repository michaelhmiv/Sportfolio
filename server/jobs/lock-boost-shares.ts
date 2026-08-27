import { hasGameStartedForBoost } from "@shared/game-status";
import { resolveEconomySeasonPhase } from "../economy/config";
import { lockDirectShareBoost } from "../economy/repository";
import { storage } from "../storage";
import { notifyBoostLockingSoonPush } from "../services/push-notification-events";
import { sendUserNotification } from "../services/notification-dispatcher";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

function logBoostLockError(message: string, error: unknown, context: Record<string, unknown> = {}) {
  const resolvedError = error instanceof Error ? error : new Error(String(error));
  const databaseError = resolvedError as Error & {
    code?: string;
    detail?: string;
    constraint?: string;
    table?: string;
    column?: string;
  };

  console.error(
    JSON.stringify({
      level: "error",
      job: "lock_boost_shares",
      message,
      ...context,
      error: {
        name: databaseError.name,
        message: databaseError.message,
        code: databaseError.code,
        detail: databaseError.detail,
        constraint: databaseError.constraint,
        table: databaseError.table,
        column: databaseError.column,
        stack: databaseError.stack,
      },
    }),
  );
}

export async function lockBoostShares(progressCallback?: ProgressCallback): Promise<JobResult> {
  const lockingSoonWindowMinutes = Math.max(
    5,
    Number.parseInt(process.env.BOOST_LOCKING_SOON_WINDOW_MINUTES || "25", 10) || 25,
  );
  let boostsLocked = 0;
  let errorCount = 0;

  try {
    const activeBoosts = await storage.getDailyBoostsByStatus("active");
    const now = new Date();

    for (const boost of activeBoosts) {
      try {
        let game = boost.gameId ? await storage.getDailyGameByGameId(boost.gameId) : undefined;
        if (!game) {
          game = await storage.getPlayerGameForDate(
            boost.playerId,
            boost.sport,
            new Date(boost.boostDate),
          );
          if (game && boost.gameId !== game.gameId) {
            await storage.updateDailyBoost(boost.id, { gameId: game.gameId });
          }
        }
        if (!game) continue;

        const gameStatus = String(game.status || "").toLowerCase();
        if (["cancelled", "canceled"].includes(gameStatus)) {
          await storage.deleteDailyBoost(boost.id);
          continue;
        }
        if (gameStatus === "postponed") continue;
        if (resolveEconomySeasonPhase({ seasonType: game.seasonType }) === "preseason") {
          await storage.deleteDailyBoost(boost.id);
          continue;
        }

        const gameStart = new Date(game.startTime);
        const msUntilStart = gameStart.getTime() - now.getTime();
        if (msUntilStart > 0 && msUntilStart <= lockingSoonWindowMinutes * 60_000) {
          const player = await storage.getPlayer(boost.playerId);
          await notifyBoostLockingSoonPush({
            userId: boost.userId,
            boostId: boost.id,
            playerName: `${player?.firstName ?? ""} ${player?.lastName ?? ""}`.trim() || "Player",
            minutesUntilLock: msUntilStart / 60_000,
          });
        }

        if (!hasGameStartedForBoost(game, new Date(now.getTime() + 60_000))) continue;

        // lockDirectShareBoost first commits the immutable pre-burn earnings snapshot, then burns
        // exactly the reserved Singles in a separate atomic transaction.
        const locked = await lockDirectShareBoost(boost.id, game);
        if (!locked.locked) continue;
        boostsLocked++;

        void sendUserNotification({
          userId: boost.userId,
          category: "boost_lifecycle",
          title: "Boost Locked",
          body: `${locked.sharesBurned.toFixed(4)} shares were permanently burned as your ${boost.slotTier}x Boost began.`,
          deepLink: "/boosts",
          data: {
            boostId: boost.id,
            playerId: boost.playerId,
            gameId: game.gameId,
            sharesBurned: locked.sharesBurned.toFixed(4),
          },
          dedupeKey: `boost_locked:${boost.id}`,
        }).catch((error) => {
          console.error("[lock_boost_shares] Failed to send lock push:", error);
        });

        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Locked ${boost.slotTier}x Boost ${boost.id}; burned ${locked.sharesBurned.toFixed(4)} Singles`,
        });
      } catch (error: unknown) {
        errorCount++;
        const detail = error instanceof Error ? error.message : String(error);
        logBoostLockError("Boost share lock failed", error, {
          boostId: boost.id,
          userId: boost.userId,
          playerId: boost.playerId,
          gameId: boost.gameId,
          sport: boost.sport,
          slotTier: boost.slotTier,
        });
        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Error locking boost ${boost.id}: ${detail}`,
        });
      }
    }

    return { requestCount: activeBoosts.length, recordsProcessed: boostsLocked, errorCount };
  } catch (error: unknown) {
    logBoostLockError("Boost share lock job failed before item processing", error);
    return { requestCount: 0, recordsProcessed: boostsLocked, errorCount: errorCount + 1 };
  }
}

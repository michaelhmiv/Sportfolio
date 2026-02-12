/**
 * Boost Settlement Job
 *
 * Runs after games complete to settle boosts and pay out earnings.
 * For each locked boost where the game is completed:
 * - Calculates payout: shares × fantasy points × multiplier
 * - Credits user balance
 * - Logs to boost_payouts ledger
 * - Marks boost as processed (shares were already burned when game started)
 */

import { storage } from "../storage";
import { broadcast } from "../websocket";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

export async function settleBoosts(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[settle_boosts] Starting boost settlement...");

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting boost settlement job",
  });

  let boostsSettled = 0;
  let totalPayout = 0;
  let errorCount = 0;

  try {
    // Get all locked boosts ready for settlement
    const lockedBoosts = await storage.getDailyBoostsByStatus("locked");
    const communityCountCache = new Map<string, number>();

    console.log(`[settle_boosts] Found ${lockedBoosts.length} locked boosts to check`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Checking ${lockedBoosts.length} locked boosts for completed games`,
    });

    for (const boost of lockedBoosts) {
      try {
        const now = Date.now();
        let game = boost.gameId ? await storage.getDailyGameByGameId(boost.gameId) : undefined;

        const isLikelyLegacyNbaGameId =
          boost.sport?.toUpperCase?.() === "NBA" &&
          typeof boost.gameId === "string" &&
          boost.gameId.startsWith("18447");

        // Self-heal: resolve canonical gameId (BallDontLie) for legacy/missing refs.
        // This prevents settlement from being blocked by legacy MySportsFeeds gameIds that don't match stats.
        if (!game || isLikelyLegacyNbaGameId) {
          const resolved = await storage.getPlayerGameForDate(
            boost.playerId,
            boost.sport,
            new Date(boost.boostDate),
          );

          if (resolved) {
            if (boost.gameId !== resolved.gameId) {
              console.warn(
                `[settle_boosts] Boost ${boost.id}: repairing gameId ${boost.gameId || "(null)"} -> ${resolved.gameId}`,
              );
              await storage.updateDailyBoost(boost.id, { gameId: resolved.gameId });
            }
            game = resolved;
          }
        }

        if (!game) {
          console.warn(
            `[settle_boosts] Boost ${boost.id}: no game found (gameId=${boost.gameId || "(null)"}), skipping`,
          );
          continue;
        }

        // Only settle if game is completed (or very likely completed based on elapsed time)
        const gameStatus = (game.status || "").toLowerCase();
        const isCompletedStatus = gameStatus === "completed" || gameStatus === "ended";
        const isBlockedStatus =
          gameStatus === "postponed" || gameStatus === "cancelled" || gameStatus === "canceled";

        const gameStartMs = new Date(game.startTime).getTime();
        const isTimeLikelyEnded = now - gameStartMs > 6 * 60 * 60 * 1000; // 6h buffer

        if (!isCompletedStatus && (isBlockedStatus || !isTimeLikelyEnded)) {
          continue;
        }

        const canonicalGameId = game.gameId;

        console.log(
          `[settle_boosts] Settling boost ${boost.id} - game ${canonicalGameId} ${isCompletedStatus ? "completed" : "likely ended"}`,
        );

        // Get player's fantasy points for this game
        const stats = await storage.getPlayerGameStats(boost.playerId, canonicalGameId);

        // BUG FIX #44: Skip settlement if stats are not yet available
        // This prevents race condition where boost is settled before sync-stats job stores player stats
        if (!stats) {
          console.warn(
            `[settle_boosts] Boost ${boost.id}: No stats found for player ${boost.playerId} game ${canonicalGameId}, deferring settlement`,
          );
          continue;
        }

        const fantasyPoints = parseFloat(stats.fantasyPoints);

        const dateKey = boost.boostDate
          ? new Date(boost.boostDate).toISOString().split("T")[0]
          : "unknown";
        const cacheKey = `${boost.sport}:${dateKey}:${boost.playerId}`;
        let communityBoostCount = communityCountCache.get(cacheKey);
        if (communityBoostCount === undefined) {
          const communityBoosts = await storage.getCommunityBoostsForDate(
            boost.sport,
            new Date(boost.boostDate),
          );
          communityBoostCount = communityBoosts.filter(
            (cb) => cb.playerId === boost.playerId,
          ).length;
          communityCountCache.set(cacheKey, communityBoostCount);
        }

        // Calculate payout: use powerLevel if available, otherwise fall back to sharesEntered
        // Power Level represents condensed shares' effective power
        const effectivePower = boost.powerLevel
          ? parseFloat(boost.powerLevel.toString())
          : boost.sharesEntered;
        const effectiveMultiplier = boost.slotTier + communityBoostCount;
        // Floor payout at 0 to prevent negative balances from poor player performance
        const rawPayout = effectivePower * fantasyPoints * effectiveMultiplier;
        const payout = Math.max(0, rawPayout);

        console.log(
          `[settle_boosts] Boost ${boost.id}: ${effectivePower} power × ${fantasyPoints} FP × ${effectiveMultiplier}x (${boost.slotTier}+${communityBoostCount}) = $${payout.toFixed(2)}`,
        );

        // Credit user balance
        const user = await storage.getUser(boost.userId);
        if (user) {
          const newBalance = parseFloat(user.balance) + payout;
          await storage.updateUserBalance(boost.userId, newBalance.toFixed(2));
        }

        // Log to boost_payouts ledger
        await storage.createBoostPayout({
          boostId: boost.id,
          userId: boost.userId,
          playerId: boost.playerId,
          sharesUsed: boost.sharesEntered,
          fantasyPoints: fantasyPoints.toFixed(2),
          multiplier: effectiveMultiplier,
          payoutAmount: payout.toFixed(2),
        });

        // Note: Shares were already burned when game started (in lock-boost-shares job)
        // No unlock needed - that's the risk/reward of Daily Boosts!

        // Update boost status to processed
        await storage.updateDailyBoost(boost.id, {
          status: "processed",
          fantasyPoints: fantasyPoints.toFixed(2),
          payout: payout.toFixed(2),
          processedAt: new Date(),
        });

        boostsSettled++;
        totalPayout += payout;

        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Settled boost ${boost.id}: $${payout.toFixed(2)} payout`,
          data: { boostId: boost.id, payout, fantasyPoints },
        });

        // Broadcast settlement to user
        broadcast({
          type: "boost_settled",
          userId: boost.userId,
          boostId: boost.id,
          payout: payout.toFixed(2),
          fantasyPoints,
          multiplier: effectiveMultiplier,
        });
      } catch (boostError: any) {
        console.error(`[settle_boosts] Error settling boost ${boost.id}:`, boostError.message);
        errorCount++;
        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Error settling boost ${boost.id}: ${boostError.message}`,
        });
      }
    }

    console.log(
      `[settle_boosts] Complete: ${boostsSettled} boosts settled, $${totalPayout.toFixed(2)} total payout, ${errorCount} errors`,
    );

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `Boost settlement complete: ${boostsSettled} settled, $${totalPayout.toFixed(2)} paid out`,
      data: { boostsSettled, totalPayout: totalPayout.toFixed(2), errorCount },
    });

    return {
      requestCount: 0,
      recordsProcessed: boostsSettled,
      errorCount,
    };
  } catch (error: any) {
    console.error("[settle_boosts] Fatal error:", error);

    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Fatal error: ${error.message}`,
    });

    return {
      requestCount: 0,
      recordsProcessed: boostsSettled,
      errorCount: errorCount + 1,
    };
  }
}

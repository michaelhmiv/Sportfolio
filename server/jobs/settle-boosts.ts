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
        // Check if game is completed
        if (!boost.gameId) {
          console.warn(`[settle_boosts] Boost ${boost.id} has no gameId, skipping`);
          continue;
        }

        const game = await storage.getDailyGameByGameId(boost.gameId);
        if (!game) {
          console.warn(`[settle_boosts] Game ${boost.gameId} not found for boost ${boost.id}`);
          continue;
        }

        // Only settle if game is completed
        if (game.status !== "completed") {
          continue;
        }

        console.log(`[settle_boosts] Settling boost ${boost.id} - game ${boost.gameId} completed`);

        // Get player's fantasy points for this game
        const stats = await storage.getPlayerGameStats(boost.playerId, boost.gameId);

        // BUG FIX #44: Skip settlement if stats are not yet available
        // This prevents race condition where boost is settled before sync-stats job stores player stats
        if (!stats) {
          console.warn(
            `[settle_boosts] Boost ${boost.id}: No stats found for player ${boost.playerId} game ${boost.gameId}, deferring settlement`,
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

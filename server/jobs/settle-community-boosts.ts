/**
 * Community Boost Settlement Job
 *
 * Runs after games complete to finalize community boosts.
 * For each active community boost where the game is completed:
 * - Marks community boost as processed
 * - Stores final fantasy points for audit/history
 * - Daily boost payout multiplier impact is handled in settle-boosts job
 */

import { storage } from "../storage";
import { broadcast } from "../websocket";
import { sendUserNotification } from "../services/notification-dispatcher";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

export async function settleCommunityBoosts(
  progressCallback?: ProgressCallback,
): Promise<JobResult> {
  console.log("[settle_community_boosts] Starting community boost settlement...");

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting community boost settlement job",
  });

  let boostsSettled = 0;
  let totalPayout = 0;
  let errorCount = 0;

  try {
    // Get all active community boosts (we don't strictly require a "locked" state like daily boosts
    // since the API prevents creation after game start)
    const activeBoosts = await storage.getCommunityBoostsByStatus("active");

    console.log(`[settle_community_boosts] Found ${activeBoosts.length} active boosts to check`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Checking ${activeBoosts.length} active community boosts for completed games`,
    });

    for (const boost of activeBoosts) {
      try {
        // Check if game is completed
        if (!boost.gameId) {
          console.warn(`[settle_community_boosts] Boost ${boost.id} has no gameId, skipping`);
          continue;
        }

        const game = await storage.getDailyGameByGameId(boost.gameId);
        if (!game) {
          // Try to find game by date/sport/player if gameId is missing (fallback)
          // But for now, assume gameId is present as it's required in creation
          console.warn(
            `[settle_community_boosts] Game ${boost.gameId} not found for boost ${boost.id}`,
          );
          continue;
        }

        // Only settle if game is completed
        if (game.status !== "completed") {
          continue;
        }

        console.log(
          `[settle_community_boosts] Settling community boost ${boost.id} - game ${boost.gameId} completed`,
        );

        // Get player's fantasy points for this game
        const stats = await storage.getPlayerGameStatsForIdentity(boost.playerId, boost.gameId);
        const fantasyPoints = stats ? parseFloat(stats.fantasyPoints) : 0;

        // Community boosts now modify Daily Boost multipliers (+1x each) and are settled there.
        // This job only finalizes boost lifecycle state to avoid duplicate/legacy payouts.
        const boostTotalPayout = 0;
        const beneficiaryCount = 0;

        // Update community boost status
        await storage.updateCommunityBoost(boost.id, {
          status: "processed",
          fantasyPoints: fantasyPoints.toFixed(2),
          totalPayout: boostTotalPayout.toFixed(2),
          beneficiaryCount: beneficiaryCount,
          processedAt: new Date(),
        });

        console.log(
          `[settle_community_boosts] Processed boost ${boost.id}: payout handled by daily boost settlement`,
        );

        // Notify via websocket
        broadcast({
          type: "COMMUNITY_BOOST_SETTLED",
          payload: {
            boostId: boost.id,
            playerId: boost.playerId,
            sport: boost.sport,
            totalPayout: boostTotalPayout,
            beneficiaryCount,
          },
        });

        void sendUserNotification({
          userId: boost.creatorId,
          category: "community_boosts",
          title: "Community Boost Settled",
          body: "Your community boost finished and has been processed.",
          deepLink: "/boosts",
          data: {
            boostId: boost.id,
            playerId: boost.playerId,
            sport: boost.sport,
          },
          dedupeKey: `community_boost_settled:${boost.id}`,
        }).catch((error) => {
          console.error("[settle_community_boosts] Failed to send push:", error);
        });

        boostsSettled++;
        totalPayout += boostTotalPayout;
      } catch (err: any) {
        console.error(`[settle_community_boosts] Error processing boost ${boost.id}:`, err);
        errorCount++;
      }
    }

    const result = {
      requestCount: activeBoosts.length,
      recordsProcessed: boostsSettled,
      errorCount,
    };

    progressCallback?.({
      type: result.errorCount > 0 ? "warning" : "complete",
      timestamp: new Date().toISOString(),
      message: `Settled ${boostsSettled} community boosts, total payout $${totalPayout.toFixed(2)}`,
    });

    return result;
  } catch (error: any) {
    console.error("[settle_community_boosts] Fatal error:", error);
    return {
      requestCount: 0,
      recordsProcessed: boostsSettled,
      errorCount: errorCount + 1,
    };
  }
}

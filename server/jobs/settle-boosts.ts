import { settleBaseEarningsForGame, settleDirectShareBoost } from "../economy/repository";
import { storage } from "../storage";
import { broadcast } from "../websocket";
import { sendUserNotification } from "../services/notification-dispatcher";
import { notifyBoostSettledPush } from "../services/push-notification-events";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

function isSettlableNascarStats(
  sport: unknown,
  stats: { statsJson?: unknown } | null | undefined,
): boolean {
  if (String(sport || "").toUpperCase() !== "NASCAR") return true;
  const statsJson = stats?.statsJson;
  if (!statsJson || typeof statsJson !== "object" || Array.isArray(statsJson)) return true;
  const record = statsJson as Record<string, unknown>;
  const runType = Number(record.runType ?? record.run_type);
  if (Number.isFinite(runType)) return runType === 3;
  const runName = String(record.runName ?? record.run_name ?? "").toLowerCase();
  return !runName || (!runName.includes("qualifying") && !runName.includes("practice"));
}

export async function settleBoosts(progressCallback?: ProgressCallback): Promise<JobResult> {
  let boostsSettled = 0;
  let totalBonusIssued = 0;
  let errorCount = 0;
  let requestCount = 0;

  try {
    const lockedBoosts = await storage.getDailyBoostsByStatus("locked");
    requestCount++;
    const settledBaseGames = new Set<string>();

    for (const boost of lockedBoosts) {
      try {
        if (!boost.gameId) continue;
        const game = await storage.getDailyGameByGameId(boost.gameId);
        requestCount++;
        if (!game) continue;
        const status = String(game.status || "").toLowerCase();
        if (status !== "completed" && status !== "ended") continue;

        const stats = await storage.getPlayerGameStatsForIdentity(boost.playerId, game.gameId);
        requestCount++;
        if (!stats || !isSettlableNascarStats(game.sport ?? boost.sport, stats)) continue;

        // Base EPS must settle first. This is idempotent and ensures the Boost only mints the
        // incremental amount above the ordinary 1x payout already owed to the burned shares.
        if (!settledBaseGames.has(game.gameId)) {
          await settleBaseEarningsForGame(game);
          settledBaseGames.add(game.gameId);
          requestCount++;
        }

        const communityBoostCount = await storage.getCommunityBoostCountForPlayerIdentity(
          boost.sport,
          new Date(boost.boostDate),
          boost.playerId,
        );
        requestCount++;

        const fantasyPoints = Number(stats.fantasyPoints || 0);
        const result = await settleDirectShareBoost(boost.id, fantasyPoints, communityBoostCount);
        requestCount++;
        if (!result.settled) continue;

        boostsSettled++;
        totalBonusIssued += result.boostBonusSb;
        const player = await storage.getPlayer(boost.playerId);
        requestCount++;
        const playerName = `${player?.firstName ?? ""} ${player?.lastName ?? ""}`.trim() || "Player";

        broadcast({
          type: "boost_settled",
          userId: boost.userId,
          boostId: boost.id,
          payout: result.totalEconomicEarningsSb.toFixed(2),
          boostBonus: result.boostBonusSb.toFixed(2),
          baseComponent: result.baseComponentSb.toFixed(2),
          gameEps: result.gameEpsSb.toFixed(8),
          fantasyPoints,
          multiplier: result.effectiveMultiplier,
          slotTier: boost.slotTier,
          sharesBurned: result.sharesBurned,
          playerFirstName: player?.firstName ?? "",
          playerLastName: player?.lastName ?? "",
          playerTeam: player?.team ?? "",
        });

        void sendUserNotification({
          userId: boost.userId,
          category: "boost_lifecycle",
          title: "Boost Settled",
          body: `${playerName}'s ${result.effectiveMultiplier}x Boost generated ${result.totalEconomicEarningsSb.toFixed(2)} SB of total game earnings.`,
          deepLink: "/boosts",
          data: {
            boostId: boost.id,
            playerId: boost.playerId,
            boostBonus: result.boostBonusSb.toFixed(2),
            totalEconomicEarnings: result.totalEconomicEarningsSb.toFixed(2),
            sharesBurned: result.sharesBurned.toFixed(4),
          },
          dedupeKey: `boost_settled:${boost.id}`,
        }).catch((error) => {
          console.error("[settle_boosts] Failed to send settle push:", error);
        });

        await notifyBoostSettledPush({
          userId: boost.userId,
          boostId: boost.id,
          playerName,
          payout: result.totalEconomicEarningsSb.toFixed(2),
          fantasyPoints,
          slotTier: result.effectiveMultiplier,
        });

        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Settled ${result.effectiveMultiplier}x Boost ${boost.id}: ${result.boostBonusSb.toFixed(2)} incremental SB bonus`,
        });
      } catch (error: any) {
        errorCount++;
        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Boost settlement failed for ${boost.id}: ${error?.message || error}`,
        });
      }
    }

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `Economy V2 Boost settlement: ${boostsSettled} settled, ${totalBonusIssued.toFixed(2)} bonus SB issued`,
    });
    return { requestCount, recordsProcessed: boostsSettled, errorCount };
  } catch {
    return { requestCount, recordsProcessed: boostsSettled, errorCount: errorCount + 1 };
  }
}

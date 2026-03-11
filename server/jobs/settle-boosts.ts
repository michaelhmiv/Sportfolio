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
import { choosePreferredDailyGame } from "../lib/daily-game-dedupe";
import { getETDayBoundaries, getGameDay } from "../lib/time";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

function isLegacyNbaGameId(sport: unknown, gameId: unknown): boolean {
  return String(sport || "").toUpperCase() === "NBA" && String(gameId || "").startsWith("18447");
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

const STALE_MISSING_STATS_SETTLE_MS = 12 * 60 * 60 * 1000;

function getBoostCommunityCacheKey(boost: {
  sport: string;
  boostDate: Date | string;
  playerId: string;
}) {
  const dateKey = boost.boostDate
    ? new Date(boost.boostDate).toISOString().split("T")[0]
    : "unknown";
  return `${boost.sport}:${dateKey}:${boost.playerId}`;
}

async function getCommunityBoostCountForBoost(
  boost: {
    sport: string;
    boostDate: Date | string;
    playerId: string;
  },
  cache: Map<string, number>,
) {
  const cacheKey = getBoostCommunityCacheKey(boost);
  let communityBoostCount = cache.get(cacheKey);
  if (communityBoostCount === undefined) {
    const communityBoosts = await storage.getCommunityBoostsForDate(
      boost.sport,
      new Date(boost.boostDate),
    );
    communityBoostCount = communityBoosts.filter(
      (entry) => entry.playerId === boost.playerId,
    ).length;
    cache.set(cacheKey, communityBoostCount);
  }

  return communityBoostCount;
}

function shouldFinalizeWithoutStats(
  boost: { boostDate: Date | string },
  game?: { startTime?: Date | string } | null,
) {
  const reference = game?.startTime ? new Date(game.startTime) : new Date(boost.boostDate);
  return Date.now() - reference.getTime() >= STALE_MISSING_STATS_SETTLE_MS;
}

async function finalizeBoostWithoutStats(input: {
  boost: any;
  game?: { startTime?: Date | string } | null;
  communityCountCache: Map<string, number>;
  progressCallback?: ProgressCallback;
}) {
  const communityBoostCount = await getCommunityBoostCountForBoost(
    input.boost,
    input.communityCountCache,
  );
  const effectiveMultiplier = input.boost.slotTier + communityBoostCount;

  await storage.createBoostPayout({
    boostId: input.boost.id,
    userId: input.boost.userId,
    playerId: input.boost.playerId,
    sharesUsed: input.boost.sharesEntered,
    fantasyPoints: "0.00",
    multiplier: effectiveMultiplier,
    payoutAmount: "0.00",
  });

  await storage.updateDailyBoost(input.boost.id, {
    status: "processed",
    fantasyPoints: "0.00",
    payout: "0.00",
    processedAt: new Date(),
  });

  input.progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: `Settled stale boost ${input.boost.id} with zero payout after repeated missing stats.`,
    data: {
      boostId: input.boost.id,
      playerId: input.boost.playerId,
      gameId: input.boost.gameId,
    },
  });

  broadcast({
    type: "boost_settled",
    userId: input.boost.userId,
    boostId: input.boost.id,
    payout: "0.00",
    fantasyPoints: 0,
    multiplier: effectiveMultiplier,
  });
}

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
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000; // 2 seconds between retries

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

    // Collect boosts that need retry due to missing stats
    const boostsNeedingRetry: typeof lockedBoosts = [];

    for (const boost of lockedBoosts) {
      try {
        const now = Date.now();
        let game = boost.gameId ? await storage.getDailyGameByGameId(boost.gameId) : undefined;

        const shouldTryRepair =
          !game ||
          isLegacyNbaGameId(boost.sport, boost.gameId) ||
          (game && isLegacyNbaGameId(game.sport ?? boost.sport, game.gameId));

        // Self-heal: resolve canonical gameId (BallDontLie) for legacy/missing refs.
        // Prefer matchup/time context over player team (player.team can change over time).
        if (game && shouldTryRepair && isLegacyNbaGameId(boost.sport, game.gameId)) {
          const baseGame = game;
          const dateStr = getGameDay(baseGame.startTime);
          const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
          const dayGames = await storage.getDailyGamesBySport(boost.sport, startOfDay, endOfDay);
          const matchupGames = dayGames.filter(
            (g) => g.homeTeam === baseGame.homeTeam && g.awayTeam === baseGame.awayTeam,
          );

          let canonical: typeof baseGame | undefined;
          for (const g of matchupGames) {
            canonical = canonical ? choosePreferredDailyGame(canonical, g) : g;
          }

          if (canonical && boost.gameId !== canonical.gameId) {
            console.log(
              `[settle_boosts] Boost ${boost.id}: repairing gameId ${boost.gameId || "(null)"} -> ${canonical.gameId}`,
            );
            await storage.updateDailyBoost(boost.id, { gameId: canonical.gameId });
          }

          game = canonical ?? baseGame;
        }

        // Fallback: If we still can't resolve a game record, attempt a player/team lookup for that ET date.
        if (shouldTryRepair && (!game || isLegacyNbaGameId(boost.sport, game.gameId))) {
          const resolved = await storage.getPlayerGameForDate(
            boost.playerId,
            boost.sport,
            new Date(boost.boostDate),
          );

          if (resolved) {
            if (boost.gameId !== resolved.gameId) {
              console.log(
                `[settle_boosts] Boost ${boost.id}: repairing gameId ${boost.gameId || "(null)"} -> ${resolved.gameId}`,
              );
              await storage.updateDailyBoost(boost.id, { gameId: resolved.gameId });
            }
            game = resolved;
          }
        }

        if (!game) {
          console.log(
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
        // FIX: Add to retry list instead of just skipping
        if (!stats) {
          console.log(
            `[settle_boosts] Boost ${boost.id}: No stats found for player ${boost.playerId} game ${canonicalGameId}, queuing for retry`,
          );
          boostsNeedingRetry.push(boost);
          continue;
        }

        if (!isSettlableNascarStats(game.sport ?? boost.sport, stats)) {
          console.log(
            `[settle_boosts] Boost ${boost.id}: ignoring non-race NASCAR session stats for game ${canonicalGameId}`,
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

        const effectivePower = boost.shareMultiplier
          ? parseFloat(boost.shareMultiplier.toString())
          : boost.sharesEntered;
        const effectiveMultiplier = boost.slotTier + communityBoostCount;
        // Floor payout at 0 to prevent negative balances from poor player performance
        const rawPayout = effectivePower * fantasyPoints * effectiveMultiplier;
        const payout = Math.max(0, rawPayout);

        console.log(
          `[settle_boosts] Boost ${boost.id}: ${effectivePower}x multiplier × ${fantasyPoints} FP × ${effectiveMultiplier}x (${boost.slotTier}+${communityBoostCount}) = $${payout.toFixed(2)}`,
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

    // Retry boosts that were skipped due to missing stats
    if (boostsNeedingRetry.length > 0) {
      console.log(
        `[settle_boosts] Retrying ${boostsNeedingRetry.length} boosts that had missing stats...`,
      );

      for (let retry = 1; retry <= MAX_RETRIES && boostsNeedingRetry.length > 0; retry++) {
        console.log(`[settle_boosts] Retry attempt ${retry}/${MAX_RETRIES}`);

        // Wait before retry
        if (retry > 1) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }

        const remainingBoosts: typeof lockedBoosts = [];

        for (const boost of boostsNeedingRetry) {
          try {
            // Re-fetch game data (it may have been updated)
            const game = boost.gameId
              ? await storage.getDailyGameByGameId(boost.gameId)
              : undefined;

            if (!game) {
              console.log(`[settle_boosts] Retry - Boost ${boost.id}: no game found, skipping`);
              continue;
            }

            const canonicalGameId = game.gameId;

            // Re-check stats
            const stats = await storage.getPlayerGameStats(boost.playerId, canonicalGameId);

            if (!stats) {
              console.log(
                `[settle_boosts] Retry ${retry} - Boost ${boost.id}: still no stats, will retry again if available`,
              );
              remainingBoosts.push(boost);
              continue;
            }

            if (!isSettlableNascarStats(game.sport ?? boost.sport, stats)) {
              console.log(
                `[settle_boosts] Retry ${retry} - Boost ${boost.id}: still non-race NASCAR session stats for game ${canonicalGameId}, deferring`,
              );
              remainingBoosts.push(boost);
              continue;
            }

            console.log(
              `[settle_boosts] Retry ${retry} - Settling boost ${boost.id} - game ${canonicalGameId}`,
            );

            const fantasyPoints = parseFloat(stats.fantasyPoints);

            // Re-calculate community boost count
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

            // Calculate payout
            const effectivePower = boost.shareMultiplier
              ? parseFloat(boost.shareMultiplier.toString())
              : boost.sharesEntered;
            const effectiveMultiplier = boost.slotTier + communityBoostCount;
            const rawPayout = effectivePower * fantasyPoints * effectiveMultiplier;
            const payout = Math.max(0, rawPayout);

            console.log(
              `[settle_boosts] Retry ${retry} - Boost ${boost.id}: ${effectivePower}x multiplier × ${fantasyPoints} FP × ${effectiveMultiplier}x = $${payout.toFixed(2)}`,
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
              message: `Settled boost ${boost.id} on retry ${retry}: $${payout.toFixed(2)} payout`,
              data: { boostId: boost.id, payout, fantasyPoints, retry },
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
          } catch (retryError: any) {
            console.error(`[settle_boosts] Retry error for boost ${boost.id}:`, retryError.message);
            errorCount++;
            remainingBoosts.push(boost);
          }
        }

        // Update the list for next iteration
        boostsNeedingRetry.length = 0;
        boostsNeedingRetry.push(...remainingBoosts);
      }

      if (boostsNeedingRetry.length > 0) {
        const unresolvedBoosts: typeof lockedBoosts = [];

        for (const boost of boostsNeedingRetry) {
          const game = boost.gameId ? await storage.getDailyGameByGameId(boost.gameId) : undefined;
          if (shouldFinalizeWithoutStats(boost, game)) {
            console.log(
              `[settle_boosts] Finalizing stale boost ${boost.id} with zero payout after missing stats retries.`,
            );
            await finalizeBoostWithoutStats({
              boost,
              game,
              communityCountCache,
              progressCallback,
            });
            boostsSettled++;
            continue;
          }

          unresolvedBoosts.push(boost);
        }

        if (unresolvedBoosts.length > 0) {
          console.log(
            `[settle_boosts] ${unresolvedBoosts.length} boosts still missing stats after ${MAX_RETRIES} retries`,
          );
          for (const boost of unresolvedBoosts) {
            console.log(
              `[settle_boosts] Unsettled boost: ${boost.id} - player ${boost.playerId} game ${boost.gameId}`,
            );
          }
        }
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

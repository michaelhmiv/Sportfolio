/**
 * Lock Boost Shares Job
 *
 * Runs frequently to lock shares for boosts when their game starts.
 * This transitions boosts from "active" to "locked" status and creates
 * holdings locks to prevent users from selling boosted shares during games.
 */

import { storage } from "../storage";
import { choosePreferredDailyGame } from "../lib/daily-game-dedupe";
import { getETDayBoundaries, getGameDay } from "../lib/time";
import { hasGameStartedForBoost } from "@shared/game-status";
import { notifyBoostLockingSoonPush } from "../services/push-notification-events";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";
import { sendUserNotification } from "../services/notification-dispatcher";
import { isNflPreseasonGame } from "../nfl/season";

function isLegacyNbaGameId(sport: unknown, gameId: unknown): boolean {
  return String(sport || "").toUpperCase() === "NBA" && String(gameId || "").startsWith("18447");
}

export async function lockBoostShares(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[lock_boost_shares] Starting boost share locking...");
  const lockingSoonWindowMinutes = Math.max(
    5,
    Number.parseInt(process.env.BOOST_LOCKING_SOON_WINDOW_MINUTES || "25", 10) || 25,
  );

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting boost share locking job",
  });

  let boostsLocked = 0;
  let errorCount = 0;

  try {
    // Get all active boosts that haven't been locked yet
    const activeBoosts = await storage.getDailyBoostsByStatus("active");

    console.log(`[lock_boost_shares] Found ${activeBoosts.length} active boosts to check`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Checking ${activeBoosts.length} active boosts for game start`,
    });

    const now = new Date();

    for (const boost of activeBoosts) {
      try {
        // Check if game has started
        let game = boost.gameId ? await storage.getDailyGameByGameId(boost.gameId) : undefined;

        const shouldTryRepair =
          !game ||
          isLegacyNbaGameId(boost.sport, boost.gameId) ||
          (game && isLegacyNbaGameId(game.sport ?? boost.sport, game.gameId));

        // Self-heal: If boost points at a missing/legacy gameId (e.g., old MySportsFeeds duplicates),
        // resolve the canonical game using matchup/time context (player.team can change over time).
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
            console.warn(
              `[lock_boost_shares] Boost ${boost.id}: repairing gameId ${boost.gameId || "(null)"} -> ${canonical.gameId}`,
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
              console.warn(
                `[lock_boost_shares] Boost ${boost.id}: repairing gameId ${boost.gameId || "(null)"} -> ${resolved.gameId}`,
              );
              await storage.updateDailyBoost(boost.id, { gameId: resolved.gameId });
            }
            game = resolved;
          }
        }

        if (!game) {
          console.warn(
            `[lock_boost_shares] Boost ${boost.id}: no game found (gameId=${boost.gameId || "(null)"}), skipping`,
          );
          continue;
        }

        if (isNflPreseasonGame(game)) continue;

        const gameStart = new Date(game.startTime);
        const msUntilStart = gameStart.getTime() - now.getTime();
        if (msUntilStart > 0 && msUntilStart <= lockingSoonWindowMinutes * 60 * 1000) {
          const player = await storage.getPlayer(boost.playerId);
          await notifyBoostLockingSoonPush({
            userId: boost.userId,
            boostId: boost.id,
            playerName: `${player?.firstName ?? ""} ${player?.lastName ?? ""}`.trim() || "Player",
            minutesUntilLock: msUntilStart / (60 * 1000),
          });
        }

        // Lock once the game is actually live/completed rather than purely by scheduled tipoff time.
        if (hasGameStartedForBoost(game, new Date(now.getTime() + 60000))) {
          console.log(
            `[lock_boost_shares] Locking boost ${boost.id} - game ${game.gameId} started at ${gameStart.toISOString()}`,
          );

          await storage.lockBoostShares(boost.id);
          boostsLocked++;

          void sendUserNotification({
            userId: boost.userId,
            category: "boost_lifecycle",
            title: "Boost Locked",
            body: "Your boost is now locked because the game has started.",
            deepLink: "/boosts",
            data: {
              boostId: boost.id,
              playerId: boost.playerId,
              gameId: game.gameId,
            },
            dedupeKey: `boost_locked:${boost.id}`,
          }).catch((error) => {
            console.error("[lock_boost_shares] Failed to send lock push:", error);
          });

          progressCallback?.({
            type: "info",
            timestamp: new Date().toISOString(),
            message: `Locked boost ${boost.id} for player game`,
          });
        }
      } catch (boostError: any) {
        console.error(`[lock_boost_shares] Error locking boost ${boost.id}:`, boostError.message);
        errorCount++;
        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Error locking boost ${boost.id}: ${boostError.message}`,
        });
      }
    }

    console.log(
      `[lock_boost_shares] Complete: ${boostsLocked} boosts locked, ${errorCount} errors`,
    );

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `Boost locking complete: ${boostsLocked} locked, ${errorCount} errors`,
      data: { boostsLocked, errorCount },
    });

    return {
      requestCount: 0,
      recordsProcessed: boostsLocked,
      errorCount,
    };
  } catch (error: any) {
    console.error("[lock_boost_shares] Fatal error:", error);

    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Fatal error: ${error.message}`,
    });

    return {
      requestCount: 0,
      recordsProcessed: boostsLocked,
      errorCount: errorCount + 1,
    };
  }
}

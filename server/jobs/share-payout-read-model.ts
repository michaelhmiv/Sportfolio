import { and, inArray } from "drizzle-orm";
import type { DailyGame, PlayerGameStats, SharePayout } from "@shared/schema";
import { dailyGames, playerGameStats } from "@shared/schema";
import { db } from "../db";

function statsKey(playerId: string, gameId: string): string {
  return `${playerId}\u0000${gameId}`;
}

function fetchedAtMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export type SharePayoutSettlementContext = {
  gamesById: Map<string, DailyGame>;
  statsByPlayerGame: Map<string, PlayerGameStats>;
  readCount: number;
};

/**
 * Load all game and player-game-stat rows required to evaluate a payout batch.
 * This intentionally performs at most two database reads regardless of payout
 * count, replacing the previous per-payout game + stats lookup pattern.
 */
export async function loadSharePayoutSettlementContext(
  payouts: Array<Pick<SharePayout, "playerId" | "gameId">>,
): Promise<SharePayoutSettlementContext> {
  const gameIds = Array.from(new Set(payouts.map((payout) => payout.gameId).filter(Boolean)));
  const playerIds = Array.from(new Set(payouts.map((payout) => payout.playerId).filter(Boolean)));

  const [games, stats] = await Promise.all([
    gameIds.length
      ? db.select().from(dailyGames).where(inArray(dailyGames.gameId, gameIds))
      : Promise.resolve([] as DailyGame[]),
    gameIds.length && playerIds.length
      ? db
          .select()
          .from(playerGameStats)
          .where(
            and(
              inArray(playerGameStats.gameId, gameIds),
              inArray(playerGameStats.playerId, playerIds),
            ),
          )
      : Promise.resolve([] as PlayerGameStats[]),
  ]);

  const gamesById = new Map<string, DailyGame>();
  for (const game of games) {
    gamesById.set(game.gameId, game);
  }

  const statsByPlayerGame = new Map<string, PlayerGameStats>();
  for (const row of stats) {
    const key = statsKey(row.playerId, row.gameId);
    const existing = statsByPlayerGame.get(key);
    if (!existing || fetchedAtMs(row.lastFetchedAt) >= fetchedAtMs(existing.lastFetchedAt)) {
      statsByPlayerGame.set(key, row);
    }
  }

  return {
    gamesById,
    statsByPlayerGame,
    readCount: Number(gameIds.length > 0) + Number(gameIds.length > 0 && playerIds.length > 0),
  };
}

export function getSharePayoutStats(
  context: SharePayoutSettlementContext,
  playerId: string,
  gameId: string,
): PlayerGameStats | undefined {
  return context.statsByPlayerGame.get(statsKey(playerId, gameId));
}

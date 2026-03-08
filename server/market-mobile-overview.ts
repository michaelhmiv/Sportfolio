import type { DailyGame, Holding, Player } from "@shared/schema";
import { players, scoutAssignments, scoutHistory, trades } from "@shared/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "./db";
import { getETDayBoundaries, getGameDay } from "./lib/time";
import { storage } from "./storage";
import type { HoldingWithPlayerSummary } from "./storage";

type GameStatus = "none" | "upcoming" | "live" | "ended";
type SignalKind = "momentum" | "value" | "scout" | "boost" | "watchlist" | "ticker";
type HeatCheckStatus = "fire" | "ice" | "neutral";

interface ScannerEntry {
  player: Player;
  metrics: {
    valueIndex?: number;
    sentiment?: {
      buyPressure?: number;
      totalVolume24h?: number;
    };
  };
}

type CommunityBoostLike = { playerId: string; sport?: string | null };
type DailyBoostLike = { playerId: string; slotTier?: number | null };

export interface MobileMarketPulse {
  tradeCount15m: number;
  lowActivity: boolean;
  liveGameCount: number;
  slateGameCount: number;
  openBoostSlots: number | null;
  generatedAt: string;
}

export interface MobileMarketTickerItem {
  id: string;
  playerId: string;
  playerName: string;
  symbol: string;
  team: string;
  currentPrice: number;
  priceChange24h: number;
  quantity: number;
  notional: number;
  isWhale: boolean;
  timestamp: string;
}

export interface MobileMarketSignal {
  playerId: string;
  firstName: string;
  lastName: string;
  team: string;
  position: string;
  currentPrice: number;
  priceChange24h: number;
  poolTvl: number;
  buyPressure: number;
  valueIndex: number;
  globalScoutCount: number;
  communityBoostCount: number;
  gameStatus: GameStatus;
  gameStartTime: string | null;
  note: string;
  signal: SignalKind;
  availableShares: number | null;
  bestShareMultiplier: number | null;
  heatCheckStatus: HeatCheckStatus;
}

export interface MobileMarketOverview {
  sport: string;
  pulse: MobileMarketPulse;
  ticker: MobileMarketTickerItem[];
  nowMoving: MobileMarketSignal[];
  boostWindow: MobileMarketSignal[];
  scoutSurge: MobileMarketSignal[];
  quietValue: MobileMarketSignal[];
  watchlistMoves: MobileMarketSignal[];
}

export interface MarketMobileOverviewDeps {
  getFinancialMarketScanners: (sport: string) => Promise<{
    undervalued: ScannerEntry[];
    premium: ScannerEntry[];
    sentiment: ScannerEntry[];
    momentum: ScannerEntry[];
  }>;
  getMarketActivity: (filters: { limit: number; sport: string }) => Promise<any[]>;
  getDailyGames: (sport: string, startOfDay: Date, endOfDay: Date) => Promise<DailyGame[]>;
  getBatchPoolData: (
    playerIds: string[],
  ) => Promise<
    Map<string, { shares: number; playMoney: number; totalVolume: number; totalTrades: number }>
  >;
  getBatchActiveScoutCounts: (playerIds: string[]) => Promise<Map<string, number>>;
  getCommunityBoostsAllSports: (date: Date) => Promise<CommunityBoostLike[]>;
  getPlayersByIds: (playerIds: string[]) => Promise<Player[]>;
  getPlayerFinancialMetrics: (playerId: string) => Promise<{
    heatCheck?: { status?: HeatCheckStatus };
  }>;
  getWatchList: (userId: string) => Promise<string[]>;
  getAllHoldingsWithPlayers: (userId: string) => Promise<HoldingWithPlayerSummary[]>;
  getDailyBoostsAllSports: (userId: string, date: Date) => Promise<DailyBoostLike[]>;
  getTotalLockedQuantity: (userId: string, assetType: string, assetId: string) => Promise<number>;
  getRecentTradeCount15m: (sport: string, since: Date) => Promise<number>;
  getTrendingScoutPlayerIds: (sport: string, limit: number, asOf: Date) => Promise<string[]>;
  now: () => Date;
}

const WHALE_ALERT_MIN_VALUE = 5000;
const LOW_ACTIVITY_THRESHOLD = 3;

const defaultDeps: MarketMobileOverviewDeps = {
  getFinancialMarketScanners: (sport) => storage.getFinancialMarketScanners(sport),
  getMarketActivity: (filters) => storage.getMarketActivity(filters),
  getDailyGames: (sport, startOfDay, endOfDay) =>
    sport === "ALL"
      ? storage.getDailyGames(startOfDay, endOfDay)
      : storage.getDailyGamesBySport(sport, startOfDay, endOfDay),
  getBatchPoolData: (playerIds) => storage.getBatchPoolData(playerIds),
  getBatchActiveScoutCounts: (playerIds) => storage.getBatchActiveScoutCounts(playerIds),
  getCommunityBoostsAllSports: (date) => storage.getCommunityBoostsAllSports(date),
  getPlayersByIds: (playerIds) => storage.getPlayersByIds(playerIds),
  getPlayerFinancialMetrics: (playerId) => storage.getPlayerFinancialMetrics(playerId),
  getWatchList: (userId) => storage.getWatchList(userId),
  getAllHoldingsWithPlayers: (userId) => storage.getAllHoldingsWithPlayers(userId),
  getDailyBoostsAllSports: (userId, date) => storage.getDailyBoostsAllSports(userId, date),
  getTotalLockedQuantity: (userId, assetType, assetId) =>
    storage.getTotalLockedQuantity(userId, assetType, assetId),
  getRecentTradeCount15m: async (sport, since) => {
    const normalizedSport = sport.toUpperCase();
    const sportCondition =
      normalizedSport === "ALL" ? sql`TRUE` : sql`UPPER(${players.sport}) = ${normalizedSport}`;

    const result = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(trades)
      .innerJoin(players, eq(trades.playerId, players.id))
      .where(and(gte(trades.executedAt, since), sportCondition));

    return Number(result[0]?.count || 0);
  },
  getTrendingScoutPlayerIds: async (sport, limit, asOf) => {
    const normalizedSport = sport.toUpperCase();
    const oneHourAgo = new Date(asOf.getTime() - 60 * 60 * 1000);
    const sportCondition =
      normalizedSport === "ALL" ? sql`TRUE` : sql`UPPER(${players.sport}) = ${normalizedSport}`;

    const currentCounts = await db
      .select({
        playerId: scoutAssignments.playerId,
        totalScouts: sql<number>`SUM(${scoutAssignments.scoutCount})`,
      })
      .from(scoutAssignments)
      .innerJoin(players, eq(scoutAssignments.playerId, players.id))
      .where(sportCondition)
      .groupBy(scoutAssignments.playerId);

    const trending: Array<{ playerId: string; velocity: number; totalScouts: number }> = [];

    for (const entry of currentCounts) {
      const previousResult = await db
        .select({
          total: sql<number>`COALESCE(SUM(${scoutHistory.scoutCount}), 0)`,
        })
        .from(scoutHistory)
        .where(
          and(
            eq(scoutHistory.playerId, entry.playerId),
            lt(scoutHistory.startedAt, oneHourAgo),
            sql`${scoutHistory.endedAt} IS NULL OR ${scoutHistory.endedAt} > ${oneHourAgo}`,
          ),
        );

      const previousTotal = Number(previousResult[0]?.total || 0);
      const currentTotal = Number(entry.totalScouts || 0);
      const velocity = currentTotal - previousTotal;

      if (velocity >= 1) {
        trending.push({
          playerId: entry.playerId,
          velocity,
          totalScouts: currentTotal,
        });
      }
    }

    return trending
      .sort((left, right) => {
        if (right.velocity !== left.velocity) {
          return right.velocity - left.velocity;
        }

        return right.totalScouts - left.totalScouts;
      })
      .slice(0, limit)
      .map((entry) => entry.playerId);
  },
  now: () => new Date(),
};

type PlayerContext = {
  playerId: string;
  firstName: string;
  lastName: string;
  sport: string;
  team: string;
  position: string;
  currentPrice: number;
  priceChange24h: number;
  poolTvl: number;
  buyPressure: number;
  valueIndex: number;
  globalScoutCount: number;
  communityBoostCount: number;
  gameStatus: GameStatus;
  gameStartTime: string | null;
  heatCheckStatus: HeatCheckStatus;
};

type HoldingContext = {
  availableShares: number;
  bestShareMultiplier: number;
};

type HoldingAggregation = {
  regularShares: number;
  stackedShares: number;
  bestShareMultiplier: number;
};

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function dedupeIds(ids: Array<string | null | undefined>): string[] {
  const unique = new Set<string>();

  ids.forEach((id) => {
    if (typeof id === "string" && id.trim().length > 0) {
      unique.add(id);
    }
  });

  return Array.from(unique);
}

function getEffectiveGameStatus(game: DailyGame | undefined, now: Date): GameStatus {
  if (!game) {
    return "none";
  }

  const normalizedStatus = String(game.status || "")
    .trim()
    .toLowerCase();
  const startTime = new Date(game.startTime);
  const timeSinceStart = now.getTime() - startTime.getTime();
  const threeHoursMs = 3 * 60 * 60 * 1000;

  if (
    normalizedStatus === "postponed" ||
    normalizedStatus === "cancelled" ||
    normalizedStatus === "canceled" ||
    normalizedStatus === "delayed" ||
    normalizedStatus === "suspended"
  ) {
    return "none";
  }

  if (normalizedStatus === "completed" || normalizedStatus === "ended") {
    return "ended";
  }

  if (normalizedStatus === "inprogress") {
    return "live";
  }

  if (normalizedStatus === "scheduled" && timeSinceStart > 0 && timeSinceStart < threeHoursMs) {
    return "live";
  }

  if (normalizedStatus === "scheduled" && timeSinceStart >= threeHoursMs) {
    return "ended";
  }

  return "upcoming";
}

function createGameMap(games: DailyGame[], now: Date) {
  const teamToGame = new Map<string, { status: GameStatus; startTime: string | null }>();

  for (const game of games) {
    const gameContext = {
      status: getEffectiveGameStatus(game, now),
      startTime: game.startTime ? new Date(game.startTime).toISOString() : null,
    };

    teamToGame.set(game.homeTeam, gameContext);
    teamToGame.set(game.awayTeam, gameContext);
  }

  return teamToGame;
}

async function buildPlayerContextMap(
  playerIds: string[],
  games: DailyGame[],
  scanners: {
    undervalued: ScannerEntry[];
    premium: ScannerEntry[];
    sentiment: ScannerEntry[];
    momentum: ScannerEntry[];
  },
  deps: MarketMobileOverviewDeps,
): Promise<Map<string, PlayerContext>> {
  const dedupedPlayerIds = dedupeIds(playerIds);
  if (dedupedPlayerIds.length === 0) {
    return new Map();
  }

  const [playersById, poolMap, scoutCountMap] = await Promise.all([
    deps.getPlayersByIds(dedupedPlayerIds),
    deps.getBatchPoolData(dedupedPlayerIds),
    deps.getBatchActiveScoutCounts(dedupedPlayerIds),
  ]);

  const communityBoosts = await deps.getCommunityBoostsAllSports(deps.now());
  const communityBoostCounts = new Map<string, number>();

  communityBoosts.forEach((boost) => {
    const current = communityBoostCounts.get(boost.playerId) || 0;
    communityBoostCounts.set(boost.playerId, current + 1);
  });

  const scannerEntries = [...scanners.undervalued, ...scanners.premium, ...scanners.sentiment];
  const scannerMetrics = new Map<
    string,
    {
      buyPressure?: number;
      valueIndex?: number;
    }
  >();

  scannerEntries.forEach((entry) => {
    scannerMetrics.set(entry.player.id, {
      buyPressure: entry.metrics.sentiment?.buyPressure,
      valueIndex: entry.metrics.valueIndex,
    });
  });

  const teamGameMap = createGameMap(games, deps.now());
  const heatMap = new Map<string, HeatCheckStatus>();

  for (const playerId of dedupedPlayerIds.slice(0, 8)) {
    try {
      const metrics = await deps.getPlayerFinancialMetrics(playerId);
      heatMap.set(playerId, metrics.heatCheck?.status || "neutral");
    } catch {
      heatMap.set(playerId, "neutral");
    }
  }

  const contextMap = new Map<string, PlayerContext>();

  playersById.forEach((player) => {
    const pool = poolMap.get(player.id);
    const scanner = scannerMetrics.get(player.id);
    const game = teamGameMap.get(player.team);
    const currentPrice =
      pool && pool.shares > 0 ? pool.playMoney / pool.shares : toNumber(player.lastTradePrice);
    const poolTvl = pool && pool.shares > 0 ? pool.playMoney * 2 : pool ? pool.playMoney : 0;

    contextMap.set(player.id, {
      playerId: player.id,
      firstName: player.firstName,
      lastName: player.lastName,
      sport: player.sport,
      team: player.team,
      position: player.position,
      currentPrice,
      priceChange24h: toNumber(player.priceChange24h),
      poolTvl,
      buyPressure: scanner?.buyPressure ?? 50,
      valueIndex: scanner?.valueIndex ?? 0,
      globalScoutCount: scoutCountMap.get(player.id) || 0,
      communityBoostCount: communityBoostCounts.get(player.id) || 0,
      gameStatus: game?.status || "none",
      gameStartTime: game?.startTime || null,
      heatCheckStatus: heatMap.get(player.id) || "neutral",
    });
  });

  return contextMap;
}

function withSignal(
  context: PlayerContext | undefined,
  signal: SignalKind,
  note: string,
  holdingContext?: HoldingContext,
): MobileMarketSignal | null {
  if (!context) {
    return null;
  }

  return {
    ...context,
    note,
    signal,
    availableShares: holdingContext?.availableShares ?? null,
    bestShareMultiplier: holdingContext?.bestShareMultiplier ?? null,
  };
}

async function buildHoldingContextMap(
  userId: string,
  deps: MarketMobileOverviewDeps,
): Promise<Map<string, HoldingContext>> {
  const holdings = await deps.getAllHoldingsWithPlayers(userId);
  const grouped = new Map<string, HoldingAggregation>();

  for (const holding of holdings) {
    if (!holding.player) {
      continue;
    }

    const current = grouped.get(holding.player.id) || {
      regularShares: 0,
      stackedShares: 0,
      bestShareMultiplier: 1,
    };
    const quantity = toNumber(holding.quantity);
    const multiplier = toNumber(holding.multiplier || "1");

    if (holding.isStackedShare) {
      current.stackedShares += quantity;
    } else {
      current.regularShares += quantity;
    }

    current.bestShareMultiplier = Math.max(
      current.bestShareMultiplier,
      holding.isStackedShare && quantity >= 1 ? multiplier : 1,
    );
    grouped.set(holding.player.id, current);
  }

  const result = new Map<string, HoldingContext>();

  for (const [playerId, context] of grouped) {
    const locked = await deps.getTotalLockedQuantity(userId, "player", playerId);
    const availableRegularShares = Math.max(0, context.regularShares - locked);

    result.set(playerId, {
      availableShares: availableRegularShares + context.stackedShares,
      bestShareMultiplier: context.bestShareMultiplier,
    });
  }

  return result;
}

function sortByMarketEnergy(
  left: Pick<PlayerContext, "priceChange24h" | "communityBoostCount" | "poolTvl">,
  right: Pick<PlayerContext, "priceChange24h" | "communityBoostCount" | "poolTvl">,
) {
  if (right.priceChange24h !== left.priceChange24h) {
    return right.priceChange24h - left.priceChange24h;
  }

  if (right.communityBoostCount !== left.communityBoostCount) {
    return right.communityBoostCount - left.communityBoostCount;
  }

  return right.poolTvl - left.poolTvl;
}

export async function buildMobileMarketOverview(
  params: {
    sport?: string | null;
    userId?: string | null;
  },
  deps: MarketMobileOverviewDeps = defaultDeps,
): Promise<MobileMarketOverview> {
  const sport = (params.sport || "ALL").toUpperCase();
  const now = deps.now();
  const todayET = getGameDay(now);
  const { startOfDay, endOfDay } = getETDayBoundaries(todayET);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

  const [scanners, activity, games, tradeCount15m, trendingScoutPlayerIds, communityBoosts] =
    await Promise.all([
      deps.getFinancialMarketScanners(sport),
      deps.getMarketActivity({ sport, limit: 24 }),
      deps.getDailyGames(sport, startOfDay, endOfDay),
      deps.getRecentTradeCount15m(sport, new Date(now.getTime() - 15 * 60 * 1000)),
      deps.getTrendingScoutPlayerIds(sport, 6, now),
      deps.getCommunityBoostsAllSports(targetDate),
    ]);

  const primaryCandidateIds = dedupeIds([
    ...scanners.momentum.map((entry) => entry.player.id),
    ...scanners.undervalued.map((entry) => entry.player.id),
    ...activity.map((entry) => entry.playerId as string),
    ...trendingScoutPlayerIds,
    ...communityBoosts.map((entry) => entry.playerId),
  ]);

  const contextMap = await buildPlayerContextMap(primaryCandidateIds, games, scanners, deps);
  const boostedCommunityMap = new Set(
    Array.from(contextMap.values())
      .filter((item) => item.communityBoostCount > 0)
      .map((item) => item.playerId),
  );

  const ticker = activity
    .slice(0, 12)
    .map((entry) => {
      const context = contextMap.get(entry.playerId);
      const price = context?.currentPrice || toNumber(entry.price);
      const quantity = Number(entry.quantity || 0);
      const notional = roundToTwo(price * quantity);

      return {
        id: entry.id,
        playerId: entry.playerId,
        playerName: `${entry.playerFirstName} ${entry.playerLastName}`,
        symbol: `${entry.playerFirstName?.charAt(0) || ""}. ${entry.playerLastName}`,
        team: entry.playerTeam,
        currentPrice: price,
        priceChange24h: context?.priceChange24h || 0,
        quantity,
        notional,
        isWhale: notional >= WHALE_ALERT_MIN_VALUE,
        timestamp: new Date(entry.timestamp).toISOString(),
      } satisfies MobileMarketTickerItem;
    })
    .filter((entry) => entry.currentPrice > 0);

  const nowMovingContexts = scanners.momentum
    .slice(0, 6)
    .map((entry) => {
      const context = contextMap.get(entry.player.id);
      const priceChange = context?.priceChange24h ?? 0;
      return withSignal(
        context,
        "momentum",
        `${priceChange >= 0 ? "+" : ""}${roundToTwo(priceChange)}% in the last 24h`,
      );
    })
    .filter((entry): entry is MobileMarketSignal => Boolean(entry))
    .sort(sortByMarketEnergy)
    .slice(0, 4);

  const quietValue = scanners.undervalued
    .slice(0, 8)
    .map((entry) => {
      const context = contextMap.get(entry.player.id);
      return withSignal(context, "value", `Value index ${roundToTwo(context?.valueIndex || 0)}`);
    })
    .filter((entry): entry is MobileMarketSignal => Boolean(entry))
    .sort((left, right) => {
      if (left.valueIndex !== right.valueIndex) {
        return left.valueIndex - right.valueIndex;
      }

      return left.poolTvl - right.poolTvl;
    })
    .slice(0, 4);

  let scoutSurge = trendingScoutPlayerIds
    .map((playerId) => {
      const context = contextMap.get(playerId);
      return withSignal(context, "scout", `${context?.globalScoutCount || 0} active scouts`);
    })
    .filter((entry): entry is MobileMarketSignal => Boolean(entry))
    .sort((left, right) => right.globalScoutCount - left.globalScoutCount)
    .slice(0, 4);

  if (scoutSurge.length === 0) {
    scoutSurge = Array.from(contextMap.values())
      .filter((entry) => entry.globalScoutCount > 0)
      .sort((left, right) => right.globalScoutCount - left.globalScoutCount)
      .slice(0, 4)
      .map((entry) => ({
        ...entry,
        note: `${entry.globalScoutCount} active scouts`,
        signal: "scout" as const,
        availableShares: null,
        bestShareMultiplier: null,
      }));
  }

  let watchlistMoves: MobileMarketSignal[] = [];
  let boostWindow: MobileMarketSignal[] = Array.from(contextMap.values())
    .filter((entry) => entry.gameStatus !== "none" && boostedCommunityMap.has(entry.playerId))
    .sort((left, right) => {
      if (left.gameStatus !== right.gameStatus) {
        if (left.gameStatus === "live") return -1;
        if (right.gameStatus === "live") return 1;
      }

      if (right.communityBoostCount !== left.communityBoostCount) {
        return right.communityBoostCount - left.communityBoostCount;
      }

      return sortByMarketEnergy(left, right);
    })
    .slice(0, 4)
    .map((entry) => ({
      ...entry,
      note:
        entry.communityBoostCount > 0
          ? `Community +${entry.communityBoostCount} on today's slate`
          : entry.gameStatus === "live"
            ? "Live game window"
            : "Upcoming game window",
      signal: "boost" as const,
      availableShares: null,
      bestShareMultiplier: null,
    }));

  if (params.userId) {
    const [watchListIds, holdingMap, currentBoosts] = await Promise.all([
      deps.getWatchList(params.userId),
      buildHoldingContextMap(params.userId, deps),
      deps.getDailyBoostsAllSports(params.userId, targetDate),
    ]);

    const additionalBoostPlayerIds = Array.from(holdingMap.keys()).filter(
      (playerId) => !contextMap.has(playerId),
    );
    if (additionalBoostPlayerIds.length > 0) {
      const extraContexts = await buildPlayerContextMap(
        additionalBoostPlayerIds,
        games,
        scanners,
        deps,
      );
      extraContexts.forEach((value, key) => {
        contextMap.set(key, value);
      });
    }

    const boostedPlayerIds = new Set(currentBoosts.map((boost) => boost.playerId));
    const availableBoostSlots = 4 - boostedPlayerIds.size;

    const personalBoostWindow = Array.from(holdingMap.entries())
      .map(([playerId, holding]) => {
        const context = contextMap.get(playerId);
        if (!context || holding.availableShares < 1 || boostedPlayerIds.has(playerId)) {
          return null;
        }

        if (context.gameStatus === "none" || context.gameStatus === "ended") {
          return null;
        }

        return withSignal(
          context,
          "boost",
          holding.bestShareMultiplier > 1
            ? `${holding.bestShareMultiplier}x multiplier ready for boost`
            : "One share ready for boost",
          holding,
        );
      })
      .filter((entry): entry is MobileMarketSignal => Boolean(entry))
      .sort((left, right) => {
        if (left.gameStatus !== right.gameStatus) {
          if (left.gameStatus === "live") return -1;
          if (right.gameStatus === "live") return 1;
        }

        if ((right.bestShareMultiplier || 1) !== (left.bestShareMultiplier || 1)) {
          return (right.bestShareMultiplier || 1) - (left.bestShareMultiplier || 1);
        }

        if (right.communityBoostCount !== left.communityBoostCount) {
          return right.communityBoostCount - left.communityBoostCount;
        }

        return sortByMarketEnergy(left, right);
      })
      .slice(0, 4)
      .map((entry) => ({
        ...entry,
        note:
          availableBoostSlots > 0
            ? `${availableBoostSlots} slot${availableBoostSlots === 1 ? "" : "s"} still open`
            : entry.note,
      }));

    if (personalBoostWindow.length > 0) {
      boostWindow = personalBoostWindow;
    }

    const watchlistPlayerIds = dedupeIds(watchListIds);
    if (watchlistPlayerIds.length > 0) {
      const watchlistContexts = await buildPlayerContextMap(
        watchlistPlayerIds,
        games,
        scanners,
        deps,
      );
      watchlistMoves = Array.from(watchlistContexts.values())
        .filter((entry) => sport === "ALL" || entry.sport.toUpperCase() === sport)
        .sort((left, right) => {
          const leftAbsMove = Math.abs(left.priceChange24h);
          const rightAbsMove = Math.abs(right.priceChange24h);
          if (rightAbsMove !== leftAbsMove) {
            return rightAbsMove - leftAbsMove;
          }

          return right.poolTvl - left.poolTvl;
        })
        .slice(0, 4)
        .map((entry) => ({
          ...entry,
          note:
            entry.priceChange24h >= 0
              ? `Watchlist up ${roundToTwo(entry.priceChange24h)}%`
              : `Watchlist down ${roundToTwo(Math.abs(entry.priceChange24h))}%`,
          signal: "watchlist" as const,
          availableShares: null,
          bestShareMultiplier: null,
        }));
    }

    return {
      sport,
      pulse: {
        tradeCount15m,
        lowActivity: tradeCount15m < LOW_ACTIVITY_THRESHOLD,
        liveGameCount: games.filter((game) => getEffectiveGameStatus(game, now) === "live").length,
        slateGameCount: games.length,
        openBoostSlots: Math.max(0, 4 - currentBoosts.length),
        generatedAt: now.toISOString(),
      },
      ticker,
      nowMoving: nowMovingContexts,
      boostWindow,
      scoutSurge,
      quietValue,
      watchlistMoves,
    };
  }

  return {
    sport,
    pulse: {
      tradeCount15m,
      lowActivity: tradeCount15m < LOW_ACTIVITY_THRESHOLD,
      liveGameCount: games.filter((game) => getEffectiveGameStatus(game, now) === "live").length,
      slateGameCount: games.length,
      openBoostSlots: null,
      generatedAt: now.toISOString(),
    },
    ticker,
    nowMoving: nowMovingContexts,
    boostWindow,
    scoutSurge,
    quietValue,
    watchlistMoves,
  };
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

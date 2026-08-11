import type { DailyGame, Player } from "@shared/schema";
import { players, scoutAssignments, scoutHistory, trades } from "@shared/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

import { getUserLpPositions } from "./amm/pool";
import { getOrCompute } from "./cache";
import { db } from "./db";
import { getETDayBoundaries, getGameDay } from "./lib/time";
import { storage } from "./storage";
import type { HoldingWithPlayerSummary } from "./storage";
import {
  getCanonicalPlayerMarkets,
  resolveCanonicalPlayerMarket,
  type CanonicalPlayerMarket,
} from "./valuation/canonical-valuation";

type GameStatus = "none" | "upcoming" | "live" | "ended";
type SignalKind =
  | "momentum"
  | "value"
  | "scout"
  | "boost"
  | "watchlist"
  | "ticker"
  | "pool"
  | "activity"
  | "portfolio";
type HeatCheckStatus = "fire" | "ice" | "neutral";
type MarketHealthLabel = "quiet" | "balanced" | "active" | "heated";

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

interface MarketScannerSummary {
  totalVolume24h: number;
  totalPoolShares: number;
  totalMarketTvl: number;
}

interface FinancialMarketScanners {
  undervalued: ScannerEntry[];
  premium: ScannerEntry[];
  sentiment: ScannerEntry[];
  momentum: ScannerEntry[];
  summary?: MarketScannerSummary;
}

interface TopRiserSnapshot {
  playerId: string;
  currentPrice: number;
  priceChange24h: number;
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
  currentPrice: number | null;
  marketStatus: "priced" | "unpriced";
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

export interface PersonalLpEdge {
  playerId: string;
  firstName: string;
  lastName: string;
  team: string;
  position: string;
  ownershipPercentage: number;
  positionValue: number;
  feesEarnedToDate: number;
}

export interface MobileMarketLeaderboards {
  risers: MobileMarketSignal[];
  topPools: MobileMarketSignal[];
  mostActive: MobileMarketSignal[];
  boostWindow: MobileMarketSignal[];
}

export interface MobileMarketIndicators {
  healthScore: number;
  healthLabel: MarketHealthLabel;
  healthSummary: string;
  marketIndex24h: number;
  volatilityIndex: number;
  liquidityHealth: number;
  totalVolume24h: number;
  totalPoolShares: number;
  totalMarketTvl: number;
  breadth: {
    risers: number;
    fallers: number;
    flat: number;
  };
}

export interface MobileMarketPersonalEdge {
  ownedMovers: MobileMarketSignal[];
  watchlistMoves: MobileMarketSignal[];
  boostReady: MobileMarketSignal[];
  lpPositions: PersonalLpEdge[];
}

export interface MobileMarketOverview {
  sport: string;
  pulse: MobileMarketPulse;
  marketIndicators: MobileMarketIndicators;
  ticker: MobileMarketTickerItem[];
  leaderboards: MobileMarketLeaderboards;
  personalEdge: MobileMarketPersonalEdge | null;
  nowMoving: MobileMarketSignal[];
  boostWindow: MobileMarketSignal[];
  scoutSurge: MobileMarketSignal[];
  quietValue: MobileMarketSignal[];
  watchlistMoves: MobileMarketSignal[];
}

export interface MarketMobileOverviewDeps {
  getFinancialMarketScanners: (sport: string) => Promise<FinancialMarketScanners>;
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
  getCanonicalPlayerMarkets?: (playerIds: string[]) => Promise<Map<string, CanonicalPlayerMarket>>;
  getPlayerFinancialMetrics: (playerId: string) => Promise<{
    heatCheck?: { status?: HeatCheckStatus };
  }>;
  getWatchList: (userId: string) => Promise<string[]>;
  getAllHoldingsWithPlayers: (userId: string) => Promise<HoldingWithPlayerSummary[]>;
  getDailyBoostsAllSports: (userId: string, date: Date) => Promise<DailyBoostLike[]>;
  getBatchTotalLockedQuantities: (
    userId: string,
    assetType: string,
    assetIds: string[],
  ) => Promise<Map<string, number>>;
  getTopRisers: (sport: string, limit: number) => Promise<TopRiserSnapshot[]>;
  getRecentTradeCount15m: (sport: string, since: Date) => Promise<number>;
  getTrendingScoutPlayerIds: (sport: string, limit: number, asOf: Date) => Promise<string[]>;
  getTopPoolPlayerIds: (sport: string, limit: number) => Promise<string[]>;
  getUserLpPositions: (userId: string) => Promise<
    Array<{
      playerId: string;
      ownershipPercentage: number;
      positionValue: number;
      feesEarnedToDate: number;
    }>
  >;
  now: () => Date;
}

const WHALE_ALERT_MIN_VALUE = 5000;
const LOW_ACTIVITY_THRESHOLD = 3;
const MARKET_BREADTH_MOVE_THRESHOLD = 0.25;
const compactMetricFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompactCurrency(value: number) {
  return `$${compactMetricFormatter.format(Math.max(0, value))}`;
}

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
  getCanonicalPlayerMarkets,
  getPlayerFinancialMetrics: (playerId) => storage.getPlayerFinancialMetrics(playerId),
  getWatchList: (userId) => storage.getWatchList(userId),
  getAllHoldingsWithPlayers: (userId) => storage.getAllHoldingsWithPlayers(userId),
  getDailyBoostsAllSports: (userId, date) => storage.getDailyBoostsAllSports(userId, date),
  getBatchTotalLockedQuantities: (userId, assetType, assetIds) =>
    storage.getBatchTotalLockedQuantities(userId, assetType, assetIds),
  getTopRisers: async (sport, limit) => {
    const normalizedSport = sport.toUpperCase();
    const sportFilter =
      normalizedSport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${normalizedSport}`;

    const result: any = await db.execute(sql`
      WITH recent AS (
        SELECT
          t.player_id AS player_id,
          FIRST_VALUE(t.price::numeric) OVER (PARTITION BY t.player_id ORDER BY t.executed_at ASC) AS first_price,
          FIRST_VALUE(t.price::numeric) OVER (PARTITION BY t.player_id ORDER BY t.executed_at DESC) AS last_price
        FROM trades t
        INNER JOIN players p ON p.id = t.player_id
        WHERE t.executed_at >= NOW() - INTERVAL '24 hours'
          AND p.is_active = TRUE
          AND ${sportFilter}
      ),
      agg AS (
        SELECT
          DISTINCT
          player_id,
          first_price,
          last_price,
          CASE
            WHEN first_price > 0 THEN ((last_price - first_price) / first_price) * 100
            ELSE 0
          END AS pct_change
        FROM recent
      )
      SELECT
        a.player_id AS "playerId",
        (a.last_price)::float8 AS "currentPrice",
        (a.pct_change)::float8 AS "priceChange24h"
      FROM agg a
      WHERE a.pct_change > 0
      ORDER BY a.pct_change DESC
      LIMIT ${limit};
    `);

    return (result?.rows || []).map((row: any) => ({
      playerId: String(row.playerId || ""),
      currentPrice:
        typeof row.currentPrice === "number"
          ? row.currentPrice
          : row.currentPrice != null
            ? parseFloat(row.currentPrice)
            : 0,
      priceChange24h:
        typeof row.priceChange24h === "number"
          ? row.priceChange24h
          : row.priceChange24h != null
            ? parseFloat(row.priceChange24h)
            : 0,
    }));
  },
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
  getTopPoolPlayerIds: async (sport, limit) => {
    const normalizedSport = sport.toUpperCase();
    const sportFilter =
      normalizedSport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${normalizedSport}`;

    const result: any = await db.execute(sql`
      SELECT pp.player_id AS "playerId"
      FROM player_pools pp
      INNER JOIN players p ON p.id = pp.player_id
      WHERE p.is_active = TRUE
        AND ${sportFilter}
      ORDER BY (
        CASE
          WHEN (pp.shares)::numeric > 0 THEN (pp.play_money)::numeric * 2
          ELSE (pp.play_money)::numeric
        END
      ) DESC
      LIMIT ${limit};
    `);

    return (result?.rows || [])
      .map((row: any) => String(row.playerId || ""))
      .filter((playerId: string) => playerId.length > 0);
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
  getUserLpPositions: (userId) => getUserLpPositions(userId),
  now: () => new Date(),
};

type PlayerContext = {
  playerId: string;
  firstName: string;
  lastName: string;
  sport: string;
  team: string;
  position: string;
  currentPrice: number | null;
  marketStatus: "priced" | "unpriced";
  priceChange24h: number;
  volume24h: number;
  poolTvl: number;
  poolShares: number;
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
  scanners: FinancialMarketScanners,
  deps: MarketMobileOverviewDeps,
): Promise<Map<string, PlayerContext>> {
  const dedupedPlayerIds = dedupeIds(playerIds);
  if (dedupedPlayerIds.length === 0) {
    return new Map();
  }

  const [playersById, poolMap, scoutCountMap, canonicalMarkets] = await Promise.all([
    deps.getPlayersByIds(dedupedPlayerIds),
    deps.getBatchPoolData(dedupedPlayerIds),
    deps.getBatchActiveScoutCounts(dedupedPlayerIds),
    deps.getCanonicalPlayerMarkets
      ? deps.getCanonicalPlayerMarkets(dedupedPlayerIds)
      : Promise.resolve(new Map<string, CanonicalPlayerMarket>()),
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
    const canonicalMarket =
      canonicalMarkets.get(player.id) || resolveCanonicalPlayerMarket({ player, pool });
    const currentPrice = canonicalMarket.marketPrice;
    const marketStatus = canonicalMarket.marketStatus;
    const poolTvl = canonicalMarket.poolTvl ?? 0;

    contextMap.set(player.id, {
      playerId: player.id,
      firstName: player.firstName,
      lastName: player.lastName,
      sport: player.sport,
      team: player.team,
      position: player.position,
      currentPrice,
      marketStatus,
      priceChange24h: toNumber(player.priceChange24h),
      volume24h: Number(player.volume24h || 0),
      poolTvl,
      poolShares: pool?.shares || 0,
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
      bestShareMultiplier: 1,
    };
    const quantity = toNumber(holding.quantity);
    current.regularShares += quantity;
    current.bestShareMultiplier = 1;
    grouped.set(holding.player.id, current);
  }

  const result = new Map<string, HoldingContext>();
  const lockedQuantities = await deps.getBatchTotalLockedQuantities(
    userId,
    "player",
    Array.from(grouped.keys()),
  );

  for (const [playerId, context] of grouped) {
    const locked = lockedQuantities.get(playerId) || 0;
    const availableRegularShares = Math.max(0, context.regularShares - locked);

    result.set(playerId, {
      availableShares: availableRegularShares,
      bestShareMultiplier: context.bestShareMultiplier,
    });
  }

  return result;
}

async function buildMobileMarketOverviewInternal(
  params: {
    sport?: string | null;
    userId?: string | null;
  },
  deps: MarketMobileOverviewDeps,
): Promise<MobileMarketOverview> {
  const sport = (params.sport || "ALL").toUpperCase();
  const now = deps.now();
  const todayET = getGameDay(now);
  const { startOfDay, endOfDay } = getETDayBoundaries(todayET);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

  const [
    scanners,
    activity,
    games,
    tradeCount15m,
    topRisers,
    trendingScoutPlayerIds,
    communityBoosts,
    topPoolPlayerIds,
  ] = await Promise.all([
    deps.getFinancialMarketScanners(sport),
    deps.getMarketActivity({ sport, limit: 24 }),
    deps.getDailyGames(sport, startOfDay, endOfDay),
    deps.getRecentTradeCount15m(sport, new Date(now.getTime() - 15 * 60 * 1000)),
    deps.getTopRisers(sport, 6),
    deps.getTrendingScoutPlayerIds(sport, 6, now),
    deps.getCommunityBoostsAllSports(targetDate),
    deps.getTopPoolPlayerIds(sport, 6),
  ]);

  const primaryCandidateIds = dedupeIds([
    ...topRisers.map((entry) => entry.playerId),
    ...scanners.momentum.map((entry) => entry.player.id),
    ...scanners.undervalued.map((entry) => entry.player.id),
    ...activity.map((entry) => entry.playerId as string),
    ...trendingScoutPlayerIds,
    ...communityBoosts.map((entry) => entry.playerId),
    ...topPoolPlayerIds,
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
      const price =
        context?.marketStatus === "priced" && context.currentPrice != null
          ? context.currentPrice
          : 0;
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

  const rankedTopRisers = topRisers
    .map((entry) => {
      const context = contextMap.get(entry.playerId);
      const signal = withSignal(
        context,
        "momentum",
        `${entry.priceChange24h >= 0 ? "+" : ""}${roundToTwo(entry.priceChange24h)}% in the last 24h`,
      );

      if (!signal) {
        return null;
      }

      return {
        ...signal,
        currentPrice: signal.currentPrice,
        priceChange24h: roundToTwo(entry.priceChange24h),
      } satisfies MobileMarketSignal;
    })
    .filter((entry): entry is MobileMarketSignal => Boolean(entry))
    .sort(sortByTopRiser);

  const fallbackMomentum = scanners.momentum
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
    .sort(sortByTopRiser);

  const nowMovingContexts: MobileMarketSignal[] = [];
  const seenRisers = new Set<string>();

  for (const entry of [...rankedTopRisers, ...fallbackMomentum]) {
    if (seenRisers.has(entry.playerId)) {
      continue;
    }

    seenRisers.add(entry.playerId);
    nowMovingContexts.push(entry);

    if (nowMovingContexts.length === 4) {
      break;
    }
  }

  const quietValue = scanners.undervalued
    .slice(0, 8)
    .map((entry) => {
      const context = contextMap.get(entry.player.id);
      return withSignal(
        context,
        "value",
        `Model value index ${roundToTwo(context?.valueIndex || 0)}`,
      );
    })
    .filter((entry): entry is MobileMarketSignal => Boolean(entry))
    .sort((left, right) => {
      if (left.valueIndex !== right.valueIndex) {
        return left.valueIndex - right.valueIndex;
      }

      return left.poolTvl - right.poolTvl;
    })
    .slice(0, 4);

  const topPools = topPoolPlayerIds
    .map((playerId) =>
      withSignal(
        contextMap.get(playerId),
        "pool",
        `TVL ${formatCompactCurrency(contextMap.get(playerId)?.poolTvl || 0)}`,
      ),
    )
    .filter((entry): entry is MobileMarketSignal => Boolean(entry))
    .sort((left, right) => {
      if (right.poolTvl !== left.poolTvl) {
        return right.poolTvl - left.poolTvl;
      }

      return sortByMarketEnergy(left, right);
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

  const marketIndicators = buildMarketIndicators({
    contexts: Array.from(contextMap.values()),
    tradeCount15m,
    liveGameCount: games.filter((game) => getEffectiveGameStatus(game, now) === "live").length,
    summary: scanners.summary,
  });

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

  const mostActive = activity
    .map((entry) => {
      const context = contextMap.get(entry.playerId);
      if (!context) {
        return null;
      }

      const quantity = Number(entry.quantity || 0);
      const price =
        context.marketStatus === "priced" && context.currentPrice != null
          ? context.currentPrice
          : 0;
      const notional = roundToTwo(quantity * price);
      const note =
        notional >= WHALE_ALERT_MIN_VALUE
          ? `Whale print ${quantity} sh / ${formatCompactCurrency(notional)}`
          : `${quantity} sh printed`;

      return withSignal(context, "activity", note);
    })
    .filter((entry): entry is MobileMarketSignal => Boolean(entry))
    .slice(0, 4);

  if (params.userId) {
    const [watchListIds, holdingMap, currentBoosts, lpPositions] = await Promise.all([
      deps.getWatchList(params.userId),
      buildHoldingContextMap(params.userId, deps),
      deps.getDailyBoostsAllSports(params.userId, targetDate),
      deps.getUserLpPositions(params.userId),
    ]);

    const additionalPlayerIds = dedupeIds([
      ...Array.from(holdingMap.keys()),
      ...watchListIds,
      ...lpPositions.map((position) => position.playerId),
    ]).filter((playerId) => !contextMap.has(playerId));

    if (additionalPlayerIds.length > 0) {
      const extraContexts = await buildPlayerContextMap(additionalPlayerIds, games, scanners, deps);
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

    const ownedMovers = Array.from(holdingMap.entries())
      .map(([playerId, holding]) => {
        const context = contextMap.get(playerId);
        if (!context || holding.availableShares <= 0) {
          return null;
        }

        return withSignal(
          context,
          "portfolio",
          holding.bestShareMultiplier > 1
            ? `${holding.bestShareMultiplier}x stack on hand`
            : `${roundToTwo(holding.availableShares)} share${holding.availableShares === 1 ? "" : "s"} ready`,
          holding,
        );
      })
      .filter((entry): entry is MobileMarketSignal => Boolean(entry))
      .sort((left, right) => {
        if ((right.bestShareMultiplier || 1) !== (left.bestShareMultiplier || 1)) {
          return (right.bestShareMultiplier || 1) - (left.bestShareMultiplier || 1);
        }

        return sortByAbsoluteMove(left, right);
      })
      .slice(0, 4);

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
        .sort(sortByAbsoluteMove)
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

    const lpPositionPlayers = await deps.getPlayersByIds(
      dedupeIds(lpPositions.map((position) => position.playerId)),
    );
    const lpPlayerMap = new Map(lpPositionPlayers.map((player) => [player.id, player]));
    const lpEdges = lpPositions
      .map((position) => {
        const player = lpPlayerMap.get(position.playerId);
        if (!player) {
          return null;
        }

        return {
          playerId: position.playerId,
          firstName: player.firstName,
          lastName: player.lastName,
          team: player.team,
          position: player.position,
          ownershipPercentage: position.ownershipPercentage,
          positionValue: position.positionValue,
          feesEarnedToDate: position.feesEarnedToDate,
        } satisfies PersonalLpEdge;
      })
      .filter((entry): entry is PersonalLpEdge => Boolean(entry))
      .sort((left, right) => {
        if (right.feesEarnedToDate !== left.feesEarnedToDate) {
          return right.feesEarnedToDate - left.feesEarnedToDate;
        }

        return right.positionValue - left.positionValue;
      })
      .slice(0, 3);

    const personalEdge =
      ownedMovers.length > 0 ||
      watchlistMoves.length > 0 ||
      personalBoostWindow.length > 0 ||
      lpEdges.length > 0
        ? {
            ownedMovers,
            watchlistMoves,
            boostReady: personalBoostWindow,
            lpPositions: lpEdges,
          }
        : null;

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
      marketIndicators,
      ticker,
      leaderboards: {
        risers: nowMovingContexts,
        topPools,
        mostActive,
        boostWindow,
      },
      personalEdge,
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
    marketIndicators,
    ticker,
    leaderboards: {
      risers: nowMovingContexts,
      topPools,
      mostActive,
      boostWindow,
    },
    personalEdge: null,
    nowMoving: nowMovingContexts,
    boostWindow,
    scoutSurge,
    quietValue,
    watchlistMoves,
  };
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

function sortByAbsoluteMove(
  left: Pick<PlayerContext, "priceChange24h" | "poolTvl">,
  right: Pick<PlayerContext, "priceChange24h" | "poolTvl">,
) {
  const leftAbsMove = Math.abs(left.priceChange24h);
  const rightAbsMove = Math.abs(right.priceChange24h);

  if (rightAbsMove !== leftAbsMove) {
    return rightAbsMove - leftAbsMove;
  }

  return right.poolTvl - left.poolTvl;
}

function sortByTopRiser(
  left: Pick<PlayerContext, "priceChange24h" | "poolTvl">,
  right: Pick<PlayerContext, "priceChange24h" | "poolTvl">,
) {
  const leftPositive = left.priceChange24h > 0 ? 1 : 0;
  const rightPositive = right.priceChange24h > 0 ? 1 : 0;

  if (rightPositive !== leftPositive) {
    return rightPositive - leftPositive;
  }

  if (right.priceChange24h !== left.priceChange24h) {
    return right.priceChange24h - left.priceChange24h;
  }

  return right.poolTvl - left.poolTvl;
}

function getMarketHealthSummary(label: MarketHealthLabel) {
  switch (label) {
    case "quiet":
      return "Composite tape read: light flow and softer movement.";
    case "balanced":
      return "Composite tape read: steady flow with usable depth.";
    case "active":
      return "Composite tape read: strong flow with broad movement.";
    case "heated":
      return "Composite tape read: crowded tape with sharp movement.";
  }
}

function buildMarketIndicators(params: {
  contexts: PlayerContext[];
  tradeCount15m: number;
  liveGameCount: number;
  summary?: MarketScannerSummary;
}): MobileMarketIndicators {
  const { contexts, tradeCount15m, liveGameCount, summary } = params;
  const breadth = contexts.reduce(
    (accumulator, context) => {
      if (context.priceChange24h > MARKET_BREADTH_MOVE_THRESHOLD) {
        accumulator.risers += 1;
      } else if (context.priceChange24h < MARKET_BREADTH_MOVE_THRESHOLD * -1) {
        accumulator.fallers += 1;
      } else {
        accumulator.flat += 1;
      }

      return accumulator;
    },
    { risers: 0, fallers: 0, flat: 0 },
  );

  const marketIndex24h =
    contexts.length > 0
      ? roundToTwo(
          contexts.reduce((total, context) => total + context.priceChange24h, 0) / contexts.length,
        )
      : 0;
  const averageAbsoluteMove =
    contexts.length > 0
      ? contexts.reduce((total, context) => total + Math.abs(context.priceChange24h), 0) /
        contexts.length
      : 0;
  const moveVariance =
    contexts.length > 0
      ? contexts.reduce(
          (total, context) => total + Math.pow(context.priceChange24h - marketIndex24h, 2),
          0,
        ) / contexts.length
      : 0;
  const moveStandardDeviation = Math.sqrt(moveVariance);
  const totalVolume24h = roundToTwo(
    summary?.totalVolume24h ??
      contexts.reduce((total, context) => total + Math.max(0, context.volume24h), 0),
  );
  const totalPoolShares = roundToTwo(
    summary?.totalPoolShares ??
      contexts.reduce((total, context) => total + Math.max(0, context.poolShares), 0),
  );
  const totalMarketTvl = roundToTwo(
    summary?.totalMarketTvl ??
      contexts.reduce((total, context) => total + Math.max(0, context.poolTvl), 0),
  );
  const averagePoolTvl = contexts.length > 0 ? totalMarketTvl / contexts.length : 0;
  const deepPoolShare =
    contexts.length > 0
      ? contexts.filter((context) => context.poolTvl >= 100000).length / contexts.length
      : 0;
  const volatilityIndex = roundToTwo(
    Math.max(0, Math.min(100, averageAbsoluteMove * 4 + moveStandardDeviation * 6)),
  );
  const liquidityHealth = roundToTwo(
    Math.max(
      0,
      Math.min(100, averagePoolTvl / 4000 + deepPoolShare * 35 + Math.min(20, tradeCount15m * 3)),
    ),
  );
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        Math.min(45, tradeCount15m * 8) +
          Math.min(30, volatilityIndex * 0.35) +
          Math.min(25, liveGameCount * 8),
      ),
    ),
  );
  let healthLabel: MarketHealthLabel = "quiet";

  if (healthScore >= 75) {
    healthLabel = "heated";
  } else if (healthScore >= 50) {
    healthLabel = "active";
  } else if (healthScore >= 25) {
    healthLabel = "balanced";
  }

  return {
    healthScore,
    healthLabel,
    healthSummary: getMarketHealthSummary(healthLabel),
    marketIndex24h,
    volatilityIndex,
    liquidityHealth,
    totalVolume24h,
    totalPoolShares,
    totalMarketTvl,
    breadth,
  };
}

export async function buildMobileMarketOverview(
  params: {
    sport?: string | null;
    userId?: string | null;
  },
  deps: MarketMobileOverviewDeps = defaultDeps,
): Promise<MobileMarketOverview> {
  if (!params.userId && deps === defaultDeps) {
    const sport = (params.sport || "ALL").toUpperCase();
    return getOrCompute(
      `market:mobile-overview:public:${sport}`,
      () => buildMobileMarketOverviewInternal({ ...params, sport, userId: null }, deps),
      60_000,
    );
  }

  return buildMobileMarketOverviewInternal(params, deps);
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

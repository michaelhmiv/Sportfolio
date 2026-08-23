import { and, eq, inArray, sql } from "drizzle-orm";
import { holdings, holdingsLocks, lpPositions, playerPools, players, users } from "@shared/schema";
import { db } from "../db";

export const VALUATION_VERSION = "amm_liquid_v2";

export type MarketStatus = "priced" | "unpriced";

export type CanonicalPlayerMarket = {
  playerId: string;
  marketStatus: MarketStatus;
  marketPrice: number | null;
  priceSource: "amm_spot" | null;
  poolInitialized: boolean;
  shareReserve: number | null;
  playMoneyReserve: number | null;
  poolTvl: number | null;
  lastTradePrice: number | null;
  liquidUserShares: number;
  liquidSharesOutstanding: number;
  marketCap: number | null;
  warnings: string[];
  diagnostics: string[];
};

export type CanonicalPlayerPosition = {
  playerId: string;
  player: Record<string, unknown>;
  holdingId: string | null;
  singles: number;
  lockedSingles: number;
  availableSingles: number;
  averageCostBasis: number;
  costBasis: number;
  marketStatus: MarketStatus;
  marketPrice: number | null;
  priceSource: "amm_spot" | null;
  marketValue: number | null;
  unrealizedChange: number | null;
  unrealizedChangePercent: number | null;
  lastTradePrice: number | null;
  poolInitialized: boolean;
  poolTvl: number | null;
};

export type CanonicalLpPosition = {
  id: string;
  playerId: string;
  lpShares: number;
  poolOwnershipPercent: number;
  underlyingShares: number;
  underlyingPlayMoney: number;
  marketValue: number | null;
  marketStatus: MarketStatus;
  player: Record<string, unknown>;
};

export type CanonicalPortfolioValuation = {
  valuationVersion: typeof VALUATION_VERSION;
  userId: string;
  cashBalance: number;
  singlesMarketValue: number;
  lpMarketValue: number;
  portfolioValue: number;
  netWorth: number;
  positionCount: number;
  pricedPositionCount: number;
  unpricedPositionCount: number;
  unpricedSingles: number;
  totalSingles: number;
  positions: CanonicalPlayerPosition[];
  lpPositions: CanonicalLpPosition[];
  warnings: string[];
};

export type CanonicalPortfolioTotals = Pick<
  CanonicalPortfolioValuation,
  | "valuationVersion"
  | "cashBalance"
  | "singlesMarketValue"
  | "lpMarketValue"
  | "portfolioValue"
  | "netWorth"
  | "totalSingles"
  | "pricedPositionCount"
  | "unpricedPositionCount"
  | "unpricedSingles"
>;

type PlayerLike = {
  id: string;
  lastTradePrice?: unknown;
  currentPrice?: unknown;
  marketCap?: unknown;
  [key: string]: unknown;
};

type PoolLike = {
  shares?: unknown;
  playMoney?: unknown;
  lpSharesTotal?: unknown;
};

type HoldingLike = {
  id: string;
  assetId: string;
  quantity: unknown;
  avgCostBasis: unknown;
  totalCostBasis: unknown;
  lockedSingles?: unknown;
  player: PlayerLike;
};

type LpLike = {
  id: string;
  playerId: string;
  lpShares: unknown;
  player: PlayerLike;
  pool: PoolLike | null;
};

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableFinite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.01, Math.abs(right) * 0.0001);
}

let driftWarningLastLoggedAt = 0;
const DRIFT_WARNING_LOG_INTERVAL_MS = 5 * 60 * 1000;
const DRIFT_WARNING_SAMPLE_SIZE = 10;

function logMarketDriftBatch(markets: Iterable<CanonicalPlayerMarket>): void {
  const drifted = Array.from(markets).filter(
    (market) => market.diagnostics.length > 0 || market.warnings.length > 0,
  );
  if (!drifted.length) return;
  const now = Date.now();
  if (now - driftWarningLastLoggedAt < DRIFT_WARNING_LOG_INTERVAL_MS) return;
  driftWarningLastLoggedAt = now;

  console.warn("[canonical_valuation] Market-state drift summary", {
    marketCount: drifted.length,
    warningCount: drifted.reduce(
      (sum, market) => sum + market.diagnostics.length + market.warnings.length,
      0,
    ),
    samples: drifted.slice(0, DRIFT_WARNING_SAMPLE_SIZE).map((market) => ({
      playerId: market.playerId,
      warnings: [...market.warnings, ...market.diagnostics],
    })),
    omittedMarketCount: Math.max(0, drifted.length - DRIFT_WARNING_SAMPLE_SIZE),
  });
}

export function getCanonicalPortfolioTotals(
  valuation: CanonicalPortfolioValuation,
): CanonicalPortfolioTotals {
  return {
    valuationVersion: valuation.valuationVersion,
    cashBalance: valuation.cashBalance,
    singlesMarketValue: valuation.singlesMarketValue,
    lpMarketValue: valuation.lpMarketValue,
    portfolioValue: valuation.portfolioValue,
    netWorth: valuation.netWorth,
    totalSingles: valuation.totalSingles,
    pricedPositionCount: valuation.pricedPositionCount,
    unpricedPositionCount: valuation.unpricedPositionCount,
    unpricedSingles: valuation.unpricedSingles,
  };
}

export function resolveCanonicalPlayerMarket(input: {
  player: PlayerLike;
  pool?: PoolLike | null;
  liquidUserShares?: number;
}): CanonicalPlayerMarket {
  const { player, pool = null } = input;
  const liquidUserShares = Math.max(0, finite(input.liquidUserShares));
  const lastTradePrice = nullableFinite(player.lastTradePrice);
  const warnings: string[] = [];
  const diagnostics: string[] = [];

  if (!pool) {
    return {
      playerId: player.id,
      marketStatus: "unpriced",
      marketPrice: null,
      priceSource: null,
      poolInitialized: false,
      shareReserve: null,
      playMoneyReserve: null,
      poolTvl: null,
      lastTradePrice,
      liquidUserShares,
      liquidSharesOutstanding: liquidUserShares,
      marketCap: null,
      warnings,
      diagnostics,
    };
  }

  const shareReserve = finite(pool.shares, Number.NaN);
  const playMoneyReserve = finite(pool.playMoney, Number.NaN);
  if (!(shareReserve > 0) || !(playMoneyReserve > 0)) {
    warnings.push(
      `Player ${player.id} has an invalid AMM pool (${shareReserve} shares / ${playMoneyReserve} SB); the market is unpriced.`,
    );
    return {
      playerId: player.id,
      marketStatus: "unpriced",
      marketPrice: null,
      priceSource: null,
      poolInitialized: true,
      shareReserve: Number.isFinite(shareReserve) ? shareReserve : null,
      playMoneyReserve: Number.isFinite(playMoneyReserve) ? playMoneyReserve : null,
      poolTvl: null,
      lastTradePrice,
      liquidUserShares,
      liquidSharesOutstanding: liquidUserShares + Math.max(0, finite(shareReserve)),
      marketCap: null,
      warnings,
      diagnostics,
    };
  }

  const marketPrice = playMoneyReserve / shareReserve;
  const poolTvl = playMoneyReserve + shareReserve * marketPrice;
  const liquidSharesOutstanding = liquidUserShares + shareReserve;
  const marketCap = marketPrice * liquidSharesOutstanding;
  // Persisted currentPrice is denormalized observability state. Canonical valuation
  // is derived from live AMM reserves, so drift is diagnostic-only and must never
  // become a user-facing portfolio warning or invalidate an MCP presentation.
  const persistedPrice = nullableFinite(player.currentPrice);
  if (persistedPrice != null && !approximatelyEqual(persistedPrice, marketPrice)) {
    diagnostics.push(
      `Player ${player.id} persisted currentPrice ${persistedPrice} differs from AMM spot ${marketPrice}.`,
    );
  }

  // players.marketCap is a legacy denormalized column and is not a canonical live
  // input. Live market-cap surfaces already derive value from AMM spot and liquid
  // supply; comparing the legacy column here generated one false warning per market.

  return {
    playerId: player.id,
    marketStatus: "priced",
    marketPrice,
    priceSource: "amm_spot",
    poolInitialized: true,
    shareReserve,
    playMoneyReserve,
    poolTvl,
    lastTradePrice,
    liquidUserShares,
    liquidSharesOutstanding,
    marketCap,
    warnings,
    diagnostics,
  };
}

export function resolveCanonicalPlayerMarketBatch(
  inputs: Array<{ player: PlayerLike; pool?: PoolLike | null; liquidUserShares?: number }>,
): Map<string, CanonicalPlayerMarket> {
  return new Map(
    inputs.map((input) => {
      const market = resolveCanonicalPlayerMarket(input);
      return [market.playerId, market];
    }),
  );
}

export function calculateCanonicalPortfolio(input: {
  userId: string;
  cashBalance: number;
  holdings: HoldingLike[];
  lpPositions?: LpLike[];
  markets: Map<string, CanonicalPlayerMarket>;
}): CanonicalPortfolioValuation {
  const warnings: string[] = [];
  const positionsByPlayer = new Map<string, { holding?: HoldingLike; player: PlayerLike }>();

  for (const holding of input.holdings) {
    if (positionsByPlayer.get(holding.assetId)?.holding) {
      warnings.push(`Duplicate Singles position loaded for player ${holding.assetId}.`);
    }
    positionsByPlayer.set(holding.assetId, {
      ...positionsByPlayer.get(holding.assetId),
      holding,
      player: holding.player,
    });
  }

  const positions: CanonicalPlayerPosition[] = [];
  for (const [playerId, row] of positionsByPlayer) {
    const market = input.markets.get(playerId);
    if (!market) {
      warnings.push(`No canonical market state was loaded for player ${playerId}.`);
      continue;
    }
    warnings.push(...market.warnings);
    const singles = Math.max(0, finite(row.holding?.quantity));
    const lockedSingles = Math.min(singles, Math.max(0, finite(row.holding?.lockedSingles)));
    const costBasis = Math.max(0, finite(row.holding?.totalCostBasis));
    const averageCostBasis =
      singles > 0 ? finite(row.holding?.avgCostBasis, costBasis / singles) : 0;
    const marketValue = market.marketPrice == null ? null : singles * market.marketPrice;
    const unrealizedChange = marketValue == null ? null : marketValue - costBasis;
    positions.push({
      playerId,
      player: row.player,
      holdingId: row.holding?.id || null,
      singles,
      lockedSingles,
      availableSingles: Math.max(0, singles - lockedSingles),
      averageCostBasis,
      costBasis,
      marketStatus: market.marketStatus,
      marketPrice: market.marketPrice,
      priceSource: market.priceSource,
      marketValue,
      unrealizedChange,
      unrealizedChangePercent:
        unrealizedChange == null || costBasis <= 0 ? null : (unrealizedChange / costBasis) * 100,
      lastTradePrice: market.lastTradePrice,
      poolInitialized: market.poolInitialized,
      poolTvl: market.poolTvl,
    });
  }

  const canonicalLpPositions: CanonicalLpPosition[] = (input.lpPositions || []).map((position) => {
    const market = input.markets.get(position.playerId);
    const pool = position.pool;
    const lpShares = Math.max(0, finite(position.lpShares));
    const totalLpShares = Math.max(0, finite(pool?.lpSharesTotal));
    const ownership = totalLpShares > 0 ? lpShares / totalLpShares : 0;
    const underlyingShares = ownership * Math.max(0, finite(pool?.shares));
    const underlyingPlayMoney = ownership * Math.max(0, finite(pool?.playMoney));
    const marketValue =
      market?.marketPrice == null
        ? null
        : underlyingPlayMoney + underlyingShares * market.marketPrice;
    if (lpShares > 0 && totalLpShares <= 0) {
      warnings.push(`LP position ${position.id} has no positive pool LP supply.`);
    }
    return {
      id: position.id,
      playerId: position.playerId,
      lpShares,
      poolOwnershipPercent: ownership * 100,
      underlyingShares,
      underlyingPlayMoney,
      marketValue,
      marketStatus: market?.marketStatus || "unpriced",
      player: position.player,
    };
  });

  positions.sort((left, right) => (right.marketValue || 0) - (left.marketValue || 0));
  const singlesMarketValue = positions.reduce(
    (total, position) => total + (position.marketValue || 0),
    0,
  );
  const lpMarketValue = canonicalLpPositions.reduce(
    (total, position) => total + (position.marketValue || 0),
    0,
  );
  const portfolioValue = singlesMarketValue + lpMarketValue;

  return {
    valuationVersion: VALUATION_VERSION,
    userId: input.userId,
    cashBalance: input.cashBalance,
    singlesMarketValue,
    lpMarketValue,
    portfolioValue,
    netWorth: input.cashBalance + portfolioValue,
    positionCount: positions.length,
    pricedPositionCount: positions.filter(
      (position) => position.singles > 0 && position.marketStatus === "priced",
    ).length,
    unpricedPositionCount: positions.filter(
      (position) => position.singles > 0 && position.marketStatus === "unpriced",
    ).length,
    unpricedSingles: positions.reduce(
      (total, position) => total + (position.marketStatus === "unpriced" ? position.singles : 0),
      0,
    ),
    totalSingles: positions.reduce((total, position) => total + position.singles, 0),
    positions,
    lpPositions: canonicalLpPositions,
    warnings: Array.from(new Set(warnings)),
  };
}

export async function getCanonicalPlayerMarkets(
  playerIds: string[],
): Promise<Map<string, CanonicalPlayerMarket>> {
  const uniqueIds = Array.from(new Set(playerIds.filter(Boolean)));
  if (!uniqueIds.length) return new Map();
  const [playerRows, poolRows, holdingRows] = await Promise.all([
    db.select().from(players).where(inArray(players.id, uniqueIds)),
    db.select().from(playerPools).where(inArray(playerPools.playerId, uniqueIds)),
    db
      .select({
        playerId: holdings.assetId,
        total: sql<string>`COALESCE(SUM(${holdings.quantity}::numeric), 0)::text`,
      })
      .from(holdings)
      .where(and(eq(holdings.assetType, "player"), inArray(holdings.assetId, uniqueIds)))
      .groupBy(holdings.assetId),
  ]);
  const poolsByPlayer = new Map(poolRows.map((pool) => [pool.playerId, pool]));
  const holdingsByPlayer = new Map(holdingRows.map((row) => [row.playerId, finite(row.total)]));
  const result = resolveCanonicalPlayerMarketBatch(
    playerRows.map((player) => ({
      player,
      pool: poolsByPlayer.get(player.id) || null,
      liquidUserShares: holdingsByPlayer.get(player.id) || 0,
    })),
  );
  logMarketDriftBatch(result.values());
  return result;
}

export async function getCanonicalPlayerMarket(
  playerId: string,
): Promise<CanonicalPlayerMarket | null> {
  return (await getCanonicalPlayerMarkets([playerId])).get(playerId) || null;
}

export async function getCanonicalPortfolioValuation(
  userId: string,
): Promise<CanonicalPortfolioValuation | null> {
  const [userRows, holdingRows, lpRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({
        id: holdings.id,
        assetId: holdings.assetId,
        quantity: holdings.quantity,
        avgCostBasis: holdings.avgCostBasis,
        totalCostBasis: holdings.totalCostBasis,
        lockedSingles: sql<string>`COALESCE(SUM(${holdingsLocks.lockedQuantity}::numeric), 0)::text`,
        player: players,
      })
      .from(holdings)
      .innerJoin(players, eq(holdings.assetId, players.id))
      .leftJoin(
        holdingsLocks,
        and(
          eq(holdingsLocks.userId, holdings.userId),
          eq(holdingsLocks.assetType, holdings.assetType),
          eq(holdingsLocks.assetId, holdings.assetId),
        ),
      )
      .where(and(eq(holdings.userId, userId), eq(holdings.assetType, "player")))
      .groupBy(holdings.id, players.id),
    db
      .select({
        id: lpPositions.id,
        playerId: lpPositions.playerId,
        lpShares: lpPositions.lpShares,
        player: players,
        pool: playerPools,
      })
      .from(lpPositions)
      .innerJoin(players, eq(lpPositions.playerId, players.id))
      .leftJoin(playerPools, eq(lpPositions.playerId, playerPools.playerId))
      .where(eq(lpPositions.userId, userId)),
  ]);
  const user = userRows[0];
  if (!user) return null;
  const playerIds = [
    ...holdingRows.map((row) => row.assetId),
    ...lpRows.map((row) => row.playerId),
  ];
  const markets = await getCanonicalPlayerMarkets(playerIds);
  return calculateCanonicalPortfolio({
    userId,
    cashBalance: finite(user.balance),
    holdings: holdingRows,
    lpPositions: lpRows,
    markets,
  });
}

export async function getAllCanonicalPortfolioValues(): Promise<
  Array<{
    userId: string;
    balance: string;
    singlesMarketValue: number;
    lpMarketValue: number;
    portfolioValue: number;
    netWorth: number;
  }>
> {
  const result: any = await db.execute(sql`
    WITH valid_pools AS (
      SELECT
        ${playerPools.playerId} AS player_id,
        ${playerPools.shares}::numeric AS share_reserve,
        ${playerPools.playMoney}::numeric AS play_money_reserve,
        ${playerPools.lpSharesTotal}::numeric AS lp_shares_total,
        (${playerPools.playMoney}::numeric / NULLIF(${playerPools.shares}::numeric, 0)) AS spot_price
      FROM ${playerPools}
      WHERE ${playerPools.shares}::numeric > 0
        AND ${playerPools.playMoney}::numeric > 0
    ),
    singles_values AS (
      SELECT
        ${holdings.userId} AS user_id,
        SUM(${holdings.quantity}::numeric * vp.spot_price) AS value
      FROM ${holdings}
      INNER JOIN valid_pools vp ON vp.player_id = ${holdings.assetId}
      WHERE ${holdings.assetType} = 'player'
      GROUP BY ${holdings.userId}
    ),
    lp_values AS (
      SELECT
        ${lpPositions.userId} AS user_id,
        SUM(
          CASE WHEN vp.lp_shares_total > 0
            THEN (${lpPositions.lpShares}::numeric / vp.lp_shares_total)
              * (vp.play_money_reserve + vp.share_reserve * vp.spot_price)
            ELSE 0
          END
        ) AS value
      FROM ${lpPositions}
      INNER JOIN valid_pools vp ON vp.player_id = ${lpPositions.playerId}
      GROUP BY ${lpPositions.userId}
    )
    SELECT
      ${users.id} AS user_id,
      ${users.balance}::text AS balance,
      COALESCE(sv.value, 0)::text AS singles_market_value,
      COALESCE(lv.value, 0)::text AS lp_market_value,
      (COALESCE(sv.value, 0) + COALESCE(lv.value, 0))::text AS portfolio_value,
      (${users.balance}::numeric + COALESCE(sv.value, 0) + COALESCE(lv.value, 0))::text AS net_worth
    FROM ${users}
    LEFT JOIN singles_values sv ON sv.user_id = ${users.id}
    LEFT JOIN lp_values lv ON lv.user_id = ${users.id}
    WHERE ${users.deletedAt} IS NULL
  `);
  const rows = result?.rows ?? result;
  return rows.map((row: any) => ({
    userId: row.user_id ?? row.userId,
    balance: row.balance,
    singlesMarketValue: finite(row.singles_market_value ?? row.singlesMarketValue),
    lpMarketValue: finite(row.lp_market_value ?? row.lpMarketValue),
    portfolioValue: finite(row.portfolio_value ?? row.portfolioValue),
    netWorth: finite(row.net_worth ?? row.netWorth),
  }));
}

export async function getCanonicalMarketTotals(): Promise<{
  marketCap: number;
  totalLiquidShares: number;
}> {
  const result: any = await db.execute(sql`
    WITH liquid_user_shares AS (
      SELECT ${holdings.assetId} AS player_id, SUM(${holdings.quantity}::numeric) AS shares
      FROM ${holdings}
      WHERE ${holdings.assetType} = 'player'
      GROUP BY ${holdings.assetId}
    )
    SELECT
      COALESCE(SUM(
        (${playerPools.playMoney}::numeric / NULLIF(${playerPools.shares}::numeric, 0))
        * (COALESCE(lus.shares, 0) + ${playerPools.shares}::numeric)
      ), 0)::text AS market_cap,
      COALESCE(SUM(COALESCE(lus.shares, 0) + ${playerPools.shares}::numeric), 0)::text AS total_liquid_shares
    FROM ${playerPools}
    LEFT JOIN liquid_user_shares lus ON lus.player_id = ${playerPools.playerId}
    WHERE ${playerPools.shares}::numeric > 0
      AND ${playerPools.playMoney}::numeric > 0
  `);
  const rows = result?.rows ?? result;
  return {
    marketCap: finite(rows[0]?.market_cap ?? rows[0]?.marketCap),
    totalLiquidShares: finite(rows[0]?.total_liquid_shares ?? rows[0]?.totalLiquidShares),
  };
}

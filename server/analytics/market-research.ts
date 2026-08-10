import { sql } from "drizzle-orm";
import type {
  AnalyticsTimeRange,
  MarketCorrelation,
  MarketOverview,
  MarketOverviewSport,
  MarketScreenerRow,
  MarketSeries,
  MarketSnapshotHealth,
  MarketTapeItem,
} from "@shared/analytics-market";
import { db } from "../db";
import { getTodayET } from "../lib/time";
import { storage } from "../storage";
import {
  getCanonicalPlayerMarkets,
  VALUATION_VERSION,
  type CanonicalPlayerMarket,
} from "../valuation/canonical-valuation";

const THIN_POOL_TVL = 5_000;
const WHALE_NOTIONAL = 5_000;
const BREADTH_FLAT_BAND = 0.25;

export type MarketSort =
  | "marketCap"
  | "volume"
  | "turnover"
  | "return"
  | "netFlow"
  | "tvl"
  | "trades"
  | "depth";

export type MarketTapeSide = "all" | "buy" | "sell" | "peer";

type PlayerIdentity = {
  id: string;
  firstName: string;
  lastName: string;
  sport: string;
  team: string;
  position: string;
};

type TradeStats = {
  playerId: string;
  volume: number;
  trades: number;
  buyNotional: number;
  sellNotional: number;
  peerNotional: number;
  whaleVolume: number;
  firstPrice: number | null;
};

type ReturnBaselines = {
  playerId: string;
  price1d: number | null;
  price7d: number | null;
  price30d: number | null;
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

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function rowsOf(result: any): any[] {
  return result?.rows ?? result ?? [];
}

function normalizeSport(sport?: string | null): string {
  const normalized = String(sport || "ALL")
    .trim()
    .toUpperCase();
  return normalized || "ALL";
}

export function normalizeAnalyticsTimeRange(value?: string | null): AnalyticsTimeRange {
  switch (String(value || "30d").toLowerCase()) {
    case "1d":
      return "1d";
    case "7d":
      return "7d";
    case "90d":
      return "90d";
    default:
      return "30d";
  }
}

export function getAnalyticsRange(timeRange: AnalyticsTimeRange, now = new Date()) {
  const days = timeRange === "1d" ? 1 : timeRange === "7d" ? 7 : timeRange === "90d" ? 90 : 30;
  return {
    startDate: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    endDate: now,
  };
}

function pctChange(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || baseline <= 0) return null;
  return round(((current - baseline) / baseline) * 100);
}

export function calculateFivePercentDepth(market: CanonicalPlayerMarket) {
  if (
    market.marketStatus !== "priced" ||
    !market.shareReserve ||
    !market.playMoneyReserve ||
    !market.marketPrice
  ) {
    return { buyDepth5Pct: null, sellDepth5Pct: null };
  }

  const shares = market.shareReserve;
  const cash = market.playMoneyReserve;
  const price = market.marketPrice;
  const buySharesAfter = shares / Math.sqrt(1.05);
  const buyCashAfter = (shares * cash) / buySharesAfter;
  const sellSharesAfter = shares / Math.sqrt(0.95);
  const sellShareInput = sellSharesAfter - shares;

  return {
    buyDepth5Pct: round(Math.max(0, buyCashAfter - cash)),
    sellDepth5Pct: round(Math.max(0, sellShareInput * price)),
  };
}

async function loadPlayers(sport: string, playerIds?: string[]): Promise<PlayerIdentity[]> {
  const normalizedSport = normalizeSport(sport);
  const sportClause =
    normalizedSport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${normalizedSport}`;
  const idsClause =
    playerIds && playerIds.length
      ? sql`p.id IN (${sql.join(
          playerIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`TRUE`;

  const result: any = await db.execute(sql`
    SELECT
      p.id,
      p.first_name AS "firstName",
      p.last_name AS "lastName",
      COALESCE(p.sport, '') AS sport,
      COALESCE(p.team, '') AS team,
      COALESCE(p.position, '') AS position
    FROM players p
    WHERE p.is_active = TRUE
      AND ${sportClause}
      AND ${idsClause}
  `);

  return rowsOf(result).map((row) => ({
    id: String(row.id),
    firstName: String(row.firstName ?? row.first_name ?? ""),
    lastName: String(row.lastName ?? row.last_name ?? ""),
    sport: String(row.sport || "").toUpperCase(),
    team: String(row.team || ""),
    position: String(row.position || ""),
  }));
}

async function loadTradeStats(
  sport: string,
  startDate: Date,
  endDate: Date,
  playerIds?: string[],
): Promise<Map<string, TradeStats>> {
  const normalizedSport = normalizeSport(sport);
  const sportClause =
    normalizedSport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${normalizedSport}`;
  const idsClause =
    playerIds && playerIds.length
      ? sql`t.player_id IN (${sql.join(
          playerIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`TRUE`;

  const result: any = await db.execute(sql`
    SELECT
      t.player_id AS "playerId",
      COALESCE(SUM(t.total_cost::numeric), 0)::float8 AS volume,
      COUNT(*)::int AS trades,
      COALESCE(SUM(CASE WHEN t.seller_id = 'pool' THEN t.total_cost::numeric ELSE 0 END), 0)::float8 AS "buyNotional",
      COALESCE(SUM(CASE WHEN t.buyer_id = 'pool' THEN t.total_cost::numeric ELSE 0 END), 0)::float8 AS "sellNotional",
      COALESCE(SUM(CASE WHEN COALESCE(t.buyer_id, '') <> 'pool' AND COALESCE(t.seller_id, '') <> 'pool' THEN t.total_cost::numeric ELSE 0 END), 0)::float8 AS "peerNotional",
      COALESCE(SUM(CASE WHEN t.total_cost::numeric >= ${WHALE_NOTIONAL} THEN t.total_cost::numeric ELSE 0 END), 0)::float8 AS "whaleVolume",
      ((ARRAY_AGG(t.price::numeric ORDER BY t.executed_at ASC))[1])::float8 AS "firstPrice"
    FROM trades t
    INNER JOIN players p ON p.id = t.player_id
    WHERE t.executed_at >= ${startDate}
      AND t.executed_at <= ${endDate}
      AND p.is_active = TRUE
      AND ${sportClause}
      AND ${idsClause}
    GROUP BY t.player_id
  `);

  return new Map(
    rowsOf(result).map((row) => [
      String(row.playerId ?? row.player_id),
      {
        playerId: String(row.playerId ?? row.player_id),
        volume: finite(row.volume),
        trades: Math.trunc(finite(row.trades)),
        buyNotional: finite(row.buyNotional ?? row.buy_notional),
        sellNotional: finite(row.sellNotional ?? row.sell_notional),
        peerNotional: finite(row.peerNotional ?? row.peer_notional),
        whaleVolume: finite(row.whaleVolume ?? row.whale_volume),
        firstPrice: nullableFinite(row.firstPrice ?? row.first_price),
      },
    ]),
  );
}

async function loadReturnBaselines(sport: string, playerIds?: string[]) {
  const normalizedSport = normalizeSport(sport);
  const sportClause =
    normalizedSport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${normalizedSport}`;
  const idsClause =
    playerIds && playerIds.length
      ? sql`t.player_id IN (${sql.join(
          playerIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`TRUE`;

  const result: any = await db.execute(sql`
    WITH one_day AS (
      SELECT DISTINCT ON (t.player_id) t.player_id, t.price::float8 AS price
      FROM trades t INNER JOIN players p ON p.id = t.player_id
      WHERE t.executed_at >= NOW() - INTERVAL '1 day' AND p.is_active = TRUE AND ${sportClause} AND ${idsClause}
      ORDER BY t.player_id, t.executed_at ASC
    ),
    seven_day AS (
      SELECT DISTINCT ON (t.player_id) t.player_id, t.price::float8 AS price
      FROM trades t INNER JOIN players p ON p.id = t.player_id
      WHERE t.executed_at >= NOW() - INTERVAL '7 days' AND p.is_active = TRUE AND ${sportClause} AND ${idsClause}
      ORDER BY t.player_id, t.executed_at ASC
    ),
    thirty_day AS (
      SELECT DISTINCT ON (t.player_id) t.player_id, t.price::float8 AS price
      FROM trades t INNER JOIN players p ON p.id = t.player_id
      WHERE t.executed_at >= NOW() - INTERVAL '30 days' AND p.is_active = TRUE AND ${sportClause} AND ${idsClause}
      ORDER BY t.player_id, t.executed_at ASC
    )
    SELECT
      COALESCE(o.player_id, s.player_id, th.player_id) AS "playerId",
      o.price AS "price1d",
      s.price AS "price7d",
      th.price AS "price30d"
    FROM one_day o
    FULL OUTER JOIN seven_day s ON s.player_id = o.player_id
    FULL OUTER JOIN thirty_day th ON th.player_id = COALESCE(o.player_id, s.player_id)
  `);

  return new Map<string, ReturnBaselines>(
    rowsOf(result).map((row) => [
      String(row.playerId ?? row.player_id),
      {
        playerId: String(row.playerId ?? row.player_id),
        price1d: nullableFinite(row.price1d),
        price7d: nullableFinite(row.price7d),
        price30d: nullableFinite(row.price30d),
      },
    ]),
  );
}

async function buildMarketRows(input: {
  sport: string;
  timeRange: AnalyticsTimeRange;
  playerIds?: string[];
}): Promise<MarketScreenerRow[]> {
  const { startDate, endDate } = getAnalyticsRange(input.timeRange);
  const players = await loadPlayers(input.sport, input.playerIds);
  if (!players.length) return [];

  const playerIds = players.map((player) => player.id);
  const [markets, tradeStats, baselines] = await Promise.all([
    getCanonicalPlayerMarkets(playerIds),
    loadTradeStats(input.sport, startDate, endDate, playerIds),
    loadReturnBaselines(input.sport, playerIds),
  ]);

  return players.map((player) => {
    const market = markets.get(player.id);
    const stats = tradeStats.get(player.id);
    const baseline = baselines.get(player.id);
    const price = market?.marketPrice ?? null;
    const periodReturnPct = pctChange(price, stats?.firstPrice ?? null);
    const marketCap = market?.marketCap ?? null;
    const tvl = market?.poolTvl ?? null;
    const volume = stats?.volume ?? 0;
    const buyNotional = stats?.buyNotional ?? 0;
    const sellNotional = stats?.sellNotional ?? 0;
    const depth = market
      ? calculateFivePercentDepth(market)
      : { buyDepth5Pct: null, sellDepth5Pct: null };

    return {
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`.trim() || player.id,
      sport: player.sport,
      team: player.team,
      position: player.position,
      marketStatus: market?.marketStatus || "unpriced",
      price,
      marketCap,
      tvl,
      shareReserve: market?.shareReserve ?? null,
      cashReserve: market?.playMoneyReserve ?? null,
      volume,
      trades: stats?.trades ?? 0,
      buyNotional,
      sellNotional,
      peerNotional: stats?.peerNotional ?? 0,
      whaleVolume: stats?.whaleVolume ?? 0,
      netFlow: round(buyNotional - sellNotional),
      turnover: marketCap && marketCap > 0 ? round(volume / marketCap, 4) : null,
      liquidityUtilization: tvl && tvl > 0 ? round(volume / tvl, 4) : null,
      return1d: pctChange(price, baseline?.price1d ?? null),
      return7d: pctChange(price, baseline?.price7d ?? null),
      return30d: pctChange(price, baseline?.price30d ?? null),
      periodReturnPct,
      buyDepth5Pct: depth.buyDepth5Pct,
      sellDepth5Pct: depth.sellDepth5Pct,
      thinPool: Boolean(tvl != null && tvl > 0 && tvl < THIN_POOL_TVL),
    } satisfies MarketScreenerRow;
  });
}

function sortMarketRows(rows: MarketScreenerRow[], sort: MarketSort) {
  const value = (row: MarketScreenerRow) => {
    switch (sort) {
      case "volume":
        return row.volume;
      case "turnover":
        return row.turnover ?? -Infinity;
      case "return":
        return row.periodReturnPct ?? -Infinity;
      case "netFlow":
        return row.netFlow;
      case "tvl":
        return row.tvl ?? -Infinity;
      case "trades":
        return row.trades;
      case "depth":
        return row.buyDepth5Pct ?? -Infinity;
      default:
        return row.marketCap ?? -Infinity;
    }
  };
  return rows.slice().sort((a, b) => value(b) - value(a));
}

function average(values: Array<number | null | undefined>) {
  const finiteValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return finiteValues.length
    ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
    : 0;
}

function buildBreadth(rows: MarketScreenerRow[]) {
  let risers = 0;
  let fallers = 0;
  let flat = 0;
  for (const row of rows) {
    const move = row.periodReturnPct;
    if (move == null || Math.abs(move) <= BREADTH_FLAT_BAND) flat += 1;
    else if (move > 0) risers += 1;
    else fallers += 1;
  }
  const observed = risers + fallers + flat;
  return {
    risers,
    fallers,
    flat,
    advancingPercent: observed ? round((risers / observed) * 100) : 0,
  };
}

function aggregateSport(rows: MarketScreenerRow[], sport: string): MarketOverviewSport {
  const marketCap = rows.reduce((sum, row) => sum + (row.marketCap || 0), 0);
  const tvl = rows.reduce((sum, row) => sum + (row.tvl || 0), 0);
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  const trades = rows.reduce((sum, row) => sum + row.trades, 0);
  const netFlow = rows.reduce((sum, row) => sum + row.netFlow, 0);
  return {
    sport,
    marketCap: round(marketCap),
    tvl: round(tvl),
    volume: round(volume),
    trades,
    pricedMarkets: rows.filter((row) => row.marketStatus === "priced").length,
    periodReturnPct: round(average(rows.map((row) => row.periodReturnPct))),
    turnover: marketCap > 0 ? round(volume / marketCap, 4) : 0,
    netFlow: round(netFlow),
  };
}

function dateStringsBetween(startDate: Date, endDate: Date) {
  const dates: string[] = [];
  const cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()),
  );
  while (cursor <= end && dates.length < 120) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function getSnapshotHealth(startDate: Date, endDate: Date): Promise<MarketSnapshotHealth> {
  const result: any = await db.execute(sql`
    SELECT snapshot_date::date::text AS "snapshotDate", created_at AS "createdAt"
    FROM market_snapshots
    WHERE snapshot_date >= ${new Date(`${startDate.toISOString().slice(0, 10)}T00:00:00.000Z`)}
      AND snapshot_date <= ${new Date(`${endDate.toISOString().slice(0, 10)}T23:59:59.999Z`)}
    ORDER BY snapshot_date ASC
  `);
  const snapshots = rowsOf(result);
  const actual = new Set(
    snapshots.map((row) => String(row.snapshotDate ?? row.snapshot_date).slice(0, 10)),
  );
  const expectedDates = dateStringsBetween(startDate, endDate);
  const missingDates = expectedDates.filter((date) => !actual.has(date));
  const latest = snapshots[snapshots.length - 1];
  const latestSnapshot = latest
    ? String(latest.snapshotDate ?? latest.snapshot_date).slice(0, 10)
    : null;

  return {
    latestSnapshot,
    expectedSnapshot: getTodayET(),
    snapshotCount: snapshots.length,
    missingDates,
    isPartial: missingDates.length > 0,
    valuationVersion: snapshots.length ? VALUATION_VERSION : null,
    dataThrough: latestSnapshot || endDate.toISOString(),
  };
}

export async function getMarketOverview(
  input: {
    sport?: string;
    timeRange?: AnalyticsTimeRange | string;
  } = {},
): Promise<MarketOverview> {
  const sport = normalizeSport(input.sport);
  const timeRange = normalizeAnalyticsTimeRange(input.timeRange);
  const { startDate, endDate } = getAnalyticsRange(timeRange);
  const rows = await buildMarketRows({ sport, timeRange });
  const marketCap = rows.reduce((sum, row) => sum + (row.marketCap || 0), 0);
  const tvl = rows.reduce((sum, row) => sum + (row.tvl || 0), 0);
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  const trades = rows.reduce((sum, row) => sum + row.trades, 0);
  const buyNotional = rows.reduce((sum, row) => sum + row.buyNotional, 0);
  const sellNotional = rows.reduce((sum, row) => sum + row.sellNotional, 0);
  const peerNotional = rows.reduce((sum, row) => sum + row.peerNotional, 0);
  const whaleVolume = rows.reduce((sum, row) => sum + row.whaleVolume, 0);
  const priced = rows.filter((row) => row.marketStatus === "priced");
  const sortedCaps = priced.map((row) => row.marketCap || 0).sort((a, b) => b - a);
  const top10Cap = sortedCaps.slice(0, 10).reduce((sum, value) => sum + value, 0);
  const tradeSizesResult: any = await db.execute(sql`
    SELECT
      COALESCE(AVG(t.total_cost::numeric), 0)::float8 AS average,
      COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.total_cost::numeric), 0)::float8 AS median
    FROM trades t
    INNER JOIN players p ON p.id = t.player_id
    WHERE t.executed_at >= ${startDate}
      AND t.executed_at <= ${endDate}
      AND p.is_active = TRUE
      AND ${sport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${sport}`}
  `);
  const tradeSize = rowsOf(tradeSizesResult)[0] || {};

  const sportGroups = new Map<string, MarketScreenerRow[]>();
  for (const row of rows) {
    if (!sportGroups.has(row.sport)) sportGroups.set(row.sport, []);
    sportGroups.get(row.sport)!.push(row);
  }
  const sports = Array.from(sportGroups.entries())
    .map(([name, sportRows]) => aggregateSport(sportRows, name))
    .sort((a, b) => b.volume - a.volume);

  let supply: MarketOverview["supply"] = null;
  if (sport === "ALL") {
    const economy = await storage.getShareEconomyStats(startDate, endDate);
    const sharesScouted = finite(economy.periodSharesScouted);
    const sharesVested = finite(economy.periodSharesVested ?? economy.periodsharesVested);
    const sharesBurned = finite(economy.periodSharesBurned);
    const netIssuance = sharesScouted + sharesVested - sharesBurned;
    supply = {
      scope: "ALL",
      sharesScouted,
      sharesVested,
      sharesBurned,
      netIssuance,
      netIssuanceRate:
        finite(economy.totalSharesInEconomy) > 0
          ? round(netIssuance / finite(economy.totalSharesInEconomy), 6)
          : null,
    };
  }

  const snapshotHealth = await getSnapshotHealth(startDate, endDate);
  return {
    summary: `Loaded ${timeRange} Sportfolio market research for ${sport}.`,
    scope: {
      sport,
      timeRange,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    valuationVersion: VALUATION_VERSION,
    marketCap: round(marketCap),
    tvl: round(tvl),
    volume: round(volume),
    trades,
    activeTradedMarkets: rows.filter((row) => row.trades > 0).length,
    pricedMarkets: priced.length,
    unpricedMarkets: rows.length - priced.length,
    periodReturnPct: round(average(rows.map((row) => row.periodReturnPct))),
    turnover: marketCap > 0 ? round(volume / marketCap, 4) : 0,
    liquidityUtilization: tvl > 0 ? round(volume / tvl, 4) : 0,
    buyNotional: round(buyNotional),
    sellNotional: round(sellNotional),
    peerNotional: round(peerNotional),
    netFlow: round(buyNotional - sellNotional),
    averageTradeSize: round(finite(tradeSize.average)),
    medianTradeSize: round(finite(tradeSize.median)),
    whaleVolume: round(whaleVolume),
    thinPoolPercent: priced.length
      ? round((priced.filter((row) => row.thinPool).length / priced.length) * 100)
      : 0,
    top10MarketCapShare: marketCap > 0 ? round((top10Cap / marketCap) * 100) : 0,
    breadth: buildBreadth(rows),
    supply,
    sports,
    snapshotHealth,
    generatedAt: new Date().toISOString(),
  };
}

export async function screenMarkets(
  input: {
    sport?: string;
    timeRange?: AnalyticsTimeRange | string;
    sort?: MarketSort;
    limit?: number;
    search?: string;
  } = {},
) {
  const sport = normalizeSport(input.sport);
  const timeRange = normalizeAnalyticsTimeRange(input.timeRange);
  const sort = input.sort || "marketCap";
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit || 50)));
  const search = String(input.search || "")
    .trim()
    .toLowerCase();
  const rows = await buildMarketRows({ sport, timeRange });
  const filtered = search
    ? rows.filter((row) =>
        [row.playerName, row.team, row.position, row.sport]
          .join(" ")
          .toLowerCase()
          .includes(search),
      )
    : rows;
  return {
    summary: `Loaded ${Math.min(limit, filtered.length)} of ${filtered.length} market rows.`,
    sport,
    timeRange,
    sort,
    total: filtered.length,
    rows: sortMarketRows(filtered, sort).slice(0, limit),
    generatedAt: new Date().toISOString(),
  };
}

export async function getMarketSeries(
  input: {
    sport?: string;
    timeRange?: AnalyticsTimeRange | string;
  } = {},
): Promise<MarketSeries> {
  const sport = normalizeSport(input.sport);
  const timeRange = normalizeAnalyticsTimeRange(input.timeRange);
  const { startDate, endDate } = getAnalyticsRange(timeRange);
  const result: any = await db.execute(sql`
    WITH daily_player AS (
      SELECT
        DATE(timezone('America/New_York', t.executed_at AT TIME ZONE 'UTC')) AS day,
        t.player_id,
        ((ARRAY_AGG(t.price::numeric ORDER BY t.executed_at ASC))[1])::float8 AS first_price,
        ((ARRAY_AGG(t.price::numeric ORDER BY t.executed_at DESC))[1])::float8 AS last_price,
        SUM(t.total_cost::numeric)::float8 AS volume,
        COUNT(*)::int AS trades,
        SUM(CASE WHEN t.seller_id = 'pool' THEN t.total_cost::numeric ELSE 0 END)::float8 AS buy_notional,
        SUM(CASE WHEN t.buyer_id = 'pool' THEN t.total_cost::numeric ELSE 0 END)::float8 AS sell_notional
      FROM trades t
      INNER JOIN players p ON p.id = t.player_id
      WHERE t.executed_at >= ${startDate}
        AND t.executed_at <= ${endDate}
        AND p.is_active = TRUE
        AND ${sport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${sport}`}
      GROUP BY day, t.player_id
    )
    SELECT
      day::text,
      COALESCE(AVG(CASE WHEN first_price > 0 THEN ((last_price - first_price) / first_price) * 100 ELSE 0 END), 0)::float8 AS daily_return,
      COALESCE(SUM(volume), 0)::float8 AS volume,
      COALESCE(SUM(trades), 0)::int AS trades,
      COUNT(*)::int AS active_markets,
      COALESCE(SUM(buy_notional), 0)::float8 AS buy_notional,
      COALESCE(SUM(sell_notional), 0)::float8 AS sell_notional
    FROM daily_player
    GROUP BY day
    ORDER BY day ASC
  `);

  let indexValue = 100;
  const points = rowsOf(result).map((row) => {
    const dailyReturnPct = finite(row.daily_return ?? row.dailyReturn);
    indexValue *= 1 + dailyReturnPct / 100;
    const buyNotional = finite(row.buy_notional ?? row.buyNotional);
    const sellNotional = finite(row.sell_notional ?? row.sellNotional);
    return {
      date: String(row.day),
      indexValue: round(indexValue, 3),
      dailyReturnPct: round(dailyReturnPct),
      volume: round(finite(row.volume)),
      trades: Math.trunc(finite(row.trades)),
      activeMarkets: Math.trunc(finite(row.active_markets ?? row.activeMarkets)),
      buyNotional: round(buyNotional),
      sellNotional: round(sellNotional),
      netFlow: round(buyNotional - sellNotional),
    };
  });

  return {
    summary: `Loaded the ${sport} equal-weight market index for ${timeRange}.`,
    sport,
    timeRange,
    methodology: "equal_weight_traded_markets_v1",
    baseValue: 100,
    points,
    generatedAt: new Date().toISOString(),
  };
}

export async function compareMarkets(input: {
  playerIds: string[];
  timeRange?: AnalyticsTimeRange | string;
}) {
  const playerIds = Array.from(new Set(input.playerIds.filter(Boolean))).slice(0, 8);
  const timeRange = normalizeAnalyticsTimeRange(input.timeRange);
  const rows = await buildMarketRows({ sport: "ALL", timeRange, playerIds });
  const order = new Map(playerIds.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.playerId) ?? 999) - (order.get(b.playerId) ?? 999));
  return {
    summary: `Compared ${rows.length} Sportfolio markets.`,
    timeRange,
    rows,
    generatedAt: new Date().toISOString(),
  };
}

export function calculatePearsonCorrelation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] - leftMean;
    const r = right[index] - rightMean;
    numerator += l * r;
    leftVariance += l * l;
    rightVariance += r * r;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? numerator / denominator : null;
}

export async function getMarketCorrelations(input: {
  playerIds: string[];
  timeRange?: AnalyticsTimeRange | string;
  minSamples?: number;
}) {
  const playerIds = Array.from(new Set(input.playerIds.filter(Boolean))).slice(0, 8);
  const timeRange = normalizeAnalyticsTimeRange(input.timeRange || "30d");
  const minSamples = Math.min(30, Math.max(3, Math.trunc(input.minSamples || 5)));
  if (playerIds.length < 2) {
    return {
      summary: "Select at least two players for correlation research.",
      timeRange,
      pairs: [] as MarketCorrelation[],
    };
  }
  const { startDate, endDate } = getAnalyticsRange(timeRange);
  const result: any = await db.execute(sql`
    WITH daily AS (
      SELECT
        DATE(timezone('America/New_York', t.executed_at AT TIME ZONE 'UTC')) AS day,
        t.player_id,
        ((ARRAY_AGG(t.price::numeric ORDER BY t.executed_at ASC))[1])::float8 AS first_price,
        ((ARRAY_AGG(t.price::numeric ORDER BY t.executed_at DESC))[1])::float8 AS last_price
      FROM trades t
      WHERE t.executed_at >= ${startDate}
        AND t.executed_at <= ${endDate}
        AND t.player_id IN (${sql.join(
          playerIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      GROUP BY day, t.player_id
    )
    SELECT day::text, player_id AS "playerId",
      CASE WHEN first_price > 0 THEN ((last_price - first_price) / first_price) * 100 ELSE 0 END::float8 AS return_pct
    FROM daily
    ORDER BY day ASC
  `);
  const identities = new Map(
    (await loadPlayers("ALL", playerIds)).map((player) => [player.id, player]),
  );
  const byPlayer = new Map<string, Map<string, number>>();
  for (const row of rowsOf(result)) {
    const id = String(row.playerId ?? row.player_id);
    if (!byPlayer.has(id)) byPlayer.set(id, new Map());
    byPlayer.get(id)!.set(String(row.day), finite(row.return_pct ?? row.returnPct));
  }

  const pairs: MarketCorrelation[] = [];
  for (let i = 0; i < playerIds.length; i += 1) {
    for (let j = i + 1; j < playerIds.length; j += 1) {
      const leftId = playerIds[i];
      const rightId = playerIds[j];
      const leftDays = byPlayer.get(leftId) || new Map();
      const rightDays = byPlayer.get(rightId) || new Map();
      const commonDays = Array.from(leftDays.keys()).filter((day) => rightDays.has(day));
      if (commonDays.length < minSamples) continue;
      const coefficient = calculatePearsonCorrelation(
        commonDays.map((day) => leftDays.get(day)!),
        commonDays.map((day) => rightDays.get(day)!),
      );
      if (coefficient == null) continue;
      const leftIdentity = identities.get(leftId);
      const rightIdentity = identities.get(rightId);
      pairs.push({
        player1Id: leftId,
        player1Name: leftIdentity
          ? `${leftIdentity.firstName} ${leftIdentity.lastName}`.trim()
          : leftId,
        player2Id: rightId,
        player2Name: rightIdentity
          ? `${rightIdentity.firstName} ${rightIdentity.lastName}`.trim()
          : rightId,
        correlation: round(coefficient, 4),
        sampleCount: commonDays.length,
      });
    }
  }
  pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return {
    summary: `Calculated ${pairs.length} Pearson correlation pair(s) from aligned daily market returns.`,
    timeRange,
    minSamples,
    methodology: "pearson_aligned_daily_trade_returns_v1",
    pairs,
    generatedAt: new Date().toISOString(),
  };
}

export async function getMarketTape(
  input: {
    sport?: string;
    side?: MarketTapeSide;
    minNotional?: number;
    limit?: number;
    playerId?: string;
  } = {},
) {
  const sport = normalizeSport(input.sport);
  const side = input.side || "all";
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit || 40)));
  const minNotional = Math.max(0, finite(input.minNotional));
  const playerClause = input.playerId ? sql`t.player_id = ${input.playerId}` : sql`TRUE`;
  const sideClause =
    side === "buy"
      ? sql`t.seller_id = 'pool'`
      : side === "sell"
        ? sql`t.buyer_id = 'pool'`
        : side === "peer"
          ? sql`COALESCE(t.buyer_id, '') <> 'pool' AND COALESCE(t.seller_id, '') <> 'pool'`
          : sql`TRUE`;
  const result: any = await db.execute(sql`
    SELECT
      t.id,
      t.player_id AS "playerId",
      t.quantity,
      t.price::float8 AS price,
      t.total_cost::float8 AS notional,
      t.executed_at AS "timestamp",
      t.buyer_id AS "buyerId",
      t.seller_id AS "sellerId",
      p.first_name AS "firstName",
      p.last_name AS "lastName",
      COALESCE(p.sport, '') AS sport,
      COALESCE(p.team, '') AS team
    FROM trades t
    INNER JOIN players p ON p.id = t.player_id
    WHERE p.is_active = TRUE
      AND ${sport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${sport}`}
      AND ${playerClause}
      AND ${sideClause}
      AND t.total_cost::numeric >= ${minNotional}
    ORDER BY t.executed_at DESC
    LIMIT ${limit}
  `);
  const sourceRows = rowsOf(result);
  const markets = await getCanonicalPlayerMarkets(
    Array.from(new Set(sourceRows.map((row) => String(row.playerId ?? row.player_id)))),
  );
  const items: MarketTapeItem[] = sourceRows.map((row) => {
    const playerId = String(row.playerId ?? row.player_id);
    const executionPrice = finite(row.price);
    const currentPrice = markets.get(playerId)?.marketPrice ?? null;
    const resolvedSide: MarketTapeItem["side"] =
      String(row.sellerId ?? row.seller_id) === "pool"
        ? "buy"
        : String(row.buyerId ?? row.buyer_id) === "pool"
          ? "sell"
          : "peer";
    return {
      id: String(row.id),
      timestamp: new Date(row.timestamp).toISOString(),
      playerId,
      playerName:
        `${String(row.firstName ?? row.first_name ?? "")} ${String(row.lastName ?? row.last_name ?? "")}`.trim() ||
        playerId,
      sport: String(row.sport || "").toUpperCase(),
      team: String(row.team || ""),
      side: resolvedSide,
      quantity: finite(row.quantity),
      price: round(executionPrice),
      notional: round(finite(row.notional)),
      currentPrice: currentPrice == null ? null : round(currentPrice),
      spotMovePct:
        currentPrice != null && executionPrice > 0
          ? round(((currentPrice - executionPrice) / executionPrice) * 100)
          : null,
      isWhale: finite(row.notional) >= WHALE_NOTIONAL,
    };
  });
  return {
    summary: `Loaded ${items.length} public market transaction${items.length === 1 ? "" : "s"}.`,
    sport,
    side,
    minNotional,
    items,
    generatedAt: new Date().toISOString(),
  };
}

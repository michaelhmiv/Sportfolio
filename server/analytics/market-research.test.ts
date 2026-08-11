import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getShareEconomyStats: vi.fn(),
  getCanonicalPlayerMarkets: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    execute: mocks.execute,
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getShareEconomyStats: mocks.getShareEconomyStats,
  },
}));

vi.mock("../valuation/canonical-valuation", () => ({
  VALUATION_VERSION: "amm_liquid_v2",
  getCanonicalPlayerMarkets: mocks.getCanonicalPlayerMarkets,
}));

import {
  calculateFivePercentDepth,
  calculatePearsonCorrelation,
  compareMarkets,
  getMarketCorrelations,
  getMarketOverview,
  getMarketSeries,
  getMarketTape,
  normalizeAnalyticsTimeRange,
  screenMarkets,
} from "./market-research";

const canonicalMarkets = new Map([
  [
    "player_1",
    {
      playerId: "player_1",
      marketStatus: "priced" as const,
      marketPrice: 12,
      priceSource: "amm_spot" as const,
      poolInitialized: true,
      shareReserve: 100,
      playMoneyReserve: 1200,
      poolTvl: 2400,
      lastTradePrice: 11,
      liquidUserShares: 50,
      liquidSharesOutstanding: 150,
      marketCap: 1800,
      warnings: [],
    },
  ],
  [
    "player_2",
    {
      playerId: "player_2",
      marketStatus: "priced" as const,
      marketPrice: 8,
      priceSource: "amm_spot" as const,
      poolInitialized: true,
      shareReserve: 200,
      playMoneyReserve: 1600,
      poolTvl: 3200,
      lastTradePrice: 8,
      liquidUserShares: 25,
      liquidSharesOutstanding: 225,
      marketCap: 1800,
      warnings: [],
    },
  ],
]);

function playerRows() {
  return {
    rows: [
      {
        id: "player_1",
        firstName: "Alpha",
        lastName: "One",
        sport: "MLB",
        team: "AAA",
        position: "P",
      },
      {
        id: "player_2",
        firstName: "Beta",
        lastName: "Two",
        sport: "MLB",
        team: "BBB",
        position: "OF",
      },
    ],
  };
}

function tradeStatsRows() {
  return {
    rows: [
      {
        playerId: "player_1",
        volume: 600,
        trades: 3,
        buyNotional: 450,
        sellNotional: 100,
        peerNotional: 50,
        whaleVolume: 0,
        firstPrice: 10,
      },
      {
        playerId: "player_2",
        volume: 200,
        trades: 2,
        buyNotional: 25,
        sellNotional: 150,
        peerNotional: 25,
        whaleVolume: 0,
        firstPrice: 8,
      },
    ],
  };
}

function baselineRows() {
  return {
    rows: [
      { playerId: "player_1", price1d: 11, price7d: 10, price30d: 9 },
      { playerId: "player_2", price1d: 8, price7d: 8, price30d: 10 },
    ],
  };
}

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.getShareEconomyStats.mockReset();
  mocks.getCanonicalPlayerMarkets.mockReset();
  mocks.getCanonicalPlayerMarkets.mockResolvedValue(canonicalMarkets);
});

describe("market research math", () => {
  it("calculates Pearson correlation rather than a direction heuristic", () => {
    expect(calculatePearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 8);
    expect(calculatePearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 8);
  });

  it("requires comparable variance for correlation", () => {
    expect(calculatePearsonCorrelation([1, 1, 1], [2, 3, 4])).toBeNull();
    expect(calculatePearsonCorrelation([1], [1])).toBeNull();
  });

  it("calculates symmetric constant-product depth around spot", () => {
    const depth = calculateFivePercentDepth(canonicalMarkets.get("player_1")!);

    expect(depth.buyDepth5Pct).toBeGreaterThan(0);
    expect(depth.sellDepth5Pct).toBeGreaterThan(0);
    expect(depth.buyDepth5Pct).toBeLessThan(40);
    expect(depth.sellDepth5Pct).toBeLessThan(40);
  });

  it("returns no depth for an unpriced market", () => {
    expect(
      calculateFivePercentDepth({
        ...canonicalMarkets.get("player_1")!,
        marketStatus: "unpriced",
        marketPrice: null,
      }),
    ).toEqual({ buyDepth5Pct: null, sellDepth5Pct: null });
  });

  it("normalizes supported and unsupported ranges", () => {
    expect(normalizeAnalyticsTimeRange("1d")).toBe("1d");
    expect(normalizeAnalyticsTimeRange("7d")).toBe("7d");
    expect(normalizeAnalyticsTimeRange("90d")).toBe("90d");
    expect(normalizeAnalyticsTimeRange("garbage")).toBe("30d");
  });
});

describe("market research service", () => {
  it("builds and sorts the player market screener from canonical prices and trade flow", async () => {
    mocks.execute
      .mockResolvedValueOnce(playerRows())
      .mockResolvedValueOnce(tradeStatsRows())
      .mockResolvedValueOnce(baselineRows());

    const result = await screenMarkets({ sport: "MLB", timeRange: "7d", sort: "netFlow" });

    expect(result.total).toBe(2);
    expect(result.rows[0]).toMatchObject({
      playerId: "player_1",
      playerName: "Alpha One",
      price: 12,
      marketCap: 1800,
      tvl: 2400,
      volume: 600,
      trades: 3,
      netFlow: 350,
      periodReturnPct: 20,
    });
    expect(result.rows[0].return7d).toBe(20);
    expect(result.rows[0].turnover).toBeCloseTo(600 / 1800, 4);
    expect(result.rows[1].netFlow).toBe(-125);
  });

  it("builds the public economy overview with breadth, supply, concentration, and snapshot health", async () => {
    mocks.execute
      .mockResolvedValueOnce(playerRows())
      .mockResolvedValueOnce(tradeStatsRows())
      .mockResolvedValueOnce(baselineRows())
      .mockResolvedValueOnce({ rows: [{ average: 160, median: 125 }] })
      .mockResolvedValueOnce({
        rows: [{ snapshotDate: "2026-08-09", createdAt: "2026-08-10T04:05:00.000Z" }],
      });
    mocks.getShareEconomyStats.mockResolvedValue({
      totalSharesVested: 1000,
      totalSharesScouted: 2000,
      totalSharesBurned: 400,
      totalSharesInEconomy: 5000,
      periodSharesVested: 50,
      periodSharesScouted: 75,
      periodsharesVested: 50,
      periodSharesBurned: 25,
    });

    const result = await getMarketOverview({ sport: "ALL", timeRange: "7d" });

    expect(result).toMatchObject({
      valuationVersion: "amm_liquid_v2",
      marketCap: 3600,
      tvl: 5600,
      volume: 800,
      trades: 5,
      activeTradedMarkets: 2,
      pricedMarkets: 2,
      buyNotional: 475,
      sellNotional: 250,
      peerNotional: 75,
      netFlow: 225,
      averageTradeSize: 160,
      medianTradeSize: 125,
    });
    expect(result.breadth).toMatchObject({ risers: 1, fallers: 0, flat: 1 });
    expect(result.supply).toMatchObject({
      sharesScouted: 75,
      sharesVested: 50,
      sharesBurned: 25,
      netIssuance: 100,
    });
    expect(result.sports[0].sport).toBe("MLB");
    expect(result.snapshotHealth.snapshotCount).toBe(1);
  });

  it("builds a compounded equal-weight index series", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          day: "2026-08-08",
          daily_return: 10,
          volume: 100,
          trades: 2,
          active_markets: 2,
          buy_notional: 70,
          sell_notional: 30,
        },
        {
          day: "2026-08-09",
          daily_return: -5,
          volume: 200,
          trades: 3,
          active_markets: 2,
          buy_notional: 80,
          sell_notional: 120,
        },
      ],
    });

    const result = await getMarketSeries({ sport: "MLB", timeRange: "7d" });

    expect(result.methodology).toBe("equal_weight_traded_markets_v1");
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toMatchObject({ indexValue: 110, netFlow: 40 });
    expect(result.points[1].indexValue).toBe(104.5);
    expect(result.points[1].netFlow).toBe(-40);
  });

  it("compares selected markets in requested order", async () => {
    mocks.execute
      .mockResolvedValueOnce(playerRows())
      .mockResolvedValueOnce(tradeStatsRows())
      .mockResolvedValueOnce(baselineRows());

    const result = await compareMarkets({
      playerIds: ["player_2", "player_1"],
      timeRange: "30d",
    });

    expect(result.rows.map((row) => row.playerId)).toEqual(["player_2", "player_1"]);
    expect(result.rows[1].return30d).toBeCloseTo(33.33, 2);
  });

  it("calculates correlations only from aligned daily observations", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          { day: "2026-08-01", playerId: "player_1", return_pct: 1 },
          { day: "2026-08-01", playerId: "player_2", return_pct: 2 },
          { day: "2026-08-02", playerId: "player_1", return_pct: 2 },
          { day: "2026-08-02", playerId: "player_2", return_pct: 4 },
          { day: "2026-08-03", playerId: "player_1", return_pct: 3 },
          { day: "2026-08-03", playerId: "player_2", return_pct: 6 },
        ],
      })
      .mockResolvedValueOnce(playerRows());

    const result = await getMarketCorrelations({
      playerIds: ["player_1", "player_2"],
      timeRange: "30d",
      minSamples: 3,
    });

    expect(result.methodology).toBe("pearson_aligned_daily_trade_returns_v1");
    expect(result.pairs).toEqual([
      expect.objectContaining({
        player1Name: "Alpha One",
        player2Name: "Beta Two",
        correlation: 1,
        sampleCount: 3,
      }),
    ]);
  });

  it("returns an empty correlation set when fewer than two markets are selected", async () => {
    const result = await getMarketCorrelations({ playerIds: ["player_1"] });
    expect(result.pairs).toEqual([]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("maps the public tape to pool buy, sell, and peer transactions", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "trade_1",
          playerId: "player_1",
          quantity: 10,
          price: 11,
          notional: 110,
          timestamp: "2026-08-09T18:00:00.000Z",
          buyerId: "user_1",
          sellerId: "pool",
          firstName: "Alpha",
          lastName: "One",
          sport: "MLB",
          team: "AAA",
        },
        {
          id: "trade_2",
          playerId: "player_2",
          quantity: 5,
          price: 8,
          notional: 40,
          timestamp: "2026-08-09T18:01:00.000Z",
          buyerId: "pool",
          sellerId: "user_2",
          firstName: "Beta",
          lastName: "Two",
          sport: "MLB",
          team: "BBB",
        },
      ],
    });

    const result = await getMarketTape({ sport: "MLB", limit: 20 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      playerName: "Alpha One",
      side: "buy",
      notional: 110,
      currentPrice: 12,
    });
    expect(result.items[0].spotMovePct).toBeCloseTo(9.09, 2);
    expect(result.items[1].side).toBe("sell");
  });
});

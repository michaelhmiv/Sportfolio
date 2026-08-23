import { describe, expect, it } from "vitest";

import type { MobileMarketOverview } from "./market-mobile-overview";
import {
  buildMarketActivityFeed,
  getMarketActivitySourceFetchWindow,
} from "./market-activity-feed";

const overview: MobileMarketOverview = {
  sport: "NBA",
  pulse: {
    tradeCount15m: 8,
    lowActivity: false,
    liveGameCount: 1,
    slateGameCount: 3,
    openBoostSlots: null,
    generatedAt: "2026-04-22T19:00:00.000Z",
  },
  marketIndicators: {
    healthScore: 70,
    healthLabel: "active",
    healthSummary: "Active market",
    marketIndex24h: 4,
    volatilityIndex: 62,
    liquidityHealth: 71,
    totalVolume24h: 1200,
    totalPoolShares: 3000,
    totalMarketTvl: 80000,
    breadth: {
      risers: 12,
      fallers: 8,
      flat: 5,
    },
  },
  ticker: [],
  leaderboards: {
    risers: [
      {
        playerId: "player-1",
        firstName: "Ariel",
        lastName: "Ace",
        team: "NYK",
        position: "G",
        currentPrice: 14,
        priceChange24h: 12,
        poolTvl: 15000,
        buyPressure: 72,
        valueIndex: 9,
        globalScoutCount: 4,
        communityBoostCount: 2,
        gameStatus: "live",
        gameStartTime: "2026-04-22T18:30:00.000Z",
        note: "Momentum breakout",
        signal: "momentum",
        availableShares: null,
        heatCheckStatus: "fire",
      },
    ],
    topPools: [
      {
        playerId: "player-1",
        firstName: "Ariel",
        lastName: "Ace",
        team: "NYK",
        position: "G",
        currentPrice: 14,
        priceChange24h: 12,
        poolTvl: 15000,
        buyPressure: 72,
        valueIndex: 9,
        globalScoutCount: 4,
        communityBoostCount: 2,
        gameStatus: "live",
        gameStartTime: "2026-04-22T18:30:00.000Z",
        note: "TVL $15,000",
        signal: "pool",
        availableShares: null,
        heatCheckStatus: "fire",
      },
    ],
    mostActive: [],
    boostWindow: [],
  },
  personalEdge: null,
  nowMoving: [],
  boostWindow: [
    {
      playerId: "player-2",
      firstName: "Blake",
      lastName: "Bolt",
      team: "BOS",
      position: "F",
      currentPrice: 4.5,
      priceChange24h: 3,
      poolTvl: 3200,
      buyPressure: 55,
      valueIndex: 16,
      globalScoutCount: 1,
      communityBoostCount: 1,
      gameStatus: "upcoming",
      gameStartTime: "2026-04-22T22:00:00.000Z",
      note: "Community +1 on today's slate",
      signal: "boost",
      availableShares: null,
      heatCheckStatus: "neutral",
    },
  ],
  scoutSurge: [
    {
      playerId: "player-1",
      firstName: "Ariel",
      lastName: "Ace",
      team: "NYK",
      position: "G",
      currentPrice: 14,
      priceChange24h: 12,
      poolTvl: 15000,
      buyPressure: 72,
      valueIndex: 9,
      globalScoutCount: 4,
      communityBoostCount: 2,
      gameStatus: "live",
      gameStartTime: "2026-04-22T18:30:00.000Z",
      note: "4 active scouts",
      signal: "scout",
      availableShares: null,
      heatCheckStatus: "fire",
    },
  ],
  quietValue: [],
  watchlistMoves: [],
};

describe("getMarketActivitySourceFetchWindow", () => {
  it("scales with pagination depth while staying bounded", () => {
    expect(getMarketActivitySourceFetchWindow(40, 0)).toBe(120);
    expect(getMarketActivitySourceFetchWindow(40, 160)).toBe(260);
    expect(getMarketActivitySourceFetchWindow(100, 500)).toBe(400);
  });
});

describe("buildMarketActivityFeed", () => {
  it("enriches trade rows with signal tags, summaries, filters, and pagination", () => {
    const feed = buildMarketActivityFeed({
      activity: [
        {
          id: "trade-1",
          playerId: "player-1",
          playerFirstName: "Ariel",
          playerLastName: "Ace",
          playerTeam: "NYK",
          playerSport: "NBA",
          buyerId: "user-1",
          buyerUsername: "momo",
          sellerId: "pool",
          sellerUsername: "Pool",
          quantity: 500,
          price: 12,
          currentPrice: 14,
          priceChange24h: 12,
          timestamp: "2026-04-22T19:00:00.000Z",
        },
        {
          id: "trade-2",
          playerId: "player-2",
          playerFirstName: "Blake",
          playerLastName: "Bolt",
          playerTeam: "BOS",
          playerSport: "NBA",
          buyerId: "pool",
          buyerUsername: "Pool",
          sellerId: "user-2",
          sellerUsername: "sage",
          quantity: 40,
          price: 4,
          currentPrice: 4.5,
          priceChange24h: 3,
          timestamp: "2026-04-22T18:50:00.000Z",
        },
      ],
      overview,
      limit: 1,
      offset: 0,
      filters: {
        sort: "notional",
      },
    });

    expect(feed.total).toBe(2);
    expect(feed.activities).toHaveLength(1);
    expect(feed.summary.whaleCount).toBe(1);
    expect(feed.summary.liveCount).toBe(1);
    expect(feed.summary.activePoolCount).toBe(2);
    expect(feed.signalCounts.whale).toBe(1);
    expect(feed.signalCounts.momentum).toBeGreaterThanOrEqual(1);
    expect(feed.activities[0]).toMatchObject({
      id: "trade-1",
      side: "buy",
      isWhale: true,
      isTopPool: true,
      gameState: "live",
      primarySignal: "whale",
    });
    expect(feed.highlights.biggestPrints[0]).toMatchObject({
      playerId: "player-1",
      metricLabel: "Print",
    });
    expect(feed.nextOffset).toBe(1);
  });

  it("applies signal, whale, and side filters together", () => {
    const feed = buildMarketActivityFeed({
      activity: [
        {
          id: "trade-1",
          playerId: "player-1",
          playerFirstName: "Ariel",
          playerLastName: "Ace",
          playerTeam: "NYK",
          playerSport: "NBA",
          buyerId: "user-1",
          buyerUsername: "momo",
          sellerId: "pool",
          sellerUsername: "Pool",
          quantity: 500,
          price: 12,
          currentPrice: 14,
          priceChange24h: 12,
          timestamp: "2026-04-22T19:00:00.000Z",
        },
        {
          id: "trade-2",
          playerId: "player-2",
          playerFirstName: "Blake",
          playerLastName: "Bolt",
          playerTeam: "BOS",
          playerSport: "NBA",
          buyerId: "pool",
          buyerUsername: "Pool",
          sellerId: "user-2",
          sellerUsername: "sage",
          quantity: 40,
          price: 4,
          currentPrice: 4.5,
          priceChange24h: 3,
          timestamp: "2026-04-22T18:50:00.000Z",
        },
      ],
      overview,
      limit: 10,
      offset: 0,
      filters: {
        signal: "momentum",
        side: "buy",
        whalesOnly: true,
      },
    });

    expect(feed.total).toBe(1);
    expect(feed.activities[0]?.id).toBe("trade-1");
  });
});

import { describe, expect, it } from "vitest";

import type { DailyGame, Holding, Player } from "@shared/schema";

import { buildMobileMarketOverview, type MarketMobileOverviewDeps } from "./market-mobile-overview";
import type { HoldingWithPlayerSummary } from "./storage";

function makePlayer(
  overrides: Partial<Player> & Pick<Player, "id" | "firstName" | "lastName" | "team" | "position">,
): Player {
  return {
    id: overrides.id,
    firstName: overrides.firstName,
    lastName: overrides.lastName,
    team: overrides.team,
    position: overrides.position,
    sport: overrides.sport || "NBA",
    currentPrice: overrides.currentPrice || "0",
    lastTradePrice: overrides.lastTradePrice || "10.00",
    priceChange24h: overrides.priceChange24h || "0",
    volume24h: overrides.volume24h || 0,
    marketCap: overrides.marketCap || "0",
    isActive: overrides.isActive ?? true,
    status: overrides.status || "active",
    totalShares: overrides.totalShares || 0,
    totalHolders: overrides.totalHolders || 0,
    teamId: overrides.teamId || null,
    externalId: overrides.externalId || null,
    league: overrides.league || null,
    metadata: overrides.metadata || null,
    injuryStatus: overrides.injuryStatus || null,
    injuryDescription: overrides.injuryDescription || null,
    injuryReturnDate: overrides.injuryReturnDate || null,
    createdAt: overrides.createdAt || new Date("2026-03-08T00:00:00.000Z"),
    updatedAt: overrides.updatedAt || new Date("2026-03-08T00:00:00.000Z"),
  } as Player;
}

function makeGame(
  overrides: Partial<DailyGame> & Pick<DailyGame, "gameId" | "homeTeam" | "awayTeam">,
) {
  return {
    id: overrides.id || "game-row",
    gameId: overrides.gameId,
    sport: overrides.sport || "NBA",
    homeTeam: overrides.homeTeam,
    awayTeam: overrides.awayTeam,
    startTime: overrides.startTime || new Date("2026-03-08T23:30:00.000Z"),
    date: overrides.date || new Date("2026-03-08T12:00:00.000Z"),
    status: overrides.status || "scheduled",
    homeScore: overrides.homeScore ?? null,
    awayScore: overrides.awayScore ?? null,
    providerGameId: overrides.providerGameId || null,
    liveMarketStatus: overrides.liveMarketStatus || null,
    createdAt: overrides.createdAt || new Date("2026-03-08T00:00:00.000Z"),
    updatedAt: overrides.updatedAt || new Date("2026-03-08T00:00:00.000Z"),
  } as DailyGame;
}

function makeHoldingSummary(
  player: Player,
  overrides: Partial<HoldingWithPlayerSummary> &
    Pick<HoldingWithPlayerSummary, "id" | "userId" | "isStackedShare">,
): HoldingWithPlayerSummary {
  return {
    id: overrides.id,
    userId: overrides.userId,
    assetType: "player",
    assetId: player.id,
    quantity: overrides.quantity || "2",
    effectiveShares: overrides.effectiveShares || overrides.quantity || "2",
    multiplier: overrides.multiplier || "1.00",
    isStackedShare: overrides.isStackedShare,
    avgCostBasis: overrides.avgCostBasis || "10.00",
    totalCostBasis: overrides.totalCostBasis || "20.00",
    lastUpdated: overrides.lastUpdated || new Date("2026-03-08T00:00:00.000Z"),
    player,
  } as HoldingWithPlayerSummary;
}

describe("buildMobileMarketOverview", () => {
  const now = new Date("2026-03-08T19:00:00.000Z");
  const playerOne = makePlayer({
    id: "p1",
    firstName: "Avery",
    lastName: "Ace",
    team: "AAA",
    position: "G",
    priceChange24h: "12.4",
    lastTradePrice: "30.00",
    volume24h: 4200,
  });
  const playerTwo = makePlayer({
    id: "p2",
    firstName: "Blake",
    lastName: "Bishop",
    team: "BBB",
    position: "F",
    priceChange24h: "-2.2",
    lastTradePrice: "14.50",
    volume24h: 1800,
  });
  const playerThree = makePlayer({
    id: "p3",
    firstName: "Casey",
    lastName: "Clutch",
    team: "CCC",
    position: "C",
    priceChange24h: "3.1",
    lastTradePrice: "9.25",
    volume24h: 600,
  });
  const playerFour = makePlayer({
    id: "p4",
    firstName: "Devon",
    lastName: "Dart",
    team: "DDD",
    position: "G",
    priceChange24h: "5.5",
    lastTradePrice: "8.10",
    volume24h: 250,
  });
  const playerFive = makePlayer({
    id: "p5",
    firstName: "Emmett",
    lastName: "Edge",
    team: "EEE",
    position: "WR",
    sport: "NFL",
    priceChange24h: "18.7",
    lastTradePrice: "22.00",
    volume24h: 5200,
  });
  const playerSix = makePlayer({
    id: "p6",
    firstName: "Flynn",
    lastName: "Freeze",
    team: "FFF",
    position: "G",
    priceChange24h: "9.4",
    lastTradePrice: "16.00",
    volume24h: 2400,
  });

  const baseDeps: MarketMobileOverviewDeps = {
    getFinancialMarketScanners: async () => ({
      undervalued: [
        { player: playerTwo, metrics: { valueIndex: 78, sentiment: { buyPressure: 61 } } },
        { player: playerFour, metrics: { valueIndex: 70, sentiment: { buyPressure: 58 } } },
      ],
      premium: [],
      sentiment: [
        { player: playerOne, metrics: { valueIndex: 112, sentiment: { buyPressure: 73 } } },
      ],
      momentum: [
        { player: playerOne, metrics: { valueIndex: 112, sentiment: { buyPressure: 73 } } },
        { player: playerFour, metrics: { valueIndex: 70, sentiment: { buyPressure: 58 } } },
      ],
    }),
    getMarketActivity: async () => [
      {
        id: "trade-1",
        playerId: "p1",
        playerFirstName: "Avery",
        playerLastName: "Ace",
        playerTeam: "AAA",
        quantity: 200,
        price: "30.00",
        timestamp: now.toISOString(),
      },
    ],
    getDailyGames: async () => [
      makeGame({
        gameId: "g1",
        homeTeam: "AAA",
        awayTeam: "XYZ",
        status: "inprogress",
        startTime: new Date("2026-03-08T18:00:00.000Z"),
      }),
      makeGame({
        gameId: "g2",
        homeTeam: "CCC",
        awayTeam: "QRS",
        status: "scheduled",
        startTime: new Date("2026-03-08T23:30:00.000Z"),
      }),
    ],
    getBatchPoolData: async (playerIds) =>
      new Map(
        playerIds.map((playerId) => [
          playerId,
          {
            shares: playerId === "p1" ? 4000 : 5000,
            playMoney: playerId === "p1" ? 120000 : playerId === "p3" ? 46250 : 40500,
            totalVolume: 10000,
            totalTrades: 150,
          },
        ]),
      ),
    getBatchActiveScoutCounts: async () =>
      new Map([
        ["p1", 18],
        ["p3", 11],
        ["p4", 23],
      ]),
    getCommunityBoostsAllSports: async () => [
      { playerId: "p1", sport: "NBA" },
      { playerId: "p3", sport: "NBA" },
      { playerId: "p3", sport: "NBA" },
    ],
    getPlayersByIds: async (playerIds) =>
      [playerOne, playerTwo, playerThree, playerFour, playerFive, playerSix].filter((player) =>
        playerIds.includes(player.id),
      ),
    getPlayerFinancialMetrics: async (playerId) => ({
      heatCheck: { status: playerId === "p1" ? "fire" : "neutral" },
    }),
    getWatchList: async () => ["p2", "p4"],
    getAllHoldingsWithPlayers: async () => [
      makeHoldingSummary(playerThree, {
        id: "holding-1",
        userId: "user-1",
        quantity: "1",
        multiplier: "3.00",
        effectiveShares: "3.00",
        isStackedShare: true,
      }),
    ],
    getDailyBoostsAllSports: async () => [],
    getTotalLockedQuantity: async (_userId, _assetType, assetId) => (assetId === "p3" ? 1 : 0),
    getRecentTradeCount15m: async () => 1,
    getTrendingScoutPlayerIds: async () => ["p4"],
    now: () => now,
  };

  it("builds the public mobile overview with low-activity fallback signals", async () => {
    const overview = await buildMobileMarketOverview({ sport: "NBA" }, baseDeps);

    expect(overview.pulse.lowActivity).toBe(true);
    expect(overview.pulse.tradeCount15m).toBe(1);
    expect(overview.ticker[0]?.playerId).toBe("p1");
    expect(overview.ticker[0]?.isWhale).toBe(true);
    expect(overview.nowMoving[0]?.playerId).toBe("p1");
    expect(overview.nowMoving[0]?.heatCheckStatus).toBe("fire");
    expect(overview.quietValue.map((entry) => entry.playerId)).toContain("p4");
    expect(overview.scoutSurge[0]?.playerId).toBe("p4");
    expect(overview.boostWindow.map((entry) => entry.playerId)).toContain("p3");
    expect(overview.watchlistMoves).toHaveLength(0);
  });

  it("adds authenticated watchlist context and personal boost opportunities", async () => {
    const overview = await buildMobileMarketOverview({ sport: "NBA", userId: "user-1" }, baseDeps);

    const personalBoost = overview.boostWindow.find((entry) => entry.playerId === "p3");

    expect(overview.pulse.openBoostSlots).toBe(4);
    expect(personalBoost?.availableShares).toBe(1);
    expect(personalBoost?.bestShareMultiplier).toBe(3);
    expect(personalBoost?.signal).toBe("boost");
    expect(overview.watchlistMoves.map((entry) => entry.playerId)).toEqual(["p4", "p2"]);
  });

  it("keeps watchlist movers inside the requested sport", async () => {
    const overview = await buildMobileMarketOverview(
      { sport: "NBA", userId: "user-1" },
      {
        ...baseDeps,
        getWatchList: async () => ["p5", "p4"],
      },
    );

    expect(overview.watchlistMoves.map((entry) => entry.playerId)).toEqual(["p4"]);
  });

  it("treats postponed games as out of slate for boost windows", async () => {
    const overview = await buildMobileMarketOverview(
      { sport: "NBA" },
      {
        ...baseDeps,
        getFinancialMarketScanners: async () => ({
          undervalued: [],
          premium: [],
          sentiment: [
            { player: playerSix, metrics: { valueIndex: 91, sentiment: { buyPressure: 67 } } },
          ],
          momentum: [
            { player: playerSix, metrics: { valueIndex: 91, sentiment: { buyPressure: 67 } } },
          ],
        }),
        getDailyGames: async () => [
          makeGame({
            gameId: "g-postponed",
            homeTeam: "FFF",
            awayTeam: "XYZ",
            status: "postponed",
            startTime: new Date("2026-03-08T18:00:00.000Z"),
          }),
        ],
        getCommunityBoostsAllSports: async () => [{ playerId: "p6", sport: "NBA" }],
        getMarketActivity: async () => [],
        getBatchActiveScoutCounts: async () => new Map(),
        getTrendingScoutPlayerIds: async () => [],
        getWatchList: async () => [],
      },
    );

    expect(overview.boostWindow).toHaveLength(0);
    expect(overview.nowMoving[0]?.gameStatus).toBe("none");
  });
});

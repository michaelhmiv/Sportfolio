import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPlayer: vi.fn(),
  getUser: vi.fn(),
  updateUserPremiumStatus: vi.fn(),
  getActiveRewardedScoutBoostForUser: vi.fn(),
  getUserScoutAssignments: vi.fn(),
  getPlayers: vi.fn(),
  getPlayersByIds: vi.fn(),
  getDailyGames: vi.fn(),
  getBatchAllTimeAvgFantasyPoints: vi.fn(),
  getFinancialMarketScanners: vi.fn(),
  getUserHoldingsWithPlayers: vi.fn(),
  getAvailableBalance: vi.fn(),
  getAvailableShares: vi.fn(),
  getTotalScoutsForUser: vi.fn(),
  getWatchlists: vi.fn(),
  getPlayerWatchlists: vi.fn(),
  getUserCommunityBoostShares: vi.fn(),
  getCommunityBoostsForDate: vi.fn(),
  getVesting: vi.fn(),
  getVestingSplits: vi.fn(),
  getDailyBoosts: vi.fn(),
  getDailyBoostsAllSports: vi.fn(),
  getPlayerGameForDate: vi.fn(),
  getPlayerShareBreakdown: vi.fn(),
  getDailyGameByGameId: vi.fn(),
}));

const poolMocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  getBuyQuote: vi.fn(),
  getSellQuote: vi.fn(),
  getLpPosition: vi.fn(),
  getZapAddQuoteSharesOnly: vi.fn(),
  getZapAddQuoteSbOnly: vi.fn(),
}));

const dataSourceMocks = vi.hoisted(() => ({
  getAgentDataSourceSummary: vi.fn(),
}));

const mlbMcpMocks = vi.hoisted(() => ({
  resolveInternalMlbMcpConfig: vi.fn(),
  runInternalMlbMcpToolRaw: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../amm/pool", () => ({
  getPool: poolMocks.getPool,
  getBuyQuote: poolMocks.getBuyQuote,
  getSellQuote: poolMocks.getSellQuote,
  getLpPosition: poolMocks.getLpPosition,
  getZapAddQuoteSharesOnly: poolMocks.getZapAddQuoteSharesOnly,
  getZapAddQuoteSbOnly: poolMocks.getZapAddQuoteSbOnly,
}));

vi.mock("./data-sources", () => ({
  getAgentDataSourceSummary: dataSourceMocks.getAgentDataSourceSummary,
}));

vi.mock("./internal-mlb-mcp", () => ({
  resolveInternalMlbMcpConfig: mlbMcpMocks.resolveInternalMlbMcpConfig,
  runInternalMlbMcpToolRaw: mlbMcpMocks.runInternalMlbMcpToolRaw,
}));

vi.mock("../db", () => ({
  db: {
    select: dbMocks.select,
  },
}));

describe("planDirectAgentOperation", () => {
  const profile = {
    defaultSport: "NBA",
  } as any;
  const player = {
    id: "nba_star",
    firstName: "Nikola",
    lastName: "Jokic",
    sport: "NBA",
    team: "DEN",
    volume24h: 1200,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: dbMocks.limit,
          }),
        }),
      }),
    }));
    dbMocks.limit.mockResolvedValue([]);
    dataSourceMocks.getAgentDataSourceSummary.mockResolvedValue({
      builtIn: [
        {
          id: "internal_mlb_mcp",
          kind: "built_in",
          name: "MLB Data Feed",
          description: "Built-in in-house MLB data for Hermes.",
          enabled: true,
          available: true,
          capabilitySummary: "In-house MLB data and leaderboard context.",
        },
      ],
      external: [],
    });
    mlbMcpMocks.resolveInternalMlbMcpConfig.mockReturnValue({
      enabled: true,
      endpoint: "http://127.0.0.1:8081/mcp",
      toolPrefix: "mlb_mcp__",
    });
    mlbMcpMocks.runInternalMlbMcpToolRaw.mockResolvedValue({
      remoteToolName: "get_league_leader_data",
      content: [],
      replyText: null,
      structuredContent: {
        result: {
          leaders: [],
        },
      },
    });
    storageMocks.getPlayer.mockResolvedValue(player);
    storageMocks.getUser.mockResolvedValue({ id: "user_1", isPremium: false });
    storageMocks.updateUserPremiumStatus.mockResolvedValue(undefined);
    storageMocks.getActiveRewardedScoutBoostForUser.mockResolvedValue(undefined);
    storageMocks.getPlayers.mockResolvedValue([
      {
        ...player,
        isActive: true,
        avgFantasyPointsPerGame: "51.2",
        priceChange24h: "4.80",
        marketCap: "1200000",
      },
      {
        id: "nba_hot",
        firstName: "Shai",
        lastName: "Gilgeous-Alexander",
        sport: "NBA",
        team: "OKC",
        volume24h: 2200,
        isActive: true,
        avgFantasyPointsPerGame: "54.4",
        priceChange24h: "6.20",
        marketCap: "1500000",
      },
      {
        id: "nba_value",
        firstName: "Jalen",
        lastName: "Williams",
        sport: "NBA",
        team: "OKC",
        volume24h: 650,
        isActive: true,
        avgFantasyPointsPerGame: "39.9",
        priceChange24h: "3.10",
        marketCap: "420000",
      },
    ]);
    storageMocks.getPlayersByIds.mockResolvedValue([
      {
        id: "nba_star",
        firstName: "Nikola",
        lastName: "Jokic",
      },
    ]);
    storageMocks.getDailyGames.mockResolvedValue([
      {
        gameId: "game_1",
        sport: "NBA",
        homeTeam: "DEN",
        awayTeam: "LAL",
        status: "scheduled",
        startTime: new Date(Date.now() + 60 * 60 * 1000),
      },
      {
        gameId: "game_2",
        sport: "NBA",
        homeTeam: "OKC",
        awayTeam: "MIN",
        status: "scheduled",
        startTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    ]);
    storageMocks.getBatchAllTimeAvgFantasyPoints.mockResolvedValue(
      new Map([
        ["nba_star", 51.2],
        ["nba_hot", 54.4],
        ["nba_value", 39.9],
      ]),
    );
    storageMocks.getFinancialMarketScanners.mockResolvedValue({
      undervalued: [{ player: { id: "nba_value" } }],
      premium: [],
      sentiment: [{ player: { id: "nba_hot" } }],
      momentum: [{ player: { id: "nba_hot" } }],
    });
    storageMocks.getUserHoldingsWithPlayers.mockResolvedValue([
      {
        holding: { assetType: "player" },
        player: { id: "nba_star" },
      },
      {
        holding: { assetType: "player" },
        player: { id: "nba_value" },
      },
    ]);
    storageMocks.getAvailableBalance.mockResolvedValue(1000);
    storageMocks.getAvailableShares.mockResolvedValue(10);
    storageMocks.getTotalScoutsForUser.mockResolvedValue(3);
    storageMocks.getUserScoutAssignments.mockResolvedValue([
      {
        playerId: "nba_star",
        scoutCount: 2,
      },
    ]);
    storageMocks.getWatchlists.mockResolvedValue([
      {
        id: "wl_1",
        name: "Favorites",
        isDefault: true,
        color: null,
        itemCount: 1,
      },
    ]);
    storageMocks.getPlayerWatchlists.mockResolvedValue([]);
    storageMocks.getUserCommunityBoostShares.mockResolvedValue(2);
    storageMocks.getCommunityBoostsForDate.mockResolvedValue([]);
    storageMocks.getVesting.mockResolvedValue({
      playerId: "nba_star",
      sharesAccumulated: 8,
      residualMs: 0,
      lastAccruedAt: new Date(),
      updatedAt: new Date(),
    });
    storageMocks.getVestingSplits.mockResolvedValue([]);
    storageMocks.getDailyBoosts.mockResolvedValue([]);
    storageMocks.getDailyBoostsAllSports.mockResolvedValue([]);
    storageMocks.getPlayerGameForDate.mockResolvedValue({
      gameId: "game_1",
      startTime: new Date(Date.now() + 60 * 60 * 1000),
      homeTeam: "DEN",
      awayTeam: "LAL",
    });
    storageMocks.getPlayerShareBreakdown.mockResolvedValue({
      regular: {
        quantity: "2",
      },
      stacked: [],
    });
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "game_1",
      startTime: new Date(Date.now() + 60 * 60 * 1000),
    });
    poolMocks.getPool.mockResolvedValue({
      shares: 1000,
      playMoney: 10000,
      lpSharesTotal: 1000,
      currentPrice: 10,
    });
    poolMocks.getBuyQuote.mockImplementation(async (_playerId: string, sbAmount: number) => ({
      sharesOut: sbAmount / 10.53,
      effectivePrice: 10.53,
      slippagePercent: 0.02,
    }));
    poolMocks.getSellQuote.mockResolvedValue({
      sbOut: 48.5,
      effectivePrice: 9.7,
      slippagePercent: 0.018,
    });
    poolMocks.getLpPosition.mockResolvedValue({
      lpShares: 50,
      ownershipPercentage: 0.05,
      equivalentShares: 10,
      equivalentPlayMoney: 100,
    });
    poolMocks.getZapAddQuoteSharesOnly.mockResolvedValue({
      estimatedLpSharesMinted: 2.25,
    });
    poolMocks.getZapAddQuoteSbOnly.mockResolvedValue({
      estimatedLpSharesMinted: 1.75,
    });
  });

  it("stages a pool buy for a direct command", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "buy $100 of nba_star",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "nba_star",
      sbAmount: 100,
    });
  }, 20000);

  it("does not stage a pool buy when the current quote already exceeds the slippage guard", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    poolMocks.getBuyQuote.mockResolvedValueOnce({
      sharesOut: 4,
      effectivePrice: 25,
      slippagePercent: 0.12,
    });

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "buy $100 of nba_star",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.actions).toEqual([]);
    expect(result?.summary).toContain("above the 5.00% execution guard");
    expect(result?.trace).toMatchObject({
      intent: "pool_buy",
      reason: "quote_slippage_too_high",
    });
  }, 15000);

  it("keeps an advisory pool buy in discussion mode", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "what do you think about buying $100 of nba_star?",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(0);
    expect(result?.replyText).toContain("queue it up for confirmation");
  });

  it("parses a conversational pool buy request as a direct command", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "can you grab $100 of nba_star for me?",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "nba_star",
      sbAmount: 100,
    });
  });

  it("stages a share-count pool buy by estimating the spend", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "buy 16 nba_star shares",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "nba_star",
    });
    expect(result?.actions[0]?.sbAmount).toBeGreaterThan(0);
  });

  it("stages a starter-size pool buy when the user omits the amount", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "buy nba_star shares",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "nba_star",
      sbAmount: 25,
    });
    expect(result?.warnings).toContain(
      "I assumed you wanted a starter buy and sized it to $25.00 under the current slippage guard.",
    );
  });

  it("stages a max-safe pool buy when the user says to buy as much as possible", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "buy as much nba_star as I can afford",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "nba_star",
      sbAmount: 1000,
    });
    expect(result?.warnings).toContain(
      "I assumed you wanted the largest safe buy size the current balance and pool depth allow.",
    );
  });

  it("stages a combined buy, stack-shares, and boost workflow", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy 16 nba_star shares, stack them all and put that share into my 5x boost slot tomorrow",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions).toHaveLength(3);
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_buy",
      "holdings_stack_shares",
      "daily_boost_assign",
    ]);
  });

  it("stages a buy then boost workflow from a compound dollar request", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "buy $25 of nba_star and put him in my 4x boost slot today",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_buy",
      "daily_boost_assign",
    ]);
    expect(result?.contextSnapshot?.intent).toBe("buy_then_boost");
  });

  it("stages a buy then boost workflow by assuming a starter buy size", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "buy nba_star and put him in my 4x boost slot today",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_buy",
      "daily_boost_assign",
    ]);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "nba_star",
      sbAmount: 25,
    });
    expect(result?.warnings).toContain(
      "I assumed you wanted a starter buy and sized it to $25.00 under the current slippage guard.",
    );
  });

  it("stages an optional buy stack boost workflow when the post-buy shares support stacking", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy $25 of nba_star, stack shares if possible, and put him in my 4x boost slot if eligible",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_buy",
      "holdings_stack_shares",
      "daily_boost_assign",
    ]);
    expect(result?.contextSnapshot?.intent).toBe("buy_then_stack_then_boost");
  });

  it("stages a natural-language stack then boost workflow with a full player name", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    dbMocks.limit.mockResolvedValueOnce([
      {
        ...player,
        isActive: true,
      },
    ]);
    storageMocks.getAvailableShares.mockResolvedValue(24);
    storageMocks.getPlayerShareBreakdown.mockResolvedValue({
      regular: {
        quantity: "24",
      },
      stacked: [],
    });

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "stack 20 shares of Nikola Jokic and put him in my 3x boost slot tomorrow",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.contextSnapshot?.intent).toBe("stack_then_boost");
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "holdings_stack_shares",
      "daily_boost_assign",
    ]);
    expect(result?.actions[0]).toMatchObject({
      actionType: "holdings_stack_shares",
      playerId: "nba_star",
      sharesToStack: 20,
    });
    expect(result?.actions[1]).toMatchObject({
      actionType: "daily_boost_assign",
      playerId: "nba_star",
      slotTier: 3,
      shareMultiplier: 10,
    });
  });

  it("stages a sell then stack then boost workflow with post-sell share math", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    dbMocks.limit.mockResolvedValueOnce([
      {
        ...player,
        isActive: true,
      },
    ]);
    storageMocks.getAvailableShares.mockResolvedValue(30);
    storageMocks.getPlayerShareBreakdown.mockResolvedValue({
      regular: {
        quantity: "30",
      },
      stacked: [],
    });

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "sell 10 shares of Nikola Jokic, then stack the rest and put him in my 2x boost slot tomorrow",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.contextSnapshot?.intent).toBe("sell_then_stack_then_boost");
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_sell",
      "holdings_stack_shares",
      "daily_boost_assign",
    ]);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_sell",
      playerId: "nba_star",
      sharesAmount: 10,
      availableSharesAfter: 20,
    });
    expect(result?.actions[1]).toMatchObject({
      actionType: "holdings_stack_shares",
      playerId: "nba_star",
      sharesToStack: 20,
    });
    expect(result?.actions[2]).toMatchObject({
      actionType: "daily_boost_assign",
      playerId: "nba_star",
      slotTier: 2,
      shareMultiplier: 10,
    });
  });

  it("does not let the profile default sport override an exact full-name player match", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");
    const anthonyEdwards = {
      id: "nba_27638",
      sport: "NBA",
      firstName: "Anthony",
      lastName: "Edwards",
      team: "MIN",
      position: "G",
      isActive: true,
      volume24h: 5426,
    };

    dbMocks.limit.mockResolvedValueOnce([anthonyEdwards]);
    storageMocks.getAvailableShares.mockResolvedValue(30);
    storageMocks.getPlayerShareBreakdown.mockResolvedValue({
      regular: {
        quantity: "30",
      },
      stacked: [],
    });

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "sell 1 share of Anthony Edwards, then stack 4 of his shares, then put him in my 5x boost slot tomorrow",
      profile: {
        ...profile,
        defaultSport: "MLB",
      },
    });

    expect(result).not.toBeNull();
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_sell",
      "holdings_stack_shares",
      "daily_boost_assign",
    ]);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_sell",
      playerId: "nba_27638",
      playerName: "Anthony Edwards",
      sharesAmount: 1,
    });
    expect(result?.actions[2]).toMatchObject({
      actionType: "daily_boost_assign",
      playerId: "nba_27638",
      slotTier: 5,
    });
  });

  it("stages a ranked MLB workflow for leaderboard-selected pitchers with ordered boost slots", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    mlbMcpMocks.runInternalMlbMcpToolRaw.mockResolvedValueOnce({
      remoteToolName: "get_league_leader_data",
      content: [],
      replyText: null,
      structuredContent: {
        result: {
          leaders: [
            [1, "Max Fried", "New York Yankees", "0.00"],
            [1, "Sandy Alcantara", "Miami Marlins", "0.00"],
            [1, "Seth Lugo", "Kansas City Royals", "0.00"],
          ],
        },
      },
    });
    dbMocks.limit
      .mockResolvedValueOnce([
        {
          id: "mlb_fried",
          firstName: "Max",
          lastName: "Fried",
          sport: "MLB",
          team: "NYY",
          volume24h: 900,
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "mlb_alcantara",
          firstName: "Sandy",
          lastName: "Alcantara",
          sport: "MLB",
          team: "MIA",
          volume24h: 850,
          isActive: true,
        },
      ]);
    storageMocks.getPlayer.mockImplementation(async (playerId: string) => {
      if (playerId === "mlb_fried") {
        return {
          id: "mlb_fried",
          firstName: "Max",
          lastName: "Fried",
          sport: "MLB",
          team: "NYY",
          volume24h: 900,
        };
      }
      if (playerId === "mlb_alcantara") {
        return {
          id: "mlb_alcantara",
          firstName: "Sandy",
          lastName: "Alcantara",
          sport: "MLB",
          team: "MIA",
          volume24h: 850,
        };
      }
      return player;
    });
    storageMocks.getPlayerGameForDate.mockImplementation(async (playerId: string) => ({
      gameId: `${playerId}_game`,
      startTime: new Date(Date.now() + 60 * 60 * 1000),
      homeTeam: playerId === "mlb_fried" ? "NYY" : "MIA",
      awayTeam: playerId === "mlb_fried" ? "BOS" : "ATL",
    }));

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy max shares for the two pitchers with lowest ERAs this season, then stack and boost in 5x and 4x respectively",
      profile,
    });

    expect(mlbMcpMocks.runInternalMlbMcpToolRaw).toHaveBeenCalledWith({
      toolName: "mlb_mcp__get_league_leader_data",
      args: expect.objectContaining({
        leader_categories: "earnedRunAverage",
        stat_group: "pitching",
        season: 2026,
      }),
    });
    expect(result).not.toBeNull();
    expect(result?.contextSnapshot?.intent).toBe("ranked_stat_multi_player_workflow");
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_buy",
      "holdings_stack_shares",
      "daily_boost_assign",
      "pool_buy",
      "holdings_stack_shares",
      "daily_boost_assign",
    ]);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "mlb_fried",
      sbAmount: 500,
      availableBalanceBefore: 1000,
      availableBalanceAfter: 500,
    });
    expect(result?.actions[3]).toMatchObject({
      actionType: "pool_buy",
      playerId: "mlb_alcantara",
      sbAmount: 500,
      availableBalanceBefore: 500,
      availableBalanceAfter: 0,
    });
    expect(result?.actions[2]).toMatchObject({
      actionType: "daily_boost_assign",
      playerId: "mlb_fried",
      slotTier: 5,
    });
    expect(result?.actions[5]).toMatchObject({
      actionType: "daily_boost_assign",
      playerId: "mlb_alcantara",
      slotTier: 4,
    });
    expect(result?.warnings).toContain(
      "I staged each ranked buy at the largest safe size the remaining balance and current pool depth allowed while keeping the leaderboard order intact.",
    );
  });

  it("skips invalid top-ranked pitchers and keeps searching for a viable ordered ranked workflow", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    mlbMcpMocks.runInternalMlbMcpToolRaw.mockResolvedValueOnce({
      remoteToolName: "get_league_leader_data",
      content: [],
      replyText: null,
      structuredContent: {
        result: {
          leaders: [
            [1, "Max Fried", "New York Yankees", "0.00"],
            [2, "Sandy Alcantara", "Miami Marlins", "0.41"],
            [3, "Seth Lugo", "Kansas City Royals", "0.55"],
          ],
        },
      },
    });
    dbMocks.limit
      .mockResolvedValueOnce([
        {
          id: "mlb_fried",
          firstName: "Max",
          lastName: "Fried",
          sport: "MLB",
          team: "NYY",
          volume24h: 900,
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "mlb_alcantara",
          firstName: "Sandy",
          lastName: "Alcantara",
          sport: "MLB",
          team: "MIA",
          volume24h: 850,
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "mlb_lugo",
          firstName: "Seth",
          lastName: "Lugo",
          sport: "MLB",
          team: "KC",
          volume24h: 800,
          isActive: true,
        },
      ]);
    storageMocks.getPlayerGameForDate.mockImplementation(async (playerId: string) => {
      if (playerId === "mlb_fried") {
        return null;
      }

      return {
        gameId: `${playerId}_game`,
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        homeTeam: playerId === "mlb_alcantara" ? "MIA" : "KC",
        awayTeam: playerId === "mlb_alcantara" ? "ATL" : "MIN",
      };
    });

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy max shares for the two pitchers with lowest ERAs this season, then stack and boost in 5x and 4x respectively",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_buy",
      "holdings_stack_shares",
      "daily_boost_assign",
      "pool_buy",
      "holdings_stack_shares",
      "daily_boost_assign",
    ]);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "mlb_alcantara",
      sbAmount: 500,
      availableBalanceBefore: 1000,
      availableBalanceAfter: 500,
    });
    expect(result?.actions[3]).toMatchObject({
      actionType: "pool_buy",
      playerId: "mlb_lugo",
      sbAmount: 500,
      availableBalanceBefore: 500,
      availableBalanceAfter: 0,
    });
    expect(result?.actions[2]).toMatchObject({
      actionType: "daily_boost_assign",
      playerId: "mlb_alcantara",
      slotTier: 5,
    });
    expect(result?.actions[5]).toMatchObject({
      actionType: "daily_boost_assign",
      playerId: "mlb_lugo",
      slotTier: 4,
    });
    expect(
      Array.isArray(result?.contextSnapshot?.candidateAssessments) &&
        result?.contextSnapshot?.candidateAssessments,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: "mlb_fried",
          status: "unavailable",
          reason: "boost_step_unavailable",
        }),
      ]),
    );
  });

  it("fails fast when a requested ranked-workflow boost slot is already occupied", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    storageMocks.getDailyBoosts.mockResolvedValueOnce([
      {
        slotTier: 4,
        playerId: "mlb_occupied",
        sport: "MLB",
      },
    ]);

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy max shares for the two pitchers with lowest ERAs this season, then stack and boost in 5x and 4x respectively",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.actions).toEqual([]);
    expect(result?.summary).toContain("4x slot is already filled");
    expect(result?.replyText).toContain("did not stage a partial bundle");
    expect(mlbMcpMocks.runInternalMlbMcpToolRaw).not.toHaveBeenCalled();
  });

  it("does not let cross-sport occupied slots block an MLB ranked workflow", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    storageMocks.getAvailableBalance.mockResolvedValueOnce(250);
    storageMocks.getDailyBoosts.mockResolvedValueOnce([]);
    storageMocks.getDailyBoostsAllSports.mockResolvedValue([]);
    mlbMcpMocks.runInternalMlbMcpToolRaw.mockResolvedValueOnce({
      remoteToolName: "get_league_leader_data",
      content: [],
      replyText: null,
      structuredContent: {
        result: {
          leaders: [
            [1, "Sandy Alcantara", "MIA", "1.90"],
            [2, "Max Fried", "NYY", "2.05"],
          ],
        },
      },
    });
    dbMocks.limit
      .mockResolvedValueOnce([
        {
          id: "mlb_alcantara",
          firstName: "Sandy",
          lastName: "Alcantara",
          sport: "MLB",
          team: "MIA",
          volume24h: 1200,
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "mlb_fried",
          firstName: "Max",
          lastName: "Fried",
          sport: "MLB",
          team: "NYY",
          volume24h: 1100,
          isActive: true,
        },
      ]);
    poolMocks.getPool.mockResolvedValue({
      playerId: "pool",
      playerName: "Pool",
      yesPrice: "0.50",
      noPrice: "0.50",
      poolType: "dynamic",
      totalLiquidity: "5000",
      yesShares: "5000",
      noShares: "5000",
    });
    poolMocks.getBuyQuote.mockImplementation(async ({ playerId }) => ({
      playerId,
      estimatedShares: "20",
      totalCost: "125",
      averagePricePerShare: "6.25",
      priceImpact: "0.01",
      estimatedPosition: {
        quantity: 20,
        avgCostBasis: "6.25",
      },
    }));
    storageMocks.getPlayerGameForDate.mockImplementation(async (playerId) => {
      const team = playerId === "mlb_alcantara" ? "MIA" : "NYY";
      return {
        id: `${playerId}_game`,
        gameId: `${playerId}_game`,
        sport: "MLB",
        homeTeam: team,
        awayTeam: "ATL",
        startTime: new Date("2026-03-03T23:10:00.000Z"),
        status: "scheduled",
      };
    });
    storageMocks.getPlayerShareBreakdown.mockResolvedValue({
      playerId: "player",
      regularShares: 20,
      powerShares: [],
      totalUnlockedShares: 20,
      maxStackableShares: 20,
      bestAssignableHolding: {
        quantity: 1,
        power: 10,
        powerLevel: 10,
      },
    });
    storageMocks.getAvailableShares.mockResolvedValue(20);

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy max shares for the two pitchers with lowest ERAs this season, then stack and boost in 5x and 4x respectively",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.summary.toLowerCase()).not.toContain("slot is already filled");
    expect(mlbMcpMocks.runInternalMlbMcpToolRaw).toHaveBeenCalled();
    expect(storageMocks.getDailyBoosts).toHaveBeenCalledWith("user_1", "MLB", expect.any(Date));
  });

  it("caps ranked workflow buy sizes to the largest safe slippage-constrained amounts", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    mlbMcpMocks.runInternalMlbMcpToolRaw.mockResolvedValueOnce({
      remoteToolName: "get_league_leader_data",
      content: [],
      replyText: null,
      structuredContent: {
        result: {
          leaders: [
            [1, "Sandy Alcantara", "MIA", "1.90"],
            [2, "Seth Lugo", "KC", "2.05"],
          ],
        },
      },
    });
    dbMocks.limit
      .mockResolvedValueOnce([
        {
          id: "mlb_alcantara",
          firstName: "Sandy",
          lastName: "Alcantara",
          sport: "MLB",
          team: "MIA",
          volume24h: 1200,
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "mlb_lugo",
          firstName: "Seth",
          lastName: "Lugo",
          sport: "MLB",
          team: "KC",
          volume24h: 1100,
          isActive: true,
        },
      ]);
    poolMocks.getBuyQuote.mockImplementation(async (playerId: string, sbAmount: number) => {
      const cap = playerId === "mlb_alcantara" ? 120 : 80;
      return {
        sharesOut: sbAmount / 10,
        effectivePrice: 10,
        slippagePercent: sbAmount <= cap ? 0.03 : 0.09,
      };
    });

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy max shares for the two pitchers with lowest ERAs this season, then stack and boost in 5x and 4x respectively",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_buy",
      "holdings_stack_shares",
      "daily_boost_assign",
      "pool_buy",
      "holdings_stack_shares",
      "daily_boost_assign",
    ]);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "mlb_alcantara",
      sbAmount: 120,
    });
    expect(result?.actions[3]).toMatchObject({
      actionType: "pool_buy",
      playerId: "mlb_lugo",
      sbAmount: 80,
    });
    expect(result?.warnings).toContain(
      "I staged each ranked buy at the largest safe size the remaining balance and current pool depth allowed while keeping the leaderboard order intact.",
    );
  });

  it("ignores parenthetical roster annotations in compound buy workflows", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "buy $25 of nba_star (DEN) and put him in my 4x daily boost slot today",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_buy",
      "daily_boost_assign",
    ]);
  });

  it("stages a pool sell for a direct command", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "sell 3 shares of nba_star",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_sell",
      playerId: "nba_star",
      sharesAmount: 3,
    });
  });

  it("stages a daily boost assignment", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "put nba_star in my 5x boost slot today",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("daily_boosts");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "daily_boost_assign",
      playerId: "nba_star",
      slotTier: 5,
    });
  });

  it("stages a daily boost assignment using the highest open slot when omitted", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "boost nba_star today",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("daily_boosts");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "daily_boost_assign",
      playerId: "nba_star",
      slotTier: 5,
    });
    expect(result?.warnings).toContain(
      "I assumed you wanted the highest open boost slot and used 5x.",
    );
  });

  it("stages a daily boost removal by slot", async () => {
    storageMocks.getDailyBoostsAllSports.mockResolvedValue([
      {
        id: "boost_1",
        userId: "user_1",
        playerId: "nba_star",
        sport: "NBA",
        slotTier: 5,
        status: "active",
        gameId: "game_1",
      },
    ]);

    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "remove my 5x boost slot",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("daily_boosts");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "daily_boost_remove",
      boostId: "boost_1",
      slotTier: 5,
    });
  });

  it("stages an optimal LP add", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "add up to 5 shares and $200 into nba_star pool",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_add_liquidity_optimal",
      playerId: "nba_star",
      maxShares: 5,
      maxPlayMoney: 200,
    });
  });

  it("stages an exact LP add", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "add 2 shares and $20 into nba_star pool",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_add_liquidity",
      playerId: "nba_star",
      shares: 2,
      playMoney: 20,
    });
  });

  it("stages an exact LP add for player-first phrasing", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "add liquidity to nba_star with 2 shares and $20",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_add_liquidity",
      playerId: "nba_star",
      shares: 2,
      playMoney: 20,
    });
  });

  it("rejects an exact LP add when the ratio is off", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "add 2 shares and $5 into nba_star pool",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(0);
    expect(result?.replyText).toContain("would fail right now because");
  });

  it("stages a share-side LP zap", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "zap 2 shares into nba_star pool",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_zap_add_shares",
      playerId: "nba_star",
      shares: 2,
    });
  });

  it("stages a cash-side LP zap", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "zap $20 into nba_star pool",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_zap_add_sb",
      playerId: "nba_star",
      sb: 20,
    });
  });

  it("stages an LP removal", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "remove 5 lp shares from nba_star pool",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_remove_liquidity",
      playerId: "nba_star",
      lpShares: 5,
    });
  });

  it("keeps an advisory boost assignment in discussion mode", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "what do you think about putting nba_star in my 5x boost slot today?",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("daily_boosts");
    expect(result?.actions).toHaveLength(0);
    expect(result?.replyText).toContain("queue it up for confirmation");
  });

  it("answers unstarted-game questions with market intelligence instead of a scout-only plan", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "who has a game that hasn't started tonight?",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions).toHaveLength(0);
    expect(result?.replyText).toContain("Nikola Jokic");
    expect(result?.replyText).toContain("Shai Gilgeous-Alexander");
  });

  it("stages scout removal for natural removal phrasing", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "remove scouts from nba_star",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("scouting");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "scout_set_count",
      playerId: "nba_star",
      targetCount: 0,
      currentCount: 2,
    });
    expect(result?.replyText).toContain("Pull all scouts off Nikola Jokic");
  });

  it("stages one scout when the user omits the scout count", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "scout nba_star",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("scouting");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "scout_set_count",
      playerId: "nba_star",
      targetCount: 1,
    });
    expect(result?.warnings).toContain("I assumed you wanted to assign 1 scout.");
  });

  it("returns a broad operator review for setup-review prompts", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "review my setup",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions).toHaveLength(0);
    expect(result?.summary).toContain("Broad operator review");
    expect(result?.replyText).toContain("broad operator read");
    expect(result?.replyText).toContain("community shares available");
  });

  it("explains the broad operator capability surface", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "what can you do?",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions).toHaveLength(0);
    expect(result?.replyText).toContain("player-pool buys and sells");
    expect(result?.replyText).toContain("built-in Hermes-only MLB enrichment connection");
    expect(result?.replyText).toContain("wait for your confirmation");
  });

  it("returns a portfolio cleanup review for cleanup prompts", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "clean up my portfolio",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions).toHaveLength(0);
    expect(result?.summary).toContain("portfolio cleanup");
    expect(result?.replyText).toContain("cleanup lever");
  });

  it("returns an idle-capital deployment read", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "what should i do with my idle balance?",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions).toHaveLength(0);
    expect(result?.summary).toContain("Idle-capital");
    expect(result?.replyText).toContain("deployable leverage");
  });

  it("returns a community-boost opportunity scan", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "who should get my community boost today?",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("community_boosts");
    expect(result?.actions).toHaveLength(0);
    expect(result?.summary).toContain("community-boost opportunity");
    expect(result?.replyText).toContain("community-boost look");
  });

  it("can suppress broad advisory planners when Hermes wants mutation-only previews", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const capabilityResult = await planDirectAgentOperation({
      userId: "user_1",
      message: "what can you do?",
      profile,
      allowAdvisoryResponses: false,
    });
    const setupReviewResult = await planDirectAgentOperation({
      userId: "user_1",
      message: "review my setup",
      profile,
      allowAdvisoryResponses: false,
    });
    const marketReadResult = await planDirectAgentOperation({
      userId: "user_1",
      message: "who has a game that hasn't started tonight?",
      profile,
      allowAdvisoryResponses: false,
    });

    expect(capabilityResult).toBeNull();
    expect(setupReviewResult).toBeNull();
    expect(marketReadResult).toBeNull();
  });

  it("stores a player-name clarification for a blocked multi-step workflow", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");
    storageMocks.getPlayer.mockResolvedValueOnce(undefined);

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy 16 nba_unknown shares, stack them all and put that share into my 5x boost slot tomorrow",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.actions).toHaveLength(0);
    expect(result?.pendingClarification).toMatchObject({
      kind: "player_name",
      missingFields: ["player_name"],
    });
    expect(result?.pendingClarification?.resumeMessageTemplate).toContain("{player}");
    expect(result?.pendingClarification?.workflowPreviewSteps).toEqual([
      "Buy 16 shares",
      "Stack the new position",
      "Assign the top stacked share to the 5x boost slot",
    ]);
  });

  it("answers portfolio-specific value questions from current holdings", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "which of my players have strong form but weak market pricing right now?",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions).toHaveLength(0);
    expect(result?.summary).toContain("holdings");
    expect(result?.replyText).toContain("current player holdings");
  });

  it("stages a watchlist add for a direct command", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "add nba_star to my watchlist",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("watchlists");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "watchlist_add_player",
      playerId: "nba_star",
      watchlistName: "Favorites",
    });
  });

  it("stages a watchlist add for bare track phrasing", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "track nba_star",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("watchlists");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "watchlist_add_player",
      playerId: "nba_star",
      watchlistName: "Favorites",
    });
  });

  it("stages a one-share sale when the user omits the count", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "sell nba_star",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("player_pools");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "pool_sell",
      playerId: "nba_star",
      sharesAmount: 1,
    });
    expect(result?.warnings).toContain("I assumed you wanted to sell 1 available share.");
  });

  it("stages the maximum stackable shares when the user omits the count", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    storageMocks.getAvailableShares.mockResolvedValueOnce(24);
    storageMocks.getPlayerShareBreakdown.mockResolvedValueOnce({
      regular: {
        quantity: "24",
      },
      stacked: [],
    });

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "stack my nba_star shares",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "holdings_stack_shares",
      playerId: "nba_star",
      sharesToStack: 24,
    });
    expect(result?.warnings).toContain(
      "I assumed you wanted the maximum stackable regular shares for that holding.",
    );
  });

  it("stages a community boost creation", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "create a community boost for nba_star tomorrow",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("community_boosts");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions[0]).toMatchObject({
      actionType: "community_boost_create",
      playerId: "nba_star",
      sport: "NBA",
    });
  });
});

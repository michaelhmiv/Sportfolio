import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPlayer: vi.fn(),
  getUser: vi.fn(),
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
  getHoldingsWithPowerBreakdown: vi.fn(),
  getDailyGameByGameId: vi.fn(),
}));

const poolMocks = vi.hoisted(() => ({
  getOrCreatePool: vi.fn(),
  getBuyQuote: vi.fn(),
  getSellQuote: vi.fn(),
  getLpPosition: vi.fn(),
  getZapAddQuoteSharesOnly: vi.fn(),
  getZapAddQuoteSbOnly: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../amm/pool", () => ({
  getOrCreatePool: poolMocks.getOrCreatePool,
  getBuyQuote: poolMocks.getBuyQuote,
  getSellQuote: poolMocks.getSellQuote,
  getLpPosition: poolMocks.getLpPosition,
  getZapAddQuoteSharesOnly: poolMocks.getZapAddQuoteSharesOnly,
  getZapAddQuoteSbOnly: poolMocks.getZapAddQuoteSbOnly,
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
    storageMocks.getPlayer.mockResolvedValue(player);
    storageMocks.getUser.mockResolvedValue({ id: "user_1", isPremium: false });
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
    storageMocks.getHoldingsWithPowerBreakdown.mockResolvedValue({
      regular: {
        quantity: "2",
        power: 1,
      },
      powered: [],
    });
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "game_1",
      startTime: new Date(Date.now() + 60 * 60 * 1000),
    });
    poolMocks.getOrCreatePool.mockResolvedValue({
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
  }, 10000);

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

  it("stages a combined buy, power-up, and boost workflow", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy 16 nba_star shares, power them all up and put that share into my 5x boost slot tomorrow",
      profile,
    });

    expect(result).not.toBeNull();
    expect(result?.domain).toBe("sportfolio");
    expect(result?.actions).toHaveLength(3);
    expect(result?.actions.map((action) => action.actionType)).toEqual([
      "pool_buy",
      "holdings_condense",
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

  it("stores a player-name clarification for a blocked multi-step workflow", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");
    storageMocks.getPlayer.mockResolvedValueOnce(undefined);

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message:
        "buy 16 nba_unknown shares, power them all up and put that share into my 5x boost slot tomorrow",
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
      "Power up the new position",
      "Assign the top powered share to the 5x boost slot",
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

  it("does not stage vesting because it is no longer in the active agent surface", async () => {
    const { planDirectAgentOperation } = await import("./operations-planner");

    const result = await planDirectAgentOperation({
      userId: "user_1",
      message: "claim my vesting",
      profile,
    });

    expect(result).toBeNull();
  });
});

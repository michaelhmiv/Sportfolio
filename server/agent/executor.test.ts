import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  applyScoutAssignments: vi.fn(),
  addToWatchList: vi.fn(),
  removeFromWatchList: vi.fn(),
  condenseShares: vi.fn(),
  createCommunityBoost: vi.fn(),
  getDailyBoosts: vi.fn(),
  getPlayerGameForDate: vi.fn(),
  getAvailableShares: vi.fn(),
  getHoldingsWithPowerBreakdown: vi.fn(),
  createDailyBoost: vi.fn(),
  getDailyBoostsByStatus: vi.fn(),
  getDailyGameByGameId: vi.fn(),
  getCommunityBoostsForDate: vi.fn(),
  getUserCommunityBoostShares: vi.fn(),
  deleteDailyBoost: vi.fn(),
  getUser: vi.fn(),
  getVesting: vi.fn(),
  getVestingSplits: vi.fn(),
  getPlayer: vi.fn(),
  getBatchHoldings: vi.fn(),
  updateHolding: vi.fn(),
  createVestingClaim: vi.fn(),
  incrementTotalSharesVested: vi.fn(),
  updateVesting: vi.fn(),
}));

const poolMocks = vi.hoisted(() => ({
  executeBuy: vi.fn(),
  executeSell: vi.fn(),
  addLiquidity: vi.fn(),
  addLiquidityOptimal: vi.fn(),
  removeLiquidity: vi.fn(),
  zapAddLiquiditySharesOnly: vi.fn(),
  zapAddLiquiditySbOnly: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../amm/pool", () => ({
  executeBuy: poolMocks.executeBuy,
  executeSell: poolMocks.executeSell,
  addLiquidity: poolMocks.addLiquidity,
  addLiquidityOptimal: poolMocks.addLiquidityOptimal,
  removeLiquidity: poolMocks.removeLiquidity,
  zapAddLiquiditySharesOnly: poolMocks.zapAddLiquiditySharesOnly,
  zapAddLiquiditySbOnly: poolMocks.zapAddLiquiditySbOnly,
}));

describe("executeAgentActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolMocks.executeBuy.mockResolvedValue({ success: true });
    poolMocks.executeSell.mockResolvedValue({ success: true });
    poolMocks.addLiquidity.mockResolvedValue({ success: true });
    poolMocks.addLiquidityOptimal.mockResolvedValue({ success: true });
    poolMocks.removeLiquidity.mockResolvedValue({ success: true });
    poolMocks.zapAddLiquiditySharesOnly.mockResolvedValue({ success: true });
    poolMocks.zapAddLiquiditySbOnly.mockResolvedValue({ success: true });
    storageMocks.applyScoutAssignments.mockResolvedValue(undefined);
    storageMocks.addToWatchList.mockResolvedValue(undefined);
    storageMocks.removeFromWatchList.mockResolvedValue(undefined);
    storageMocks.condenseShares.mockResolvedValue({
      newPowerLevel: "8.00",
      sharesCondensed: 16,
      poweredSharesCreated: 1,
    });
    storageMocks.createCommunityBoost.mockResolvedValue({});
    storageMocks.getDailyBoosts.mockResolvedValue([]);
    storageMocks.getPlayerGameForDate.mockResolvedValue({
      gameId: "game_1",
      homeTeam: "DEN",
      awayTeam: "LAL",
      startTime: new Date(Date.now() + 60 * 60 * 1000),
    });
    storageMocks.getAvailableShares.mockResolvedValue(3);
    storageMocks.getHoldingsWithPowerBreakdown.mockResolvedValue({
      regular: { quantity: "1", power: 1 },
      powered: [],
    });
    storageMocks.createDailyBoost.mockResolvedValue({});
    storageMocks.getDailyBoostsByStatus.mockResolvedValue([
      {
        id: "boost_1",
        userId: "user_1",
        status: "active",
        gameId: "game_1",
      },
    ]);
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "game_1",
      startTime: new Date(Date.now() + 60 * 60 * 1000),
    });
    storageMocks.getCommunityBoostsForDate.mockResolvedValue([]);
    storageMocks.getUserCommunityBoostShares.mockResolvedValue(2);
    storageMocks.deleteDailyBoost.mockResolvedValue(undefined);
    storageMocks.getUser.mockResolvedValue({ id: "user_1", isPremium: false });
    storageMocks.getVesting.mockResolvedValue({
      playerId: "nba_star",
      sharesAccumulated: 8,
      residualMs: 0,
      lastAccruedAt: new Date(),
      updatedAt: new Date(),
    });
    storageMocks.getVestingSplits.mockResolvedValue([]);
    storageMocks.getPlayer.mockResolvedValue({
      id: "nba_star",
      firstName: "Nikola",
      lastName: "Jokic",
    });
    storageMocks.getBatchHoldings.mockResolvedValue(new Map());
    storageMocks.updateHolding.mockResolvedValue(undefined);
    storageMocks.createVestingClaim.mockResolvedValue({});
    storageMocks.incrementTotalSharesVested.mockResolvedValue(undefined);
    storageMocks.updateVesting.mockResolvedValue(undefined);
  });

  it("executes a pool buy through the AMM runtime", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "pool_buy",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        sbAmount: 100,
        maxSlippage: 0.05,
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(poolMocks.executeBuy).toHaveBeenCalledWith("nba_star", "user_1", 100, 0.05);
  });

  it("executes a daily boost assignment through storage", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "daily_boost_assign",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        sport: "NBA",
        slotTier: 5,
        sharesEntered: 1,
        boostDate: "2026-03-01",
        gameId: "game_1",
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(storageMocks.createDailyBoost).toHaveBeenCalled();
    expect(storageMocks.createDailyBoost.mock.calls[0][0]).toMatchObject({
      userId: "user_1",
      playerId: "nba_star",
      sport: "NBA",
      slotTier: 5,
      sharesEntered: 1,
      gameId: "game_1",
    });
  });

  it("executes a pool sell through the AMM runtime", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "pool_sell",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        sharesAmount: 3,
        maxSlippage: 0.05,
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(poolMocks.executeSell).toHaveBeenCalledWith("nba_star", "user_1", 3, 0.05);
  });

  it("executes an exact LP add through the AMM runtime", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "pool_add_liquidity",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        shares: 2,
        playMoney: 20,
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(poolMocks.addLiquidity).toHaveBeenCalledWith("nba_star", "user_1", 2, 20);
  });

  it("executes an optimal LP add through the AMM runtime", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "pool_add_liquidity_optimal",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        maxShares: 3,
        maxPlayMoney: 25,
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(poolMocks.addLiquidityOptimal).toHaveBeenCalledWith("nba_star", "user_1", 3, 25);
  });

  it("executes a share-side LP zap through the AMM runtime", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "pool_zap_add_shares",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        shares: 2,
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(poolMocks.zapAddLiquiditySharesOnly).toHaveBeenCalledWith("nba_star", "user_1", 2);
  });

  it("executes a cash-side LP zap through the AMM runtime", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "pool_zap_add_sb",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        sb: 20,
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(poolMocks.zapAddLiquiditySbOnly).toHaveBeenCalledWith("nba_star", "user_1", 20);
  });

  it("executes an LP removal through the AMM runtime", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "pool_remove_liquidity",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        lpShares: 4,
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(poolMocks.removeLiquidity).toHaveBeenCalledWith("nba_star", "user_1", 4);
  });

  it("executes a holdings condense through storage", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "holdings_condense",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        sharesToCondense: 16,
        expectedPowerGained: 8,
        expectedPoweredShareCount: 1,
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(storageMocks.condenseShares).toHaveBeenCalledWith("user_1", "nba_star", 16);
  });

  it("executes a daily boost removal through storage", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "daily_boost_remove",
        boostId: "boost_1",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        slotTier: 5,
        sport: "NBA",
        boostDate: "2026-03-01",
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(storageMocks.deleteDailyBoost).toHaveBeenCalledWith("boost_1");
  });

  it("executes a watchlist add through storage", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "watchlist_add_player",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        watchlistId: "wl_1",
        watchlistName: "Favorites",
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(storageMocks.addToWatchList).toHaveBeenCalledWith("user_1", "nba_star", "wl_1");
  });

  it("executes a watchlist removal through storage", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "watchlist_remove_player",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        removeFromAll: true,
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(storageMocks.removeFromWatchList).toHaveBeenCalledWith("user_1", "nba_star", undefined);
  });

  it("executes a community boost creation through storage", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "community_boost_create",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        sport: "NBA",
        boostDate: "2026-03-01",
        gameId: "game_1",
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(storageMocks.createCommunityBoost).toHaveBeenCalled();
    expect(storageMocks.createCommunityBoost.mock.calls[0][0]).toMatchObject({
      creatorId: "user_1",
      playerId: "nba_star",
      sport: "NBA",
      gameId: "game_1",
    });
  });

  it("executes a vesting claim through storage", async () => {
    const { executeAgentActions } = await import("./executor");

    await executeAgentActions("user_1", [
      {
        actionType: "vesting_claim",
        playerId: "nba_star",
        playerName: "Nikola Jokic",
        claimableShares: 8,
        distributionCount: 1,
        targetDescription: "8 shares into Nikola Jokic",
        reasoning: "test",
        confidence: 1,
      },
    ] as any);

    expect(storageMocks.updateHolding).toHaveBeenCalledWith(
      "user_1",
      "player",
      "nba_star",
      8,
      "0.0000",
    );
    expect(storageMocks.createVestingClaim).toHaveBeenCalledWith({
      userId: "user_1",
      playerId: "nba_star",
      sharesClaimed: 8,
    });
    expect(storageMocks.incrementTotalSharesVested).toHaveBeenCalledWith("user_1", 8);
    expect(storageMocks.updateVesting).toHaveBeenCalled();
  });
});

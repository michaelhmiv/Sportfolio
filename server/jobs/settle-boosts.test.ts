import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getDailyBoostsByStatus: vi.fn(),
  getDailyGameByGameId: vi.fn(),
  getPlayerGameStatsForIdentity: vi.fn(),
  getCommunityBoostCountForPlayerIdentity: vi.fn(),
  getPlayer: vi.fn(),
}));
const economyMocks = vi.hoisted(() => ({
  settleBaseEarningsForGame: vi.fn(),
  settleDirectShareBoost: vi.fn(),
}));
const websocketMocks = vi.hoisted(() => ({ broadcast: vi.fn() }));
const notificationMocks = vi.hoisted(() => ({
  sendUserNotification: vi.fn(),
  notifyBoostSettledPush: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMocks }));
vi.mock("../economy/repository", () => ({
  settleBaseEarningsForGame: economyMocks.settleBaseEarningsForGame,
  settleDirectShareBoost: economyMocks.settleDirectShareBoost,
}));
vi.mock("../websocket", () => ({ broadcast: websocketMocks.broadcast }));
vi.mock("../services/notification-dispatcher", () => ({
  sendUserNotification: notificationMocks.sendUserNotification,
}));
vi.mock("../services/push-notification-events", () => ({
  notifyBoostSettledPush: notificationMocks.notifyBoostSettledPush,
}));

describe("settleBoosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.getPlayer.mockResolvedValue({
      id: "mlb_1",
      firstName: "Test",
      lastName: "Player",
      team: "ATL",
    });
    storageMocks.getCommunityBoostCountForPlayerIdentity.mockResolvedValue(0);
    notificationMocks.sendUserNotification.mockResolvedValue(undefined);
    notificationMocks.notifyBoostSettledPush.mockResolvedValue(undefined);
    economyMocks.settleBaseEarningsForGame.mockResolvedValue({
      playersSettled: 1,
      userPayouts: 1,
      sbIssued: 20,
    });
  });

  it("settles base EPS before crediting only the incremental Boost bonus", async () => {
    storageMocks.getDailyBoostsByStatus.mockResolvedValue([
      {
        id: "boost_1",
        userId: "user_1",
        playerId: "mlb_1",
        sport: "MLB",
        slotTier: 5,
        boostDate: new Date("2026-08-11T04:00:00.000Z"),
        sharesEntered: "4.0000",
        sharesBurned: "4.0000",
        gameId: "game_1",
        status: "locked",
      },
    ]);
    const game = {
      gameId: "game_1",
      sport: "MLB",
      seasonType: "regular",
      status: "completed",
    };
    storageMocks.getDailyGameByGameId.mockResolvedValue(game);
    storageMocks.getPlayerGameStatsForIdentity.mockResolvedValue({
      playerId: "mlb_1",
      gameId: "game_1",
      fantasyPoints: "12.50",
      statsJson: {},
    });
    economyMocks.settleDirectShareBoost.mockResolvedValue({
      settled: true,
      gameEpsSb: 0.5,
      baseComponentSb: 2,
      boostBonusSb: 8,
      totalEconomicEarningsSb: 10,
      effectiveMultiplier: 5,
      sharesBurned: 4,
    });

    const { settleBoosts } = await import("./settle-boosts");
    const result = await settleBoosts();

    expect(result.recordsProcessed).toBe(1);
    expect(economyMocks.settleBaseEarningsForGame).toHaveBeenCalledWith(game);
    expect(economyMocks.settleDirectShareBoost).toHaveBeenCalledWith("boost_1", 12.5, 0);
    expect(websocketMocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "boost_settled",
        boostId: "boost_1",
        payout: "10.00",
        boostBonus: "8.00",
        baseComponent: "2.00",
        sharesBurned: 4,
        multiplier: 5,
      }),
    );
  });

  it("applies Community Boost count through the V2 settlement repository", async () => {
    storageMocks.getDailyBoostsByStatus.mockResolvedValue([
      {
        id: "boost_community",
        userId: "user_1",
        playerId: "mlb_1",
        sport: "MLB",
        slotTier: 3,
        boostDate: new Date("2026-08-11T04:00:00.000Z"),
        sharesBurned: "2.0000",
        gameId: "game_2",
        status: "locked",
      },
    ]);
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "game_2",
      sport: "MLB",
      seasonType: "regular",
      status: "completed",
    });
    storageMocks.getPlayerGameStatsForIdentity.mockResolvedValue({
      playerId: "mlb_1",
      gameId: "game_2",
      fantasyPoints: "8.00",
      statsJson: {},
    });
    storageMocks.getCommunityBoostCountForPlayerIdentity.mockResolvedValue(2);
    economyMocks.settleDirectShareBoost.mockResolvedValue({
      settled: true,
      gameEpsSb: 0.25,
      baseComponentSb: 0.5,
      boostBonusSb: 2,
      totalEconomicEarningsSb: 2.5,
      effectiveMultiplier: 5,
      sharesBurned: 2,
    });

    const { settleBoosts } = await import("./settle-boosts");
    await settleBoosts();

    expect(economyMocks.settleDirectShareBoost).toHaveBeenCalledWith("boost_community", 8, 2);
  });

  it("does not settle a Boost until the game is complete", async () => {
    storageMocks.getDailyBoostsByStatus.mockResolvedValue([
      {
        id: "boost_live",
        userId: "user_1",
        playerId: "mlb_1",
        sport: "MLB",
        slotTier: 2,
        boostDate: new Date(),
        gameId: "game_live",
        status: "locked",
      },
    ]);
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "game_live",
      sport: "MLB",
      status: "inprogress",
    });

    const { settleBoosts } = await import("./settle-boosts");
    const result = await settleBoosts();

    expect(result.recordsProcessed).toBe(0);
    expect(economyMocks.settleBaseEarningsForGame).not.toHaveBeenCalled();
    expect(economyMocks.settleDirectShareBoost).not.toHaveBeenCalled();
  });
});

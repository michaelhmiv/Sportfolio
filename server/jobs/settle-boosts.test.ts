import { vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getDailyBoostsByStatus: vi.fn(),
  getDailyGameByGameId: vi.fn(),
  getDailyGamesBySport: vi.fn(),
  getPlayerGameForDate: vi.fn(),
  getPlayerGameStatsForIdentity: vi.fn(),
  getCommunityBoostCountForPlayerIdentity: vi.fn(),
  getPlayer: vi.fn(),
  getUser: vi.fn(),
  updateUserBalance: vi.fn(),
  createBoostPayout: vi.fn(),
  updateDailyBoost: vi.fn(),
  getUserNotificationPreferences: vi.fn(),
  createPushNotificationEvent: vi.fn(),
  listActiveUserPushTokens: vi.fn(),
  updatePushNotificationEvent: vi.fn(),
}));

const websocketMocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getDailyBoostsByStatus: storageMocks.getDailyBoostsByStatus,
    getDailyGameByGameId: storageMocks.getDailyGameByGameId,
    getDailyGamesBySport: storageMocks.getDailyGamesBySport,
    getPlayerGameForDate: storageMocks.getPlayerGameForDate,
    getPlayerGameStatsForIdentity: storageMocks.getPlayerGameStatsForIdentity,
    getCommunityBoostCountForPlayerIdentity: storageMocks.getCommunityBoostCountForPlayerIdentity,
    getPlayer: storageMocks.getPlayer,
    getUser: storageMocks.getUser,
    updateUserBalance: storageMocks.updateUserBalance,
    createBoostPayout: storageMocks.createBoostPayout,
    updateDailyBoost: storageMocks.updateDailyBoost,
    getUserNotificationPreferences: storageMocks.getUserNotificationPreferences,
    createPushNotificationEvent: storageMocks.createPushNotificationEvent,
    listActiveUserPushTokens: storageMocks.listActiveUserPushTokens,
    updatePushNotificationEvent: storageMocks.updatePushNotificationEvent,
  },
}));

vi.mock("../websocket", () => ({
  broadcast: websocketMocks.broadcast,
}));

describe("settleBoosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.getUserNotificationPreferences.mockResolvedValue([]);
    storageMocks.createPushNotificationEvent.mockResolvedValue({ id: "event_1" });
    storageMocks.listActiveUserPushTokens.mockResolvedValue([]);
    storageMocks.updatePushNotificationEvent.mockResolvedValue(undefined);
  });

  it("repairs legacy NBA gameIds and settles using canonical stats", async () => {
    storageMocks.getDailyBoostsByStatus.mockResolvedValue([
      {
        id: "boost_1",
        userId: "user_1",
        playerId: "nba_42",
        sport: "NBA",
        slotTier: 2,
        boostDate: new Date("2026-02-11T05:00:00.000Z"),
        sharesEntered: 1,
        shareMultiplier: "2.00",
        gameId: "184471234",
        status: "locked",
      },
    ]);

    // Legacy record exists but would never settle (wrong id/status)
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      id: "game_legacy",
      gameId: "184471234",
      sport: "NBA",
      startTime: new Date("2026-02-11T23:00:00.000Z"),
      status: "scheduled",
      homeTeam: "BOS",
      awayTeam: "LAL",
      date: new Date("2026-02-11T05:00:00.000Z"),
    });

    storageMocks.getDailyGamesBySport.mockResolvedValue([
      {
        id: "game_legacy",
        gameId: "184471234",
        sport: "NBA",
        startTime: new Date("2026-02-11T23:00:00.000Z"),
        status: "scheduled",
        homeTeam: "BOS",
        awayTeam: "LAL",
        date: new Date("2026-02-11T05:00:00.000Z"),
      },
      {
        id: "game_canonical",
        gameId: "123456",
        sport: "NBA",
        startTime: new Date("2026-02-11T23:00:00.000Z"),
        status: "completed",
        homeTeam: "BOS",
        awayTeam: "LAL",
        date: new Date("2026-02-11T05:00:00.000Z"),
      },
    ]);

    storageMocks.getPlayerGameStatsForIdentity.mockResolvedValue({
      id: "stats_1",
      playerId: "nba_237",
      gameId: "123456",
      fantasyPoints: "50",
    });

    storageMocks.getCommunityBoostCountForPlayerIdentity.mockResolvedValue(0);
    storageMocks.getPlayer.mockResolvedValue({
      id: "nba_42",
      firstName: "Jayson",
      lastName: "Tatum",
      team: "BOS",
    });
    storageMocks.getUser.mockResolvedValue({ id: "user_1", balance: "10.00" });
    storageMocks.updateUserBalance.mockResolvedValue(undefined);
    storageMocks.createBoostPayout.mockResolvedValue({ id: "payout_1" });
    storageMocks.updateDailyBoost.mockResolvedValue(undefined);

    const { settleBoosts } = await import("./settle-boosts");
    const result = await settleBoosts();

    expect(result.recordsProcessed).toBe(1);

    // Repair gameId to canonical
    expect(storageMocks.updateDailyBoost).toHaveBeenNthCalledWith(1, "boost_1", {
      gameId: "123456",
    });

    expect(storageMocks.getPlayerGameStatsForIdentity).toHaveBeenCalledWith("nba_42", "123456");
    expect(storageMocks.getCommunityBoostCountForPlayerIdentity).toHaveBeenCalledWith(
      "NBA",
      new Date("2026-02-11T05:00:00.000Z"),
      "nba_42",
    );

    // Payout settled
    expect(storageMocks.updateUserBalance).toHaveBeenCalledWith("user_1", "210.00");
    expect(storageMocks.createBoostPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        boostId: "boost_1",
        userId: "user_1",
        playerId: "nba_42",
        fantasyPoints: "50.00",
        payoutAmount: "200.00",
        multiplier: 2,
      }),
    );

    expect(storageMocks.updateDailyBoost).toHaveBeenNthCalledWith(
      2,
      "boost_1",
      expect.objectContaining({
        status: "processed",
        fantasyPoints: "50.00",
        payout: "200.00",
      }),
    );

    expect(websocketMocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "boost_settled",
        userId: "user_1",
        boostId: "boost_1",
        payout: "200.00",
        multiplier: 2,
      }),
    );
  }, 15000);
});

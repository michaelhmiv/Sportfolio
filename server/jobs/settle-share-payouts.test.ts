import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPendingSharePayouts: vi.fn(),
  getDailyGameByGameId: vi.fn(),
  getPlayerGameStats: vi.fn(),
  processSharePayoutCredit: vi.fn(),
}));

const websocketMocks = vi.hoisted(() => ({
  broadcastToUser: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  sendUserNotification: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getPendingSharePayouts: storageMocks.getPendingSharePayouts,
    getDailyGameByGameId: storageMocks.getDailyGameByGameId,
    getPlayerGameStats: storageMocks.getPlayerGameStats,
    processSharePayoutCredit: storageMocks.processSharePayoutCredit,
  },
}));

vi.mock("../websocket", () => ({
  broadcastToUser: websocketMocks.broadcastToUser,
}));

vi.mock("../services/notification-dispatcher", () => ({
  sendUserNotification: notificationMocks.sendUserNotification,
}));

describe("settleSharePayouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.sendUserNotification.mockResolvedValue(undefined);
  });

  it("uses earningUnits when present on multiplier-only payout rows", async () => {
    storageMocks.getPendingSharePayouts.mockResolvedValue([
      {
        id: "payout_1",
        userId: "user_1",
        playerId: "nba_star",
        gameId: "game_1",
        earningUnits: "5.00",
        sharePower: "99.00",
        baseRate: "2.0000",
      },
    ]);
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "game_1",
      sport: "NBA",
      status: "completed",
    });
    storageMocks.getPlayerGameStats.mockResolvedValue({
      fantasyPoints: "10.00",
    });
    storageMocks.processSharePayoutCredit.mockResolvedValue(true);

    const { settleSharePayouts } = await import("./settle-share-payouts");
    const result = await settleSharePayouts();

    expect(result.recordsProcessed).toBe(1);
    expect(storageMocks.processSharePayoutCredit).toHaveBeenCalledWith(
      "payout_1",
      "user_1",
      "10.00",
      "100.00",
    );
    expect(websocketMocks.broadcastToUser).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        type: "portfolio",
        reason: "share_payout",
        amount: "100.00",
      }),
    );
  });
});

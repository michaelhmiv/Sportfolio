import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPendingSharePayouts: vi.fn(),
  processSharePayoutCredit: vi.fn(),
}));

const readModelMocks = vi.hoisted(() => ({
  loadSharePayoutSettlementContext: vi.fn(),
  getSharePayoutStats: vi.fn(),
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
    processSharePayoutCredit: storageMocks.processSharePayoutCredit,
  },
}));

vi.mock("./share-payout-read-model", () => ({
  loadSharePayoutSettlementContext: readModelMocks.loadSharePayoutSettlementContext,
  getSharePayoutStats: readModelMocks.getSharePayoutStats,
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
    const payout = {
      id: "payout_1",
      userId: "user_1",
      playerId: "nba_star",
      gameId: "game_1",
      earningUnits: "5.00",
      sharePower: "99.00",
      baseRate: "2.0000",
    };
    const game = {
      gameId: "game_1",
      sport: "NBA",
      status: "completed",
    };
    const stats = {
      fantasyPoints: "10.00",
    };

    storageMocks.getPendingSharePayouts.mockResolvedValue([payout]);
    readModelMocks.loadSharePayoutSettlementContext.mockResolvedValue({
      gamesById: new Map([["game_1", game]]),
      statsByPlayerGame: new Map(),
      readCount: 2,
    });
    readModelMocks.getSharePayoutStats.mockReturnValue(stats);
    storageMocks.processSharePayoutCredit.mockResolvedValue(true);

    const { settleSharePayouts } = await import("./settle-share-payouts");
    const result = await settleSharePayouts();

    expect(result.recordsProcessed).toBe(1);
    expect(result.requestCount).toBe(4);
    expect(readModelMocks.loadSharePayoutSettlementContext).toHaveBeenCalledWith([payout]);
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
  }, 15_000);

  it("credits an NHL share payout from the simplified Sportfolio fantasy total", async () => {
    const payout = {
      id: "payout_nhl",
      userId: "user_1",
      playerId: "nhl_8478402",
      gameId: "nhl_2025020600",
      earningUnits: "2.00",
      baseRate: "1.0000",
    };
    const game = {
      gameId: "nhl_2025020600",
      sport: "NHL",
      status: "completed",
    };
    const stats = {
      fantasyPoints: "18.50",
      statsJson: {
        scoringEnrichment: { model: "simplified-sportfolio-nhl", status: "not_included" },
      },
    };

    storageMocks.getPendingSharePayouts.mockResolvedValue([payout]);
    readModelMocks.loadSharePayoutSettlementContext.mockResolvedValue({
      gamesById: new Map([["nhl_2025020600", game]]),
      statsByPlayerGame: new Map(),
      readCount: 2,
    });
    readModelMocks.getSharePayoutStats.mockReturnValue(stats);
    storageMocks.processSharePayoutCredit.mockResolvedValue(true);

    const { settleSharePayouts } = await import("./settle-share-payouts");
    const result = await settleSharePayouts();

    expect(result.recordsProcessed).toBe(1);
    expect(storageMocks.processSharePayoutCredit).toHaveBeenCalledWith(
      "payout_nhl",
      "user_1",
      "18.50",
      "37.00",
    );
  }, 15_000);

  it("does not perform bulk context reads when no payouts are pending", async () => {
    storageMocks.getPendingSharePayouts.mockResolvedValue([]);

    const { settleSharePayouts } = await import("./settle-share-payouts");
    const result = await settleSharePayouts();

    expect(result).toEqual({ requestCount: 1, recordsProcessed: 0, errorCount: 0 });
    expect(readModelMocks.loadSharePayoutSettlementContext).not.toHaveBeenCalled();
  }, 15_000);
});

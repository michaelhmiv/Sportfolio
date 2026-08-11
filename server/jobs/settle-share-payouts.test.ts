import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPendingSharePayouts: vi.fn(),
  getDailyGameByGameId: vi.fn(),
}));
const economyMocks = vi.hoisted(() => ({ settleBaseEarningsForGame: vi.fn() }));
const websocketMocks = vi.hoisted(() => ({ broadcast: vi.fn() }));

vi.mock("../storage", () => ({ storage: storageMocks }));
vi.mock("../economy/repository", () => ({
  settleBaseEarningsForGame: economyMocks.settleBaseEarningsForGame,
}));
vi.mock("../websocket", () => ({ broadcast: websocketMocks.broadcast }));

describe("settleSharePayouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    economyMocks.settleBaseEarningsForGame.mockResolvedValue({
      playersSettled: 1,
      userPayouts: 2,
      sbIssued: 125.5,
    });
  });

  it("settles each completed game once through the capped Economy V2 repository", async () => {
    storageMocks.getPendingSharePayouts.mockResolvedValue([
      { gameId: "game_1" },
      { gameId: "game_1" },
    ]);
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "game_1",
      sport: "MLB",
      seasonType: "regular",
      status: "completed",
    });

    const { settleSharePayouts } = await import("./settle-share-payouts");
    const result = await settleSharePayouts();

    expect(result.recordsProcessed).toBe(2);
    expect(economyMocks.settleBaseEarningsForGame).toHaveBeenCalledTimes(1);
    expect(websocketMocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "portfolio",
        reason: "base_player_earnings",
        gameId: "game_1",
        payoutCount: 2,
        sbIssued: "125.50",
      }),
    );
  });

  it("does not settle games that have not completed", async () => {
    storageMocks.getPendingSharePayouts.mockResolvedValue([{ gameId: "game_1" }]);
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "game_1",
      sport: "NFL",
      seasonType: "regular",
      status: "inprogress",
    });

    const { settleSharePayouts } = await import("./settle-share-payouts");
    const result = await settleSharePayouts();

    expect(result.recordsProcessed).toBe(0);
    expect(economyMocks.settleBaseEarningsForGame).not.toHaveBeenCalled();
  });

  it("does no game reads when there are no pending ownership snapshots", async () => {
    storageMocks.getPendingSharePayouts.mockResolvedValue([]);
    const { settleSharePayouts } = await import("./settle-share-payouts");
    const result = await settleSharePayouts();

    expect(result).toEqual({ requestCount: 1, recordsProcessed: 0, errorCount: 0 });
    expect(storageMocks.getDailyGameByGameId).not.toHaveBeenCalled();
  });
});

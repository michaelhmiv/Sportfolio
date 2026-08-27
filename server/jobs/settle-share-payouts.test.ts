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

  it("settles each completed game once through the base payout repository", async () => {
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

  it("logs a structured production error and continues with later games", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    storageMocks.getPendingSharePayouts.mockResolvedValue([
      { gameId: "game_bad" },
      { gameId: "game_good" },
    ]);
    storageMocks.getDailyGameByGameId.mockImplementation(async (gameId: string) => ({
      gameId,
      sport: "MLB",
      seasonType: "regular",
      status: "completed",
    }));
    economyMocks.settleBaseEarningsForGame
      .mockRejectedValueOnce(
        Object.assign(new Error("column payout_amount does not exist"), {
          code: "42703",
          column: "payout_amount",
        }),
      )
      .mockResolvedValueOnce({ playersSettled: 1, userPayouts: 3, sbIssued: 42 });

    const { settleSharePayouts } = await import("./settle-share-payouts");
    const result = await settleSharePayouts();

    expect(result).toEqual({ requestCount: 4, recordsProcessed: 3, errorCount: 1 });
    expect(economyMocks.settleBaseEarningsForGame).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledTimes(1);

    const logged = JSON.parse(String(consoleError.mock.calls[0]?.[0]));
    expect(logged).toMatchObject({
      level: "error",
      job: "settle_share_payouts",
      message: "Base payout settlement failed for game",
      gameId: "game_bad",
      sport: "MLB",
      status: "completed",
      error: {
        code: "42703",
        column: "payout_amount",
        message: "column payout_amount does not exist",
      },
    });

    consoleError.mockRestore();
  });

  it("reports failures that occur before per-game processing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    storageMocks.getPendingSharePayouts.mockRejectedValue(new Error("database unavailable"));

    const { settleSharePayouts } = await import("./settle-share-payouts");
    const result = await settleSharePayouts();

    expect(result).toEqual({ requestCount: 0, recordsProcessed: 0, errorCount: 1 });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toMatchObject({
      job: "settle_share_payouts",
      message: "Base payout settlement failed before game processing",
      error: { message: "database unavailable" },
    });

    consoleError.mockRestore();
  });

  it("surfaces the same per-game error through the optional admin progress stream", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const progress = vi.fn();
    storageMocks.getPendingSharePayouts.mockResolvedValue([{ gameId: "game_1" }]);
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "game_1",
      sport: "NBA",
      seasonType: "regular",
      status: "completed",
    });
    economyMocks.settleBaseEarningsForGame.mockRejectedValue(new Error("settlement exploded"));

    const { settleSharePayouts } = await import("./settle-share-payouts");
    await settleSharePayouts(progress);

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("settlement exploded"),
      }),
    );
    consoleError.mockRestore();
  });
});

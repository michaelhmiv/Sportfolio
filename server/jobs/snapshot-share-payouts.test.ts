import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getDailyGames: vi.fn(),
  createSharePayoutSnapshotsForGame: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getDailyGames: storageMocks.getDailyGames,
    createSharePayoutSnapshotsForGame: storageMocks.createSharePayoutSnapshotsForGame,
  },
}));

describe("snapshotSharePayouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.STACKED_SHARE_PAYOUT_CUTOVER_AT;
  });

  it("snapshots started games with the fixed base rate", async () => {
    storageMocks.getDailyGames.mockResolvedValue([
      {
        gameId: "game_1",
        sport: "NBA",
        homeTeam: "BOS",
        awayTeam: "LAL",
        status: "inprogress",
        startTime: new Date(Date.now() - 5 * 60 * 1000),
      },
    ]);
    storageMocks.createSharePayoutSnapshotsForGame.mockResolvedValue(3);

    const { snapshotSharePayouts } = await import("./snapshot-share-payouts");
    const result = await snapshotSharePayouts();

    expect(result.recordsProcessed).toBe(3);
    expect(storageMocks.createSharePayoutSnapshotsForGame).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "game_1" }),
      "1.0000",
    );
  });

  it("skips games that started before the configured cutover", async () => {
    const now = Date.now();
    process.env.STACKED_SHARE_PAYOUT_CUTOVER_AT = new Date(now - 60 * 60 * 1000).toISOString();
    storageMocks.getDailyGames.mockResolvedValue([
      {
        gameId: "before_cutover",
        sport: "NBA",
        homeTeam: "NYK",
        awayTeam: "BOS",
        status: "inprogress",
        startTime: new Date(now - 2 * 60 * 60 * 1000),
      },
      {
        gameId: "after_cutover",
        sport: "NBA",
        homeTeam: "DEN",
        awayTeam: "LAL",
        status: "inprogress",
        startTime: new Date(now - 30 * 60 * 1000),
      },
    ]);
    storageMocks.createSharePayoutSnapshotsForGame.mockResolvedValue(1);

    const { snapshotSharePayouts } = await import("./snapshot-share-payouts");
    await snapshotSharePayouts();

    expect(storageMocks.createSharePayoutSnapshotsForGame).toHaveBeenCalledTimes(1);
    expect(storageMocks.createSharePayoutSnapshotsForGame).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "after_cutover" }),
      "1.0000",
    );
  });
});

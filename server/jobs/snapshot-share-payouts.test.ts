import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({ getDailyGames: vi.fn() }));
const economyMocks = vi.hoisted(() => ({ ensureGameShareSnapshots: vi.fn() }));

vi.mock("../storage", () => ({ storage: storageMocks }));
vi.mock("../economy/repository", () => ({
  ensureGameShareSnapshots: economyMocks.ensureGameShareSnapshots,
}));

describe("snapshotSharePayouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    economyMocks.ensureGameShareSnapshots.mockResolvedValue({
      playersSnapshotted: 1,
      userSnapshots: 3,
    });
  });

  it("snapshots eligible ownership for games that have begun", async () => {
    storageMocks.getDailyGames.mockResolvedValue([
      {
        gameId: "game_1",
        sport: "MLB",
        homeTeam: "ATL",
        awayTeam: "WSH",
        seasonType: "regular",
        status: "inprogress",
        startTime: new Date(Date.now() - 5 * 60 * 1000),
      },
    ]);

    const { snapshotSharePayouts } = await import("./snapshot-share-payouts");
    const result = await snapshotSharePayouts();

    expect(result.recordsProcessed).toBe(3);
    expect(economyMocks.ensureGameShareSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "game_1" }),
    );
  });

  it("ignores future, cancelled, and preseason games without legacy cutovers", async () => {
    const now = Date.now();
    storageMocks.getDailyGames.mockResolvedValue([
      {
        gameId: "future",
        sport: "NFL",
        homeTeam: "CAR",
        awayTeam: "ATL",
        seasonType: "regular",
        status: "scheduled",
        startTime: new Date(now + 60 * 60 * 1000),
      },
      {
        gameId: "cancelled",
        sport: "MLB",
        homeTeam: "ATL",
        awayTeam: "NYM",
        seasonType: "regular",
        status: "cancelled",
        startTime: new Date(now - 60 * 1000),
      },
      {
        gameId: "preseason",
        sport: "NFL",
        homeTeam: "CAR",
        awayTeam: "ATL",
        seasonType: "preseason",
        status: "inprogress",
        startTime: new Date(now - 60 * 1000),
      },
    ]);

    const { snapshotSharePayouts } = await import("./snapshot-share-payouts");
    const result = await snapshotSharePayouts();

    expect(result.recordsProcessed).toBe(0);
    expect(economyMocks.ensureGameShareSnapshots).not.toHaveBeenCalled();
  });
});

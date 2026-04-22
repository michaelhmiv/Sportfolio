import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getDailyBoostsByStatus: vi.fn(),
  getDailyGameByGameId: vi.fn(),
  updateDailyBoost: vi.fn(),
  getDailyGamesBySport: vi.fn(),
  getPlayerGameForDate: vi.fn(),
  lockBoostShares: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getDailyBoostsByStatus: storageMocks.getDailyBoostsByStatus,
    getDailyGameByGameId: storageMocks.getDailyGameByGameId,
    updateDailyBoost: storageMocks.updateDailyBoost,
    getDailyGamesBySport: storageMocks.getDailyGamesBySport,
    getPlayerGameForDate: storageMocks.getPlayerGameForDate,
    lockBoostShares: storageMocks.lockBoostShares,
  },
}));

describe("lockBoostShares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T20:00:00.000Z"));

    storageMocks.getDailyBoostsByStatus.mockResolvedValue([
      {
        id: "boost_1",
        userId: "user_1",
        playerId: "player_1",
        sport: "NBA",
        gameId: "game_1",
        boostDate: new Date("2026-03-10T05:00:00.000Z"),
      },
    ]);
    storageMocks.updateDailyBoost.mockResolvedValue(undefined);
    storageMocks.getDailyGamesBySport.mockResolvedValue([]);
    storageMocks.getPlayerGameForDate.mockResolvedValue(undefined);
    storageMocks.lockBoostShares.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not lock a scheduled game that lacks live evidence", async () => {
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      id: "game_1",
      gameId: "game_1",
      sport: "NBA",
      startTime: new Date("2026-03-10T19:30:00.000Z"),
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      homeTeam: "BOS",
      awayTeam: "NYK",
    });

    const { lockBoostShares } = await import("./lock-boost-shares");
    const result = await lockBoostShares();

    expect(result.recordsProcessed).toBe(0);
    expect(storageMocks.lockBoostShares).not.toHaveBeenCalled();
  }, 15000);

  it("locks a scheduled game once live score evidence exists", async () => {
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      id: "game_1",
      gameId: "game_1",
      sport: "NBA",
      startTime: new Date("2026-03-10T19:30:00.000Z"),
      status: "scheduled",
      homeScore: 12,
      awayScore: 9,
      homeTeam: "BOS",
      awayTeam: "NYK",
    });

    const { lockBoostShares } = await import("./lock-boost-shares");
    const result = await lockBoostShares();

    expect(result.recordsProcessed).toBe(1);
    expect(storageMocks.lockBoostShares).toHaveBeenCalledWith("boost_1");
  });
});

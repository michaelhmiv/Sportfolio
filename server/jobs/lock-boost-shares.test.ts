import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getDailyBoostsByStatus: vi.fn(),
  getDailyGameByGameId: vi.fn(),
  updateDailyBoost: vi.fn(),
  getPlayerGameForDate: vi.fn(),
  deleteDailyBoost: vi.fn(),
  getPlayer: vi.fn(),
}));
const economyMocks = vi.hoisted(() => ({ lockDirectShareBoost: vi.fn() }));

vi.mock("../storage", () => ({
  storage: {
    getDailyBoostsByStatus: storageMocks.getDailyBoostsByStatus,
    getDailyGameByGameId: storageMocks.getDailyGameByGameId,
    updateDailyBoost: storageMocks.updateDailyBoost,
    getPlayerGameForDate: storageMocks.getPlayerGameForDate,
    deleteDailyBoost: storageMocks.deleteDailyBoost,
    getPlayer: storageMocks.getPlayer,
  },
}));
vi.mock("../economy/repository", () => ({
  lockDirectShareBoost: economyMocks.lockDirectShareBoost,
}));
vi.mock("../services/push-notification-events", () => ({
  notifyBoostLockingSoonPush: vi.fn(async () => undefined),
}));
vi.mock("../services/notification-dispatcher", () => ({
  sendUserNotification: vi.fn(async () => undefined),
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
        slotTier: 3,
      },
    ]);
    storageMocks.updateDailyBoost.mockResolvedValue(undefined);
    storageMocks.getPlayerGameForDate.mockResolvedValue(undefined);
    storageMocks.deleteDailyBoost.mockResolvedValue(undefined);
    storageMocks.getPlayer.mockResolvedValue({ firstName: "Test", lastName: "Player" });
    economyMocks.lockDirectShareBoost.mockResolvedValue({ locked: true, sharesBurned: 1 });
  });

  afterEach(() => vi.useRealTimers());

  it("does not lock a scheduled game that lacks live evidence", async () => {
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      id: "game_1",
      gameId: "game_1",
      sport: "NBA",
      seasonType: "regular",
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
    expect(economyMocks.lockDirectShareBoost).not.toHaveBeenCalled();
  }, 15000);

  it("locks and burns direct Singles once live score evidence exists", async () => {
    const game = {
      id: "game_1",
      gameId: "game_1",
      sport: "NBA",
      seasonType: "regular",
      startTime: new Date("2026-03-10T19:30:00.000Z"),
      status: "scheduled",
      homeScore: 12,
      awayScore: 9,
      homeTeam: "BOS",
      awayTeam: "NYK",
    };
    storageMocks.getDailyGameByGameId.mockResolvedValue(game);

    const { lockBoostShares } = await import("./lock-boost-shares");
    const result = await lockBoostShares();

    expect(result.recordsProcessed).toBe(1);
    expect(economyMocks.lockDirectShareBoost).toHaveBeenCalledWith("boost_1", game);
  });
});

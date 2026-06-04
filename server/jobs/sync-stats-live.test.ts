import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getDailyGames: vi.fn(),
  upsertDailyGame: vi.fn(),
  getPlayersByIds: vi.fn(),
  upsertPlayer: vi.fn(),
  upsertPlayerGameStats: vi.fn(),
}));

const nbaMocks = vi.hoisted(() => ({
  fetchDailyGames: vi.fn(),
  fetchPlayerGameStats: vi.fn(),
  isNBAApiConfigured: vi.fn(),
  calculateFantasyPoints: vi.fn(),
  createNBAPlayerId: vi.fn(),
  getCurrentNBASeasonString: vi.fn(),
  convertToGameStats: vi.fn(),
  normalizeGameStatus: vi.fn(),
}));

const timeMocks = vi.hoisted(() => ({
  getETDayBoundaries: vi.fn(),
  getGameDay: vi.fn(),
  getTodayET: vi.fn(),
  getTodayETBoundaries: vi.fn(),
}));

const websocketMocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../balldontlie-nba", () => ({
  fetchDailyGames: nbaMocks.fetchDailyGames,
  fetchPlayerGameStats: nbaMocks.fetchPlayerGameStats,
  isNBAApiConfigured: nbaMocks.isNBAApiConfigured,
  calculateFantasyPoints: nbaMocks.calculateFantasyPoints,
  createNBAPlayerId: nbaMocks.createNBAPlayerId,
  getCurrentNBASeasonString: nbaMocks.getCurrentNBASeasonString,
  convertToGameStats: nbaMocks.convertToGameStats,
  normalizeGameStatus: nbaMocks.normalizeGameStatus,
}));

vi.mock("../lib/time", () => ({
  getETDayBoundaries: timeMocks.getETDayBoundaries,
  getGameDay: timeMocks.getGameDay,
  getTodayET: timeMocks.getTodayET,
  getTodayETBoundaries: timeMocks.getTodayETBoundaries,
}));

vi.mock("../websocket", () => ({
  broadcast: websocketMocks.broadcast,
}));

vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn(() => new Date("2026-03-10T12:00:00.000-05:00")),
}));

describe("syncStatsLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    nbaMocks.isNBAApiConfigured.mockReturnValue(true);
    nbaMocks.normalizeGameStatus.mockReturnValue("inprogress");
    nbaMocks.createNBAPlayerId.mockImplementation((playerId: number) => `nba_${playerId}`);
    nbaMocks.calculateFantasyPoints.mockReturnValue(42);
    nbaMocks.convertToGameStats.mockImplementation((stat: any) => stat);
    nbaMocks.getCurrentNBASeasonString.mockReturnValue("2025-26");

    timeMocks.getTodayET.mockReturnValue("2026-03-10");
    timeMocks.getGameDay.mockReturnValue("2026-03-10");
    timeMocks.getETDayBoundaries.mockReturnValue({
      startOfDay: new Date("2026-03-10T00:00:00.000Z"),
      endOfDay: new Date("2026-03-10T23:59:59.999Z"),
    });
    timeMocks.getTodayETBoundaries.mockReturnValue({
      endOfDay: new Date("2026-03-10T23:59:59.999Z"),
    });

    storageMocks.getDailyGames.mockResolvedValue([]);
    storageMocks.upsertDailyGame.mockResolvedValue(undefined);
    storageMocks.upsertPlayer.mockResolvedValue({ id: "nba_2" });
    storageMocks.upsertPlayerGameStats.mockResolvedValue(undefined);
    storageMocks.getPlayersByIds.mockImplementation(async (ids: string[]) => {
      if (ids.includes("nba_1")) {
        return [{ id: "nba_1" }];
      }
      return [];
    });

    nbaMocks.fetchDailyGames.mockResolvedValue([
      {
        id: 101,
        datetime: "2026-03-10T19:00:00.000Z",
        status: "In Progress",
        postponed: false,
        home_team: { abbreviation: "BOS" },
        visitor_team: { abbreviation: "NYK" },
        home_team_score: 100,
        visitor_team_score: 98,
      },
    ]);
    nbaMocks.fetchPlayerGameStats.mockResolvedValue([
      {
        player: {
          id: 1,
          first_name: "Known",
          last_name: "Player",
          position: "G",
          jersey_number: "1",
          team: { abbreviation: "BOS" },
        },
        team: { abbreviation: "BOS" },
        pts: 20,
        reb: 10,
        ast: 8,
        stl: 1,
        blk: 1,
        turnover: 2,
        fg3m: 3,
        fgm: 8,
        fga: 15,
        fg3a: 7,
        ftm: 1,
        fta: 2,
        min: "32",
      },
      {
        player: {
          id: 2,
          first_name: "Missing",
          last_name: "Player",
          position: "F",
          jersey_number: "2",
          team: { abbreviation: "NYK" },
        },
        team: { abbreviation: "NYK" },
        pts: 18,
        reb: 5,
        ast: 6,
        stl: 0,
        blk: 0,
        turnover: 1,
        fg3m: 2,
        fgm: 7,
        fga: 14,
        fg3a: 6,
        ftm: 2,
        fta: 3,
        min: "30",
      },
    ]);
  });

  it("upserts missing players before storing their live stat lines", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { syncStatsLive } = await import("./sync-stats-live");
    const result = await syncStatsLive();

    expect(storageMocks.getPlayersByIds).toHaveBeenCalledWith(["nba_1", "nba_2"]);
    expect(storageMocks.upsertPlayer).toHaveBeenCalledTimes(1);
    expect(storageMocks.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "nba_2",
        sport: "NBA",
        firstName: "Missing",
        lastName: "Player",
        team: "NYK",
      }),
    );
    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledTimes(2);
    expect(result.recordsProcessed).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(result.skippedMissingPlayers).toBe(0);
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Skipped 1 NBA stat rows for players missing from the local roster"),
    );
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Failed to upsert player stats:"),
      expect.anything(),
    );

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

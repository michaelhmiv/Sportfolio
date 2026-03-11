import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  updateDailyGameScore: vi.fn(),
  getDailyGamesBySport: vi.fn(),
  getPlayersByIds: vi.fn(),
  upsertPlayerGameStats: vi.fn(),
}));

const nflApiMocks = vi.hoisted(() => ({
  fetchGames: vi.fn(),
  fetchGameStats: vi.fn(),
  calculateNFLFantasyPoints: vi.fn(),
  parseStatsToJson: vi.fn(),
  isNFLApiConfigured: vi.fn(),
  createNFLPlayerId: vi.fn(),
}));

const timeMocks = vi.hoisted(() => ({
  getTodayETBoundaries: vi.fn(),
  getGameDay: vi.fn(),
  getETDayBoundaries: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../balldontlie-nfl", () => ({
  fetchGames: nflApiMocks.fetchGames,
  fetchGameStats: nflApiMocks.fetchGameStats,
  calculateNFLFantasyPoints: nflApiMocks.calculateNFLFantasyPoints,
  parseStatsToJson: nflApiMocks.parseStatsToJson,
  isNFLApiConfigured: nflApiMocks.isNFLApiConfigured,
  createNFLPlayerId: nflApiMocks.createNFLPlayerId,
}));

vi.mock("../lib/time", () => ({
  getTodayETBoundaries: timeMocks.getTodayETBoundaries,
  getGameDay: timeMocks.getGameDay,
  getETDayBoundaries: timeMocks.getETDayBoundaries,
}));

describe("syncNFLStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    nflApiMocks.isNFLApiConfigured.mockReturnValue(true);
    timeMocks.getGameDay.mockReturnValue("2026-03-10");
    timeMocks.getETDayBoundaries.mockReturnValue({
      startOfDay: new Date("2026-03-09T00:00:00.000Z"),
    });
    timeMocks.getTodayETBoundaries.mockReturnValue({
      endOfDay: new Date("2026-03-10T23:59:59.999Z"),
    });

    nflApiMocks.fetchGames.mockResolvedValue([
      {
        id: 201,
        status: "Final",
        date: "2026-03-10T19:00:00.000Z",
        week: 1,
        season: 2026,
        home_team_score: 24,
        visitor_team_score: 21,
      },
    ]);
    storageMocks.getDailyGamesBySport.mockResolvedValue([
      { gameId: "nfl_201", status: "completed" },
    ]);
    nflApiMocks.fetchGameStats.mockResolvedValue([
      {
        player: { id: 11 },
        game: {
          id: 201,
          date: "2026-03-10T19:00:00.000Z",
          week: 1,
          season: 2026,
          status: "Final",
          home_team: { abbreviation: "BUF" },
          visitor_team: { abbreviation: "KC" },
          home_team_score: 24,
          visitor_team_score: 21,
        },
        team: { abbreviation: "BUF" },
      },
      {
        player: { id: 22 },
        game: {
          id: 201,
          date: "2026-03-10T19:00:00.000Z",
          week: 1,
          season: 2026,
          status: "Final",
          home_team: { abbreviation: "BUF" },
          visitor_team: { abbreviation: "KC" },
          home_team_score: 24,
          visitor_team_score: 21,
        },
        team: { abbreviation: "KC" },
      },
    ]);
    nflApiMocks.createNFLPlayerId.mockImplementation((playerId: number) => `nfl_${playerId}`);
    storageMocks.getPlayersByIds.mockResolvedValue([{ id: "nfl_11" }]);
    nflApiMocks.calculateNFLFantasyPoints.mockReturnValue(15.5);
    nflApiMocks.parseStatsToJson.mockReturnValue({ yards: 100 });
    storageMocks.updateDailyGameScore.mockResolvedValue(undefined);
    storageMocks.upsertPlayerGameStats.mockResolvedValue(undefined);
  });

  it("summarizes missing local players as skips instead of hard errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { syncNFLStats } = await import("./sync-nfl-stats");
    const result = await syncNFLStats();

    expect(storageMocks.getPlayersByIds).toHaveBeenCalledWith(["nfl_11", "nfl_22"]);
    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledTimes(1);
    expect(result.statsProcessed).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.skippedMissingPlayers).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipped 1 stat rows for players missing from the local roster"),
    );
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Error processing stat for player 22"),
      expect.anything(),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  updateDailyGameScore: vi.fn(),
  getDailyGamesBySport: vi.fn(),
  getPlayersByIds: vi.fn(),
  upsertPlayerGameStats: vi.fn(),
}));

const mlbApiMocks = vi.hoisted(() => ({
  fetchGamesByDate: vi.fn(),
  fetchBoxscore: vi.fn(),
  calculateFantasyPoints: vi.fn(),
  parseStatsToJson: vi.fn(),
  normalizeGameStatus: vi.fn(),
  createPlayerId: vi.fn(),
  getCurrentSeason: vi.fn(),
  resolvePlayerGameSide: vi.fn(),
  extractBoxscorePlayerStats: vi.fn(),
}));

const timeMocks = vi.hoisted(() => ({
  getTodayETBoundaries: vi.fn(),
  getGameDay: vi.fn(),
  getETDayBoundaries: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../mlb-statsapi", () => ({
  fetchGamesByDate: mlbApiMocks.fetchGamesByDate,
  fetchBoxscore: mlbApiMocks.fetchBoxscore,
  calculateFantasyPoints: mlbApiMocks.calculateFantasyPoints,
  parseStatsToJson: mlbApiMocks.parseStatsToJson,
  normalizeGameStatus: mlbApiMocks.normalizeGameStatus,
  createPlayerId: mlbApiMocks.createPlayerId,
  getCurrentSeason: mlbApiMocks.getCurrentSeason,
  getOpponentTeam: vi.fn(),
  resolvePlayerGameSide: mlbApiMocks.resolvePlayerGameSide,
  extractBoxscorePlayerStats: mlbApiMocks.extractBoxscorePlayerStats,
}));

vi.mock("../lib/time", () => ({
  getTodayETBoundaries: timeMocks.getTodayETBoundaries,
  getGameDay: timeMocks.getGameDay,
  getETDayBoundaries: timeMocks.getETDayBoundaries,
}));

describe("syncMLBStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    timeMocks.getGameDay.mockReturnValueOnce("2026-03-09").mockReturnValueOnce("2026-03-10");
    timeMocks.getETDayBoundaries.mockReturnValue({
      startOfDay: new Date("2026-03-09T00:00:00.000Z"),
    });
    timeMocks.getTodayETBoundaries.mockReturnValue({
      endOfDay: new Date("2026-03-10T23:59:59.999Z"),
    });

    const apiGame = {
      gamePk: 101,
      gameDate: "2026-03-10T19:00:00.000Z",
      status: { abstractGameState: "Final", detailedState: "Final" },
      teams: {
        home: { team: { abbreviation: "NYY" }, score: 5 },
        away: { team: { abbreviation: "BOS" }, score: 3 },
      },
    };
    mlbApiMocks.fetchGamesByDate.mockResolvedValueOnce([]).mockResolvedValueOnce([apiGame]);
    storageMocks.getDailyGamesBySport.mockResolvedValue([
      { gameId: "mlb_101", status: "completed" },
    ]);

    const boxscore = {
      teams: {
        home: { team: { abbreviation: "NYY" }, players: {} },
        away: { team: { abbreviation: "BOS" }, players: {} },
      },
      linescore: {
        teams: { home: { runs: 5 }, away: { runs: 3 } },
      },
    };
    mlbApiMocks.fetchBoxscore.mockResolvedValue(boxscore);
    mlbApiMocks.extractBoxscorePlayerStats.mockReturnValue(
      new Map([
        [11, { batting: { hits: 2 }, pitching: {} }],
        [22, { batting: { hits: 1 }, pitching: {} }],
      ]),
    );
    mlbApiMocks.createPlayerId.mockImplementation((playerId: number) => `mlb_${playerId}`);
    storageMocks.getPlayersByIds.mockResolvedValue([{ id: "mlb_11" }]);
    mlbApiMocks.getCurrentSeason.mockReturnValue(2026);
    mlbApiMocks.calculateFantasyPoints.mockReturnValue({ points: 17.5, breakdown: {} });
    mlbApiMocks.parseStatsToJson.mockReturnValue({ hits: 2 });
    mlbApiMocks.normalizeGameStatus.mockReturnValue("completed");
    mlbApiMocks.resolvePlayerGameSide.mockImplementation((_: unknown, playerId: number) =>
      playerId === 11 ? "away" : "home",
    );
    storageMocks.updateDailyGameScore.mockResolvedValue(undefined);
    storageMocks.upsertPlayerGameStats.mockResolvedValue(undefined);
  });

  it("summarizes missing local players as skips instead of hard per-row errors", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { syncMLBStats } = await import("./sync-mlb-stats");
    const result = await syncMLBStats();

    expect(storageMocks.getPlayersByIds).toHaveBeenCalledWith(
      expect.arrayContaining(["mlb_11", "mlb_22"]),
    );
    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledTimes(1);
    expect(result.statsProcessed).toBe(1);
    expect(result.skippedMissingPlayers).toBe(1);
    expect(result.errors).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipped 1 stat rows for players missing from the local roster"),
    );
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Error processing stat for player 22"),
      expect.anything(),
    );

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("can process an explicit date list for MLB stat backfills", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { syncMLBStatsForDates } = await import("./sync-mlb-stats");
    const result = await syncMLBStatsForDates(["2026-07-07"]);

    expect(mlbApiMocks.fetchGamesByDate).toHaveBeenCalledTimes(1);
    expect(mlbApiMocks.fetchGamesByDate).toHaveBeenCalledWith("2026-07-07");
    expect(storageMocks.getDailyGamesBySport).toHaveBeenCalledWith(
      "MLB",
      new Date("2026-03-09T00:00:00.000Z"),
      new Date("2026-03-09T00:00:00.000Z"),
    );
    expect(result.statsProcessed).toBe(1);
    expect(result.skippedMissingPlayers).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

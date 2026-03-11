import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  updateDailyGameScore: vi.fn(),
  getDailyGamesBySport: vi.fn(),
  getPlayersByIds: vi.fn(),
  upsertPlayerGameStats: vi.fn(),
}));

const mlbApiMocks = vi.hoisted(() => ({
  fetchGames: vi.fn(),
  fetchGameStats: vi.fn(),
  calculateMLBFantasyPoints: vi.fn(),
  parseStatsToJson: vi.fn(),
  isMLBApiConfigured: vi.fn(),
  createMLBPlayerId: vi.fn(),
  normalizeGameStatus: vi.fn(),
  getCurrentMLBSeason: vi.fn(),
  getMLBHomeScore: vi.fn(),
  getMLBAwayScore: vi.fn(),
  getMLBAwayTeam: vi.fn(),
  getMLBHomeTeamName: vi.fn(),
  getMLBAwayTeamName: vi.fn(),
  getMLBTeamDisplayName: vi.fn(),
  getMLBStatGameId: vi.fn(),
  getMLBStatTeamAbbreviation: vi.fn(),
  getMLBStatTeamName: vi.fn(),
}));

const timeMocks = vi.hoisted(() => ({
  getTodayETBoundaries: vi.fn(),
  getGameDay: vi.fn(),
  getETDayBoundaries: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../balldontlie-mlb", () => ({
  fetchGames: mlbApiMocks.fetchGames,
  fetchGameStats: mlbApiMocks.fetchGameStats,
  calculateMLBFantasyPoints: mlbApiMocks.calculateMLBFantasyPoints,
  parseStatsToJson: mlbApiMocks.parseStatsToJson,
  isMLBApiConfigured: mlbApiMocks.isMLBApiConfigured,
  createMLBPlayerId: mlbApiMocks.createMLBPlayerId,
  normalizeGameStatus: mlbApiMocks.normalizeGameStatus,
  getCurrentMLBSeason: mlbApiMocks.getCurrentMLBSeason,
  getMLBHomeScore: mlbApiMocks.getMLBHomeScore,
  getMLBAwayScore: mlbApiMocks.getMLBAwayScore,
  getMLBAwayTeam: mlbApiMocks.getMLBAwayTeam,
  getMLBHomeTeamName: mlbApiMocks.getMLBHomeTeamName,
  getMLBAwayTeamName: mlbApiMocks.getMLBAwayTeamName,
  getMLBTeamDisplayName: mlbApiMocks.getMLBTeamDisplayName,
  getMLBStatGameId: mlbApiMocks.getMLBStatGameId,
  getMLBStatTeamAbbreviation: mlbApiMocks.getMLBStatTeamAbbreviation,
  getMLBStatTeamName: mlbApiMocks.getMLBStatTeamName,
}));

vi.mock("../lib/time", () => ({
  getTodayETBoundaries: timeMocks.getTodayETBoundaries,
  getGameDay: timeMocks.getGameDay,
  getETDayBoundaries: timeMocks.getETDayBoundaries,
}));

describe("syncMLBStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mlbApiMocks.isMLBApiConfigured.mockReturnValue(true);
    timeMocks.getGameDay.mockReturnValue("2026-03-10");
    timeMocks.getETDayBoundaries.mockReturnValue({
      startOfDay: new Date("2026-03-09T00:00:00.000Z"),
    });
    timeMocks.getTodayETBoundaries.mockReturnValue({
      endOfDay: new Date("2026-03-10T23:59:59.999Z"),
    });

    mlbApiMocks.fetchGames.mockResolvedValue([
      {
        id: 101,
        date: "2026-03-10T19:00:00.000Z",
        season: 2026,
        status: "Final",
        home_team: {
          abbreviation: "NYY",
          name: "Yankees",
          display_name: "New York Yankees",
          short_display_name: "Yankees",
        },
        away_team: {
          abbreviation: "BOS",
          name: "Red Sox",
          display_name: "Boston Red Sox",
          short_display_name: "Red Sox",
        },
      },
    ]);
    storageMocks.getDailyGamesBySport.mockResolvedValue([
      { gameId: "mlb_101", status: "completed" },
    ]);
    mlbApiMocks.fetchGameStats.mockResolvedValue([
      { player: { id: 11 }, game: { id: 101 }, team: { abbreviation: "BOS", name: "Red Sox" } },
      { player: { id: 22 }, game: { id: 101 }, team: { abbreviation: "BOS", name: "Red Sox" } },
    ]);
    mlbApiMocks.createMLBPlayerId.mockImplementation((playerId: number) => `mlb_${playerId}`);
    storageMocks.getPlayersByIds.mockResolvedValue([{ id: "mlb_11" }]);
    mlbApiMocks.getMLBStatGameId.mockImplementation((stat: any) => stat.game.id);
    mlbApiMocks.getCurrentMLBSeason.mockReturnValue(2026);
    mlbApiMocks.calculateMLBFantasyPoints.mockReturnValue(17.5);
    mlbApiMocks.parseStatsToJson.mockReturnValue({ hits: 2 });
    mlbApiMocks.normalizeGameStatus.mockReturnValue("completed");
    mlbApiMocks.getMLBHomeScore.mockReturnValue(5);
    mlbApiMocks.getMLBAwayScore.mockReturnValue(3);
    mlbApiMocks.getMLBAwayTeam.mockImplementation((game: any) => game.away_team);
    mlbApiMocks.getMLBHomeTeamName.mockReturnValue("New York Yankees");
    mlbApiMocks.getMLBAwayTeamName.mockReturnValue("Boston Red Sox");
    mlbApiMocks.getMLBTeamDisplayName.mockImplementation(
      (team: any) => team?.display_name || team?.name,
    );
    mlbApiMocks.getMLBStatTeamAbbreviation.mockImplementation(
      (stat: any) => stat.team.abbreviation,
    );
    mlbApiMocks.getMLBStatTeamName.mockImplementation((stat: any) => stat.team.name);
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
});

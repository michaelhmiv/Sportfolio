import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  db: {
    select: selectMock,
  },
}));

function makeLimitQuery(rows: unknown[]) {
  return {
    limit: () => rows,
  };
}

function makeOrderByQuery(rows: unknown[]) {
  return {
    orderBy: () => rows,
  };
}

function makeOrderByLimitQuery(rows: unknown[]) {
  return {
    orderBy: () => makeLimitQuery(rows),
  };
}

function makeWhereOnlyQuery(rows: unknown[]) {
  return Promise.resolve(rows);
}

describe("DatabaseStorage player stats readers", () => {
  beforeEach(() => {
    selectMock.mockReset();
    vi.restoreAllMocks();
  });

  it("includes alias rows when building season stats", async () => {
    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();
    vi.spyOn(storage, "getPlayerIdentityIds").mockResolvedValue(["nba_1", "nba_alias"]);

    const seasonLog = {
      sport: "NBA",
      fantasyPoints: "28.50",
      points: 20,
      rebounds: 10,
      assists: 7,
      steals: 2,
      blocks: 1,
      minutes: 34,
      fieldGoalsMade: 8,
      fieldGoalsAttempted: 12,
      threePointersMade: 2,
      threePointersAttempted: 4,
      freeThrowsMade: 4,
      freeThrowsAttempted: 5,
      statsJson: {},
    };

    selectMock
      .mockReturnValueOnce({
        from: () => ({
          where: () => makeLimitQuery([{ sport: "NBA" }]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => makeOrderByQuery([seasonLog]),
        }),
      });

    const stats = await storage.getPlayerSeasonStatsFromLogs("nba_1");

    expect(stats).toMatchObject({
      sport: "NBA",
      gamesPlayed: 1,
      avgFantasyPointsPerGame: "28.50",
      pointsPerGame: "20.0",
      reboundsPerGame: "10.0",
      assistsPerGame: "7.0",
      fieldGoalPct: "66.7",
      threePointPct: "50.0",
      freeThrowPct: "80.0",
      steals: 2,
      blocks: 1,
      minutesPerGame: "34.0",
    });
    expect(storage.getPlayerIdentityIds).toHaveBeenCalledWith("nba_1");
  }, 30000);

  it("includes alias rows when returning recent games", async () => {
    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();
    vi.spyOn(storage, "getPlayerIdentityIds").mockResolvedValue(["nba_1", "nba_alias"]);

    const recentLog = {
      gameId: "nba_123456",
      gameDate: new Date("2026-03-10T00:00:00.000Z"),
      opponentTeam: "NYK",
      homeAway: "home",
      sport: "NBA",
      fantasyPoints: "25.00",
      points: 18,
      rebounds: 8,
      assists: 4,
      steals: 1,
      blocks: 0,
      minutes: 31,
      fieldGoalsMade: 7,
      fieldGoalsAttempted: 13,
      threePointersMade: 3,
      threePointersAttempted: 6,
      freeThrowsMade: 1,
      freeThrowsAttempted: 2,
      statsJson: {},
    };

    selectMock.mockReturnValueOnce({
      from: () => ({
        where: () => makeOrderByLimitQuery([recentLog]),
      }),
    });

    const recentGames = await storage.getPlayerRecentGamesFromLogs("nba_1", 5);

    expect(recentGames).toHaveLength(1);
    expect(recentGames[0]).toMatchObject({
      game: {
        id: 123456,
        opponent: "NYK",
        isHome: true,
      },
      stats: {
        points: 18,
        rebounds: 8,
        assists: 4,
        steals: 1,
        blocks: 0,
        minutes: 31,
        fantasyPoints: 25,
      },
    });
    expect(storage.getPlayerIdentityIds).toHaveBeenCalledWith("nba_1");
  });

  it("aggregates batched season stats across alias ids", async () => {
    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();

    const batchLog = {
      playerId: "nba_alias",
      sport: "NBA",
      season: "2025-2026-regular",
      gameDate: new Date("2026-03-10T00:00:00.000Z"),
      fantasyPoints: "30.00",
    };

    selectMock
      .mockReturnValueOnce({
        from: () => ({
          where: () =>
            makeWhereOnlyQuery([{ aliasPlayerId: "nba_alias", canonicalPlayerId: "nba_1" }]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () =>
            makeWhereOnlyQuery([{ canonicalPlayerId: "nba_1", aliasPlayerId: "nba_alias" }]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => makeWhereOnlyQuery([{ id: "nba_1", sport: "NBA" }]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => makeWhereOnlyQuery([batchLog]),
        }),
      });

    const statsMap = await storage.getBatchPlayerSeasonStatsFromLogs(["nba_alias"]);

    expect(statsMap.get("nba_alias")).toEqual({
      gamesPlayed: 1,
      avgFantasyPointsPerGame: "30.00",
    });
  });
});

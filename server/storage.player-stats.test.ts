import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  afterEach(() => {
    vi.useRealTimers();
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

  it("combines batched alias aggregates using a games-played weighted average", async () => {
    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();
    const groupByMock = vi.fn(() => [
      { playerId: "nba_1", gamesPlayed: "2", totalFantasyPoints: "31.00" },
      { playerId: "nba_alias", gamesPlayed: "1", totalFantasyPoints: "40.00" },
    ]);

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
          where: () => ({ groupBy: groupByMock }),
        }),
      });

    const statsMap = await storage.getBatchPlayerSeasonStatsFromLogs(["nba_alias"]);

    expect(statsMap.get("nba_alias")).toEqual({
      gamesPlayed: 3,
      avgFantasyPointsPerGame: "23.67",
    });
    expect(groupByMock).toHaveBeenCalledTimes(1);
  });

  it("selects only grouped aggregate fields for batched season logs", async () => {
    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();
    const groupByMock = vi.fn(() => []);

    selectMock
      .mockReturnValueOnce({
        from: () => ({
          where: () => makeWhereOnlyQuery([]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => makeWhereOnlyQuery([{ id: "nba_1", sport: "NBA" }]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ groupBy: groupByMock }),
        }),
      });

    const statsMap = await storage.getBatchPlayerSeasonStatsFromLogs(["nba_1"]);
    const aggregateSelection = selectMock.mock.calls[2]?.[0];

    expect(Object.keys(aggregateSelection)).toEqual([
      "playerId",
      "gamesPlayed",
      "totalFantasyPoints",
    ]);
    expect(groupByMock).toHaveBeenCalledTimes(1);
    expect(statsMap.get("nba_1")).toEqual({
      gamesPlayed: 0,
      avgFantasyPointsPerGame: "0.0",
    });
  });

  it("scopes each sport to its current competitive season identifiers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00.000Z"));

    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();
    const whereMock = vi.fn((_filter: SQL) => ({ groupBy: vi.fn(() => []) }));

    selectMock
      .mockReturnValueOnce({
        from: () => ({
          where: () => makeWhereOnlyQuery([]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () =>
            makeWhereOnlyQuery([
              { id: "nba_1", sport: "NBA" },
              { id: "nhl_1", sport: "NHL" },
              { id: "mlb_1", sport: "MLB" },
              { id: "nascar_1", sport: "NASCAR" },
              { id: "nfl_1", sport: "NFL" },
            ]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: whereMock }),
      });

    const playerIds = ["nba_1", "nhl_1", "mlb_1", "nascar_1", "nfl_1"];
    await storage.getBatchPlayerSeasonStatsFromLogs(playerIds);

    expect(whereMock).toHaveBeenCalledTimes(1);
    const compiledFilter = new PgDialect().sqlToQuery(whereMock.mock.calls[0][0]);
    expect(compiledFilter.params).toEqual([
      "nba_1",
      "2025-2026-regular",
      "2025-2026-playoff",
      "2024-2025-regular",
      "2024-2025-playoff",
      "nhl_1",
      "20252026",
      "20242025",
      "mlb_1",
      "2026",
      "2025",
      "nascar_1",
      "2026",
      "2025",
      "nfl_1",
      "2025",
      "2024",
    ]);
    expect(compiledFilter.sql).toContain('\"player_game_stats\".\"season\" in');
    expect(compiledFilter.sql.match(/\"player_game_stats\"\.\"season\" in/g)).toHaveLength(5);
  });

  it("defensively normalizes malformed aggregate numbers without discarding valid negatives", async () => {
    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();
    const groupByMock = vi.fn(() => [
      { playerId: "nba_bad_count", gamesPlayed: "NaN", totalFantasyPoints: "100" },
      { playerId: "nba_negative_count", gamesPlayed: "-2", totalFantasyPoints: "100" },
      { playerId: "nba_bad_total", gamesPlayed: "2", totalFantasyPoints: "Infinity" },
      { playerId: "nba_negative_total", gamesPlayed: "2", totalFantasyPoints: "-3" },
    ]);
    const playerIds = [
      "nba_bad_count",
      "nba_negative_count",
      "nba_bad_total",
      "nba_negative_total",
    ];

    selectMock
      .mockReturnValueOnce({
        from: () => ({
          where: () => makeWhereOnlyQuery([]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => makeWhereOnlyQuery(playerIds.map((id) => ({ id, sport: "NBA" }))),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ groupBy: groupByMock }),
        }),
      });

    const statsMap = await storage.getBatchPlayerSeasonStatsFromLogs(playerIds);

    expect(statsMap.get("nba_bad_count")).toEqual({
      gamesPlayed: 0,
      avgFantasyPointsPerGame: "0.0",
    });
    expect(statsMap.get("nba_negative_count")).toEqual({
      gamesPlayed: 0,
      avgFantasyPointsPerGame: "0.0",
    });
    expect(statsMap.get("nba_bad_total")).toEqual({
      gamesPlayed: 2,
      avgFantasyPointsPerGame: "0.00",
    });
    expect(statsMap.get("nba_negative_total")).toEqual({
      gamesPlayed: 2,
      avgFantasyPointsPerGame: "-1.50",
    });
    expect(groupByMock).toHaveBeenCalledTimes(1);
  });
});

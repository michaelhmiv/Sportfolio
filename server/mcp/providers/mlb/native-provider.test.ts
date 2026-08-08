import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statsApi = vi.hoisted(() => ({
  fetchAllPlayers: vi.fn(),
  fetchSeasonStatSplits: vi.fn(),
  fetchTeamRoster: vi.fn(),
  isApiReachable: vi.fn(),
}));

vi.mock("../../../mlb-statsapi", () => statsApi);

import { callNativeMlbTool, nativeMlbHealth } from "./native-provider";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  statsApi.fetchAllPlayers.mockReset();
  statsApi.fetchSeasonStatSplits.mockReset();
  statsApi.fetchTeamRoster.mockReset();
  statsApi.isApiReachable.mockReset();
  statsApi.isApiReachable.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native MLB provider", () => {
  it("returns schedule data in the compatibility shape used by pregame insights", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        dates: [
          {
            date: "2026-08-07",
            games: [
              {
                gamePk: 123,
                gameDate: "2026-08-07T23:10:00Z",
                status: { detailedState: "Scheduled" },
                teams: {
                  away: {
                    team: { id: 111, name: "Boston Red Sox" },
                    score: null,
                    probablePitcher: { id: 1, fullName: "Away Starter" },
                  },
                  home: {
                    team: { id: 147, name: "New York Yankees" },
                    score: null,
                    probablePitcher: { id: 2, fullName: "Home Starter" },
                  },
                },
                venue: { id: 3313, name: "Yankee Stadium" },
                doubleHeader: "N",
                gameNumber: 1,
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = (await callNativeMlbTool(
      "get_mlb_games",
      { date: "2026-08-07" },
      { timeoutMs: 1000 },
    )) as any;

    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({
      game_id: 123,
      game_date: "2026-08-07",
      away_name: "Boston Red Sox",
      home_name: "New York Yankees",
      away_probable_pitcher: "Away Starter",
      home_probable_pitcher: "Home Starter",
      venue_name: "Yankee Stadium",
      status: "Scheduled",
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("statsapi.mlb.com/api/v1/schedule");
  });

  it("returns the raw MLB live feed for game details", async () => {
    const payload = {
      gameData: { status: { detailedState: "Final" } },
      liveData: { boxscore: { teams: {} }, linescore: { currentInning: 9 } },
    };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callNativeMlbTool("get_mlb_game_details", { gameId: 123 }, { timeoutMs: 1000 }),
    ).resolves.toEqual(payload);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1.1/game/123/feed/live");
  });

  it("parses Baseball Savant expected-stat CSV into the legacy data envelope", async () => {
    const csv = [
      "player_id,first_name,last_name,pa,woba,est_woba,ba,est_ba,slg,est_slg",
      "660271,Shohei,Ohtani,500,0.400,0.410,0.300,0.305,0.600,0.620",
    ].join("\n");
    const fetchMock = vi.fn(async () => new Response(csv, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = (await callNativeMlbTool(
      "get_mlb_statcast_profile",
      { role: "batter", season: 2026, minimum: 50 },
      { timeoutMs: 1000 },
    )) as any;

    expect(result).toMatchObject({ count: 1, total_rows: 1, truncated: false });
    expect(result.data[0]).toMatchObject({
      player_id: 660271,
      first_name: "Shohei",
      last_name: "Ohtani",
      pa: 500,
      est_woba: 0.41,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "baseballsavant.mlb.com/leaderboard/expected_statistics",
    );
  });

  it("searches native MLB players without a separate MCP service", async () => {
    statsApi.fetchAllPlayers.mockResolvedValue([
      { id: 660271, fullName: "Shohei Ohtani" },
      { id: 592450, fullName: "Aaron Judge" },
    ]);

    const result = (await callNativeMlbTool(
      "search_mlb_players",
      { query: "Ohtani", season: 2026 },
      { timeoutMs: 1000 },
    )) as any;
    expect(result.people).toEqual([{ id: 660271, fullName: "Shohei Ohtani" }]);
  });

  it("reports health through Sportfolio's native StatsAPI client", async () => {
    statsApi.isApiReachable.mockResolvedValue(true);
    await expect(nativeMlbHealth()).resolves.toMatchObject({ reachable: true });
  });
});

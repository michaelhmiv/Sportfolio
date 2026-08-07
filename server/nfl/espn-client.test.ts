import { describe, expect, it, vi } from "vitest";
import {
  EspnNflClient,
  extractEspnPlayerStats,
  extractEspnRoster,
  normalizeEspnGame,
} from "./espn-client";

describe("ESPN NFL provider", () => {
  it("normalizes a scoreboard event with preseason metadata", () => {
    const game = normalizeEspnGame({
      id: "401772510",
      date: "2026-08-07T00:00Z",
      season: { year: 2026, type: 1 },
      week: { number: 1 },
      competitions: [
        {
          status: {
            period: 2,
            displayClock: "03:15",
            type: { name: "STATUS_IN_PROGRESS", state: "in" },
          },
          venue: { fullName: "Example Stadium" },
          competitors: [
            { homeAway: "home", score: "14", team: { abbreviation: "CAR" } },
            { homeAway: "away", score: "10", team: { abbreviation: "CLE" } },
          ],
        },
      ],
    });
    expect(game).toMatchObject({
      espnId: "401772510",
      season: 2026,
      seasonType: "preseason",
      week: 1,
      status: "inprogress",
      homeTeam: "CAR",
      awayTeam: "CLE",
      homeScore: 14,
      awayScore: 10,
      period: 2,
      clock: "03:15",
    });
  });

  it("extracts only market-eligible roster positions", () => {
    const roster = extractEspnRoster(
      {
        athletes: [
          { id: "1", displayName: "QB One", active: true, position: { abbreviation: "QB" } },
          { id: "2", displayName: "Linebacker", active: true, position: { abbreviation: "LB" } },
          { id: "3", displayName: "Receiver", active: true, position: { abbreviation: "WR" } },
        ],
      },
      "CAR",
    );
    expect(roster.map((player) => player.position)).toEqual(["QB", "WR"]);
  });

  it("extracts player statistics and made field-goal distance", () => {
    const rows = extractEspnPlayerStats({
      scoringPlays: [
        {
          type: { text: "Field Goal" },
          text: "Kicker 52 yard field goal is GOOD",
          participants: [{ athlete: { id: "9" } }],
        },
      ],
      boxscore: {
        players: [
          {
            team: { abbreviation: "CAR" },
            statistics: [
              {
                name: "kicking",
                names: ["FG", "XP"],
                athletes: [
                  {
                    athlete: {
                      id: "9",
                      displayName: "Kicker Nine",
                      position: { abbreviation: "K" },
                    },
                    stats: ["1", "2"],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].stats).toMatchObject({ fieldgoalsmade: 1, extrapointsmade: 2 });
    expect(rows[0].fieldGoalDistances).toEqual([52]);
  });

  it("namespaces ESPN shorthand stats by category", () => {
    const [row] = extractEspnPlayerStats({
      boxscore: {
        players: [
          {
            team: { abbreviation: "BUF" },
            statistics: [
              {
                name: "passing",
                names: ["YDS", "TD", "INT"],
                athletes: [
                  {
                    athlete: { id: "17", displayName: "QB Test", position: { abbreviation: "QB" } },
                    stats: ["280", "2", "1"],
                  },
                ],
              },
              {
                name: "rushing",
                names: ["YDS", "TD"],
                athletes: [
                  {
                    athlete: { id: "17", displayName: "QB Test", position: { abbreviation: "QB" } },
                    stats: ["42", "1"],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(row.stats).toMatchObject({
      passingyards: 280,
      passingtouchdowns: 2,
      interceptions: 1,
      rushingyards: 42,
      rushingtouchdowns: 1,
    });
  });

  it("retries one 429 response and succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    const client = new EspnNflClient(fetchImpl as typeof fetch, 1000, 1);
    await expect(client.getGames()).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed on malformed JSON shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("null", { status: 200 }));
    const client = new EspnNflClient(fetchImpl as typeof fetch, 1000, 0);
    await expect(client.getGames()).rejects.toThrow("invalid JSON");
  });

  it("keeps preseason offensive box-score rows when ESPN omits athlete position", () => {
    const rows = extractEspnPlayerStats({
      boxscore: {
        players: [
          {
            team: { abbreviation: "CAR" },
            statistics: [
              {
                name: "passing",
                names: ["C/ATT", "YDS", "TD", "INT"],
                athletes: [
                  {
                    athlete: { id: "101", displayName: "Preseason QB" },
                    stats: ["12/18", "141", "1", "0"],
                  },
                ],
              },
              {
                name: "rushing",
                names: ["CAR", "YDS", "TD"],
                athletes: [
                  {
                    athlete: { id: "102", displayName: "Preseason Runner" },
                    stats: ["7", "44", "1"],
                  },
                ],
              },
              {
                name: "receiving",
                names: ["REC", "TGTS", "YDS", "TD"],
                athletes: [
                  {
                    athlete: { id: "103", displayName: "Preseason Receiver" },
                    stats: ["4", "6", "65", "1"],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ espnId: "101", position: "QB" });
    expect(rows[0].stats).toMatchObject({
      passingcompletions: 12,
      passingattempts: 18,
      passingyards: 141,
      passingtouchdowns: 1,
    });
    expect(rows[1].stats).toMatchObject({ rushingattempts: 7, rushingyards: 44 });
    expect(rows[2].stats).toMatchObject({ receptions: 4, receivingtargets: 6, receivingyards: 65 });
  });

  it("preserves made and attempted kicking values", () => {
    const [row] = extractEspnPlayerStats({
      boxscore: {
        players: [
          {
            team: { abbreviation: "ARI" },
            statistics: [
              {
                name: "kicking",
                names: ["FG", "XP"],
                athletes: [{ athlete: { id: "9", displayName: "Kicker" }, stats: ["2/3", "3/3"] }],
              },
            ],
          },
        ],
      },
    });
    expect(row.position).toBe("K");
    expect(row.stats).toMatchObject({
      fieldgoalsmade: 2,
      fieldgoalsattempted: 3,
      extrapointsmade: 3,
      extrapointsattempted: 3,
    });
  });
});

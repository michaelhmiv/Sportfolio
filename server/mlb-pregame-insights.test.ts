import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveInternalMlbMcpConfig: vi.fn(),
  runInternalMlbMcpToolRaw: vi.fn(),
}));

vi.mock("./agent/internal-mlb-mcp", () => ({
  resolveInternalMlbMcpConfig: mocks.resolveInternalMlbMcpConfig,
  runInternalMlbMcpToolRaw: mocks.runInternalMlbMcpToolRaw,
}));

import { clearAll } from "./cache";
import {
  getMlbPregameInsightBundle,
  getMlbPitcherMatchupChip,
  getMlbPlayerPregameLookup,
  getMlbPregameInsightMap,
} from "./mlb-pregame-insights";

const localGame = {
  gameId: "mlb_local_1",
  sport: "MLB",
  startTime: new Date("2026-03-27T23:15:00.000Z"),
  homeTeam: "ATL",
  awayTeam: "KC",
  homeScore: null,
  awayScore: null,
  venue: "Truist Park",
} as any;

describe("mlb-pregame-insights", () => {
  beforeEach(() => {
    clearAll();
    mocks.resolveInternalMlbMcpConfig.mockReset();
    mocks.runInternalMlbMcpToolRaw.mockReset();

    mocks.resolveInternalMlbMcpConfig.mockReturnValue({
      enabled: true,
      endpoint: "http://mlb-mcp.railway.internal:8080/mcp",
      toolPrefix: "mlb_mcp__",
      timeoutMs: 12000,
      cacheTtlMs: 60000,
      authBearerToken: null,
      implicitLocalDevFallback: false,
    });

    mocks.runInternalMlbMcpToolRaw.mockImplementation(async ({ toolName, args }) => {
      if (toolName === "mlb_mcp__get_schedule") {
        expect(args).toMatchObject({ date: "2026-03-27" });
        return {
          remoteToolName: "get_schedule",
          replyText: null,
          content: [],
          structuredContent: {
            games: [
              {
                game_id: 824946,
                game_datetime: "2026-03-27T23:15:00Z",
                game_date: "2026-03-27",
                away_name: "Kansas City Royals",
                home_name: "Atlanta Braves",
                away_probable_pitcher: "Cole Ragans",
                home_probable_pitcher: "Chris Sale",
                away_pitcher_note: "",
                home_pitcher_note: "",
                doubleheader: "N",
                game_num: 1,
                venue_name: "Truist Park",
                national_broadcasts: ["MLBN"],
                status: "Pre-Game",
              },
            ],
          },
        };
      }

      if (toolName === "mlb_mcp__get_statcast_pitcher_expected_stats") {
        expect(args).toMatchObject({
          year: 2025,
          minPA: 1,
          start_row: 0,
          end_row: 1400,
        });

        return {
          remoteToolName: "get_statcast_pitcher_expected_stats",
          replyText: null,
          content: [],
          structuredContent: {
            data: [
              {
                "last_name, first_name": "Sale, Chris",
                player_id: 519242,
                year: 2025,
                pa: 713,
                ba: 0.214,
                est_ba: 0.221,
                slg: 0.329,
                est_slg: 0.341,
                woba: 0.267,
                est_woba: 0.274,
                era: 2.91,
                xera: 3.04,
              },
              {
                "last_name, first_name": "Ragans, Cole",
                player_id: 666142,
                year: 2025,
                pa: 702,
                ba: 0.225,
                est_ba: 0.229,
                slg: 0.361,
                est_slg: 0.378,
                woba: 0.283,
                est_woba: 0.291,
                era: 3.33,
                xera: 3.46,
              },
            ],
          },
        };
      }

      if (toolName === "mlb_mcp__get_statcast_batter_expected_stats") {
        expect(args).toMatchObject({
          year: 2025,
          minPA: 1,
          start_row: 0,
          end_row: 2200,
        });

        return {
          remoteToolName: "get_statcast_batter_expected_stats",
          replyText: null,
          content: [],
          structuredContent: {
            data: [
              {
                "last_name, first_name": "Garcia, Maikel",
                player_id: 677951,
                year: 2025,
                pa: 602,
                ba: 0.279,
                est_ba: 0.284,
                slg: 0.422,
                est_slg: 0.441,
                woba: 0.332,
                est_woba: 0.345,
              },
              {
                "last_name, first_name": "Witt Jr., Bobby",
                player_id: 664034,
                year: 2025,
                pa: 688,
                ba: 0.301,
                est_ba: 0.295,
                slg: 0.523,
                est_slg: 0.548,
                woba: 0.372,
                est_woba: 0.381,
              },
              {
                "last_name, first_name": "Acuna Jr., Ronald",
                player_id: 592450,
                year: 2025,
                pa: 640,
                ba: 0.318,
                est_ba: 0.309,
                slg: 0.561,
                est_slg: 0.579,
                woba: 0.398,
                est_woba: 0.402,
              },
              {
                "last_name, first_name": "Riley, Austin",
                player_id: 663586,
                year: 2025,
                pa: 615,
                ba: 0.281,
                est_ba: 0.287,
                slg: 0.505,
                est_slg: 0.521,
                woba: 0.361,
                est_woba: 0.369,
              },
            ],
          },
        };
      }

      if (toolName === "mlb_mcp__get_stats") {
        expect(args).toMatchObject({
          endpoint: "game",
        });

        const gamePk = args?.params?.gamePk;

        if (gamePk === 824946) {
          return {
            remoteToolName: "get_stats",
            replyText: null,
            content: [],
            structuredContent: {
              gameData: {
                gamePk: 824946,
                datetime: {
                  dateTime: "2026-03-27T23:15:00Z",
                },
                status: {
                  detailedState: "Final",
                },
                venue: {
                  name: "Truist Park",
                },
                teams: {
                  away: {
                    id: 118,
                    name: "Kansas City Royals",
                    abbreviation: "KC",
                    record: {
                      wins: 86,
                      losses: 76,
                    },
                  },
                  home: {
                    id: 144,
                    name: "Atlanta Braves",
                    abbreviation: "ATL",
                    record: {
                      wins: 95,
                      losses: 67,
                    },
                  },
                },
                weather: {
                  condition: "Clear",
                  temp: 72,
                  wind: "8 mph, Out to LF",
                },
                gameInfo: {
                  attendance: 40213,
                },
              },
              liveData: {
                decisions: {
                  winner: { fullName: "Chris Sale" },
                  loser: { fullName: "Cole Ragans" },
                  save: { fullName: "Raisel Iglesias" },
                },
                plays: {
                  scoringPlays: [0, 1],
                  allPlays: [
                    {
                      about: {
                        halfInning: "bottom",
                        inning: 1,
                        ordinalNum: "1st",
                      },
                      matchup: {
                        battingTeam: {
                          abbreviation: "ATL",
                        },
                      },
                      result: {
                        event: "Home Run",
                        description: "Ronald Acuna Jr. homers to left field.",
                        awayScore: 0,
                        homeScore: 2,
                      },
                    },
                    {
                      about: {
                        halfInning: "top",
                        inning: 4,
                        ordinalNum: "4th",
                      },
                      matchup: {
                        battingTeam: {
                          abbreviation: "KC",
                        },
                      },
                      result: {
                        event: "Single",
                        description: "Bobby Witt Jr. singles on a line drive.",
                        awayScore: 2,
                        homeScore: 3,
                      },
                    },
                  ],
                },
                linescore: {
                  currentInning: 9,
                  currentInningOrdinal: "9th",
                  inningState: "End",
                  balls: 0,
                  strikes: 0,
                  outs: 3,
                  teams: {
                    away: {
                      runs: 2,
                      hits: 7,
                      errors: 1,
                    },
                    home: {
                      runs: 5,
                      hits: 9,
                      errors: 0,
                    },
                  },
                  innings: [
                    { num: 1, away: { runs: 0 }, home: { runs: 2 } },
                    { num: 2, away: { runs: 1 }, home: { runs: 0 } },
                    { num: 3, away: { runs: 0 }, home: { runs: 1 } },
                    { num: 4, away: { runs: 1 }, home: { runs: 0 } },
                    { num: 5, away: { runs: 0 }, home: { runs: 2 } },
                  ],
                },
                boxscore: {
                  info: [
                    { label: "Weather", value: "Clear, 72F" },
                    { label: "Wind", value: "8 mph, Out to LF" },
                    { label: "Att", value: "40,213" },
                  ],
                  teams: {
                    away: {
                      batters: [677951, 664034, 666142],
                      players: {
                        ID677951: {
                          person: { fullName: "Maikel Garcia" },
                          jerseyNumber: "11",
                          position: { abbreviation: "3B" },
                        },
                        ID664034: {
                          person: { fullName: "Bobby Witt Jr." },
                          jerseyNumber: "7",
                          position: { abbreviation: "SS" },
                        },
                        ID666142: {
                          person: { fullName: "Cole Ragans" },
                          jerseyNumber: "55",
                          position: { abbreviation: "P" },
                        },
                      },
                    },
                    home: {
                      batters: [592450, 663586, 519242],
                      players: {
                        ID592450: {
                          person: { fullName: "Ronald Acuna Jr." },
                          jerseyNumber: "13",
                          position: { abbreviation: "RF" },
                        },
                        ID663586: {
                          person: { fullName: "Austin Riley" },
                          jerseyNumber: "27",
                          position: { abbreviation: "3B" },
                        },
                        ID519242: {
                          person: { fullName: "Chris Sale" },
                          jerseyNumber: "51",
                          position: { abbreviation: "P" },
                        },
                      },
                    },
                  },
                },
              },
            },
          };
        }

        if (gamePk === 824930) {
          return {
            remoteToolName: "get_stats",
            replyText: null,
            content: [],
            structuredContent: {
              gameData: {
                gamePk: 824930,
                datetime: {
                  dateTime: "2026-03-26T19:10:00Z",
                },
                status: {
                  detailedState: "Final",
                },
                teams: {
                  away: {
                    id: 118,
                    name: "Kansas City Royals",
                    abbreviation: "KC",
                  },
                  home: {
                    id: 140,
                    name: "Texas Rangers",
                    abbreviation: "TEX",
                  },
                },
              },
              liveData: {
                linescore: {
                  teams: {
                    away: {
                      runs: 6,
                      hits: 10,
                      errors: 0,
                    },
                    home: {
                      runs: 4,
                      hits: 8,
                      errors: 1,
                    },
                  },
                },
              },
            },
          };
        }

        if (gamePk === 824931) {
          return {
            remoteToolName: "get_stats",
            replyText: null,
            content: [],
            structuredContent: {
              gameData: {
                gamePk: 824931,
                datetime: {
                  dateTime: "2026-03-26T23:20:00Z",
                },
                status: {
                  detailedState: "Final",
                },
                teams: {
                  away: {
                    id: 146,
                    name: "Miami Marlins",
                    abbreviation: "MIA",
                  },
                  home: {
                    id: 144,
                    name: "Atlanta Braves",
                    abbreviation: "ATL",
                  },
                },
              },
              liveData: {
                linescore: {
                  teams: {
                    away: {
                      runs: 2,
                      hits: 6,
                      errors: 0,
                    },
                    home: {
                      runs: 5,
                      hits: 9,
                      errors: 0,
                    },
                  },
                },
              },
            },
          };
        }

        if (gamePk === 824960) {
          return {
            remoteToolName: "get_stats",
            replyText: null,
            content: [],
            structuredContent: {
              gameData: {
                gamePk: 824960,
                datetime: {
                  dateTime: "2026-03-28T20:10:00Z",
                },
                status: {
                  detailedState: "Scheduled",
                },
                teams: {
                  away: {
                    id: 118,
                    name: "Kansas City Royals",
                    abbreviation: "KC",
                  },
                  home: {
                    id: 116,
                    name: "Detroit Tigers",
                    abbreviation: "DET",
                  },
                },
              },
              liveData: {},
            },
          };
        }

        if (gamePk === 824961) {
          return {
            remoteToolName: "get_stats",
            replyText: null,
            content: [],
            structuredContent: {
              gameData: {
                gamePk: 824961,
                datetime: {
                  dateTime: "2026-03-29T17:35:00Z",
                },
                status: {
                  detailedState: "Scheduled",
                },
                teams: {
                  away: {
                    id: 143,
                    name: "Philadelphia Phillies",
                    abbreviation: "PHI",
                  },
                  home: {
                    id: 144,
                    name: "Atlanta Braves",
                    abbreviation: "ATL",
                  },
                },
              },
              liveData: {},
            },
          };
        }

        throw new Error(`Unexpected gamePk: ${String(gamePk)}`);
      }

      if (toolName === "mlb_mcp__get_last_game") {
        if (args.team_id === 118) {
          return {
            remoteToolName: "get_last_game",
            replyText: null,
            content: [],
            structuredContent: {
              game_id: 824930,
              team_id: 118,
              date: "2026-03-26",
              status: "Final",
            },
          };
        }

        if (args.team_id === 144) {
          return {
            remoteToolName: "get_last_game",
            replyText: null,
            content: [],
            structuredContent: {
              game_id: 824931,
              team_id: 144,
              date: "2026-03-26",
              status: "Final",
            },
          };
        }
      }

      if (toolName === "mlb_mcp__get_next_game") {
        if (args.team_id === 118) {
          return {
            remoteToolName: "get_next_game",
            replyText: null,
            content: [],
            structuredContent: {
              game_id: 824960,
              team_id: 118,
              date: "2026-03-28",
              status: "Scheduled",
            },
          };
        }

        if (args.team_id === 144) {
          return {
            remoteToolName: "get_next_game",
            replyText: null,
            content: [],
            structuredContent: {
              game_id: 824961,
              team_id: 144,
              date: "2026-03-29",
              status: "Scheduled",
            },
          };
        }
      }

      throw new Error(`Unexpected tool call: ${toolName}`);
    });
  });

  it("maps probable pitchers and expected stats onto local MLB games", async () => {
    const insightByGameId = await getMlbPregameInsightMap([localGame], "2026-03-27");
    const insight = insightByGameId.get("mlb_local_1");

    expect(insight).toBeTruthy();
    expect(insight?.probablePitchers.away?.name).toBe("Cole Ragans");
    expect(insight?.probablePitchers.home?.name).toBe("Chris Sale");
    expect(insight?.probablePitcherStats.away?.xera).toBeCloseTo(3.46);
    expect(insight?.probablePitcherStats.home?.summary).toContain("xERA");
    expect(insight?.advancedStatsAvailable).toBe(true);
    expect(insight?.statYear).toBe(2025);
    expect(insight?.matchupSummary).toContain("ATL");
    expect(insight?.venue).toBe("Truist Park");
    expect(insight?.broadcasts).toEqual(["MLBN"]);
    expect(insight?.lineupsPosted).toBe(false);
    expect(insight?.startingLineups.away).toEqual([]);
    expect(insight?.hitterSpotlights.away).toEqual([]);
    expect(insight?.gameState).toBeNull();
  });

  it("marks MLB enrichment unavailable when the internal MLB MCP is not configured", async () => {
    mocks.resolveInternalMlbMcpConfig.mockReturnValue({
      enabled: false,
      endpoint: null,
      toolPrefix: "mlb_mcp__",
      timeoutMs: 12000,
      cacheTtlMs: 60000,
      authBearerToken: null,
      implicitLocalDevFallback: false,
    });

    const bundle = await getMlbPregameInsightBundle([localGame], "2026-03-27");

    expect(bundle.insightByGameId.get("mlb_local_1")).toBeUndefined();
    expect(bundle.statusByGameId.get("mlb_local_1")).toEqual({
      state: "unavailable",
      message: "MLB enrichment unavailable in this environment.",
    });
  });

  it("marks MLB enrichment pending when no schedule match is available yet", async () => {
    mocks.runInternalMlbMcpToolRaw.mockImplementation(async ({ toolName }) => {
      if (toolName === "mlb_mcp__get_schedule") {
        return {
          remoteToolName: "get_schedule",
          replyText: null,
          content: [],
          structuredContent: {
            games: [],
          },
        };
      }

      throw new Error(`Unexpected tool call: ${toolName}`);
    });

    const bundle = await getMlbPregameInsightBundle([localGame], "2026-03-27");

    expect(bundle.insightByGameId.get("mlb_local_1")).toBeUndefined();
    expect(bundle.statusByGameId.get("mlb_local_1")).toEqual({
      state: "pending",
      message: "MLB game context is pending.",
    });
  });

  it("loads lineup details for detailed MLB game cards", async () => {
    const insightByGameId = await getMlbPregameInsightMap([localGame], "2026-03-27", {
      includeGameDetails: true,
    });
    const insight = insightByGameId.get("mlb_local_1");

    expect(insight?.gameNumber).toBe(1);
    expect(insight?.lineupsPosted).toBe(true);
    expect(insight?.startingLineups.away.map((player) => player.name)).toEqual([
      "Maikel Garcia",
      "Bobby Witt Jr.",
      "Cole Ragans",
    ]);
    expect(insight?.startingLineups.home[0]).toMatchObject({
      slot: 1,
      name: "Ronald Acuna Jr.",
      position: "RF",
      jerseyNumber: "13",
    });
    expect(insight?.weatherSummary).toBe("Clear | 72F | 8 mph, Out to LF");
    expect(insight?.attendance).toBe(40213);
    expect(insight?.hitterSpotlights.away[0]).toMatchObject({
      name: "Bobby Witt Jr.",
      slot: 2,
      expectedWoba: 0.381,
    });
    expect(insight?.hitterSpotlights.home[0]).toMatchObject({
      name: "Ronald Acuna Jr.",
      slot: 1,
      expectedWoba: 0.402,
    });
    expect(insight?.hitterMatchupNotes.away).toContain("KC leans on");
    expect(insight?.lineupSignals.home).toContain("Pressure");
    expect(insight?.teamContexts.away).toMatchObject({
      record: "86-76",
      lastGameSummary: "Won 6-4 @ TEX on Mar 26",
      nextGameSummary: "Next Mar 28 @ DET",
    });
    expect(insight?.teamContexts.home).toMatchObject({
      record: "95-67",
      lastGameSummary: "Won 5-2 vs MIA on Mar 26",
      nextGameSummary: "Next Mar 29 vs PHI",
    });
    expect(insight?.scoringPlays[0]).toMatchObject({
      inningLabel: "top 4th",
      battingTeam: "KC",
      event: "Single",
      scoreLabel: "2-3",
    });
    expect(insight?.gameState?.linescore?.totals).toMatchObject({
      awayRuns: 2,
      homeRuns: 5,
      awayHits: 7,
      homeHits: 9,
    });
    expect(insight?.gameState?.decisions).toMatchObject({
      winner: "Chris Sale",
      loser: "Cole Ragans",
      save: "Raisel Iglesias",
    });
  });

  it("accepts wrapped MLB MCP tool payloads from the live server", async () => {
    const baseImplementation = mocks.runInternalMlbMcpToolRaw.getMockImplementation();
    expect(baseImplementation).toBeTypeOf("function");

    mocks.runInternalMlbMcpToolRaw.mockImplementation(async (input) => {
      const response = await baseImplementation?.(input as never);
      return {
        ...response,
        structuredContent: {
          result: response?.structuredContent ?? null,
        },
      };
    });

    const insightByGameId = await getMlbPregameInsightMap([localGame], "2026-03-27", {
      includeGameDetails: true,
    });
    const insight = insightByGameId.get("mlb_local_1");

    expect(insight?.probablePitchers.away?.name).toBe("Cole Ragans");
    expect(insight?.probablePitchers.home?.name).toBe("Chris Sale");
    expect(insight?.lineupsPosted).toBe(true);
    expect(insight?.startingLineups.home[0]?.name).toBe("Ronald Acuna Jr.");
    expect(insight?.teamContexts.away?.lastGameSummary).toBe("Won 6-4 @ TEX on Mar 26");
    expect(insight?.teamContexts.home?.nextGameSummary).toBe("Next Mar 29 vs PHI");
  });

  it("builds probable-starter and hitter matchup lookup data for the market boards", async () => {
    const lookup = await getMlbPlayerPregameLookup([localGame], "2026-03-27");

    const probableStarterContext = getMlbPitcherMatchupChip({
      playerName: "Chris Sale",
      playerTeam: "ATL",
      playerPosition: "P",
      probableStarterKeys: lookup.probableStarterKeys,
      probableStarterContextByKey: lookup.probableStarterContextByKey,
      matchupsByTeam: lookup.matchupsByTeam,
    });

    const hitterContext = getMlbPitcherMatchupChip({
      playerName: "Matt Olson",
      playerTeam: "ATL",
      playerPosition: "1B",
      probableStarterKeys: lookup.probableStarterKeys,
      probableStarterContextByKey: lookup.probableStarterContextByKey,
      matchupsByTeam: lookup.matchupsByTeam,
    });

    expect(probableStarterContext.isProbableStarter).toBe(true);
    expect(probableStarterContext.probablePitcherGameId).toBe("mlb_local_1");
    expect(probableStarterContext.mlbMatchupChip).toBe("vs KC");
    expect(hitterContext.isProbableStarter).toBe(false);
    expect(hitterContext.mlbMatchupChip).toBe("vs Ragans");
    expect(hitterContext.mlbPregameSummary).toContain("ATL");
  });

  it("keeps doubleheader probable starters tied to the correct game context", async () => {
    const firstGame = {
      ...localGame,
      gameId: "mlb_local_1",
      startTime: new Date("2026-03-27T19:15:00.000Z"),
    } as any;
    const secondGame = {
      ...localGame,
      gameId: "mlb_local_2",
      startTime: new Date("2026-03-27T23:15:00.000Z"),
    } as any;

    mocks.runInternalMlbMcpToolRaw.mockImplementation(async ({ toolName, args }) => {
      if (toolName === "mlb_mcp__get_schedule") {
        expect(args).toMatchObject({ date: "2026-03-27" });
        return {
          remoteToolName: "get_schedule",
          replyText: null,
          content: [],
          structuredContent: {
            games: [
              {
                game_id: 824946,
                game_datetime: "2026-03-27T19:15:00Z",
                game_date: "2026-03-27",
                away_name: "Kansas City Royals",
                home_name: "Atlanta Braves",
                away_probable_pitcher: "Cole Ragans",
                home_probable_pitcher: "Chris Sale",
                away_pitcher_note: "",
                home_pitcher_note: "",
                doubleheader: "Y",
                game_num: 1,
                venue_name: "Truist Park",
                national_broadcasts: [],
                status: "Pre-Game",
              },
              {
                game_id: 824947,
                game_datetime: "2026-03-27T23:15:00Z",
                game_date: "2026-03-27",
                away_name: "Kansas City Royals",
                home_name: "Atlanta Braves",
                away_probable_pitcher: "Seth Lugo",
                home_probable_pitcher: "Reynaldo Lopez",
                away_pitcher_note: "",
                home_pitcher_note: "",
                doubleheader: "Y",
                game_num: 2,
                venue_name: "Truist Park",
                national_broadcasts: [],
                status: "Pre-Game",
              },
            ],
          },
        };
      }

      if (toolName === "mlb_mcp__get_statcast_pitcher_expected_stats") {
        expect(args).toMatchObject({
          minPA: 1,
          start_row: 0,
          end_row: 1400,
        });
        expect([2025, 2026]).toContain(args.year);
        return {
          remoteToolName: "get_statcast_pitcher_expected_stats",
          replyText: null,
          content: [],
          structuredContent: {
            data: [],
          },
        };
      }

      throw new Error(`Unexpected MLB MCP tool call in doubleheader test: ${toolName}`);
    });

    const lookup = await getMlbPlayerPregameLookup([firstGame, secondGame], "2026-03-27");
    const secondStarterContext = getMlbPitcherMatchupChip({
      playerName: "Reynaldo Lopez",
      playerTeam: "ATL",
      playerPosition: "P",
      probableStarterKeys: lookup.probableStarterKeys,
      probableStarterContextByKey: lookup.probableStarterContextByKey,
      matchupsByTeam: lookup.matchupsByTeam,
    });

    expect(lookup.matchupsByTeam.get("ATL")).toHaveLength(2);
    expect(secondStarterContext.isProbableStarter).toBe(true);
    expect(secondStarterContext.probablePitcherGameId).toBe("mlb_local_2");
    expect(secondStarterContext.mlbPregameSummary).toContain("Lugo");
    expect(secondStarterContext.mlbPregameSummary).toContain("Lopez");
  });
});

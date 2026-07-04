import { describe, expect, it } from "vitest";

import {
  createPlayerId,
  parsePlayerId,
  normalizePosition,
  normalizeGameStatus,
  calculateFantasyPoints,
  extractBoxscorePlayerStats,
  resolvePlayerGameSide,
  getOpponentTeam,
  parseStatsToJson,
  getCurrentSeason,
  type MlbBoxscore,
  type MlbGame,
} from "./mlb-statsapi";

describe("createPlayerId", () => {
  it("formats mlb_<MLBAM_ID>", () => {
    expect(createPlayerId(660271)).toBe("mlb_660271");
  });

  it("handles zero correctly", () => {
    expect(createPlayerId(0)).toBe("mlb_0");
  });
});

describe("parsePlayerId", () => {
  it("extracts MLBAM ID from canonical format", () => {
    expect(parsePlayerId("mlb_660271")).toBe(660271);
  });

  it("returns null for non-mlb prefix", () => {
    expect(parsePlayerId("nba_123")).toBeNull();
  });

  it("returns null for malformed IDs", () => {
    expect(parsePlayerId("mlb_abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePlayerId("")).toBeNull();
  });
});

describe("normalizePosition", () => {
  it("maps standard MLB abbreviations", () => {
    expect(normalizePosition("P")).toBe("P");
    expect(normalizePosition("C")).toBe("C");
    expect(normalizePosition("1B")).toBe("1B");
    expect(normalizePosition("2B")).toBe("2B");
    expect(normalizePosition("3B")).toBe("3B");
    expect(normalizePosition("SS")).toBe("SS");
    expect(normalizePosition("OF")).toBe("OF");
    expect(normalizePosition("DH")).toBe("DH");
  });

  it("normalizes outfield variants", () => {
    expect(normalizePosition("LF")).toBe("OF");
    expect(normalizePosition("CF")).toBe("OF");
    expect(normalizePosition("RF")).toBe("OF");
  });

  it("normalizes pitcher variants", () => {
    expect(normalizePosition("SP")).toBe("P");
    expect(normalizePosition("RP")).toBe("P");
  });

  it("handles case insensitivity", () => {
    expect(normalizePosition("of")).toBe("OF");
    expect(normalizePosition("dh")).toBe("DH");
  });

  it("defaults unknown positions to UTIL", () => {
    expect(normalizePosition("")).toBe("UTIL");
    expect(normalizePosition("XYZ")).toBe("UTIL");
    expect(normalizePosition("K")).toBe("UTIL");
  });
});

describe("normalizeGameStatus", () => {
  function makeGame(overrides: Partial<MlbGame["status"]>): MlbGame {
    return {
      gamePk: 1,
      gameDate: "2026-07-04T19:05:00Z",
      status: {
        abstractGameState: "Preview",
        codedGameState: "P",
        detailedState: "Scheduled",
        statusCode: "P",
        startTimeTBD: false,
        ...overrides,
      },
      teams: {
        away: {
          team: { id: 108, name: "Angels", abbreviation: "LAA" },
          score: null,
          isWinner: false,
        },
        home: {
          team: { id: 117, name: "Astros", abbreviation: "HOU" },
          score: null,
          isWinner: false,
        },
      },
    };
  }

  it("returns 'completed' for final games", () => {
    expect(normalizeGameStatus(makeGame({ abstractGameState: "Final" }))).toBe("completed");
    expect(normalizeGameStatus(makeGame({ abstractGameState: "Complete" }))).toBe("completed");
  });

  it("returns 'inprogress' for live games", () => {
    expect(normalizeGameStatus(makeGame({ abstractGameState: "Live" }))).toBe("inprogress");
    expect(
      normalizeGameStatus(makeGame({ abstractGameState: "Live", detailedState: "In Progress" })),
    ).toBe("inprogress");
  });

  it("returns 'scheduled' for preview/pre-game", () => {
    expect(normalizeGameStatus(makeGame())).toBe("scheduled");
    expect(
      normalizeGameStatus(makeGame({ abstractGameState: "Preview", detailedState: "Pre-Game" })),
    ).toBe("scheduled");
  });

  it("returns 'postponed' for postponed/cancelled games", () => {
    expect(
      normalizeGameStatus(makeGame({ detailedState: "Postponed", abstractGameState: "Preview" })),
    ).toBe("postponed");
    expect(
      normalizeGameStatus(makeGame({ detailedState: "Cancelled", abstractGameState: "Preview" })),
    ).toBe("postponed");
  });
});

describe("calculateFantasyPoints", () => {
  it("calculates hitting-only points correctly", () => {
    const result = calculateFantasyPoints({
      batting: {
        hits: 2,
        doubles: 1,
        triples: 0,
        homeRuns: 1,
        runs: 2,
        rbi: 3,
        baseOnBalls: 1,
        hitByPitch: 0,
        stolenBases: 0,
        strikeOuts: 1,
      },
    });
    // singles = 2 - 1 - 0 - 1 = 0
    // singles(0*3) + 2B(1*5) + 3B(0*8) + HR(1*10) + R(2*2) + RBI(3*2) + BB(1*2) + HBP(0*2) + SB(0*5) + K(1*-0.5)
    // = 0 + 5 + 0 + 10 + 4 + 6 + 2 + 0 + 0 - 0.5 = 26.50
    expect(result.points).toBe(26.5);
    expect(result.breakdown.homeRuns).toBe(1);
    expect(result.breakdown.doubles).toBe(1);
  });

  it("calculates pitching points correctly", () => {
    const result = calculateFantasyPoints({
      pitching: {
        inningsPitched: 6,
        strikeOuts: 8,
        wins: 1,
        saves: 0,
        earnedRuns: 2,
        hits: 4,
        baseOnBalls: 1,
        runs: 2,
      },
    });
    // IP(6*2.25) + K(8*2) + W(1*4) + SV(0*5) + ER(2*-2) + RA(2*-0.5) + HA(4*-0.6) + BB(1*-0.6)
    // = 13.5 + 16 + 4 + 0 - 4 - 1 - 2.4 - 0.6 = 25.50
    expect(result.points).toBe(25.5);
  });

  it("handles empty stats gracefully", () => {
    const result = calculateFantasyPoints({});
    expect(result.points).toBe(0);
    expect(result.breakdown.singles).toBe(0);
  });

  it("handles mixed batting and pitching stats", () => {
    const result = calculateFantasyPoints({
      batting: { hits: 1, homeRuns: 1, runs: 1, rbi: 1 },
      pitching: { strikeOuts: 3 },
    });
    expect(result.points).toBeGreaterThan(0);
  });
});

describe("extractBoxscorePlayerStats", () => {
  it("extracts batting/pitching stats from both teams", () => {
    const boxscore: MlbBoxscore = {
      teams: {
        away: {
          team: { id: 108, name: "Angels", abbreviation: "LAA" },
          teamStats: { batting: {}, pitching: {}, fielding: {} },
          players: {
            ID108100: {
              person: { id: 108100, fullName: "Player A" },
              jerseyNumber: "10",
              position: { code: "3", name: "First Base", type: "Infielder", abbreviation: "1B" },
              stats: { batting: { hits: 2 }, pitching: {} },
            },
          },
        },
        home: {
          team: { id: 117, name: "Astros", abbreviation: "HOU" },
          teamStats: { batting: {}, pitching: {}, fielding: {} },
          players: {
            ID117200: {
              person: { id: 117200, fullName: "Player B" },
              jerseyNumber: "7",
              position: { code: "1", name: "Pitcher", type: "Pitcher", abbreviation: "P" },
              stats: { batting: { atBats: 1 }, pitching: { strikeOuts: 5 } },
            },
          },
        },
      },
      linescore: {
        teams: { home: { runs: 3, hits: 5, errors: 1 }, away: { runs: 2, hits: 6, errors: 0 } },
        innings: [],
      },
    };

    const stats = extractBoxscorePlayerStats(boxscore);
    expect(stats.size).toBe(2);

    expect(stats.get(108100)?.batting?.hits).toBe(2);
    expect(stats.get(117200)?.pitching?.strikeOuts).toBe(5);
  });

  it("returns empty map for empty boxscore", () => {
    const empty: MlbBoxscore = {
      teams: {
        away: {
          team: { id: 108, name: "Angels", abbreviation: "LAA" },
          teamStats: { batting: {}, pitching: {}, fielding: {} },
          players: {},
        },
        home: {
          team: { id: 117, name: "Astros", abbreviation: "HOU" },
          teamStats: { batting: {}, pitching: {}, fielding: {} },
          players: {},
        },
      },
      linescore: {
        teams: { home: { runs: 0, hits: 0, errors: 0 }, away: { runs: 0, hits: 0, errors: 0 } },
        innings: [],
      },
    };
    expect(extractBoxscorePlayerStats(empty).size).toBe(0);
  });
});

describe("resolvePlayerGameSide", () => {
  const boxscore: MlbBoxscore = {
    teams: {
      away: {
        team: { id: 108, name: "Angels", abbreviation: "LAA" },
        teamStats: { batting: {}, pitching: {}, fielding: {} },
        players: {
          ID660271: {
            person: { id: 660271, fullName: "Shohei Ohtani" },
            jerseyNumber: "17",
            position: { code: "1", name: "Pitcher", type: "Pitcher", abbreviation: "P" },
            stats: {},
          },
        },
      },
      home: {
        team: { id: 117, name: "Astros", abbreviation: "HOU" },
        teamStats: { batting: {}, pitching: {}, fielding: {} },
        players: {
          ID600111: {
            person: { id: 600111, fullName: "Player C" },
            jerseyNumber: "27",
            position: { code: "3", name: "First Base", type: "Infielder", abbreviation: "1B" },
            stats: {},
          },
        },
      },
    },
    linescore: {
      teams: { home: { runs: 0, hits: 0, errors: 0 }, away: { runs: 0, hits: 0, errors: 0 } },
      innings: [],
    },
  };

  it("resolves away player correctly", () => {
    expect(resolvePlayerGameSide(boxscore, 660271)).toBe("away");
  });

  it("resolves home player correctly", () => {
    expect(resolvePlayerGameSide(boxscore, 600111)).toBe("home");
  });

  it("returns null for unknown player", () => {
    expect(resolvePlayerGameSide(boxscore, 999999)).toBeNull();
  });
});

describe("getOpponentTeam", () => {
  const boxscore: MlbBoxscore = {
    teams: {
      away: {
        team: { id: 108, name: "Angels", abbreviation: "LAA" },
        teamStats: { batting: {}, pitching: {}, fielding: {} },
        players: {
          ID660271: {
            person: { id: 660271, fullName: "Shohei Ohtani" },
            jerseyNumber: "17",
            position: { code: "1", name: "Pitcher", type: "Pitcher", abbreviation: "P" },
            stats: {},
          },
        },
      },
      home: {
        team: { id: 117, name: "Astros", abbreviation: "HOU" },
        teamStats: { batting: {}, pitching: {}, fielding: {} },
        players: {
          ID600111: {
            person: { id: 600111, fullName: "Player C" },
            jerseyNumber: "27",
            position: { code: "3", name: "First Base", type: "Infielder", abbreviation: "1B" },
            stats: {},
          },
        },
      },
    },
    linescore: {
      teams: { home: { runs: 0, hits: 0, errors: 0 }, away: { runs: 0, hits: 0, errors: 0 } },
      innings: [],
    },
  };

  it("returns HOU for LAA player", () => {
    expect(getOpponentTeam(boxscore, 660271)).toBe("HOU");
  });

  it("returns LAA for HOU player", () => {
    expect(getOpponentTeam(boxscore, 600111)).toBe("LAA");
  });

  it("returns null for unknown player", () => {
    expect(getOpponentTeam(boxscore, 999999)).toBeNull();
  });
});

describe("parseStatsToJson", () => {
  it("flattens batting and pitching stats", () => {
    const result = parseStatsToJson({
      batting: { hits: 3, homeRuns: 1, rbi: 2, strikeOuts: 1 },
      pitching: { inningsPitched: 5, strikeOuts: 6, earnedRuns: 2 },
    });

    expect(result.hits).toBe(3);
    expect(result.homeRuns).toBe(1);
    expect(result.runsBattedIn).toBe(2);
    expect(result.inningsPitched).toBe(5);
    expect(result.pitchingStrikeouts).toBe(6);
    expect(result.earnedRuns).toBe(2);
  });

  it("defaults missing keys to 0", () => {
    const result = parseStatsToJson({ batting: { hits: 1 } });
    expect(result.hits).toBe(1);
    expect(result.homeRuns).toBe(0);
    expect(result.inningsPitched).toBe(0);
  });
});

describe("getCurrentSeason", () => {
  it("returns current calendar year", () => {
    expect(getCurrentSeason()).toBe(new Date().getFullYear());
  });
});

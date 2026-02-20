import { describe, expect, it } from "vitest";

import {
  getMLBAwayScore,
  getMLBAwayTeam,
  getMLBHomeScore,
  normalizeGameStatus,
  type MLBGame,
} from "./balldontlie-mlb";

describe("MLB away-team compatibility helpers", () => {
  const baseGame: MLBGame = {
    id: 1,
    date: "2026-02-20T00:00:00Z",
    season: 2026,
    status: "Scheduled",
    home_team: {
      id: 2,
      abbreviation: "NYY",
      name: "Yankees",
    },
    home_team_score: null,
    venue: "Test Park",
  };

  it("prefers visitor_team when present", () => {
    const game: MLBGame = {
      ...baseGame,
      visitor_team: { id: 3, abbreviation: "BOS", name: "Red Sox" },
      away_team: { id: 4, abbreviation: "TOR", name: "Blue Jays" },
      visitor_team_score: 4,
      away_team_score: 5,
    };

    expect(getMLBAwayTeam(game)?.abbreviation).toBe("BOS");
    expect(getMLBAwayScore(game)).toBe(4);
  });

  it("falls back to away_team + away_team_score", () => {
    const game: MLBGame = {
      ...baseGame,
      away_team: { id: 4, abbreviation: "TOR", name: "Blue Jays" },
      away_team_score: 7,
    };

    expect(getMLBAwayTeam(game)?.abbreviation).toBe("TOR");
    expect(getMLBAwayScore(game)).toBe(7);
  });

  it("reads modern away/home line scores from *_team_data.runs", () => {
    const game: MLBGame = {
      ...baseGame,
      away_team: { id: 4, abbreviation: "TOR", name: "Blue Jays" },
      home_team_score: null,
      away_team_score: null,
      home_team_data: { runs: 2 },
      away_team_data: { runs: 5 },
    };

    expect(getMLBHomeScore(game)).toBe(2);
    expect(getMLBAwayScore(game)).toBe(5);
  });
});

describe("normalizeGameStatus", () => {
  it("normalizes STATUS_* enums from modern MLB feed", () => {
    expect(normalizeGameStatus("STATUS_IN_PROGRESS")).toBe("inprogress");
    expect(normalizeGameStatus("STATUS_FINAL")).toBe("completed");
    expect(normalizeGameStatus("STATUS_SCHEDULED")).toBe("scheduled");
  });

  it("normalizes postponed-like states", () => {
    expect(normalizeGameStatus("STATUS_POSTPONED")).toBe("postponed");
    expect(normalizeGameStatus("Suspended")).toBe("postponed");
  });
});

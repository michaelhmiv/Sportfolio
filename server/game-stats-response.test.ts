import { describe, expect, it } from "vitest";

import { buildGameStatsPayload } from "./game-stats-response";

const baseRow = {
  minutes: 0,
  points: 0,
  threePointersMade: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
};

describe("buildGameStatsPayload", () => {
  it("returns MLB-native totals and top performers for MLB game stats", () => {
    const payload = buildGameStatsPayload("mlb_824579", [
      {
        ...baseRow,
        playerId: "mlb_hitter",
        playerName: "Andruw Monasterio",
        team: "BOS",
        sport: "MLB",
        homeAway: "away",
        fantasyPoints: 17.5,
        statsJson: {
          atBats: 4,
          hits: 2,
          runs: 1,
          runsBattedIn: 1,
          homeRuns: 1,
          stolenBases: 1,
          walks: 1,
          strikeoutsBatting: 1,
        },
      },
      {
        ...baseRow,
        playerId: "mlb_pitcher",
        playerName: "Payton Tolle",
        team: "BOS",
        sport: "MLB",
        homeAway: "away",
        fantasyPoints: 24,
        statsJson: {
          inningsPitched: 6,
          pitchingStrikeouts: 6,
          earnedRuns: 0,
          wins: 1,
        },
      },
      {
        ...baseRow,
        playerId: "mlb_home_hitter",
        playerName: "Home Hitter",
        team: "CWS",
        sport: "MLB",
        homeAway: "home",
        fantasyPoints: 8,
        statsJson: {
          atBats: 3,
          hits: 1,
          runsBattedIn: 2,
        },
      },
    ]);

    expect(payload.sport).toBe("MLB");
    expect(payload.awayTeam.totals).toMatchObject({
      atBats: 4,
      hits: 2,
      runs: 1,
      runsBattedIn: 1,
      homeRuns: 1,
      stolenBases: 1,
      inningsPitched: 6,
      pitchingStrikeouts: 6,
      earnedRuns: 0,
    });
    expect(payload.topPerformers).toMatchObject({
      topFantasy: { playerId: "mlb_pitcher", fantasyPoints: 24, pitchingStrikeouts: 6 },
      topHitter: { playerId: "mlb_hitter", hits: 2, homeRuns: 1, stolenBases: 1 },
      topPitcher: { playerId: "mlb_pitcher", inningsPitched: 6, wins: 1 },
      topRunProducer: { playerId: "mlb_home_hitter", runsBattedIn: 2 },
      topPowerBat: { playerId: "mlb_hitter", homeRuns: 1 },
    });
    expect(payload.topPerformers).not.toHaveProperty("topScorer");
    expect(payload.topPerformers).not.toHaveProperty("topRebounder");
    expect(payload.topPerformers).not.toHaveProperty("topAssister");
  });

  it("preserves basketball performer keys for non-MLB game stats", () => {
    const payload = buildGameStatsPayload("nba_1", [
      {
        ...baseRow,
        playerId: "nba_1",
        playerName: "Basketball Player",
        team: "BOS",
        sport: "NBA",
        homeAway: "home",
        fantasyPoints: 42,
        statsJson: {},
        points: 30,
        rebounds: 9,
        assists: 4,
      },
    ]);

    expect(payload.sport).toBe("NBA");
    expect(payload.topPerformers).toHaveProperty("topScorer");
    expect(payload.topPerformers).toHaveProperty("topRebounder");
    expect(payload.topPerformers).toHaveProperty("topAssister");
  });
});

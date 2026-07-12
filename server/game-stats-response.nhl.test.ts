import { describe, expect, it } from "vitest";
import { buildGameStatsPayload } from "./game-stats-response";

describe("NHL game stats response", () => {
  it("uses hockey-shaped skater and goalie fields without affecting other sport adapters", () => {
    const payload = buildGameStatsPayload("nhl_2026020001", [
      {
        playerId: "nhl_1",
        playerName: "Away Skater",
        team: "BOS",
        sport: "NHL",
        statsJson: {
          position: "C",
          goals: 1,
          assists: 2,
          points: 3,
          shotsOnGoal: 4,
          hits: 1,
          blockedShots: 2,
          timeOnIce: "18:24",
        },
        minutes: 0,
        points: 0,
        threePointersMade: 0,
        rebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fantasyPoints: 25.1,
        homeAway: "away",
      },
      {
        playerId: "nhl_2",
        playerName: "Home Goalie",
        team: "NYR",
        sport: "NHL",
        statsJson: {
          position: "G",
          saves: 31,
          goalsAgainst: 2,
          savePercentage: 0.939,
          decision: "W",
        },
        minutes: 0,
        points: 0,
        threePointersMade: 0,
        rebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fantasyPoints: 20.7,
        homeAway: "home",
      },
    ]);
    expect(payload.sport).toBe("NHL");
    expect(payload.awayTeam.players[0]).toMatchObject({
      goals: 1,
      shotsOnGoal: 4,
      timeOnIce: "18:24",
    });
    expect(payload.homeTeam.players[0]).toMatchObject({ saves: 31, decision: "W" });
  });
});

import { describe, expect, it } from "vitest";

import { buildMlbPlayerContextPayload } from "./mlb-player-context";
import type { MlbPregameInsight } from "./mlb-pregame-insights";

const player = {
  id: "mlb_123",
  firstName: "Ceddanne",
  lastName: "Rafaela",
  team: "BOS",
  position: "CF",
} as any;

const game = {
  gameId: "mlb_824579",
  homeTeam: "CWS",
  awayTeam: "BOS",
  startTime: new Date("2026-07-07T23:40:00.000Z"),
  status: "scheduled",
  venue: "Rate Field",
  homeScore: null,
  awayScore: null,
} as any;

const pregame: MlbPregameInsight = {
  matchupSummary: "BOS at CWS",
  venue: "Rate Field",
  gameNumber: 1,
  broadcasts: [],
  weatherSummary: "74°F, wind out to left",
  attendance: null,
  probablePitchers: {
    away: { name: "Payton Tolle", note: null, team: "BOS" },
    home: { name: "Noah Schultz", note: null, team: "CWS" },
  },
  probablePitcherStats: {
    away: null,
    home: {
      name: "Noah Schultz",
      statYear: 2026,
      plateAppearances: 150,
      era: 3.2,
      xera: 3.4,
      woba: 0.29,
      expectedWoba: 0.3,
      battingAverage: 0.22,
      expectedBattingAverage: 0.23,
      slugging: 0.36,
      expectedSlugging: 0.37,
      summary: "xERA 3.40, xwOBA .300",
    },
  },
  advancedStatsAvailable: true,
  statYear: 2026,
  doubleheader: false,
  lineupsPosted: true,
  startingLineups: {
    away: [
      {
        slot: 2,
        playerId: "mlb_123",
        name: "Ceddanne Rafaela",
        position: "CF",
        jerseyNumber: "43",
      },
    ],
    home: [],
  },
  hitterSpotlights: {
    away: [
      {
        slot: 2,
        name: "Ceddanne Rafaela",
        team: "BOS",
        position: "CF",
        statYear: 2026,
        plateAppearances: 250,
        woba: 0.36,
        expectedWoba: 0.37,
        battingAverage: 0.28,
        expectedBattingAverage: 0.29,
        slugging: 0.5,
        expectedSlugging: 0.52,
        summary: "Strong expected power profile",
      },
    ],
    home: [],
  },
  hitterMatchupNotes: { away: null, home: null },
  lineupSignals: { away: "BOS top-half bats confirmed", home: null },
  teamContexts: { away: null, home: null },
  scoringPlays: [],
  gameState: null,
};

describe("buildMlbPlayerContextPayload", () => {
  it("summarizes lineup, opponent pitcher, weather, and Statcast context", () => {
    const context = buildMlbPlayerContextPayload({
      player,
      game,
      mlbPregame: pregame,
      signals: [
        {
          id: "sig1",
          gameId: "mlb_824579",
          category: "statcast",
          severity: "positive",
          label: "Ceddanne Rafaela expected-stat spotlight",
          detail: "Strong expected power profile",
          team: "BOS",
        },
      ],
    });

    expect(context.game?.opponentLabel).toBe("@ CWS");
    expect(context.lineup?.label).toBe("Batting 2 · CF");
    expect(context.opposingProbablePitcher?.name).toBe("Noah Schultz");
    expect(context.opposingProbablePitcher?.summary).toBe("xERA 3.40, xwOBA .300");
    expect(context.weatherSummary).toBe("74°F, wind out to left");
    expect(context.hitterSpotlight?.summary).toBe("Strong expected power profile");
    expect(context.playerSignals).toHaveLength(1);
  });

  it("returns a quiet empty context when no upcoming game is available", () => {
    const context = buildMlbPlayerContextPayload({
      player,
      game: null,
      mlbPregame: null,
      signals: [],
    });

    expect(context.game).toBeNull();
    expect(context.lineup).toBeNull();
    expect(context.playerSignals).toEqual([]);
  });
});

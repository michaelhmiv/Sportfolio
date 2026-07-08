import { describe, expect, it } from "vitest";

import { buildMlbGameplaySignals, type MlbGameplaySignal } from "./mlb-gameplay-signals";
import type { MlbPregameInsight } from "./mlb-pregame-insights";

const basePregame: MlbPregameInsight = {
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
    away: {
      name: "Payton Tolle",
      statYear: 2026,
      plateAppearances: 150,
      era: 2.91,
      xera: 3.1,
      woba: 0.28,
      expectedWoba: 0.29,
      battingAverage: 0.21,
      expectedBattingAverage: 0.22,
      slugging: 0.35,
      expectedSlugging: 0.34,
      summary: "xERA 3.10, xwOBA .290",
    },
    home: null,
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
  teamContexts: {
    away: { record: "52-38", lastGameSummary: null, nextGameSummary: null },
    home: null,
  },
  scoringPlays: [
    {
      inningLabel: "Top 3rd",
      battingTeam: "BOS",
      event: "Home Run",
      description: "Rafaela homered to left.",
      scoreLabel: "BOS 2, CWS 0",
    },
  ],
  gameState: {
    detailedStatus: "In Progress",
    inningState: "Top",
    inningLabel: "Top 7th",
    countSummary: null,
    weatherSummary: "74°F, wind out to left",
    attendance: null,
    decisions: null,
    linescore: null,
  },
};

const labels = (signals: MlbGameplaySignal[]) => signals.map((signal) => signal.label);

describe("buildMlbGameplaySignals", () => {
  it("converts pregame/live MLB context into prioritized gameplay signals", () => {
    const signals = buildMlbGameplaySignals({
      game: {
        gameId: "mlb_824579",
        status: "inprogress",
        awayTeam: "BOS",
        homeTeam: "CWS",
      },
      mlbPregame: basePregame,
      leaders: {
        scouts: {
          name: "Ceddanne Rafaela",
          team: "BOS",
          avgFantasyPointsPerGame: 8.3,
          totalShares: 120,
          scoutCount: 3,
        },
      },
      userContext: {
        eligibleCount: 2,
        ownedPlayers: [{ playerId: "mlb_123", name: "Ceddanne Rafaela", team: "BOS" }],
      },
    });

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.length).toBeLessThanOrEqual(10);
    expect(labels(signals)).toContain("Game is live");
    expect(labels(signals)).toContain("Lineups posted");
    expect(labels(signals)).toContain("BOS probable: Payton Tolle");
    expect(labels(signals)).toContain("Expected stats available");
    expect(labels(signals)).toContain("Scout attention: Ceddanne Rafaela");
    expect(signals[0]).toMatchObject({ category: "game_state", severity: "high" });
    expect(signals.every((signal) => signal.gameId === "mlb_824579")).toBe(true);
  });

  it("warns when a scheduled game has no posted lineups yet", () => {
    const signals = buildMlbGameplaySignals({
      game: {
        gameId: "mlb_1",
        status: "scheduled",
        awayTeam: "BOS",
        homeTeam: "CWS",
      },
      mlbPregame: {
        ...basePregame,
        lineupsPosted: false,
        gameState: null,
        scoringPlays: [],
      },
    });

    expect(signals).toContainEqual(
      expect.objectContaining({
        category: "lineup",
        severity: "warning",
        label: "Lineups pending",
      }),
    );
  });

  it("returns no signals when MLB enrichment has not resolved", () => {
    expect(
      buildMlbGameplaySignals({
        game: {
          gameId: "mlb_1",
          status: "scheduled",
          awayTeam: "BOS",
          homeTeam: "CWS",
        },
        mlbPregame: null,
      }),
    ).toEqual([]);
  });
});

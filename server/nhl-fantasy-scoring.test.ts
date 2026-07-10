import { describe, expect, it } from "vitest";
import { calculateNhlFantasyPoints } from "./nhl-fantasy-scoring";

describe("calculateNhlFantasyPoints", () => {
  it("scores all skater components and threshold bonuses deterministically", () => {
    const scored = calculateNhlFantasyPoints({
      kind: "skater",
      goals: 3,
      assists: 1,
      shotsOnGoal: 4,
      blockedShots: 2,
      shortHandedPoints: 1,
      shootoutGoals: 1,
    });
    // 3*8.5 + 1*5 + 4*1.5 + 2*1.3 + 2 + 1.5 + hat trick 3 + 3+ points 3
    expect(scored.points).toBe(48.6);
    expect(scored.breakdown.hatTrickBonus).toBe(3);
    expect(scored.breakdown.threePointBonus).toBe(3);
  });

  it("does not treat absent enrichment fields as confirmed bonuses", () => {
    expect(
      calculateNhlFantasyPoints({
        kind: "skater",
        goals: 0,
        assists: 0,
        shotsOnGoal: 0,
        blockedShots: 0,
      }).points,
    ).toBe(0);
  });

  it("scores goalie win, saves, goals allowed, shutout, and 35-save bonus", () => {
    const scored = calculateNhlFantasyPoints({
      kind: "goalie",
      decision: "W",
      saves: 35,
      goalsAgainst: 0,
      shutout: true,
    });
    expect(scored.points).toBe(37.5);
  });

  it("awards overtime-loss bonus instead of a win, never both", () => {
    const scored = calculateNhlFantasyPoints({
      kind: "goalie",
      decision: "OTL",
      saves: 20,
      goalsAgainst: 2,
    });
    expect(scored.points).toBe(9);
    expect(scored.breakdown.win).toBe(0);
    expect(scored.breakdown.overtimeLossBonus).toBe(2);
  });

  it("handles zero and negative goalie values without fabricated bonuses", () => {
    const scored = calculateNhlFantasyPoints({ kind: "goalie", saves: 0, goalsAgainst: 3 });
    expect(scored.points).toBe(-10.5);
    expect(scored.breakdown.shutoutBonus).toBe(0);
  });
});

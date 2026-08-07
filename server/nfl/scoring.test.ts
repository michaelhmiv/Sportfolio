import { describe, expect, it } from "vitest";
import { calculateNflFantasyPoints, fieldGoalFantasyPoints } from "./scoring";

describe("NFL conventional fantasy scoring", () => {
  it("scores a pocket passer", () => {
    expect(
      calculateNflFantasyPoints({ passingYards: 300, passingTouchdowns: 3, interceptions: 1 }),
    ).toBe(22);
  });

  it("scores a dual-threat quarterback", () => {
    expect(
      calculateNflFantasyPoints({
        passingYards: 250,
        passingTouchdowns: 2,
        rushingYards: 60,
        rushingTouchdowns: 1,
      }),
    ).toBe(30);
  });

  it("uses full PPR for receiving production", () => {
    expect(
      calculateNflFantasyPoints({ receptions: 8, receivingYards: 120, receivingTouchdowns: 1 }),
    ).toBe(26);
  });

  it("combines rushing and receiving for backs", () => {
    expect(
      calculateNflFantasyPoints({
        rushingYards: 85,
        rushingTouchdowns: 1,
        receptions: 4,
        receivingYards: 35,
      }),
    ).toBe(22);
  });

  it("applies interception and lost-fumble negatives", () => {
    expect(calculateNflFantasyPoints({ passingYards: 100, interceptions: 2, fumblesLost: 1 })).toBe(
      -2,
    );
  });

  it("uses 3/4/5 point field-goal tiers", () => {
    expect(fieldGoalFantasyPoints(39)).toBe(3);
    expect(fieldGoalFantasyPoints(40)).toBe(4);
    expect(fieldGoalFantasyPoints(49)).toBe(4);
    expect(fieldGoalFantasyPoints(50)).toBe(5);
    expect(
      calculateNflFantasyPoints({
        fieldGoalsMade: 3,
        fieldGoalDistances: [35, 44, 52],
        extraPointsMade: 2,
      }),
    ).toBe(14);
  });
});

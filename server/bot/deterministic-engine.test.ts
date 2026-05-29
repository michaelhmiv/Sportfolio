import { describe, expect, it } from "vitest";
import { computeClampedSportTargets, isBotEngineEnabled } from "./deterministic-engine";

describe("deterministic-engine policy utilities", () => {
  it("parses BOT_ENGINE_ENABLED values correctly", () => {
    expect(isBotEngineEnabled(undefined)).toBe(true);
    expect(isBotEngineEnabled("true")).toBe(true);
    expect(isBotEngineEnabled("false")).toBe(false);
    expect(isBotEngineEnabled("0")).toBe(false);
    expect(isBotEngineEnabled("off")).toBe(false);
  });

  it("computes clamped, normalized sport targets", () => {
    const targets = computeClampedSportTargets(
      new Map([
        ["NBA", 10],
        ["NFL", 3],
        ["MLB", 1],
      ]),
      0.15,
      0.55,
    );

    const nba = targets.get("NBA") || 0;
    const nfl = targets.get("NFL") || 0;
    const mlb = targets.get("MLB") || 0;
    const total = nba + nfl + mlb;

    expect(nba).toBeLessThanOrEqual(0.55 + 1e-6);
    expect(nfl).toBeGreaterThanOrEqual(0.15 - 1e-6);
    expect(mlb).toBeGreaterThanOrEqual(0.15 - 1e-6);
    expect(total).toBeCloseTo(1, 6);
  });
});

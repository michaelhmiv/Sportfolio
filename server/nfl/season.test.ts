import { describe, expect, it } from "vitest";
import {
  getNflSeasonYear,
  isNflGameplayEligibleSeasonType,
  isNflPreseasonGame,
  normalizeNflSeasonType,
} from "./season";

describe("NFL season semantics", () => {
  it("treats August 2026 as the 2026 season", () => {
    expect(getNflSeasonYear(new Date("2026-08-07T12:00:00Z"))).toBe(2026);
  });

  it("treats January 2027 as the 2026 season", () => {
    expect(getNflSeasonYear(new Date("2027-01-15T12:00:00Z"))).toBe(2026);
  });

  it("normalizes ESPN season type codes", () => {
    expect(normalizeNflSeasonType(1)).toBe("preseason");
    expect(normalizeNflSeasonType(2)).toBe("regular");
    expect(normalizeNflSeasonType(3)).toBe("postseason");
  });

  it("keeps preseason displayable but gameplay-ineligible", () => {
    expect(isNflGameplayEligibleSeasonType("preseason")).toBe(false);
    expect(isNflGameplayEligibleSeasonType("regular")).toBe(true);
    expect(isNflGameplayEligibleSeasonType("postseason")).toBe(true);
    expect(isNflPreseasonGame({ sport: "NFL", seasonType: "preseason" })).toBe(true);
    expect(isNflPreseasonGame({ sport: "MLB", seasonType: "preseason" })).toBe(false);
  });
});

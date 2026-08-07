import { describe, expect, it } from "vitest";
import {
  ENABLED_SPORTS,
  SPORT_CONFIGS,
  getNHLSeasonDisplay,
  getNHLSeasonYear,
  getPositionOptions,
  isEnabledSport,
} from "./sport-config";

describe("NHL sport configuration", () => {
  it("makes NHL a public sport with hockey positions from the shared canonical config", () => {
    expect(ENABLED_SPORTS).toContain("NHL");
    expect(isEnabledSport("NHL")).toBe(true);
    expect(getPositionOptions("NHL")).toEqual([
      { value: "C", label: "Center" },
      { value: "LW", label: "Left Wing" },
      { value: "RW", label: "Right Wing" },
      { value: "D", label: "Defense" },
      { value: "G", label: "Goalie" },
    ]);
    expect(SPORT_CONFIGS.NHL.apiProvider).toBe("nhl-web-api");
  });

  it("uses a season-start display year instead of a calendar-year or metadata sentinel", () => {
    expect(getNHLSeasonYear(new Date("2026-02-01T12:00:00Z"))).toBe(2025);
    expect(getNHLSeasonDisplay(new Date("2026-02-01T12:00:00Z"))).toBe("2025-26");
    expect(getNHLSeasonYear(new Date("2026-07-01T12:00:00Z"))).toBe(2026);
    expect(getNHLSeasonDisplay(new Date("2026-07-01T12:00:00Z"))).toBe("2026-27");
  });
});

describe("NFL sport activation", () => {
  it("is activated by the deterministic NFL restoration patch", () => {
    expect(ENABLED_SPORTS).toEqual(["MLB", "NASCAR", "NHL"]);
    expect(isEnabledSport("NFL")).toBe(false);
  });
});

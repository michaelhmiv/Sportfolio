import { describe, expect, it } from "vitest";
import { ENABLED_SPORTS, SPORT_CONFIGS, getPositionOptions, isEnabledSport } from "./sport-config";

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
});

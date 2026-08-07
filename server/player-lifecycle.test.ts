import { describe, expect, it } from "vitest";
import {
  assertPlayerScoutable,
  normalizePlayerActivityFilter,
  resolvePlayerActivityFilter,
} from "./player-lifecycle";

describe("player lifecycle", () => {
  it("keeps normal marketplace browsing active-only", () => {
    expect(resolvePlayerActivityFilter({})).toBe("active");
  });

  it("lets explicit search find previously admitted inactive assets", () => {
    expect(resolvePlayerActivityFilter({ search: "Joe Burrow" })).toBe("all");
  });

  it("honors explicit activity filters", () => {
    expect(resolvePlayerActivityFilter({ explicit: "inactive", search: "Joe" })).toBe("inactive");
    expect(resolvePlayerActivityFilter({ explicit: "active", search: "Joe" })).toBe("active");
    expect(resolvePlayerActivityFilter({ explicit: "all" })).toBe("all");
  });

  it("rejects unsupported activity query values", () => {
    expect(normalizePlayerActivityFilter("ALL")).toBe("all");
    expect(normalizePlayerActivityFilter(" inactive ")).toBe("inactive");
    expect(normalizePlayerActivityFilter("retired")).toBeUndefined();
  });

  it("allows positive scouting only for currently active athletes", () => {
    expect(() => assertPlayerScoutable({ isActive: true })).not.toThrow();
    expect(() => assertPlayerScoutable({ isActive: false })).toThrow(
      "Inactive players cannot be scouted",
    );
    expect(() => assertPlayerScoutable(null)).toThrow("Player not found");
  });
});

import { describe, expect, it } from "vitest";
import { normalizePresentationWarnings } from "./presentation-warnings";

describe("presentation warning contract", () => {
  it("deduplicates and bounds warnings to the renderer output limit", () => {
    const warnings = normalizePresentationWarnings([
      "routine drift",
      "routine drift",
      ...Array.from({ length: 25 }, (_, index) => `warning ${index}`),
    ]);
    expect(warnings).toHaveLength(20);
    expect(warnings.at(-1)).toContain("additional presentation warning(s) omitted");
  });

  it("does not emit empty warning entries", () => {
    expect(normalizePresentationWarnings(["", "  ", null, "provider unavailable"])).toEqual([
      "provider unavailable",
    ]);
  });
});

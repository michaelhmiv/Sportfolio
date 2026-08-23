import { describe, expect, it } from "vitest";
import {
  MAX_PRESENTATION_WARNINGS,
  normalizePresentationToolResult,
  normalizePresentationWarnings,
  SPORTFOLIO_VIRTUAL_CURRENCY,
} from "./presentation-contract";

describe("plugin presentation contract", () => {
  it("bounds and summarizes presentation warnings", () => {
    const warnings = Array.from({ length: 26 }, (_, index) => "warning-" + (index + 1));
    const normalized = normalizePresentationWarnings(warnings);
    expect(normalized).toHaveLength(MAX_PRESENTATION_WARNINGS);
    expect(normalized.at(-1)).toContain("Additional diagnostics omitted: 7");
  });

  it("deduplicates warnings before applying the cap", () => {
    expect(normalizePresentationWarnings(["same", "same", "other"])).toEqual(["same", "other"]);
  });

  it("attaches canonical virtual-currency metadata without changing view data", () => {
    const result = normalizePresentationToolResult({
      structuredContent: {
        view: "portfolio",
        warnings: [],
        data: { summary: { netWorth: 123 } },
      },
    });
    expect(result.structuredContent.data).toMatchObject({
      summary: { netWorth: 123 },
      currency: SPORTFOLIO_VIRTUAL_CURRENCY,
    });
  });
});

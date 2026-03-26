import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPACT_CURRENCY_THRESHOLD,
  formatAdaptiveCurrency,
  formatCompactCurrency,
  formatSignedAdaptiveCurrency,
  formatStandardCurrency,
} from "./currency";

describe("currency", () => {
  it("keeps values below the compact threshold in standard currency", () => {
    expect(formatAdaptiveCurrency(DEFAULT_COMPACT_CURRENCY_THRESHOLD - 0.01)).toBe("$999.99");
  });

  it("switches to compact currency at the threshold", () => {
    expect(formatAdaptiveCurrency(DEFAULT_COMPACT_CURRENCY_THRESHOLD)).toBe("$1K");
    expect(formatAdaptiveCurrency(4_500)).toBe("$4.5K");
    expect(formatAdaptiveCurrency(2_300_000)).toBe("$2.3M");
  });

  it("formats standard and compact currency explicitly", () => {
    expect(formatStandardCurrency(12.345)).toBe("$12.35");
    expect(formatCompactCurrency(12_345)).toBe("$12.3K");
  });

  it("preserves sign handling for signed adaptive currency", () => {
    expect(formatSignedAdaptiveCurrency(4_500)).toBe("+$4.5K");
    expect(formatSignedAdaptiveCurrency(-4_500)).toBe("-$4.5K");
    expect(formatSignedAdaptiveCurrency(0)).toBe("$0.00");
  });

  it("returns the fallback display for invalid signed values", () => {
    expect(formatSignedAdaptiveCurrency(null)).toBe("--");
    expect(formatSignedAdaptiveCurrency(Number.NaN)).toBe("--");
  });
});

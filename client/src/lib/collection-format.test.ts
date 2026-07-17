import { describe, expect, it } from "vitest";
import {
  formatCanonicalQuantity,
  basisPointsToPercentString,
  basisPointsToProgressValue,
  allocationProgressDisplay,
  compareCanonicalQuantities,
  looksLikeCanonicalQuantity,
  parseUserQuantityInput,
} from "./collection-format";

describe("formatCanonicalQuantity", () => {
  it("trims trailing fractional zeros", () => {
    expect(formatCanonicalQuantity("1.0000")).toBe("1");
    expect(formatCanonicalQuantity("0.5000")).toBe("0.5");
    expect(formatCanonicalQuantity("12.3400")).toBe("12.34");
  });

  it("returns 0 for all-zero quantity", () => {
    expect(formatCanonicalQuantity("0.0000")).toBe("0");
    expect(formatCanonicalQuantity("0")).toBe("0");
  });

  it("preserves non-zero fractions", () => {
    expect(formatCanonicalQuantity("0.1234")).toBe("0.1234");
    expect(formatCanonicalQuantity("99.0001")).toBe("99.0001");
  });

  it("returns integer part when no fraction", () => {
    expect(formatCanonicalQuantity("42")).toBe("42");
    expect(formatCanonicalQuantity("100")).toBe("100");
  });
});

describe("basisPointsToPercentString", () => {
  it("converts 0 bps to 0.00", () => {
    expect(basisPointsToPercentString(0)).toBe("0.00");
  });

  it("converts 1 bps to 0.01", () => {
    expect(basisPointsToPercentString(1)).toBe("0.01");
  });

  it("converts 5000 bps to 50.00", () => {
    expect(basisPointsToPercentString(5000)).toBe("50.00");
  });

  it("converts 9999 bps to 99.99, not 100", () => {
    expect(basisPointsToPercentString(9999)).toBe("99.99");
  });

  it("converts 10000 bps to 100.00", () => {
    expect(basisPointsToPercentString(10000)).toBe("100.00");
  });

  it("handles large safe integers exactly", () => {
    // 9007199254740993.0000 → if we had that as bps, but bps is integer
    // The bps value itself fits in JS safe integer: 9007199254740993
    expect(basisPointsToPercentString(500)).toBe("5.00");
  });

  it("clamps NaN and non-finite input to 0.00", () => {
    expect(basisPointsToPercentString(NaN)).toBe("0.00");
    expect(basisPointsToPercentString(Infinity)).toBe("0.00");
  });

  it("clamps negative input to 0.00", () => {
    expect(basisPointsToPercentString(-100)).toBe("0.00");
  });
});

describe("basisPointsToProgressValue", () => {
  it("returns 0 for 0 bps", () => {
    expect(basisPointsToProgressValue(0)).toBe(0);
  });

  it("returns 50 for 5000 bps", () => {
    expect(basisPointsToProgressValue(5000)).toBe(50);
  });

  it("returns 99.99 for 9999 bps (never rounds up to 100)", () => {
    expect(basisPointsToProgressValue(9999)).toBe(99.99);
  });

  it("returns 100 for 10000 bps", () => {
    expect(basisPointsToProgressValue(10000)).toBe(100);
  });

  it("returns 100 for values above 10000", () => {
    expect(basisPointsToProgressValue(12000)).toBe(100);
  });

  it("returns 0 for negative values", () => {
    expect(basisPointsToProgressValue(-500)).toBe(0);
  });

  it("returns 0 for non-finite values", () => {
    expect(basisPointsToProgressValue(NaN)).toBe(0);
    expect(basisPointsToProgressValue(Infinity)).toBe(0);
  });

  it("preserves fractional result: 5001 → 50.01", () => {
    expect(basisPointsToProgressValue(5001)).toBe(50.01);
  });

  it("preserves fractional result: 5099 → 50.99", () => {
    expect(basisPointsToProgressValue(5099)).toBe(50.99);
  });
});

describe("allocationProgressDisplay", () => {
  it("returns 0.00% for 0", () => {
    expect(allocationProgressDisplay(0)).toBe("0.00%");
  });

  it("returns 99.99% for 9999", () => {
    expect(allocationProgressDisplay(9999)).toBe("99.99%");
  });

  it("returns 100.00% for 10000", () => {
    expect(allocationProgressDisplay(10000)).toBe("100.00%");
  });
});

describe("looksLikeCanonicalQuantity", () => {
  it("accepts valid quantities", () => {
    expect(looksLikeCanonicalQuantity("0")).toBe(true);
    expect(looksLikeCanonicalQuantity("1.0000")).toBe(true);
    expect(looksLikeCanonicalQuantity("0.1234")).toBe(true);
    expect(looksLikeCanonicalQuantity("999")).toBe(true);
  });

  it("rejects non-canonical strings", () => {
    expect(looksLikeCanonicalQuantity("abc")).toBe(false);
    expect(looksLikeCanonicalQuantity("")).toBe(false);
    expect(looksLikeCanonicalQuantity("1.2.3")).toBe(false);
    expect(looksLikeCanonicalQuantity("-1.0000")).toBe(false);
  });
});

describe("parseUserQuantityInput", () => {
  it("parses whole numbers", () => {
    expect(parseUserQuantityInput("5")).toBe("5.0000");
    expect(parseUserQuantityInput("0")).toBe("0.0000");
  });

  it("parses decimals with exact 4 fractional digits", () => {
    expect(parseUserQuantityInput("1.5000")).toBe("1.5000");
  });

  it("pads short fractions", () => {
    expect(parseUserQuantityInput("0.5")).toBe("0.5000");
    expect(parseUserQuantityInput("1.25")).toBe("1.2500");
  });

  it("handles leading dot: .5 → 0.5000", () => {
    expect(parseUserQuantityInput(".5")).toBe("0.5000");
  });

  it("handles trailing dot: 5. → 5.0000", () => {
    expect(parseUserQuantityInput("5.")).toBe("5.0000");
  });

  it("handles whitespace", () => {
    expect(parseUserQuantityInput("  3.5  ")).toBe("3.5000");
  });

  it("returns null for invalid input", () => {
    expect(parseUserQuantityInput("")).toBeNull();
    expect(parseUserQuantityInput("abc")).toBeNull();
    expect(parseUserQuantityInput("-1")).toBeNull();
    expect(parseUserQuantityInput("1.12345")).toBeNull(); // too many fractional digits
  });

  it("returns canonical zero for 0", () => {
    expect(parseUserQuantityInput("0.0000")).toBe("0.0000");
    expect(parseUserQuantityInput("0.0")).toBe("0.0000");
  });
});

describe("compareCanonicalQuantities", () => {
  it("compares exact quantities without floating point", () => {
    expect(compareCanonicalQuantities("9007199254740993.0000", "9007199254740992.9999")).toBe(1);
    expect(compareCanonicalQuantities("0.5000", "0.5000")).toBe(0);
    expect(compareCanonicalQuantities("0.4999", "0.5000")).toBe(-1);
  });
});

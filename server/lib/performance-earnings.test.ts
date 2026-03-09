import { describe, expect, it } from "vitest";
import { getPerformanceEarningUnits } from "./performance-earnings";

describe("getPerformanceEarningUnits", () => {
  it("returns zero for regular single-share holdings", () => {
    expect(
      getPerformanceEarningUnits({
        quantity: "100",
        effectiveShares: "100.00",
        multiplier: "1.00",
        isStackedShare: false,
      }),
    ).toBe(0);
  });

  it("returns effective shares for stacked-share holdings", () => {
    expect(
      getPerformanceEarningUnits({
        quantity: "1",
        effectiveShares: "3.00",
        multiplier: "3.00",
        isStackedShare: true,
      }),
    ).toBe(3);
  });
});

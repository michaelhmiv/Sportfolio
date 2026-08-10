import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../valuation/canonical-valuation", async () => {
  const actual = await vi.importActual<typeof import("../valuation/canonical-valuation")>(
    "../valuation/canonical-valuation",
  );
  return {
    ...actual,
    getCanonicalPlayerMarkets: vi.fn(),
  };
});

import {
  calculateFivePercentDepth,
  calculatePearsonCorrelation,
  normalizeAnalyticsTimeRange,
} from "./market-research";

describe("market research math", () => {
  it("calculates Pearson correlation rather than a direction heuristic", () => {
    expect(calculatePearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 8);
    expect(calculatePearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 8);
  });

  it("requires comparable variance for correlation", () => {
    expect(calculatePearsonCorrelation([1, 1, 1], [2, 3, 4])).toBeNull();
    expect(calculatePearsonCorrelation([1], [1])).toBeNull();
  });

  it("calculates symmetric constant-product depth around spot", () => {
    const depth = calculateFivePercentDepth({
      playerId: "player_1",
      marketStatus: "priced",
      marketPrice: 10,
      priceSource: "amm_spot",
      poolInitialized: true,
      shareReserve: 100,
      playMoneyReserve: 1000,
      poolTvl: 2000,
      lastTradePrice: 10,
      liquidUserShares: 0,
      liquidSharesOutstanding: 100,
      marketCap: 1000,
      warnings: [],
    });

    expect(depth.buyDepth5Pct).toBeGreaterThan(0);
    expect(depth.sellDepth5Pct).toBeGreaterThan(0);
    expect(depth.buyDepth5Pct).toBeLessThan(30);
    expect(depth.sellDepth5Pct).toBeLessThan(30);
  });

  it("normalizes unsupported ranges to 30d", () => {
    expect(normalizeAnalyticsTimeRange("7d")).toBe("7d");
    expect(normalizeAnalyticsTimeRange("garbage")).toBe("30d");
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../db", () => ({ db: {} }));
vi.mock("./market-snapshot", () => ({ takeMarketSnapshot: vi.fn() }));

import { buildDailySnapshotPortfolioData } from "./daily-snapshot";

describe("daily snapshot valuation contract", () => {
  it("carries the canonical bulk portfolio value into net worth unchanged", () => {
    expect(
      buildDailySnapshotPortfolioData([
        { userId: "joey-owner", balance: "1000.00", portfolioValue: 600 },
      ]),
    ).toEqual([
      {
        userId: "joey-owner",
        cashBalance: "1000.00",
        portfolioValue: 600,
        totalNetWorth: 1600,
      },
    ]);
  });
});

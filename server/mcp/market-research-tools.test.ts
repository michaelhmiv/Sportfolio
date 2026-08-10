import { describe, expect, it, vi } from "vitest";

vi.mock("../analytics/market-research", () => ({
  compareMarkets: vi.fn(),
  getMarketCorrelations: vi.fn(),
  getMarketOverview: vi.fn(),
  getMarketSeries: vi.fn(),
  getMarketTape: vi.fn(),
  screenMarkets: vi.fn(),
}));

import { getMarketResearchToolNames } from "./market-research-tools";

describe("market research MCP surface", () => {
  it("keeps the web research intents available to MCP and the ChatGPT plugin", () => {
    expect(getMarketResearchToolNames()).toEqual([
      "get_market_overview",
      "screen_markets",
      "get_market_index",
      "get_market_tape",
      "compare_player_markets",
      "get_market_correlations",
    ]);
  });
});

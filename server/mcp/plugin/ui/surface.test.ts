import { describe, expect, it } from "vitest";
import {
  buildPluginPresentationCatalog,
  SPORTFOLIO_UI_RESOURCE_URIS,
} from "./surface";

describe("Sportfolio plugin UI presentation catalog", () => {
  it("keeps UI-only tools separate, read-only, and versioned", () => {
    const catalog = buildPluginPresentationCatalog();
    expect(catalog).toHaveLength(5);
    expect(catalog.map((entry) => entry.name)).toEqual([
      "render_player_market",
      "render_trade_preview",
      "render_portfolio",
      "render_market_movers",
      "render_liquidity_position",
    ]);
    expect(new Set(catalog.map((entry) => entry.resourceUri)).size).toBe(catalog.length);
    for (const entry of catalog) {
      expect(entry.name.startsWith("render_")).toBe(true);
      expect(entry.readOnly).toBe(true);
      expect(entry.destructive).toBe(false);
      expect(entry.openWorld).toBe(false);
      expect(entry.resourceUri).toMatch(/^ui:\/\/sportfolio\/[a-z0-9-]+\/v\d+\.html$/);
    }
  });

  it("publishes the complete intended resource inventory", () => {
    expect(Object.values(SPORTFOLIO_UI_RESOURCE_URIS)).toEqual([
      "ui://sportfolio/player-market/v1.html",
      "ui://sportfolio/trade-preview/v1.html",
      "ui://sportfolio/portfolio/v1.html",
      "ui://sportfolio/market-movers/v1.html",
      "ui://sportfolio/liquidity/v1.html",
    ]);
  });
});

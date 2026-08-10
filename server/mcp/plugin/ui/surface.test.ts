import { describe, expect, it } from "vitest";
import {
  buildPluginPresentationCatalog,
  buildPortfolioViewData,
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

  it("presents one canonical player position with separate Singles and Stack Power", () => {
    const data = buildPortfolioViewData(
      {
        valuationVersion: "amm_liquid_v2",
        userId: "user-1",
        cashBalance: 1000,
        singlesMarketValue: 600,
        lpMarketValue: 0,
        portfolioValue: 600,
        netWorth: 1600,
        positionCount: 1,
        pricedPositionCount: 1,
        unpricedPositionCount: 0,
        unpricedSingles: 0,
        totalSingles: 60,
        totalStackPower: 600,
        totalGameplayPower: 660,
        warnings: [],
        lpPositions: [],
        positions: [
          {
            playerId: "nascar_3859",
            player: {
              id: "nascar_3859",
              firstName: "Joey",
              lastName: "Gase",
              sport: "NASCAR",
            },
            holdingId: "holding-1",
            stackId: "stack-1",
            singles: 60,
            lockedSingles: 0,
            availableSingles: 60,
            stackPower: 600,
            gameplayPower: 660,
            averageCostBasis: 4,
            costBasis: 240,
            marketStatus: "priced",
            marketPrice: 10,
            priceSource: "amm_spot",
            marketValue: 600,
            unrealizedChange: 360,
            unrealizedChangePercent: 150,
            lastTradePrice: null,
            poolInitialized: true,
            poolTvl: 100,
          },
        ],
      },
      900,
      { sort: "value", limit: 25 },
    );

    expect(data.summary).toMatchObject({
      totalValue: 600,
      totalSingles: 60,
      totalStackPower: 600,
      totalGameplayPower: 660,
    });
    const holdings = data.holdings as Array<Record<string, unknown>>;
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      singles: 60,
      stackPower: 600,
      gameplayPower: 660,
      positionValue: 600,
      marketStatus: "priced",
    });
  });

  it("keeps unpriced Singles explicit and includes LP value in the portfolio total", () => {
    const data = buildPortfolioViewData(
      {
        valuationVersion: "amm_liquid_v2",
        userId: "user-1",
        cashBalance: 100,
        singlesMarketValue: 0,
        lpMarketValue: 20,
        portfolioValue: 20,
        netWorth: 120,
        positionCount: 1,
        pricedPositionCount: 0,
        unpricedPositionCount: 1,
        unpricedSingles: 3,
        totalSingles: 3,
        totalStackPower: 0,
        totalGameplayPower: 3,
        warnings: [],
        positions: [
          {
            playerId: "nascar_unpriced",
            player: { id: "nascar_unpriced", firstName: "Casey", lastName: "NoPool" },
            holdingId: "holding-1",
            stackId: null,
            singles: 3,
            lockedSingles: 0,
            availableSingles: 3,
            stackPower: 0,
            gameplayPower: 3,
            averageCostBasis: 2,
            costBasis: 6,
            marketStatus: "unpriced",
            marketPrice: null,
            priceSource: null,
            marketValue: null,
            unrealizedChange: null,
            unrealizedChangePercent: null,
            lastTradePrice: null,
            poolInitialized: false,
            poolTvl: null,
          },
        ],
        lpPositions: [
          {
            id: "lp-1",
            playerId: "nascar_3859",
            lpShares: 2,
            poolOwnershipPercent: 20,
            underlyingShares: 1,
            underlyingPlayMoney: 10,
            marketValue: 20,
            marketStatus: "priced",
            player: { id: "nascar_3859", sport: "NASCAR" },
          },
        ],
      },
      90,
      {},
    );

    expect(data.summary).toMatchObject({
      portfolioValue: 20,
      singlesMarketValue: 0,
      lpMarketValue: 20,
      unpricedPositionCount: 1,
      unpricedSingles: 3,
    });
    expect(data.holdings).toMatchObject([
      { marketStatus: "unpriced", marketPrice: null, positionValue: null, singles: 3 },
    ]);
    expect(data.lpPositions).toHaveLength(1);
  });
});

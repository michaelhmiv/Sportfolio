import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

let calculateCanonicalPortfolio: typeof import("./canonical-valuation").calculateCanonicalPortfolio;
let resolveCanonicalPlayerMarket: typeof import("./canonical-valuation").resolveCanonicalPlayerMarket;
let resolveCanonicalPlayerMarketBatch: typeof import("./canonical-valuation").resolveCanonicalPlayerMarketBatch;

beforeAll(async () => {
  ({
    calculateCanonicalPortfolio,
    resolveCanonicalPlayerMarket,
    resolveCanonicalPlayerMarketBatch,
  } = await import("./canonical-valuation"));
});

const joey = {
  id: "nascar_3859",
  firstName: "Joey",
  lastName: "Gase",
  sport: "NASCAR",
  lastTradePrice: null,
  currentPrice: "0.00",
  marketCap: "0.00",
};

describe("canonical AMM valuation", () => {
  it("prices Joey's initialized zero-trade pool and excludes Stack Power from value", () => {
    const market = resolveCanonicalPlayerMarket({
      player: joey,
      pool: { shares: "5", playMoney: "50", lpSharesTotal: "10" },
      liquidUserShares: 60,
    });
    const valuation = calculateCanonicalPortfolio({
      userId: "joey-owner",
      cashBalance: 1_000,
      holdings: [
        {
          id: "holding-1",
          assetId: joey.id,
          quantity: "60",
          avgCostBasis: "4.00",
          totalCostBasis: "240.00",
          lockedSingles: "10",
          player: joey,
        },
      ],
      multipliers: [{ id: "stack-1", playerId: joey.id, multiplier: 600, player: joey }],
      markets: new Map([[joey.id, market]]),
    });

    expect(market).toMatchObject({
      marketStatus: "priced",
      marketPrice: 10,
      priceSource: "amm_spot",
      poolTvl: 100,
      liquidUserShares: 60,
      liquidSharesOutstanding: 65,
      marketCap: 650,
      lastTradePrice: null,
    });
    expect(valuation.positions).toHaveLength(1);
    expect(valuation.positions[0]).toMatchObject({
      singles: 60,
      lockedSingles: 10,
      availableSingles: 50,
      stackPower: 600,
      gameplayPower: 660,
      marketValue: 600,
    });
    expect(valuation).toMatchObject({
      totalSingles: 60,
      totalStackPower: 600,
      totalGameplayPower: 660,
      singlesMarketValue: 600,
      lpMarketValue: 0,
      portfolioValue: 600,
      netWorth: 1600,
    });
  });

  it("keeps lastTradePrice historical when AMM spot differs", () => {
    const market = resolveCanonicalPlayerMarket({
      player: { ...joey, lastTradePrice: "7.00" },
      pool: { shares: 5, playMoney: 50 },
      liquidUserShares: 60,
    });
    expect(market.marketPrice).toBe(10);
    expect(market.lastTradePrice).toBe(7);
  });

  it("resolves a batch with the same market contract as single resolution", () => {
    const input = {
      player: { ...joey, lastTradePrice: "8.00" },
      pool: { shares: 5, playMoney: 50 },
      liquidUserShares: 100,
    };
    const single = resolveCanonicalPlayerMarket(input);
    const batch = resolveCanonicalPlayerMarketBatch([input]);
    expect(batch.get(joey.id)).toEqual(single);
    expect(single).toMatchObject({
      marketPrice: 10,
      liquidSharesOutstanding: 105,
      marketCap: 1050,
      lastTradePrice: 8,
    });
  });

  it("represents a missing pool as unpriced instead of a zero-dollar market", () => {
    const market = resolveCanonicalPlayerMarket({ player: joey, liquidUserShares: 60 });
    const valuation = calculateCanonicalPortfolio({
      userId: "unpriced-owner",
      cashBalance: 100,
      holdings: [
        {
          id: "holding-1",
          assetId: joey.id,
          quantity: 60,
          avgCostBasis: 4,
          totalCostBasis: 240,
          player: joey,
        },
      ],
      multipliers: [],
      markets: new Map([[joey.id, market]]),
    });
    expect(market).toMatchObject({
      marketStatus: "unpriced",
      marketPrice: null,
      priceSource: null,
      poolInitialized: false,
      marketCap: null,
    });
    expect(valuation.positions[0].marketValue).toBeNull();
    expect(valuation.unpricedPositionCount).toBe(1);
  });

  it("marks malformed pool reserves unpriced and emits a structured warning", () => {
    const market = resolveCanonicalPlayerMarket({
      player: joey,
      pool: { shares: 0, playMoney: 50 },
      liquidUserShares: 60,
    });
    expect(market).toMatchObject({
      marketStatus: "unpriced",
      marketPrice: null,
      poolInitialized: true,
      marketCap: null,
    });
    expect(market.warnings).toHaveLength(1);
    expect(market.warnings[0]).toContain("invalid AMM pool");
  });

  it("includes the LP claim's current underlying value without changing market cap", () => {
    const pool = { shares: 5, playMoney: 50, lpSharesTotal: 10 };
    const market = resolveCanonicalPlayerMarket({
      player: joey,
      pool,
      liquidUserShares: 60,
    });
    const valuation = calculateCanonicalPortfolio({
      userId: "lp-owner",
      cashBalance: 0,
      holdings: [],
      multipliers: [],
      lpPositions: [{ id: "lp-1", playerId: joey.id, lpShares: 2, player: joey, pool }],
      markets: new Map([[joey.id, market]]),
    });
    expect(valuation.lpPositions[0]).toMatchObject({
      underlyingShares: 1,
      underlyingPlayMoney: 10,
      marketValue: 20,
    });
    expect(valuation.portfolioValue).toBe(20);
    expect(market.marketCap).toBe(650);
  });

  it("supports fractional Singles and multiple players without valuing Stack Power", () => {
    const secondPlayer = { id: "mlb_1", firstName: "Ada", lastName: "Ace", sport: "MLB" };
    const joeyMarket = resolveCanonicalPlayerMarket({
      player: joey,
      pool: { shares: 5, playMoney: 50 },
      liquidUserShares: 10.5,
    });
    const secondMarket = resolveCanonicalPlayerMarket({
      player: secondPlayer,
      pool: { shares: 4, playMoney: 20 },
      liquidUserShares: 2.25,
    });
    const valuation = calculateCanonicalPortfolio({
      userId: "fractional-owner",
      cashBalance: 25,
      holdings: [
        {
          id: "holding-joey",
          assetId: joey.id,
          quantity: 10.5,
          avgCostBasis: 3,
          totalCostBasis: 31.5,
          lockedSingles: 4.25,
          player: joey,
        },
        {
          id: "holding-ada",
          assetId: secondPlayer.id,
          quantity: 2.25,
          avgCostBasis: 2,
          totalCostBasis: 4.5,
          player: secondPlayer,
        },
      ],
      multipliers: [{ id: "stack-joey", playerId: joey.id, multiplier: 500, player: joey }],
      markets: new Map([
        [joey.id, joeyMarket],
        [secondPlayer.id, secondMarket],
      ]),
    });

    expect(valuation.positions).toHaveLength(2);
    expect(valuation.positions.find((position) => position.playerId === joey.id)).toMatchObject({
      singles: 10.5,
      lockedSingles: 4.25,
      availableSingles: 6.25,
      stackPower: 500,
      marketValue: 105,
    });
    expect(valuation).toMatchObject({
      singlesMarketValue: 116.25,
      portfolioValue: 116.25,
      netWorth: 141.25,
      totalStackPower: 500,
    });
  });

  it("keeps Stack-only inventory owned but at zero liquid portfolio value", () => {
    const market = resolveCanonicalPlayerMarket({
      player: joey,
      pool: { shares: 5, playMoney: 50 },
      liquidUserShares: 0,
    });
    const valuation = calculateCanonicalPortfolio({
      userId: "stack-only",
      cashBalance: 12,
      holdings: [],
      multipliers: [{ id: "stack-1", playerId: joey.id, multiplier: 600, player: joey }],
      markets: new Map([[joey.id, market]]),
    });
    expect(valuation.positions).toHaveLength(1);
    expect(valuation.positions[0]).toMatchObject({
      singles: 0,
      stackPower: 600,
      gameplayPower: 600,
      marketValue: 0,
    });
    expect(valuation.portfolioValue).toBe(0);
    expect(valuation.netWorth).toBe(12);
  });

  it("does not preserve liquid value when Singles are converted through stacking mechanics", () => {
    const market = resolveCanonicalPlayerMarket({
      player: joey,
      pool: { shares: 5, playMoney: 50 },
      liquidUserShares: 10,
    });
    const before = calculateCanonicalPortfolio({
      userId: "stacking-owner",
      cashBalance: 0,
      holdings: [
        {
          id: "holding-1",
          assetId: joey.id,
          quantity: 10,
          avgCostBasis: 10,
          totalCostBasis: 100,
          player: joey,
        },
      ],
      multipliers: [],
      markets: new Map([[joey.id, market]]),
    });
    const after = calculateCanonicalPortfolio({
      userId: "stacking-owner",
      cashBalance: 0,
      holdings: [],
      multipliers: [{ id: "stack-1", playerId: joey.id, multiplier: 5, player: joey }],
      markets: new Map([[joey.id, market]]),
    });

    expect(before).toMatchObject({ portfolioValue: 100, totalGameplayPower: 10 });
    expect(after).toMatchObject({
      portfolioValue: 0,
      totalSingles: 0,
      totalStackPower: 5,
      totalGameplayPower: 5,
    });
  });

  it("warns when duplicate source rows would violate one-position-per-player", () => {
    const market = resolveCanonicalPlayerMarket({
      player: joey,
      pool: { shares: 5, playMoney: 50 },
      liquidUserShares: 2,
    });
    const holding = {
      id: "holding-1",
      assetId: joey.id,
      quantity: 1,
      avgCostBasis: 1,
      totalCostBasis: 1,
      player: joey,
    };
    const valuation = calculateCanonicalPortfolio({
      userId: "duplicate-owner",
      cashBalance: 0,
      holdings: [holding, { ...holding, id: "holding-2" }],
      multipliers: [],
      markets: new Map([[joey.id, market]]),
    });
    expect(valuation.positions).toHaveLength(1);
    expect(valuation.warnings).toContain(
      `Duplicate Singles position loaded for player ${joey.id}.`,
    );
  });
});

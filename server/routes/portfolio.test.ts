import express, { type RequestHandler } from "express";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

let registerPortfolioRoutes: typeof import("./portfolio").registerPortfolioRoutes;
let calculateCanonicalPortfolio: typeof import("../valuation/canonical-valuation").calculateCanonicalPortfolio;
let resolveCanonicalPlayerMarket: typeof import("../valuation/canonical-valuation").resolveCanonicalPlayerMarket;

beforeAll(async () => {
  ({ registerPortfolioRoutes } = await import("./portfolio"));
  ({ calculateCanonicalPortfolio, resolveCanonicalPlayerMarket } =
    await import("../valuation/canonical-valuation"));
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start test server");
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("GET /api/portfolio canonical contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns one Joey position, values only Singles, and preserves an unpriced position", async () => {
    const joey = {
      id: "nascar_3859",
      firstName: "Joey",
      lastName: "Logano",
      sport: "NASCAR",
      team: "22",
      position: "Driver",
      lastTradePrice: null,
    };
    const unpriced = {
      id: "nascar_unpriced",
      firstName: "Casey",
      lastName: "NoPool",
      sport: "NASCAR",
      team: "00",
      position: "Driver",
      lastTradePrice: null,
    };
    const joeyMarket = resolveCanonicalPlayerMarket({
      player: joey,
      pool: { shares: 5, playMoney: 50, lpSharesTotal: 5 },
      liquidUserShares: 60,
    });
    const unpricedMarket = resolveCanonicalPlayerMarket({
      player: unpriced,
      liquidUserShares: 3,
    });
    const valuation = calculateCanonicalPortfolio({
      userId: "user-1",
      cashBalance: 900,
      holdings: [
        {
          id: "holding-joey",
          assetId: joey.id,
          quantity: 60,
          avgCostBasis: 4,
          totalCostBasis: 240,
          player: joey,
        },
        {
          id: "holding-unpriced",
          assetId: unpriced.id,
          quantity: 3,
          avgCostBasis: 2,
          totalCostBasis: 6,
          player: unpriced,
        },
      ],
      multipliers: [{ id: "stack-joey", playerId: joey.id, multiplier: 600, player: joey }],
      markets: new Map([
        [joey.id, joeyMarket],
        [unpriced.id, unpricedMarket],
      ]),
    });
    const { app, baseUrl, close } = createTestServer();
    const isAuthenticated: RequestHandler = (req: any, _res, next) => {
      req.user = { id: "user-1" };
      next();
    };
    registerPortfolioRoutes(app, {
      isAuthenticated,
      getUserId: () => "user-1",
      loadEffectiveUserState: vi.fn().mockResolvedValue({
        user: { id: "user-1", balance: "900.00" },
        entitlements: {
          premiumActive: false,
          premiumExpiresAt: null,
          rewardedScoutBoostActive: false,
          rewardedScoutBoostExpiresAt: null,
          maxScouts: 5,
        },
      }),
      getCanonicalPortfolioValuation: vi.fn().mockResolvedValue(valuation),
      storage: {
        getUserHoldings: vi.fn().mockResolvedValue([]),
        getAvailableBalance: vi.fn().mockResolvedValue(850),
        getBatchPoolData: vi
          .fn()
          .mockResolvedValue(new Map([[joey.id, { shares: 5, playMoney: 50, totalTrades: 0 }]])),
        getBatchActiveScoutCounts: vi.fn().mockResolvedValue(new Map()),
      },
    });

    try {
      const response = await fetch(`${baseUrl}/api/portfolio`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toMatchObject({
        availableBalance: "850.00",
        portfolioValue: "600.00",
        singlesMarketValue: "600.00",
        lpMarketValue: "0.00",
        netWorth: "1500.00",
        totalSingles: 63,
        totalStackPower: 600,
        totalGameplayPower: 663,
        pricedPositionCount: 1,
        unpricedPositionCount: 1,
        unpricedSingles: 3,
      });
      expect(body.positions).toHaveLength(2);
      expect(body.positions.filter((position: any) => position.assetId === joey.id)).toHaveLength(
        1,
      );
      expect(body.positions.find((position: any) => position.assetId === joey.id)).toMatchObject({
        singles: 60,
        stackPower: 600,
        gameplayPower: 660,
        marketPrice: 10,
        currentValue: "600.00",
      });
      expect(
        body.positions.find((position: any) => position.assetId === unpriced.id),
      ).toMatchObject({
        singles: 3,
        stackPower: 0,
        marketStatus: "unpriced",
        marketPrice: null,
        currentValue: null,
      });
    } finally {
      await close();
    }
  });
});

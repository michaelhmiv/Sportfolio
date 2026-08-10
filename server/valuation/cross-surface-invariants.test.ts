import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../jobs/market-snapshot", () => ({ takeMarketSnapshot: vi.fn() }));

import { buildDailySnapshotPortfolioData } from "../jobs/daily-snapshot";
import { buildNativePortfolioSummary } from "../mcp/native-operations";
import { buildPortfolioViewData } from "../mcp/plugin/ui/surface";
import { buildPortfolioApiPayload } from "../routes/portfolio";
import {
  calculateCanonicalPortfolio,
  getCanonicalPortfolioTotals,
  resolveCanonicalPlayerMarket,
} from "./canonical-valuation";

describe("canonical valuation cross-surface invariants", () => {
  it("keeps API/dashboard, native MCP, plugin UI, leaderboard input, and snapshot totals equal", () => {
    const player = {
      id: "nascar_3859",
      firstName: "Joey",
      lastName: "Logano",
      sport: "NASCAR",
      lastTradePrice: null,
    };
    const market = resolveCanonicalPlayerMarket({
      player,
      pool: { shares: 5, playMoney: 50 },
      liquidUserShares: 60,
    });
    const valuation = calculateCanonicalPortfolio({
      userId: "user-a",
      cashBalance: 900,
      holdings: [
        {
          id: "holding-a",
          assetId: player.id,
          quantity: 60,
          avgCostBasis: 4,
          totalCostBasis: 240,
          player,
        },
      ],
      multipliers: [{ id: "stack-a", playerId: player.id, multiplier: 600, player }],
      markets: new Map([[player.id, market]]),
    });

    const apiAndDashboardTotals = getCanonicalPortfolioTotals(valuation);
    const api = buildPortfolioApiPayload({
      userState: {
        user: { id: valuation.userId, balance: valuation.cashBalance.toFixed(2) },
        entitlements: {
          premiumActive: false,
          premiumExpiresAt: null,
          rewardedScoutBoostActive: false,
          rewardedScoutBoostExpiresAt: null,
          maxScouts: 5,
        },
      },
      valuation,
      availableBalance: 850,
      rawHoldings: [],
      poolDataMap: new Map([[player.id, { shares: 5, playMoney: 50, totalTrades: 0 }]]),
      globalScoutMap: new Map(),
    });
    const native = buildNativePortfolioSummary(valuation, 850) as any;
    const plugin = buildPortfolioViewData(valuation, 850, {}) as any;
    const leaderboardInput = {
      userId: valuation.userId,
      balance: valuation.cashBalance.toFixed(2),
      portfolioValue: valuation.portfolioValue,
    };
    const [snapshot] = buildDailySnapshotPortfolioData([leaderboardInput]);

    expect(apiAndDashboardTotals.portfolioValue).toBe(600);
    expect(Number(api.portfolioValue)).toBe(apiAndDashboardTotals.portfolioValue);
    expect(native.portfolioValue).toBe(apiAndDashboardTotals.portfolioValue);
    expect(plugin.summary.portfolioValue).toBe(apiAndDashboardTotals.portfolioValue);
    expect(plugin.summary.totalValue).toBe(apiAndDashboardTotals.portfolioValue);
    expect(leaderboardInput.portfolioValue).toBe(apiAndDashboardTotals.portfolioValue);
    expect(snapshot.portfolioValue).toBe(apiAndDashboardTotals.portfolioValue);
    expect(snapshot.totalNetWorth).toBe(apiAndDashboardTotals.netWorth);
    expect(native.holdings).toHaveLength(1);
    expect(plugin.holdings).toHaveLength(1);
  });
});

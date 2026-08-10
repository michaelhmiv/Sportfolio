import { afterEach, describe, expect, it, vi } from "vitest";
import { runNativeReadTool } from "./native-operations";
import * as canonicalValuation from "../valuation/canonical-valuation";
import { storage } from "../storage";

afterEach(() => vi.restoreAllMocks());

describe("native get_holdings", () => {
  it("honors sport and limit without leaking holdings from another sport", async () => {
    vi.spyOn(canonicalValuation, "getCanonicalPortfolioValuation").mockResolvedValue({
      positions: [
        { playerId: "nascar_1", player: { id: "nascar_1", sport: "NASCAR" } },
        { playerId: "mlb_1", player: { id: "mlb_1", sport: "MLB" } },
        { playerId: "nascar_2", player: { id: "nascar_2", sport: "NASCAR" } },
      ],
    } as any);

    const result = (await runNativeReadTool({
      toolName: "get_holdings",
      userId: "user-1",
      args: { sport: "nascar", limit: 1 },
    })) as any[];

    expect(result).toHaveLength(1);
    expect(result[0].player.id).toBe("nascar_1");
    expect(result.every((row) => row.player.sport === "NASCAR")).toBe(true);
  });

  it("returns explicit canonical totals from get_portfolio_summary", async () => {
    vi.spyOn(canonicalValuation, "getCanonicalPortfolioValuation").mockResolvedValue({
      valuationVersion: "amm_liquid_v2",
      userId: "user-1",
      cashBalance: 900,
      singlesMarketValue: 600,
      lpMarketValue: 20,
      portfolioValue: 620,
      netWorth: 1520,
      positionCount: 1,
      pricedPositionCount: 1,
      unpricedPositionCount: 0,
      unpricedSingles: 0,
      totalSingles: 60,
      totalStackPower: 600,
      totalGameplayPower: 660,
      positions: [{ playerId: "nascar_3859" }],
      lpPositions: [{ id: "lp-1" }],
      warnings: [],
    } as any);
    vi.spyOn(storage, "getAvailableBalance").mockResolvedValue(850);

    const result = (await runNativeReadTool({
      toolName: "get_portfolio_summary",
      userId: "user-1",
      args: {},
    })) as any;
    expect(result).toMatchObject({
      valuationVersion: "amm_liquid_v2",
      availableBalance: 850,
      totalSingles: 60,
      totalStackPower: 600,
      totalGameplayPower: 660,
      singlesMarketValue: 600,
      lpMarketValue: 20,
      portfolioValue: 620,
      netWorth: 1520,
    });
    expect(result).not.toHaveProperty("totalQuantity");
  });

  it("returns liquid share supply and AMM market cap from get_player_shares_info", async () => {
    vi.spyOn(storage, "getPlayer").mockResolvedValue({ id: "nascar_3859" } as any);
    vi.spyOn(storage, "getAvailableShares").mockResolvedValue(50);
    vi.spyOn(storage, "getPlayerShareBreakdown").mockResolvedValue({
      regular: { quantity: "60" },
      stacked: [{ multiplier: "600" }],
    } as any);
    vi.spyOn(canonicalValuation, "getCanonicalPlayerMarket").mockResolvedValue({
      playerId: "nascar_3859",
      marketStatus: "priced",
      marketPrice: 10,
      priceSource: "amm_spot",
      poolInitialized: true,
      shareReserve: 5,
      playMoneyReserve: 50,
      poolTvl: 100,
      lastTradePrice: null,
      liquidUserShares: 100,
      liquidSharesOutstanding: 105,
      marketCap: 1050,
      warnings: [],
    });

    const result = (await runNativeReadTool({
      toolName: "get_player_shares_info",
      userId: "user-1",
      args: { playerId: "nascar_3859" },
    })) as any;
    expect(result).toMatchObject({
      marketStatus: "priced",
      marketPrice: 10,
      liquidUserShares: 100,
      poolShareReserve: 5,
      liquidSharesOutstanding: 105,
      marketCap: 1050,
      availableShares: 50,
    });
  });
});

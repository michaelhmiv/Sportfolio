import type { Express, Request, RequestHandler } from "express";
import {
  getCanonicalPortfolioTotals,
  type CanonicalPortfolioValuation,
} from "../valuation/canonical-valuation";

type EffectiveUserState = {
  user: { id: string; balance: string };
  entitlements: {
    premiumActive: boolean;
    premiumExpiresAt: Date | string | null;
    rewardedScoutBoostActive: boolean;
    rewardedScoutBoostExpiresAt: Date | string | null;
    maxScouts: number;
  };
};

export type PortfolioRouteDeps = {
  isAuthenticated: RequestHandler;
  getUserId: (request: Request) => string;
  loadEffectiveUserState: (userId: string) => Promise<EffectiveUserState | null>;
  getCanonicalPortfolioValuation: (userId: string) => Promise<CanonicalPortfolioValuation | null>;
  storage: {
    getUserHoldings: (userId: string) => Promise<any[]>;
    getAvailableBalance: (userId: string) => Promise<number>;
    getBatchPoolData: (playerIds: string[]) => Promise<Map<string, any>>;
    getBatchActiveScoutCounts: (playerIds: string[]) => Promise<Map<string, number>>;
  };
};

export function buildPortfolioApiPayload(input: {
  userState: EffectiveUserState;
  valuation: CanonicalPortfolioValuation;
  availableBalance: number;
  rawHoldings: any[];
  poolDataMap: Map<string, any>;
  globalScoutMap: Map<string, number>;
}) {
  const { userState, valuation, availableBalance, rawHoldings, poolDataMap, globalScoutMap } =
    input;
  const portfolioTotals = getCanonicalPortfolioTotals(valuation);
  const playerPositions = valuation.positions.map((position) => {
    const pool = poolDataMap.get(position.playerId);
    return {
      id: position.holdingId || `position:${position.playerId}`,
      holdingId: position.holdingId,
      assetType: "player",
      assetId: position.playerId,
      quantity: position.singles.toFixed(4),
      avgCostBasis: position.averageCostBasis.toFixed(4),
      totalCostBasis: position.costBasis.toFixed(2),
      player: {
        ...position.player,
        marketStatus: position.marketStatus,
        marketPrice: position.marketPrice,
        currentPrice: position.marketPrice?.toFixed(2) ?? null,
        poolLiquidity: pool?.playMoney || 0,
        poolTvl: position.poolTvl,
        poolShares: pool?.shares || 0,
        poolTotalTrades: pool?.totalTrades || 0,
      },
      marketStatus: position.marketStatus,
      marketPrice: position.marketPrice,
      currentValue: position.marketValue?.toFixed(2) ?? null,
      pnl: position.unrealizedChange?.toFixed(2) ?? null,
      pnlPercent: position.unrealizedChangePercent?.toFixed(2) ?? null,
      lockedQuantity: position.lockedSingles,
      availableQuantity: position.availableSingles,
      singles: position.singles,
      effectiveShares: position.singles.toFixed(4),
      totalPlayerEffectiveShares: position.singles.toFixed(4),
      isCanonicalPosition: true as const,
      globalScoutCount: globalScoutMap.get(position.playerId) || 0,
    };
  });
  const nonPlayerHoldings = rawHoldings.filter((holding) => holding.assetType !== "player");
  const premiumShares =
    nonPlayerHoldings.find((holding) => holding.assetType === "premium")?.quantity || 0;
  const totalPnL = valuation.positions.reduce(
    (total, position) => total + (position.unrealizedChange || 0),
    0,
  );
  const totalCost = valuation.positions.reduce((total, position) => total + position.costBasis, 0);

  return {
    balance: userState.user.balance,
    availableBalance: availableBalance.toFixed(2),
    valuationVersion: portfolioTotals.valuationVersion,
    portfolioValue: portfolioTotals.portfolioValue.toFixed(2),
    singlesMarketValue: portfolioTotals.singlesMarketValue.toFixed(2),
    lpMarketValue: portfolioTotals.lpMarketValue.toFixed(2),
    netWorth: portfolioTotals.netWorth.toFixed(2),
    totalSingles: portfolioTotals.totalSingles,
    pricedPositionCount: portfolioTotals.pricedPositionCount,
    unpricedPositionCount: portfolioTotals.unpricedPositionCount,
    unpricedSingles: portfolioTotals.unpricedSingles,
    totalPnL: totalPnL.toFixed(2),
    totalPnLPercent: totalCost > 0 ? ((totalPnL / totalCost) * 100).toFixed(2) : "0.00",
    positions: playerPositions,
    holdings: [...playerPositions, ...nonPlayerHoldings],
    lpPositions: valuation.lpPositions,
    warnings: valuation.warnings,
    premiumShares,
    isPremium: userState.entitlements.premiumActive,
    premiumActive: userState.entitlements.premiumActive,
    premiumExpiresAt: userState.entitlements.premiumExpiresAt,
    rewardedScoutBoostActive: userState.entitlements.rewardedScoutBoostActive,
    rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
    maxScouts: userState.entitlements.maxScouts,
  };
}

export function registerPortfolioRoutes(app: Express, deps: PortfolioRouteDeps): void {
  const { isAuthenticated } = deps;

  app.get("/api/portfolio", isAuthenticated, async (req, res) => {
    try {
      const userId = deps.getUserId(req);
      const userState = await deps.loadEffectiveUserState(userId);
      if (!userState) return res.status(404).json({ error: "User not found" });

      const [valuation, availableBalance, rawHoldings] = await Promise.all([
        deps.getCanonicalPortfolioValuation(userState.user.id),
        deps.storage.getAvailableBalance(userState.user.id),
        deps.storage.getUserHoldings(userState.user.id),
      ]);
      if (!valuation) return res.status(404).json({ error: "User not found" });

      const playerIds = valuation.positions.map((position) => position.playerId);
      const [poolDataMap, globalScoutMap] = await Promise.all([
        playerIds.length ? deps.storage.getBatchPoolData(playerIds) : Promise.resolve(new Map()),
        playerIds.length
          ? deps.storage.getBatchActiveScoutCounts(playerIds)
          : Promise.resolve(new Map()),
      ]);

      return res.json(
        buildPortfolioApiPayload({
          userState,
          valuation,
          availableBalance,
          rawHoldings,
          poolDataMap,
          globalScoutMap,
        }),
      );
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });
}

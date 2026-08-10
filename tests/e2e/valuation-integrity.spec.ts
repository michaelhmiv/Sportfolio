import { expect, test, type Page } from "@playwright/test";

const joeyPosition = {
  id: "holding-joey",
  holdingId: "holding-joey",
  stackId: "stack-joey",
  assetType: "player",
  assetId: "nascar_3859",
  quantity: "60.0000",
  avgCostBasis: "4.0000",
  totalCostBasis: "240.00",
  player: {
    id: "nascar_3859",
    firstName: "Joey",
    lastName: "Logano",
    team: "22",
    position: "Driver",
    sport: "NASCAR",
    marketStatus: "priced",
    marketPrice: 10,
    currentPrice: "10.00",
    poolShares: 5,
    poolLiquidity: 50,
    poolTvl: 100,
    poolTotalTrades: 0,
  },
  marketStatus: "priced",
  marketPrice: 10,
  currentValue: "600.00",
  pnl: "360.00",
  pnlPercent: "150.00",
  lockedQuantity: 0,
  availableQuantity: 60,
  singles: 60,
  stackPower: 600,
  gameplayPower: 660,
  effectiveShares: "660.00",
  totalPlayerEffectiveShares: "660.00",
  isCanonicalPosition: true,
  globalScoutCount: 0,
};

async function mockValuationApis(page: Page) {
  await page.addInitScript(() => {
    // Enter protected routes immediately while the mocked auth query settles.
    // App.tsx exposes this loopback-only hook specifically for Playwright.
    (window as Window & { __PLAYWRIGHT_AGENT_E2E__?: boolean }).__PLAYWRIGHT_AGENT_E2E__ = true;
    window.localStorage.setItem("sportfolio_selected_sport", "ALL");
    window.localStorage.setItem("portfolioViewMode", "list");
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/auth/user") {
      return json({
        id: "user-a",
        email: "valuation@example.com",
        username: "valuation-user",
        hasSeenOnboarding: true,
        isPremium: false,
        isAdmin: false,
      });
    }
    if (path === "/api/watchlist") return json([]);
    if (path === "/api/player/nascar_3859") {
      return json({
        player: joeyPosition.player,
        priceHistory: [],
        recentTrades: [],
        userBalance: "900.00",
        userHolding: { quantity: 60, avgCostBasis: "4.00" },
      });
    }
    if (path === "/api/amm/nascar_3859") {
      return json({
        playerId: "nascar_3859",
        poolInitialized: true,
        marketStatus: "priced",
        marketPrice: 10,
        currentPrice: 10,
        shares: 5,
        playMoney: 50,
        poolTvl: 100,
        totalVolume: 0,
        totalTrades: 0,
        lpSharesTotal: 5,
        feesAccumulated: 0,
      });
    }
    if (path === "/api/player/nascar_unpriced") {
      return json({
        player: {
          id: "nascar_unpriced",
          firstName: "Casey",
          lastName: "NoPool",
          team: "00",
          position: "Driver",
          sport: "NASCAR",
          marketStatus: "unpriced",
          marketPrice: null,
          lastTradePrice: "8.00",
        },
        priceHistory: [],
        recentTrades: [],
        userBalance: "900.00",
        userHolding: { quantity: 3, avgCostBasis: "2.00" },
      });
    }
    if (path === "/api/amm/nascar_unpriced") {
      return json({
        playerId: "nascar_unpriced",
        poolInitialized: false,
        marketStatus: "unpriced",
        marketPrice: null,
        currentPrice: null,
        shares: null,
        playMoney: null,
        poolTvl: null,
        totalVolume: 0,
        totalTrades: 0,
        lpSharesTotal: 0,
        feesAccumulated: 0,
      });
    }
    if (/^\/api\/lp\/[^/]+\/position$/.test(path)) return json({ position: null });
    if (path === "/api/portfolio") {
      return json({
        balance: "900.00",
        valuationVersion: "amm_liquid_v2",
        portfolioValue: "600.00",
        singlesMarketValue: "600.00",
        lpMarketValue: "0.00",
        netWorth: "1500.00",
        totalPnL: "360.00",
        totalPnLPercent: "150.00",
        positions: [joeyPosition],
        holdings: [joeyPosition],
        lpPositions: [],
        warnings: [],
        premiumShares: 0,
        isPremium: false,
      });
    }
    if (path === "/api/lp/positions") return json([]);
    if (path === "/api/daily-boosts/eligible-all") return json({ eligiblePlayers: [] });
    if (path === "/api/premium/market-data") {
      return json({ lastTradePrice: null, circulation: 0, totalTrades: 0 });
    }
    if (path === "/api/user/portfolio-history") return json({ history: [], timeRange: "1M" });
    if (path === "/api/leaderboards") {
      const entry = {
        rank: 1,
        userId: "user-a",
        username: "valuation-user",
        profileImageUrl: null,
        value: 600,
        rankChange: null,
      };
      return json({
        category: "portfolioValue",
        categoryLabel: "Portfolio Value",
        description: "Liquid portfolio value",
        unit: "currency",
        updatedAt: "2026-08-10T12:00:00.000Z",
        totalEntries: 1,
        leaderboard: [entry],
        currentUser: entry,
        currentUserWindow: [entry],
      });
    }
    if (path === "/api/dashboard") {
      return json({
        user: {
          balance: "900.00",
          portfolioValue: "600.00",
          singlesMarketValue: "600.00",
          lpMarketValue: "0.00",
          netWorth: "1500.00",
          cashRank: 1,
          portfolioRank: 1,
          cashRankChange: null,
          portfolioRankChange: null,
          change24h: { amount: null, percent: null, rank: null },
          change7d: { amount: null, percent: null, rank: null },
          change30d: { amount: null, percent: null, rank: null },
        },
        hotPlayers: [],
        recentTrades: [],
        topHoldings: [],
        portfolioMovers24h: [],
        portfolioHistory: [],
        boosts: {
          activeBoosts: 0,
          lockedBoosts: 0,
          processedBoosts: 0,
          totalBoosts: 0,
          slotsRemaining: 4,
          availableSlots: [2, 3, 4, 5],
          communityBoostCount: 0,
          userCommunityShares: 0,
          totalLivePayout: "0",
          totalProcessedPayout: "0",
        },
      });
    }
    if (path.includes("/insights")) return json({ games: [], insights: [] });
    if (path.includes("/financials")) return json({});
    return json({});
  });
}

test("AMM valuation stays consistent across player, portfolio, leaderboard, and dashboard UI", async ({
  page,
}) => {
  await mockValuationApis(page);

  await page.goto("/player/nascar_3859");
  await expect(page.getByText("Joey Logano").first()).toBeVisible();
  await expect(page.getByTestId("text-current-price")).toContainText("$10.00");
  await expect(page.getByText("Pool Shares")).toBeVisible();
  await expect(page.getByText("5", { exact: true })).toBeVisible();
  await expect(page.getByText("Pool TVL")).toBeVisible();
  await expect(page.getByText("$100.00", { exact: true })).toBeVisible();

  await page.goto("/portfolio");
  await expect(page.getByTestId("text-portfolio-value-desktop")).toHaveText("$600.00");
  const joeyRow = page.getByTestId("row-holding-nascar_3859");
  await expect(joeyRow).toHaveCount(1);
  await expect(joeyRow).toContainText("60");
  await expect(joeyRow).toContainText("600p");
  await expect(joeyRow).toContainText("660.00 gameplay power");
  await expect(joeyRow).toContainText("$600.00");

  await page.goto("/leaderboards#portfolioValue");
  await expect(page.getByText("@valuation-user (You)")).toBeVisible();
  await expect(page.getByText("$600.00").first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("text-portfolio-value")).toContainText("$600");

  await page.goto("/player/nascar_unpriced");
  await expect(page.getByTestId("text-current-price")).toHaveText("Unpriced");
});

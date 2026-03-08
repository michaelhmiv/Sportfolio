import { test, expect, type Page, devices } from "@playwright/test";

const playerOne = {
  id: "p1",
  firstName: "Jalen",
  lastName: "Brunson",
  team: "NYK",
  position: "PG",
  sport: "NBA",
  currentPrice: "14.25",
  priceChange24h: "7.4",
  volume24h: 18240,
  marketCap: "1320000",
  poolTvl: 42000,
  buyPressure: 71,
  valueIndex: 88,
  avgFantasyPointsPerGame: "41.2",
  hasGameToday: true,
  gameStatus: "upcoming",
  gameStartTime: "2026-03-07T23:30:00.000Z",
  communityBoostCount: 2,
};

const playerTwo = {
  id: "p2",
  firstName: "Anthony",
  lastName: "Edwards",
  team: "MIN",
  position: "SG",
  sport: "NBA",
  currentPrice: "12.40",
  priceChange24h: "4.1",
  volume24h: 9630,
  marketCap: "1180000",
  poolTvl: 15500,
  buyPressure: 63,
  valueIndex: 93,
  avgFantasyPointsPerGame: "39.7",
  hasGameToday: true,
  gameStatus: "live",
  gameStartTime: "2026-03-07T20:00:00.000Z",
  communityBoostCount: 0,
};

async function mockAuth(page: Page) {
  await page.route("**/api/auth/user?sync=true", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_market_mobile",
        email: "market-mobile@example.com",
        username: "market-mobile",
        hasSeenOnboarding: true,
        isPremium: false,
      }),
    });
  });

  await page.route("**/api/auth/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_market_mobile",
        email: "market-mobile@example.com",
        username: "market-mobile",
        hasSeenOnboarding: true,
        isPremium: false,
      }),
    });
  });

  await page.route("**/api/auth/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "http://127.0.0.1:5000/mock-supabase",
        anonKey: "market-mobile-e2e",
        configVersion: "market-mobile-e2e",
      }),
    });
  });

  await page.route("**/mock-supabase/auth/v1/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: null,
        session: null,
      }),
    });
  });
}

async function mockMarketplace(page: Page) {
  await mockAuth(page);

  await page.route(/.*\/api\/players\?.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        players: [playerOne, playerTwo],
        total: 2,
      }),
    });
  });

  await page.route(/.*\/api\/market\/mobile-overview\?.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sport: "NBA",
        pulse: {
          tradeCount15m: 2,
          lowActivity: true,
          liveGameCount: 1,
          slateGameCount: 4,
          openBoostSlots: 3,
          generatedAt: "2026-03-07T21:12:00.000Z",
        },
        ticker: [
          {
            id: "ticker_1",
            playerId: "p1",
            playerName: "Jalen Brunson",
            symbol: "J. Brunson",
            team: "NYK",
            currentPrice: 14.25,
            priceChange24h: 7.4,
            quantity: 220,
            notional: 3135,
            isWhale: false,
            timestamp: "2026-03-07T21:10:00.000Z",
          },
          {
            id: "ticker_2",
            playerId: "p2",
            playerName: "Anthony Edwards",
            symbol: "A. Edwards",
            team: "MIN",
            currentPrice: 12.4,
            priceChange24h: 4.1,
            quantity: 540,
            notional: 6696,
            isWhale: true,
            timestamp: "2026-03-07T21:09:00.000Z",
          },
        ],
        nowMoving: [
          {
            playerId: "p1",
            firstName: "Jalen",
            lastName: "Brunson",
            team: "NYK",
            position: "PG",
            currentPrice: 14.25,
            priceChange24h: 7.4,
            poolTvl: 42000,
            buyPressure: 71,
            valueIndex: 88,
            globalScoutCount: 4,
            communityBoostCount: 2,
            gameStatus: "upcoming",
            gameStartTime: "2026-03-07T23:30:00.000Z",
            note: "+7.4% in the last 24h",
            signal: "momentum",
            availableShares: null,
            bestSharePower: null,
            heatCheckStatus: "fire",
          },
        ],
        boostWindow: [
          {
            playerId: "p1",
            firstName: "Jalen",
            lastName: "Brunson",
            team: "NYK",
            position: "PG",
            currentPrice: 14.25,
            priceChange24h: 7.4,
            poolTvl: 42000,
            buyPressure: 71,
            valueIndex: 88,
            globalScoutCount: 4,
            communityBoostCount: 2,
            gameStatus: "upcoming",
            gameStartTime: "2026-03-07T23:30:00.000Z",
            note: "3 slots still open",
            signal: "boost",
            availableShares: 2,
            bestSharePower: 3,
            heatCheckStatus: "fire",
          },
        ],
        scoutSurge: [
          {
            playerId: "p2",
            firstName: "Anthony",
            lastName: "Edwards",
            team: "MIN",
            position: "SG",
            currentPrice: 12.4,
            priceChange24h: 4.1,
            poolTvl: 15500,
            buyPressure: 63,
            valueIndex: 93,
            globalScoutCount: 6,
            communityBoostCount: 0,
            gameStatus: "live",
            gameStartTime: "2026-03-07T20:00:00.000Z",
            note: "6 active scouts",
            signal: "scout",
            availableShares: null,
            bestSharePower: null,
            heatCheckStatus: "neutral",
          },
        ],
        quietValue: [
          {
            playerId: "p2",
            firstName: "Anthony",
            lastName: "Edwards",
            team: "MIN",
            position: "SG",
            currentPrice: 12.4,
            priceChange24h: 4.1,
            poolTvl: 15500,
            buyPressure: 63,
            valueIndex: 93,
            globalScoutCount: 6,
            communityBoostCount: 0,
            gameStatus: "live",
            gameStartTime: "2026-03-07T20:00:00.000Z",
            note: "Value index 93",
            signal: "value",
            availableShares: null,
            bestSharePower: null,
            heatCheckStatus: "neutral",
          },
        ],
        watchlistMoves: [
          {
            playerId: "p1",
            firstName: "Jalen",
            lastName: "Brunson",
            team: "NYK",
            position: "PG",
            currentPrice: 14.25,
            priceChange24h: 7.4,
            poolTvl: 42000,
            buyPressure: 71,
            valueIndex: 88,
            globalScoutCount: 4,
            communityBoostCount: 2,
            gameStatus: "upcoming",
            gameStartTime: "2026-03-07T23:30:00.000Z",
            note: "Watchlist up 7.4%",
            signal: "watchlist",
            availableShares: null,
            bestSharePower: null,
            heatCheckStatus: "fire",
          },
        ],
      }),
    });
  });

  await page.route("**/api/daily-boosts/eligible-all", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        eligiblePlayers: [
          {
            playerId: "p1",
            player: { sport: "NBA" },
            availableShares: 2,
            bestSharePower: 3,
            isAlreadyBoosted: false,
            gameStatus: "upcoming",
          },
        ],
      }),
    });
  });

  await page.route("**/api/watchlist", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(["p1"]),
    });
  });

  await page.route("**/api/watchlists", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "w1", name: "Core" }]),
    });
  });

  await page.route("**/api/market/scanners?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        undervalued: [],
        premium: [],
        sentiment: [],
        momentum: [],
      }),
    });
  });

  await page.route("**/api/players/spotlight/top-risers?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route("**/api/players/spotlight/top-market-cap?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route("**/api/players/spotlight/top-pools?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route(/.*\/api\/player\/[^/]+\/financials$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        valueIndex: 88,
        sentiment: {
          buyPressure: 71,
          totalVolume24h: 18240,
          trend: "bullish",
        },
        heatCheck: {
          status: "fire",
        },
      }),
    });
  });

  await page.route(/.*\/api\/player\/[^/]+$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        player: playerOne,
        userBalance: "1250",
        userHolding: {
          quantity: 2,
          avgCostBasis: "11.25",
        },
      }),
    });
  });

  await page.route(/.*\/api\/amm\/[^/]+$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currentPrice: 14.25,
        totalTrades: 18,
        totalVolume: 18240,
        playMoney: 21000,
        shares: 1473,
      }),
    });
  });

  await page.route(/.*\/api\/market\/activity\?.*/, async (route) => {
    const url = new URL(route.request().url());
    const playerId = url.searchParams.get("playerId");

    const body =
      playerId === "p1"
        ? [
            {
              id: "trade_p1",
              playerId: "p1",
              playerFirstName: "Jalen",
              playerLastName: "Brunson",
              playerTeam: "NYK",
              buyerId: "buyer_1",
              buyerUsername: "tape_hawk",
              sellerId: "pool",
              sellerUsername: "Pool",
              quantity: 12,
              price: "14.25",
              timestamp: "2026-03-07T21:10:00.000Z",
            },
          ]
        : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("mobile pools loads the live market home and opens the trade sheet", async ({ browser }) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: "http://127.0.0.1:5000",
  });
  const page = await context.newPage();

  await mockMarketplace(page);

  await page.goto("/pools", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("mobile-market-pulse")).toBeVisible();
  await expect(page.getByTestId("mobile-market-tape")).toBeVisible();
  await expect(page.getByTestId("market-module-now-moving")).toBeVisible();
  await expect(page.getByTestId("market-mobile-player-card").first()).toBeVisible();
  await expect(page.getByText("Search & Filters")).toHaveCount(0);

  await page
    .getByTestId("market-mobile-player-card")
    .first()
    .locator("button")
    .filter({ hasText: /^Boost$/ })
    .click();
  await expect(page.getByTestId("market-mobile-player-sheet")).toBeVisible();
  await expect(page.getByText("Tonight's Boost Window")).toBeVisible();

  await context.close();
});

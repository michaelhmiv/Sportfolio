import { expect, test, type Page, devices } from "@playwright/test";

async function mockAuth(page: Page) {
  await page.route("**/api/auth/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "http://127.0.0.1:5000/mock-supabase",
        anonKey: "test-anon-key-placeholder",
        configVersion: "boosts-player-e2e",
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

  const authUser = {
    id: "user_e2e_boosts",
    email: "boosts@example.com",
    username: "boosts-user",
    hasSeenOnboarding: true,
    isPremium: true,
    isAdmin: false,
  };

  await page.route("**/api/auth/user?sync=true", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(authUser),
    });
  });

  await page.route("**/api/auth/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(authUser),
    });
  });
}

test("mobile boosts keeps community add visible and opens processed results", async ({
  browser,
}) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: "http://127.0.0.1:5000",
  });
  const page = await context.newPage();

  await mockAuth(page);

  await page.route(/.*\/api\/daily-boosts\/all\?date=.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        boosts: [
          {
            id: "boost_locked",
            playerId: "player_locked",
            slotTier: 4,
            sharesEntered: 1,
            status: "locked",
            shareMultiplier: "2.00",
            communityBoostCount: 1,
            sport: "NBA",
            liveFantasyPoints: 3,
            player: {
              id: "player_locked",
              firstName: "Jalen",
              lastName: "North",
              team: "NYK",
            },
          },
          {
            id: "boost_processed",
            playerId: "player_processed",
            slotTier: 5,
            sharesEntered: 1,
            status: "processed",
            fantasyPoints: "8.00",
            payout: "24.50",
            shareMultiplier: "1.50",
            communityBoostCount: 0,
            sport: "NBA",
            player: {
              id: "player_processed",
              firstName: "Marcus",
              lastName: "Vale",
              team: "BOS",
            },
          },
        ],
        slotsRemaining: 2,
        availableSlots: [2, 3],
      }),
    });
  });

  await page.route(/.*\/api\/daily-boosts\/eligible-all\?date=.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        eligiblePlayers: [
          {
            playerId: "player_locked",
            player: {
              id: "player_locked",
              firstName: "Jalen",
              lastName: "North",
              team: "NYK",
            },
            availableShares: 2,
            effectiveShares: "2.00",
            multiplier: "2.00",
            bestShareMultiplier: 2,
            totalShares: "2.00",
            gameId: "game_1",
            gameStartTime: "2026-04-27T23:00:00.000Z",
            hasGameToday: true,
            gameStatus: "upcoming",
            gameDbStatus: "scheduled",
            isAlreadyBoosted: false,
            communityBoostCount: 1,
            hasCommunityBoost: true,
            userPremiumShares: 3,
            sport: "NBA",
          },
        ],
        totalEligible: 1,
      }),
    });
  });

  await page.route(/.*\/api\/community-boosts\/all\?date=.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        communityBoosts: [
          {
            playerId: "player_locked",
            communityBoostCount: 1,
            sport: "NBA",
            boostDate: "2026-04-27",
            player: {
              id: "player_locked",
              firstName: "Jalen",
              lastName: "North",
              team: "NYK",
            },
          },
        ],
      }),
    });
  });

  await page.route("**/api/daily-boosts/history", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        payouts: [
          {
            id: "payout_1",
            playerId: "player_processed",
            sharesUsed: 1,
            fantasyPoints: "8.00",
            multiplier: 5,
            payoutAmount: "24.50",
            createdAt: "2026-04-27T04:00:00.000Z",
            player: {
              id: "player_processed",
              firstName: "Marcus",
              lastName: "Vale",
              team: "BOS",
            },
          },
        ],
        totalEarned: "24.50",
        totalBoosts: 1,
      }),
    });
  });

  await page.goto("/boosts", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: "Add" })).toBeVisible();
  await expect(page.getByText("Est. Payout").first()).toBeVisible();
  await expect(page.getByText("$54.50").first()).toBeVisible();

  await page.getByRole("button", { name: "Results" }).click();
  await expect(page.getByText("Today's Performance")).toBeVisible();
  await expect(page.getByText("Marcus Vale").first()).toBeVisible();

  await context.close();
});

test("player error state returns home with in-app navigation", async ({ page }) => {
  await mockAuth(page);

  await page.route("**/api/amm/player_404", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        playerId: "player_404",
        poolInitialized: true,
        shares: 10,
        playMoney: 100,
        currentPrice: 10,
        totalVolume: 0,
        totalTrades: 0,
        lpSharesTotal: 0,
        feesAccumulated: 0,
      }),
    });
  });

  await page.route("**/api/player/player_404?range=1D", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "text/plain",
      body: "Player not found",
    });
  });

  await page.route("**/api/dashboard", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: null,
        recentTrades: [],
        portfolioHistory: [],
        topHoldings: [],
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
      }),
    });
  });

  await page.route("**/api/games/insights**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ games: [] }),
    });
  });

  await page.goto("/player/player_404", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Player Not Found")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/$/);
});

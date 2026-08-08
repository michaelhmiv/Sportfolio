import { expect, test, type Page } from "@playwright/test";


const players = [
  {
    id: "p-nba-1",
    firstName: "Jalen",
    lastName: "North",
    team: "NYK",
    position: "PG",
    sport: "NBA",
    isActive: true,
  },
  {
    id: "p-nba-2",
    firstName: "Marcus",
    lastName: "Vale",
    team: "BOS",
    position: "SG",
    sport: "NBA",
    isActive: true,
  },
  {
    id: "p-nfl-1",
    firstName: "Rico",
    lastName: "Lane",
    team: "BUF",
    position: "WR",
    sport: "NFL",
    isActive: true,
  },
  {
    id: "p-nfl-2",
    firstName: "Troy",
    lastName: "Mills",
    team: "KC",
    position: "QB",
    sport: "NFL",
    isActive: true,
  },
];

const analyticsPayload = {
  marketHealth: {
    transactions: 1280,
    transactionChange: 8.3,
    volume: 218500,
    volumeChange: 6.8,
    marketCap: 1480000,
    marketCapChange: 12.5,
    sharesMined: 9600,
    sharesBurned: 2400,
    totalShares: 51200,
    periodSharesMined: 840,
    periodSharesBurned: 120,
    timeSeries: [],
    shareEconomyTimeSeries: [],
  },
  powerRankings: [
    {
      rank: 1,
      player: {
        id: "p-nba-1",
        firstName: "Jalen",
        lastName: "North",
        team: "NYK",
        position: "PG",
        lastTradePrice: "12.50",
        volume24h: 3500,
        priceChange24h: "6.5",
      },
      compositeScore: 92.4,
      priceChange7d: 9.2,
      avgFantasyPoints: 39.4,
    },
    {
      rank: 2,
      player: {
        id: "p-nba-2",
        firstName: "Marcus",
        lastName: "Vale",
        team: "BOS",
        position: "SG",
        lastTradePrice: "10.10",
        volume24h: 3100,
        priceChange24h: "4.1",
      },
      compositeScore: 88.1,
      priceChange7d: 5.8,
      avgFantasyPoints: 35.1,
    },
    {
      rank: 3,
      player: {
        id: "p-nfl-1",
        firstName: "Rico",
        lastName: "Lane",
        team: "BUF",
        position: "WR",
        lastTradePrice: "8.10",
        volume24h: 2200,
        priceChange24h: "3.2",
      },
      compositeScore: 80.2,
      priceChange7d: 4.9,
      avgFantasyPoints: 24.6,
    },
    {
      rank: 4,
      player: {
        id: "p-nfl-2",
        firstName: "Troy",
        lastName: "Mills",
        team: "KC",
        position: "QB",
        lastTradePrice: "14.00",
        volume24h: 2050,
        priceChange24h: "2.1",
      },
      compositeScore: 78.7,
      priceChange7d: 2.4,
      avgFantasyPoints: 22.2,
    },
  ],
  positionRankings: [
    {
      position: "PG",
      players: [
        {
          rank: 1,
          player: {
            id: "p-nba-1",
            firstName: "Jalen",
            lastName: "North",
            team: "NYK",
            position: "PG",
            lastTradePrice: "12.50",
            volume24h: 3500,
            priceChange24h: "6.5",
          },
          avgFantasyPoints: 39.4,
          priceChange7d: 9.2,
        },
      ],
    },
    {
      position: "SG",
      players: [
        {
          rank: 1,
          player: {
            id: "p-nba-2",
            firstName: "Marcus",
            lastName: "Vale",
            team: "BOS",
            position: "SG",
            lastTradePrice: "10.10",
            volume24h: 3100,
            priceChange24h: "4.1",
          },
          avgFantasyPoints: 35.1,
          priceChange7d: 5.8,
        },
      ],
    },
  ],
  sportBreakdown: [
    {
      sport: "NBA",
      totalPlayers: 2,
      activePlayers: 2,
      totalVolume24h: 6600,
      totalMarketCap: 420000,
      avgPriceChange24h: 5.3,
      tradesInRange: 840,
      tradedVolumeInRange: 115000,
    },
    {
      sport: "NFL",
      totalPlayers: 2,
      activePlayers: 2,
      totalVolume24h: 4250,
      totalMarketCap: 360000,
      avgPriceChange24h: 2.9,
      tradesInRange: 610,
      tradedVolumeInRange: 90500,
    },
  ],
  marketStats: {
    totalVolume24h: 218500,
    totalTrades24h: 1280,
    avgPriceChange: 4.1,
    mostActiveTeam: "NYK",
  },
};

const snapshotsPayload = {
  timeRange: "30D",
  startDate: "2026-02-01T00:00:00.000Z",
  endDate: "2026-03-01T00:00:00.000Z",
  snapshots: [
    {
      date: "2026-02-24T00:00:00.000Z",
      marketCap: 1360000,
      transactions: 980,
      volume: 160000,
      sharesMined: 610,
      sharesBurned: 90,
      totalShares: 48600,
    },
    {
      date: "2026-02-25T00:00:00.000Z",
      marketCap: 1395000,
      transactions: 1040,
      volume: 171000,
      sharesMined: 680,
      sharesBurned: 100,
      totalShares: 49200,
    },
    {
      date: "2026-02-26T00:00:00.000Z",
      marketCap: 1420000,
      transactions: 1095,
      volume: 185000,
      sharesMined: 720,
      sharesBurned: 110,
      totalShares: 50000,
    },
    {
      date: "2026-02-27T00:00:00.000Z",
      marketCap: 1450000,
      transactions: 1170,
      volume: 199000,
      sharesMined: 790,
      sharesBurned: 118,
      totalShares: 50700,
    },
    {
      date: "2026-02-28T00:00:00.000Z",
      marketCap: 1480000,
      transactions: 1280,
      volume: 218500,
      sharesMined: 840,
      sharesBurned: 120,
      totalShares: 51200,
    },
  ],
};

const comparePlayers = {
  "p-nba-1": {
    id: "p-nba-1",
    name: "Jalen North",
    team: "NYK",
    position: "PG",
    shares: 1200,
    marketCap: 15000,
    price: 12.5,
    volume: 3500,
    priceChange24h: 6.5,
    boostUsagePercent: 21.4,
    timesUsedInBoosts: 18,
    ammVolume: 64000,
    ammTrades: 32,
    poolLiquidity: 98000,
    poolShares: 5100,
    ammVolumeHistory: [
      { timestamp: "2026-02-26T00:00:00.000Z", volume: 21000 },
      { timestamp: "2026-02-27T00:00:00.000Z", volume: 24000 },
      { timestamp: "2026-02-28T00:00:00.000Z", volume: 64000 },
    ],
  },
  "p-nba-2": {
    id: "p-nba-2",
    name: "Marcus Vale",
    team: "BOS",
    position: "SG",
    shares: 980,
    marketCap: 9900,
    price: 10.1,
    volume: 3100,
    priceChange24h: 4.1,
    boostUsagePercent: 17.1,
    timesUsedInBoosts: 13,
    ammVolume: 52000,
    ammTrades: 28,
    poolLiquidity: 87000,
    poolShares: 4600,
    ammVolumeHistory: [
      { timestamp: "2026-02-26T00:00:00.000Z", volume: 16000 },
      { timestamp: "2026-02-27T00:00:00.000Z", volume: 22000 },
      { timestamp: "2026-02-28T00:00:00.000Z", volume: 52000 },
    ],
  },
  "p-nfl-1": {
    id: "p-nfl-1",
    name: "Rico Lane",
    team: "BUF",
    position: "WR",
    shares: 850,
    marketCap: 6885,
    price: 8.1,
    volume: 2200,
    priceChange24h: 3.2,
    boostUsagePercent: 12.4,
    timesUsedInBoosts: 9,
    ammVolume: 41000,
    ammTrades: 21,
    poolLiquidity: 65000,
    poolShares: 4100,
    ammVolumeHistory: [
      { timestamp: "2026-02-26T00:00:00.000Z", volume: 12000 },
      { timestamp: "2026-02-27T00:00:00.000Z", volume: 18000 },
      { timestamp: "2026-02-28T00:00:00.000Z", volume: 41000 },
    ],
  },
};

const correlationsPayload = [
  {
    player1: "Jalen North",
    player1Id: "p-nba-1",
    player2: "Marcus Vale",
    player2Id: "p-nba-2",
    correlation: 0.84,
  },
  {
    player1: "Rico Lane",
    player1Id: "p-nfl-1",
    player2: "Troy Mills",
    player2Id: "p-nfl-2",
    correlation: 0.73,
  },
];

async function mockAnalyticsRoutes(page: Page) {
  await page.route(/.*\/api\/auth\/user(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unauthorized" }),
    });
  });

  await page.route("**/api/players", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ players }),
    });
  });

  await page.route(/.*\/api\/analytics\/snapshots(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshotsPayload),
    });
  });

  await page.route(/.*\/api\/analytics\/correlations(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(correlationsPayload),
    });
  });

  await page.route(/.*\/api\/analytics\/compare(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const playerIds = (url.searchParams.get("playerIds") || "").split(",").filter(Boolean);
    const selected = playerIds
      .map((playerId) => comparePlayers[playerId as keyof typeof comparePlayers])
      .filter(Boolean);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ players: selected }),
    });
  });

  await page.route(/.*\/api\/analytics(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(analyticsPayload),
    });
  });
}

test("analytics command center supports desktop drill-downs", async ({ page }) => {
  await mockAnalyticsRoutes(page);

  await page.goto("/analytics");

  await expect(page.getByTestId("text-analytics-title")).toBeVisible();
  await expect(page.getByTestId("text-pulse-heading")).toContainText("Market Cap");

  await page.getByTestId("button-metric-volume").click();
  await expect(page.getByTestId("text-pulse-heading")).toContainText("Volume");

  await page.getByTestId("button-sport-nba").click();
  await page.getByTestId("tab-leaders").click();
  await expect(page.getByTestId("button-spotlight-p-nba-1")).toBeVisible();
  await expect(page.getByText("Rico Lane")).toHaveCount(0);

  await page.getByTestId("tab-compare").click();
  await page.getByTestId("button-open-compare-search").click();
  await page.getByTestId("button-compare-result-p-nba-1").click();
  await page.getByTestId("button-open-compare-search").click();
  await page.getByTestId("button-compare-result-p-nba-2").click();
  await expect(page.getByTestId("chart-compare-radar")).toBeVisible();
  await expect(page.getByTestId("chart-amm-trend")).toBeVisible();

  await page.getByTestId("tab-relationships").click();
  await page.getByTestId("button-relationship-p-nba-1-p-nba-2").click();
  await expect(page.getByTestId("card-relationship-detail")).toContainText("Jalen North");
  await expect(page.getByTestId("card-relationship-detail")).toContainText("Marcus Vale");
});

test("analytics mobile layout keeps title and horizontal rails visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAnalyticsRoutes(page);

  await page.goto("/analytics");

  await expect(page.getByTestId("text-analytics-title")).toBeVisible();
  await expect(page.getByTestId("select-timerange")).toBeVisible();

  const sectionRailIsScrollable = await page
    .getByTestId("rail-section-tabs")
    .evaluate((node) => node.scrollWidth >= node.clientWidth);
  expect(sectionRailIsScrollable).toBe(true);

  const metricRailIsScrollable = await page
    .getByTestId("rail-metric-deck")
    .evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(metricRailIsScrollable).toBe(true);

  await page.getByTestId("button-metric-volume").click();
  await expect(page.getByTestId("text-pulse-heading")).toContainText("Volume");
});

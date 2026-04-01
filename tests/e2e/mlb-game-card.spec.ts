import { expect, test, type Page } from "@playwright/test";

const baseLeaders = {
  fantasy: null,
  shares: null,
  scouts: null,
};

const baseDashboard = {
  user: {
    balance: "1250.00",
    portfolioValue: "4800.00",
    netWorth: "6050.00",
    cashRank: 24,
    portfolioRank: 12,
    cashRankChange: null,
    portfolioRankChange: null,
    change24h: { amount: null, percent: null, rank: null },
    change7d: { amount: null, percent: null, rank: null },
    change30d: { amount: null, percent: null, rank: null },
  },
  recentTrades: [],
  portfolioHistory: [],
  topHoldings: [],
  boosts: {
    activeBoosts: 0,
    lockedBoosts: 0,
    processedBoosts: 0,
    totalBoosts: 0,
    slotsRemaining: 2,
    availableSlots: [2, 3],
    communityBoostCount: 0,
    userCommunityShares: 0,
    totalLivePayout: "0",
    totalProcessedPayout: "0",
  },
};

const emptyScouts = {
  assignments: [],
  totalScouts: 5,
  maxScouts: 5,
  remaining: 5,
  isPremium: false,
};

function buildUserContext(team: string, playerId: string, playerName: string, status: string) {
  return {
    eligibleCount: 1,
    topMultiplierPlayers: [
      {
        playerId,
        name: playerName,
        team,
        multiplier: 2,
        availableShares: 2,
        totalShares: 2,
        isBoosted: false,
      },
    ],
    ownedPlayers: [
      {
        playerId,
        name: playerName,
        team,
        multiplier: 2,
        availableShares: 2,
        totalShares: 2,
        isBoosted: false,
      },
    ],
    liveEarned: status === "scheduled" ? null : 18.25,
    earningsStatus: status,
  };
}

function buildMlbPregame(overrides: Record<string, unknown> = {}) {
  return {
    matchupSummary: "Pitching edge leans toward the home side.",
    venue: "Fenway Park",
    gameNumber: 1,
    broadcasts: ["ESPN"],
    weatherSummary: "Clear | 68F | 7 mph, Out to LF",
    attendance: 40112,
    probablePitchers: {
      away: {
        name: "Corbin Burnes",
        note: null,
        team: "NYY",
      },
      home: {
        name: "Gerrit Cole",
        note: null,
        team: "BOS",
      },
    },
    probablePitcherStats: {
      away: {
        name: "Corbin Burnes",
        statYear: 2025,
        plateAppearances: 700,
        era: 3.14,
        xera: 3.28,
        woba: 0.271,
        expectedWoba: 0.279,
        battingAverage: 0.221,
        expectedBattingAverage: 0.229,
        slugging: 0.351,
        expectedSlugging: 0.366,
        summary: "3.14 ERA | 3.28 xERA | 0.279 xwOBA",
      },
      home: {
        name: "Gerrit Cole",
        statYear: 2025,
        plateAppearances: 688,
        era: 2.98,
        xera: 3.11,
        woba: 0.263,
        expectedWoba: 0.274,
        battingAverage: 0.214,
        expectedBattingAverage: 0.223,
        slugging: 0.333,
        expectedSlugging: 0.345,
        summary: "2.98 ERA | 3.11 xERA | 0.274 xwOBA",
      },
    },
    advancedStatsAvailable: true,
    statYear: 2025,
    doubleheader: false,
    lineupsPosted: true,
    startingLineups: {
      away: [
        {
          slot: 1,
          playerId: "mlb_judge",
          name: "Aaron Judge",
          position: "RF",
          jerseyNumber: "99",
        },
        {
          slot: 2,
          playerId: "mlb_soto",
          name: "Juan Soto",
          position: "LF",
          jerseyNumber: "22",
        },
      ],
      home: [
        {
          slot: 1,
          playerId: "mlb_duran",
          name: "Jarren Duran",
          position: "CF",
          jerseyNumber: "16",
        },
        {
          slot: 2,
          playerId: "mlb_devers",
          name: "Rafael Devers",
          position: "3B",
          jerseyNumber: "11",
        },
      ],
    },
    hitterSpotlights: {
      away: [],
      home: [],
    },
    hitterMatchupNotes: {
      away: "NYY top order has power upside in this matchup.",
      home: "BOS can pressure early if Cole falls behind.",
    },
    lineupSignals: {
      away: "Pressure pockets early in the order.",
      home: "Balanced contact-heavy top six.",
    },
    teamContexts: {
      away: {
        record: "92-61",
        lastGameSummary: "Won 5-3 @ TOR on Mar 26",
        nextGameSummary: "Next Mar 28 @ BOS",
      },
      home: {
        record: "89-64",
        lastGameSummary: "Won 6-2 vs TB on Mar 26",
        nextGameSummary: "Next Mar 28 vs NYY",
      },
    },
    scoringPlays: [],
    gameState: null,
    ...overrides,
  };
}

function buildGame(params: {
  gameId: string;
  status: "scheduled" | "inprogress" | "completed";
  awayTeam: string;
  homeTeam: string;
  startTime: string;
  venue: string;
  homeScore?: number | null;
  awayScore?: number | null;
  mlbEnrichment: { state: "available" | "pending" | "unavailable"; message: string | null };
  mlbPregame: Record<string, unknown> | null;
}) {
  return {
    gameId: params.gameId,
    sport: "MLB",
    gameDay: "2026-03-27",
    status: params.status,
    startTime: params.startTime,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    homeScore: params.homeScore ?? null,
    awayScore: params.awayScore ?? null,
    venue: params.venue,
    leaders: baseLeaders,
    userContext: buildUserContext(params.awayTeam, "mlb_judge", "Aaron Judge", params.status),
    liveMarketStatus: params.status === "inprogress" ? "Top 5th" : null,
    mlbEnrichment: params.mlbEnrichment,
    mlbPregame: params.mlbPregame,
  };
}

function buildDetailResponse(game: Record<string, unknown>) {
  return {
    date: "2026-03-27",
    sport: "MLB",
    boostSlotsRemaining: 2,
    game,
    leaders: baseLeaders,
    topPlayers: {
      fantasy: [],
      shares: [],
      scouts: [],
    },
    injuries: [],
    userContext: game.userContext,
  };
}

async function mockAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("sportfolio_selected_sport", "MLB");
  });

  await page.route("**/api/auth/user?sync=true", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_mlb_e2e",
        email: "mlb-e2e@example.com",
        username: "mlb-e2e",
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
        id: "user_mlb_e2e",
        email: "mlb-e2e@example.com",
        username: "mlb-e2e",
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
        anonKey: "mlb-e2e",
        configVersion: "mlb-e2e",
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

async function mockDashboardScenario(
  page: Page,
  scenario: {
    game: Record<string, unknown>;
    detail: Record<string, unknown>;
    liveStats?: Record<string, unknown> | null;
  },
) {
  await mockAuth(page);

  await page.route("**/api/dashboard", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(baseDashboard),
    });
  });

  await page.route(/.*\/api\/daily-boosts\/eligible-all\?.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        eligiblePlayers: [],
        totalEligible: 0,
      }),
    });
  });

  await page.route(/.*\/api\/scouts$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(emptyScouts),
    });
  });

  await page.route(/.*\/api\/games\/insights\?.*sport=MLB.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        date: "2026-03-27",
        sport: "MLB",
        boostSlotsRemaining: 2,
        games: [scenario.game],
        slatePlayers: [],
      }),
    });
  });

  await page.route(/.*\/api\/games\/[^/]+\/insights\?.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(scenario.detail),
    });
  });

  await page.route(/.*\/api\/games\/[^/]+\/live-stats$/, async (route) => {
    if (!scenario.liveStats) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          gameId: String(scenario.game.gameId),
          status: String(scenario.game.status),
          homeTeam: String(scenario.game.homeTeam),
          awayTeam: String(scenario.game.awayTeam),
          homeScore: scenario.game.homeScore ?? 0,
          awayScore: scenario.game.awayScore ?? 0,
          homePlayers: [],
          awayPlayers: [],
          homeTopPerformers: [],
          awayTopPerformers: [],
          userEarnings: null,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(scenario.liveStats),
    });
  });

  await page.route(/.*\/api\/games\/[^/]+\/stats$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        gameId: String(scenario.game.gameId),
        homeTeam: { players: [], totals: null },
        awayTeam: { players: [], totals: null },
        topPerformers: null,
      }),
    });
  });
}

function getGamesTableRow(page: Page, matchupKey: string) {
  return page.getByRole("button", { name: new RegExp(`\\b${matchupKey}\\b`, "i") });
}

async function openGameModal(page: Page, matchupKey: string) {
  const gameRow = getGamesTableRow(page, matchupKey);
  await expect(gameRow).toBeVisible();
  await gameRow.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("MLB game card", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("shows probable pitchers on the slate and lineup context in the scheduled MLB modal", async ({
    page,
  }) => {
    const mlbPregame = buildMlbPregame();
    const game = buildGame({
      gameId: "mlb_sched_1",
      status: "scheduled",
      awayTeam: "NYY",
      homeTeam: "BOS",
      startTime: "2026-03-28T23:15:00.000Z",
      venue: "Fenway Park",
      mlbEnrichment: { state: "available", message: null },
      mlbPregame,
    });

    await mockDashboardScenario(page, {
      game,
      detail: buildDetailResponse(game),
    });

    await page.goto("/");

    const gameRow = getGamesTableRow(page, "NYY@BOS");
    await expect(gameRow).toBeVisible();
    await expect(gameRow).toContainText("C. Burnes vs G. Cole");

    const dialog = await openGameModal(page, "NYY@BOS");

    await expect(dialog.getByText("Pregame box score")).toBeVisible();
    await expect(dialog.getByText("Corbin Burnes").first()).toBeVisible();
    await expect(dialog.getByText("Gerrit Cole").first()).toBeVisible();
    await expect(dialog.getByText("Starting lineups")).toBeVisible();
    await expect(dialog.getByText("Aaron Judge").first()).toBeVisible();
    await expect(dialog.getByText("Juan Soto").first()).toBeVisible();
    await expect(dialog.getByText("Fenway Park").first()).toBeVisible();
  });

  test("shows live MLB linescore, scoring summary, and Sportfolio angle content", async ({
    page,
  }) => {
    const mlbPregame = buildMlbPregame({
      venue: "Dodger Stadium",
      gameState: {
        detailedStatus: "In Progress",
        inningState: "Top",
        inningLabel: "Top 5th",
        countSummary: "2-1, 1 out",
        weatherSummary: "Clear | 71F",
        attendance: 51222,
        decisions: null,
        linescore: {
          innings: [
            { num: 1, away: 1, home: 0 },
            { num: 2, away: 0, home: 2 },
          ],
          totals: {
            awayRuns: 3,
            homeRuns: 4,
            awayHits: 6,
            homeHits: 8,
            awayErrors: 0,
            homeErrors: 1,
          },
        },
      },
      scoringPlays: [
        {
          inningLabel: "Top 4th",
          battingTeam: "ATL",
          event: "Single",
          description: "Austin Riley singles to left, scoring Ronald Acuna Jr.",
          scoreLabel: "3-2",
        },
      ],
    });
    const game = buildGame({
      gameId: "mlb_live_1",
      status: "inprogress",
      awayTeam: "ATL",
      homeTeam: "LAD",
      startTime: "2026-03-27T20:15:00.000Z",
      venue: "Dodger Stadium",
      awayScore: 3,
      homeScore: 4,
      mlbEnrichment: { state: "available", message: null },
      mlbPregame,
    });

    await mockDashboardScenario(page, {
      game,
      detail: buildDetailResponse(game),
      liveStats: {
        gameId: "mlb_live_1",
        status: "inprogress",
        homeTeam: "LAD",
        awayTeam: "ATL",
        homeScore: 4,
        awayScore: 3,
        homePlayers: [],
        awayPlayers: [],
        homeTopPerformers: [
          {
            name: "Mookie Betts",
            team: "LAD",
            pts: 18.4,
            hits: 2,
            runs: 1,
            rbi: 2,
          },
        ],
        awayTopPerformers: [
          {
            name: "Austin Riley",
            team: "ATL",
            pts: 16.2,
            hits: 2,
            runs: 1,
            rbi: 1,
          },
        ],
        userEarnings: {
          totalEstimatedEarnings: 18.25,
          ownedPlayers: [
            {
              playerId: "mlb_judge",
              name: "Aaron Judge",
              team: "ATL",
              quantity: 2,
              effectiveShares: 2,
              fantasyPoints: 14.8,
              estimatedEarnings: 18.25,
            },
          ],
        },
      },
    });

    await page.goto("/");

    const dialog = await openGameModal(page, "ATL@LAD");

    await expect(dialog.getByText("MLB Game State")).toBeVisible();
    await expect(dialog.getByText("Scoring summary")).toBeVisible();
    await expect(
      dialog.getByText("Austin Riley singles to left, scoring Ronald Acuna Jr."),
    ).toBeVisible();
    await expect(dialog.getByText("Your exposure")).toBeVisible();
    await expect(dialog.getByText("$18.25").first()).toBeVisible();
  });

  test("shows final MLB recap content for completed games", async ({ page }) => {
    const mlbPregame = buildMlbPregame({
      venue: "Oracle Park",
      gameState: {
        detailedStatus: "Final",
        inningState: null,
        inningLabel: null,
        countSummary: null,
        weatherSummary: "Clear | 61F",
        attendance: 39701,
        decisions: {
          winner: "Logan Webb",
          loser: "Joe Musgrove",
          save: "Camilo Doval",
        },
        linescore: {
          innings: [
            { num: 1, away: 0, home: 1 },
            { num: 2, away: 1, home: 0 },
          ],
          totals: {
            awayRuns: 2,
            homeRuns: 5,
            awayHits: 7,
            homeHits: 9,
            awayErrors: 1,
            homeErrors: 0,
          },
        },
      },
      scoringPlays: [
        {
          inningLabel: "Bottom 7th",
          battingTeam: "SF",
          event: "Home Run",
          description: "Matt Chapman homers to left, scoring two.",
          scoreLabel: "5-2",
        },
      ],
    });
    const game = buildGame({
      gameId: "mlb_final_1",
      status: "completed",
      awayTeam: "SD",
      homeTeam: "SF",
      startTime: "2026-03-27T19:15:00.000Z",
      venue: "Oracle Park",
      awayScore: 2,
      homeScore: 5,
      mlbEnrichment: { state: "available", message: null },
      mlbPregame,
    });

    await mockDashboardScenario(page, {
      game,
      detail: buildDetailResponse(game),
      liveStats: {
        gameId: "mlb_final_1",
        status: "completed",
        homeTeam: "SF",
        awayTeam: "SD",
        homeScore: 5,
        awayScore: 2,
        homePlayers: [],
        awayPlayers: [],
        homeTopPerformers: [
          {
            name: "Matt Chapman",
            team: "SF",
            pts: 21.3,
            hits: 2,
            runs: 2,
            rbi: 3,
          },
        ],
        awayTopPerformers: [],
        userEarnings: {
          totalEstimatedEarnings: 24.1,
          ownedPlayers: [
            {
              playerId: "mlb_judge",
              name: "Aaron Judge",
              team: "SF",
              quantity: 2,
              effectiveShares: 2,
              fantasyPoints: 17.2,
              estimatedEarnings: 24.1,
            },
          ],
        },
      },
    });

    await page.goto("/");

    const dialog = await openGameModal(page, "SD@SF");

    await expect(dialog.getByText("Final Linescore")).toBeVisible();
    await expect(dialog.getByText("Final Fantasy Leaders")).toBeVisible();
    await expect(dialog.getByText("Final Share Check")).toBeVisible();
    await expect(dialog.getByText("Matt Chapman homers to left, scoring two.")).toBeVisible();
    await expect(dialog.getByText("$24.10").first()).toBeVisible();
  });

  test("shows basic game info without error card when game details are unavailable", async ({
    page,
  }) => {
    const game = buildGame({
      gameId: "mlb_unavailable_1",
      status: "scheduled",
      awayTeam: "CHC",
      homeTeam: "MIL",
      startTime: "2026-03-28T23:40:00.000Z",
      venue: "American Family Field",
      mlbEnrichment: {
        state: "unavailable",
        message: "Game details are not available in this environment.",
      },
      mlbPregame: null,
    });

    await mockDashboardScenario(page, {
      game,
      detail: buildDetailResponse(game),
    });

    await page.goto("/");

    const gameRow = getGamesTableRow(page, "CHC@MIL");
    await expect(gameRow).toBeVisible();
    // Should NOT show "MLB unavailable" on the slate row
    await expect(gameRow).not.toContainText("MLB unavailable");

    const dialog = await openGameModal(page, "CHC@MIL");

    // Should show the standard game modal content (leaders, team rosters)
    await expect(dialog.getByText("CHC @ MIL")).toBeVisible();
    await expect(dialog.getByText("FP Leader")).toBeVisible();

    // Should NOT show the old enrichment error card
    await expect(dialog.getByText("Game-center updates are unavailable.")).not.toBeVisible();
    await expect(
      dialog.getByText("Game details are not available in this environment."),
    ).not.toBeVisible();
  });
});

import { test, expect, type Locator, type Page, type Route, devices } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function mockAgentShell(page: Page) {
  await page.addInitScript(() => {
    (window as Window & { __PLAYWRIGHT_AGENT_E2E__?: boolean }).__PLAYWRIGHT_AGENT_E2E__ = true;
  });

  const now = "2026-03-18T12:00:00.000Z";
  const postedMessages: Array<{ threadId: string; message: string }> = [];
  const threads = [
    {
      id: "thread_existing",
      title: "Morning portfolio check-in",
      channel: "in_app",
      domain: "sportfolio",
      workspace: "chat",
      strategyId: null,
      status: "ready",
      lastMessageAt: now,
      updatedAt: now,
      createdAt: now,
      lastMessagePreview: "Review my setup for today.",
      pendingActionBundle: null,
    },
  ];

  const longMessages = Array.from({ length: 40 }, (_, index) => {
    const isUserMessage = index % 2 === 0;
    const isFormattedAssistantMessage = index === 39;

    return {
      id: `msg_${index + 1}`,
      role: isUserMessage ? "user" : "assistant",
      messageType: "chat",
      contentText: isUserMessage
        ? `User update ${index + 1}: keep checking my portfolio and walk me through the setup.`
        : isFormattedAssistantMessage
          ? [
              "Hermes reply 40: here is the latest context for your setup and what still matters.",
              "",
              "| Rank | Player | Team | AVG |",
              "| --- | --- | --- | --- |",
              "| 1 | [Mookie Betts](/player/player_3) | LAD | .338 |",
              "| 2 | [Juan Soto](/player/player_2) | NYM | .333 |",
            ].join("\n")
          : `Hermes reply ${index + 1}: here is the latest context for your setup and what still matters.`,
      createdAt: now,
      runId: null,
      actionBundle: null,
      citations: [],
      pendingClarification: null,
      toolTrace: [],
      skillsUsed: [],
      memoryInfluences: [],
      confirmationPreview: null,
      uiBlocks: isFormattedAssistantMessage
        ? [
            {
              type: "stat_highlight_strip",
              priority: 10,
              props: {
                title: "League leaders",
                items: [
                  {
                    label: "Leader",
                    value: "Aaron Judge",
                    helper: "Highest batting average right now",
                  },
                  {
                    label: "AVG",
                    value: ".341",
                  },
                ],
              },
            },
            {
              type: "leaderboard_table",
              priority: 20,
              props: {
                title: "Top batting averages",
                statLabel: "AVG",
                leaders: [
                  {
                    id: "leader_1",
                    rank: 1,
                    playerName: "Aaron Judge",
                    playerId: "player_1",
                    team: "NYY",
                    primaryValue: ".341",
                  },
                  {
                    id: "leader_2",
                    rank: 2,
                    playerName: "Freddie Freeman",
                    playerId: "player_4",
                    team: "LAD",
                    primaryValue: ".339",
                  },
                ],
              },
            },
          ]
        : [],
      generatedBy: isUserMessage ? "user" : "assistant",
      scheduleJobType: null,
    };
  });

  const continuity = {
    headline: "Hermes is carrying active strategy context forward.",
    summary:
      "Hermes should reason from ongoing operator state: 1 active strategy context, 0 waiting items, 1 scheduled follow-up, 1 fresh evidence update.",
    recentActions: [
      {
        id: "continuity_action_1",
        title: "Bought John Doe",
        summary: "Deployed $12.00 into John Doe earlier in the week.",
        createdAt: now,
        source: "strategy_run",
      },
    ],
    openLoops: [
      {
        id: "continuity_loop_1",
        title: "Daily Movers wakes again soon",
        summary: "Hermes has another scheduled evaluation coming up for the saved mover plan.",
        status: "scheduled",
        dueAt: now,
        source: "strategy",
      },
    ],
    activeStrategies: [
      {
        strategyId: "strategy_1",
        name: "Daily Movers",
        status: "live",
        nextRunAt: now,
        lastOutcomeSummary: "Reviewed the morning board and held the current plan.",
      },
    ],
    evidenceUpdates: [
      {
        id: "continuity_evidence_1",
        title: "Market momentum board",
        summary: "The morning movers remain concentrated in a narrow group.",
        createdAt: now,
        sourceName: "Internal board",
      },
    ],
  };

  const runtimeDetails = {
    activeObjective: {
      title: "Review today's setup before lock",
      status: "tracking",
      summary:
        "Hermes is watching the highest-signal changes and waiting for your next instruction.",
      nextStep: "Ask for a trade plan or save this workflow as a strategy.",
      source: "assistant_run",
      updatedAt: now,
      runId: "run_1",
    },
    sinceLastUserMessage: {
      anchorAt: now,
      eventCount: 2,
      headline: "Hermes has 2 updates since your last check-in.",
      items: [
        {
          id: "delta_1",
          title: "Latest slate review completed",
          createdAt: now,
          type: "assistant_run",
        },
      ],
    },
    continuity,
    timeline: [],
    researchSources: [
      {
        id: "source_1",
        title: "Market momentum board",
        sourceName: "Internal board",
        url: "https://example.com/source",
        publishedAt: null,
        retrievedAt: now,
        factSummary: "The morning movers remain concentrated in a narrow group.",
        relevanceScore: 0.9,
      },
    ],
    schedules: [],
    capabilityGroups: [],
    isolation: {
      gameplayOnly: true,
      codebaseAccess: false,
      arbitraryDatabaseAccess: false,
      genericFileAccess: false,
      adminAccess: false,
      riskyMutationsRequireConfirmation: true,
    },
  };

  const strategyMessagesByThread: Record<string, unknown[]> = {
    strategy_thread_1: [
      {
        id: "strategy_msg_1",
        role: "assistant",
        messageType: "chat",
        contentText:
          "This strategy already tracks the daily movers. Use this chat to tighten the schedule or change the rules.",
        createdAt: now,
        runId: null,
        actionBundle: null,
        citations: [],
        pendingClarification: null,
        toolTrace: [],
        skillsUsed: [],
        memoryInfluences: [],
        confirmationPreview: null,
        generatedBy: "assistant",
        scheduleJobType: null,
      },
    ],
  };
  const messagesByThread: Record<string, unknown[]> = {
    thread_existing: longMessages,
    ...strategyMessagesByThread,
  };

  const strategies = [
    {
      id: "strategy_1",
      userId: "user_agent_shell",
      sourceThreadId: "strategy_thread_1",
      conversationThreadId: "strategy_thread_1",
      name: "Daily Movers",
      summary:
        "Track the strongest movers every morning and review whether Hermes should buy or hold.",
      mandateText: "Focus on the strongest movers every morning and keep the rules tight.",
      normalizedRuleSheet: {
        timeline: {
          objective:
            "Track the strongest movers every morning and review whether Hermes should buy or hold.",
          currentStageId: "stage_1",
          stages: [
            {
              id: "stage_1",
              title: "Morning movers review",
              summary: "Hermes reviews the strongest movers before the main slate gets underway.",
              status: "active",
              actionScope: ["pool_buy", "pool_sell"],
              triggerPolicy: {
                kind: "recurring_cron",
                anchor: "daily_at_time",
                scheduleCron: "0 8 * * *",
                timezone: "America/New_York",
              },
            },
          ],
        },
      },
      timeline: {
        objective:
          "Track the strongest movers every morning and review whether Hermes should buy or hold.",
        currentStageId: "stage_1",
        stages: [
          {
            id: "stage_1",
            title: "Morning movers review",
            summary: "Hermes reviews the strongest movers before the main slate gets underway.",
            status: "active",
            actionScope: ["pool_buy", "pool_sell"],
            triggerPolicy: {
              kind: "recurring_cron",
              anchor: "daily_at_time",
              scheduleCron: "0 8 * * *",
              timezone: "America/New_York",
            },
          },
        ],
      },
      status: "live",
      scheduleCron: "0 8 * * *",
      eventSubscriptions: ["schedule"],
      allowedActionTypes: ["pool_buy", "pool_sell"],
      guardrails: {
        maxActionsPerRun: 1,
        maxActionsPerDay: 3,
      },
      linkedSkillId: null,
      lastOutcomeSummary: "Reviewed the morning board and held the current plan.",
      lastRunAt: now,
      nextRunAt: now,
      activatedAt: now,
      pausedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      recentRuns: [],
    },
  ];

  const strategyDetails: Record<string, unknown> = {
    strategy_1: {
      ...strategies[0],
      recentRuns: [
        {
          id: "strategy_run_1",
          strategyId: "strategy_1",
          userId: "user_agent_shell",
          threadId: "strategy_thread_1",
          hermesRunId: "run_1",
          runtimeSessionId: "session_1",
          runtimeTransport: "sidecar",
          runtimeEndpoint: "http://127.0.0.1:5050/internal/hermes/respond",
          runtimeCorrelationId: "corr-1",
          triggerSource: "strategy_schedule",
          status: "completed",
          outcomeSummary: "Reviewed the board and kept the current setup.",
          toolTrace: [],
          appliedActions: [],
          adaptationNotes: null,
          failureReason: null,
          createdAt: now,
          completedAt: now,
        },
      ],
      recentEvents: [
        {
          id: "strategy_event_1",
          strategyId: "strategy_1",
          userId: "user_agent_shell",
          strategyRunId: "strategy_run_1",
          eventType: "run_completed",
          status: "success",
          title: "Morning run completed",
          summary: "Hermes reviewed the latest mover board and kept the current setup.",
          eventKey: null,
          metadata: {},
          createdAt: now,
        },
      ],
      performance: {
        appliedRunCount: 1,
        completedRunCount: 1,
        blockedRunCount: 0,
        failedRunCount: 0,
        buyActionCount: 0,
        sellActionCount: 0,
        scoutActionCount: 0,
        watchlistActionCount: 0,
        boostActionCount: 0,
        estimatedSpentSb: 12,
        estimatedRealizedSb: 0,
        estimatedCurrentValueSb: 14,
        estimatedNetPnlSb: 2,
        openPositionCount: 1,
        openScoutTargetCount: 0,
        lastAppliedAt: now,
        positions: [
          {
            playerId: "player_1",
            playerName: "John Doe",
            team: "ATL",
            netShares: 2,
            estimatedCostBasis: 12,
            estimatedCurrentPrice: 7,
            estimatedCurrentValue: 14,
            estimatedUnrealizedPnl: 2,
          },
        ],
      },
      continuity,
    },
  };

  let createdStrategies = 1;

  const fulfillAuthUser = async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_agent_shell",
        email: "agent-shell@example.com",
        username: "agent-shell",
        hasSeenOnboarding: true,
        isPremium: false,
      }),
    });
  };

  await page.route("**/api/auth/user?sync=true", fulfillAuthUser);
  await page.route("**/api/auth/user", fulfillAuthUser);
  await page.route("**/api/auth/config**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "http://127.0.0.1:5000/mock-supabase",
        anonKey: "agent-shell-e2e",
        configVersion: "agent-shell-e2e",
      }),
    });
  });
  await page.route("**/mock-supabase/auth/v1/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: null, session: null }),
    });
  });

  const playerLookup: Record<
    string,
    {
      firstName: string;
      lastName: string;
      team: string;
      sport: string;
      battingAverage: string;
    }
  > = {
    player_1: {
      firstName: "Aaron",
      lastName: "Judge",
      team: "NYY",
      sport: "MLB",
      battingAverage: ".341",
    },
    player_2: {
      firstName: "Juan",
      lastName: "Soto",
      team: "NYM",
      sport: "MLB",
      battingAverage: ".333",
    },
    player_3: {
      firstName: "Mookie",
      lastName: "Betts",
      team: "LAD",
      sport: "MLB",
      battingAverage: ".338",
    },
    player_4: {
      firstName: "Freddie",
      lastName: "Freeman",
      team: "LAD",
      sport: "MLB",
      battingAverage: ".339",
    },
  };

  await page.route(/.*\/api\/player\/[^/]+\/stats$/, async (route) => {
    const match = route
      .request()
      .url()
      .match(/\/api\/player\/([^/]+)\/stats$/);
    const playerId = match?.[1] || "player_1";
    const player = playerLookup[playerId] || playerLookup.player_1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        player: {
          id: playerId,
          firstName: player.firstName,
          lastName: player.lastName,
          sport: player.sport,
        },
        team: {
          abbreviation: player.team,
        },
        stats: {
          sport: player.sport,
          battingAverage: player.battingAverage,
          avgFantasyPointsPerGame: 18.4,
          gamesPlayed: 12,
          homeRuns: 4,
        },
      }),
    });
  });

  await page.route(/.*\/api\/player\/[^/]+\/recent-games$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        recentGames: [
          {
            game: {
              id: 1,
              date: now,
              opponent: "BOS",
              isHome: true,
            },
            stats: {
              hits: 2,
              runs: 1,
              runsBattedIn: 3,
              fantasyPoints: 18.4,
            },
          },
        ],
      }),
    });
  });

  await page.route(/.*\/api\/player\/[^/]+\/shares-info$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sharesInfo: {
          currentSharePrice: "12.40",
          marketCap: "1240",
          totalSharesOutstanding: 100,
          totalHolders: 28,
          volume24h: 1234,
          priceChange24h: "4.2",
        },
      }),
    });
  });

  await page.route(/.*\/api\/player\/[^/]+\/financials$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        valueIndex: 97,
        sentiment: {
          buyPressure: 61,
          totalVolume24h: 1234,
          trend: "bullish",
        },
        heatCheck: {
          l5Avg: 17.1,
          seasonAvg: 15.2,
          status: "fire",
        },
        marketCapRank: {
          tier: "blue_chip",
          percentile: 92,
        },
      }),
    });
  });

  await page.route("**/api/agent/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          enabled: true,
          providerMode: "managed",
          userPromptTemplate: "",
          defaultSport: "ALL",
          baseUrl: null,
          model: "gpt-test",
        },
        secret: {
          configured: false,
          keyLast4: null,
        },
        capabilities: {
          canAnalyze: true,
          canAutoExecute: true,
          canUseWebResearch: true,
          webResearchProvider: "brave",
        },
      }),
    });
  });

  await page.route("**/api/agent/threads?workspace=chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(threads),
    });
  });

  await page.route("**/api/agent/threads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    const newThread = {
      id: `thread_new_${threads.length + 1}`,
      title: null,
      channel: "in_app",
      domain: "sportfolio",
      workspace: "chat",
      strategyId: null,
      status: "ready",
      lastMessageAt: null,
      updatedAt: now,
      createdAt: now,
      lastMessagePreview: null,
      pendingActionBundle: null,
    };
    threads.unshift(newThread);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(newThread),
    });
  });

  await page.route(/.*\/api\/agent\/threads\/[^/]+\/messages$/, async (route) => {
    const match = route
      .request()
      .url()
      .match(/\/api\/agent\/threads\/([^/]+)\/messages$/);
    const threadId = match?.[1];
    if (!threadId) {
      await route.abort();
      return;
    }

    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { message?: string } | null;
      const message = String(body?.message || "");
      postedMessages.push({ threadId, message });
      const threadMessages = messagesByThread[threadId] || [];
      threadMessages.push({
        id: `posted_user_${postedMessages.length}`,
        role: "user",
        messageType: "chat",
        contentText: message,
        createdAt: now,
        runId: null,
        actionBundle: null,
        citations: [],
        pendingClarification: null,
        toolTrace: [],
        skillsUsed: [],
        memoryInfluences: [],
        confirmationPreview: null,
        generatedBy: "user",
        scheduleJobType: null,
      });
      threadMessages.push({
        id: `posted_assistant_${postedMessages.length}`,
        role: "assistant",
        messageType: "chat",
        contentText: `Hermes handled: ${message}`,
        createdAt: now,
        runId: null,
        actionBundle: null,
        citations: [],
        pendingClarification: null,
        toolTrace: [],
        skillsUsed: [],
        memoryInfluences: [],
        confirmationPreview: null,
        generatedBy: "assistant",
        scheduleJobType: null,
      });
      messagesByThread[threadId] = threadMessages;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          thread: {
            id: threadId,
          },
        }),
      });
      return;
    }

    const body = messagesByThread[threadId] || [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route(/.*\/api\/agent\/threads\/[^/]+\/runtime-details$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runtimeDetails),
    });
  });

  await page.route("**/api/agent/strategies", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(strategies),
      });
      return;
    }

    createdStrategies += 1;
    const strategyId = `strategy_${createdStrategies}`;
    const threadId = `strategy_thread_${createdStrategies}`;
    const strategySummary = {
      id: strategyId,
      userId: "user_agent_shell",
      sourceThreadId: threadId,
      conversationThreadId: threadId,
      name: `Strategy ${createdStrategies}`,
      summary: "A newly created strategy workspace.",
      mandateText: "Help me build a repeating strategy.",
      normalizedRuleSheet: {
        timeline: {
          objective: "A newly created strategy workspace.",
          currentStageId: "stage_1",
          stages: [
            {
              id: "stage_1",
              title: "Manual review",
              summary: "This draft still needs a saved trigger.",
              status: "pending",
              actionScope: [],
              triggerPolicy: {
                kind: "event_window",
                anchor: "day_close",
                timezone: "America/New_York",
              },
            },
          ],
        },
      },
      timeline: {
        objective: "A newly created strategy workspace.",
        currentStageId: "stage_1",
        stages: [
          {
            id: "stage_1",
            title: "Manual review",
            summary: "This draft still needs a saved trigger.",
            status: "pending",
            actionScope: [],
            triggerPolicy: {
              kind: "event_window",
              anchor: "day_close",
              timezone: "America/New_York",
            },
          },
        ],
      },
      status: "draft",
      scheduleCron: null,
      eventSubscriptions: ["schedule"],
      allowedActionTypes: [],
      guardrails: {
        maxActionsPerRun: 1,
        maxActionsPerDay: 3,
      },
      linkedSkillId: null,
      lastOutcomeSummary: null,
      lastRunAt: null,
      nextRunAt: null,
      activatedAt: null,
      pausedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      recentRuns: [],
    };

    strategies.push(strategySummary);
    strategyMessagesByThread[threadId] = [];
    messagesByThread[threadId] = strategyMessagesByThread[threadId];
    strategyDetails[strategyId] = {
      ...strategySummary,
      recentRuns: [],
      recentEvents: [],
      performance: {
        appliedRunCount: 0,
        completedRunCount: 0,
        blockedRunCount: 0,
        failedRunCount: 0,
        buyActionCount: 0,
        sellActionCount: 0,
        scoutActionCount: 0,
        watchlistActionCount: 0,
        boostActionCount: 0,
        estimatedSpentSb: 0,
        estimatedRealizedSb: 0,
        estimatedCurrentValueSb: 0,
        estimatedNetPnlSb: 0,
        openPositionCount: 0,
        openScoutTargetCount: 0,
        lastAppliedAt: null,
        positions: [],
      },
      continuity: {
        ...continuity,
        recentActions: [],
        openLoops: [],
        activeStrategies: [
          {
            strategyId,
            name: strategySummary.name,
            status: strategySummary.status,
            nextRunAt: strategySummary.nextRunAt,
            lastOutcomeSummary: null,
          },
        ],
      },
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(strategySummary),
    });
  });

  await page.route(/.*\/api\/agent\/strategies\/[^/]+$/, async (route) => {
    const match = route
      .request()
      .url()
      .match(/\/api\/agent\/strategies\/([^/]+)$/);
    const strategyId = match?.[1];
    if (!strategyId) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(strategyDetails[strategyId]),
    });
  });

  return {
    postedMessages,
  };
}

async function waitForAgentShell(page: Page) {
  await expect(getWorkspaceTab(page, "Chat")).toBeVisible({ timeout: 30000 });
  await expect(getWorkspaceTab(page, "Strategies")).toBeVisible({ timeout: 30000 });
}

function getWorkspaceTab(page: Page, name: "Chat" | "Strategies") {
  return page.getByTestId(name === "Chat" ? "agent-workspace-chat" : "agent-workspace-strategies");
}

async function getScrollMetrics(locator: Locator) {
  return locator.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop: node.scrollTop,
  }));
}

test("desktop shows clean Chat and Strategies tabs and the chat scrolls fully", async ({
  page,
}) => {
  await mockAgentShell(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/agent", { waitUntil: "domcontentloaded" });
  await waitForAgentShell(page);

  await expect(getWorkspaceTab(page, "Chat")).toBeVisible();
  await expect(getWorkspaceTab(page, "Strategies")).toBeVisible();
  await getWorkspaceTab(page, "Chat").click();
  await expect(page.getByRole("tab", { name: "Mission" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Thread" })).toHaveCount(0);
  await expect(page.getByText("Review today's setup before lock")).toBeVisible();

  const chatScroll = page.getByTestId("agent-chat-scroll");
  const bottomMessage = page.getByText("Hermes reply 40:", { exact: false });

  await chatScroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(bottomMessage).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("mobile chat keeps the final messages above the bottom edge", async ({ browser }) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: "http://127.0.0.1:5000",
  });
  const page = await context.newPage();

  await mockAgentShell(page);

  await page.goto("/agent", { waitUntil: "domcontentloaded" });
  await waitForAgentShell(page);
  await getWorkspaceTab(page, "Chat").click();

  const chatScroll = page.getByTestId("agent-chat-scroll");
  const bottomMessage = page.getByText("Hermes reply 40:", { exact: false });
  const composerInput = page.getByTestId("agent-composer-input").first();
  const composerSendButton = page.getByTestId("agent-composer-send").first();

  await chatScroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(bottomMessage).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const composerBounds = await composerSendButton.boundingBox();
  const viewportHeight = page.viewportSize()?.height ?? 844;
  expect(composerBounds?.y ?? 0).toBeGreaterThan(0);
  expect((composerBounds?.y ?? 0) + (composerBounds?.height ?? 0)).toBeLessThanOrEqual(
    viewportHeight,
  );
  await composerInput.click();
  await composerInput.fill("Review my MLB setup for this week.");
  await expect(composerInput).toHaveValue("Review my MLB setup for this week.");

  await context.close();
});

test("mobile strategies keep the selected detail accessible and still allow slot navigation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: "http://127.0.0.1:5000",
  });
  const page = await context.newPage();

  await mockAgentShell(page);

  await page.goto("/agent", { waitUntil: "domcontentloaded" });
  await waitForAgentShell(page);

  await getWorkspaceTab(page, "Strategies").click();
  const strategyCommandCenter = page.locator('[data-testid="strategy-command-center"]:visible');
  await expect(strategyCommandCenter).toBeVisible();
  await expect(
    page.getByTestId("strategy-command-center-scroll").getByText("Strategy desk", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Agent" })).toBeVisible();

  const commandCenterScroll = page.locator(
    '[data-testid="strategy-command-center-scroll"]:visible',
  );
  await commandCenterScroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(page.getByRole("button", { name: /daily movers/i })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.getByRole("button", { name: /daily movers/i }).click();
  const strategyDetail = page.locator('[data-testid="strategy-detail"]:visible').first();
  await expect(strategyDetail).toBeVisible();
  await expect(strategyDetail.getByRole("tab", { name: "Overview" })).toBeVisible();
  await expect(strategyDetail.getByRole("tab", { name: "Chat" })).toBeVisible();
  await expect(strategyDetail.getByRole("tab", { name: "Rules" })).toBeVisible();

  await strategyDetail.getByRole("button", { name: /back to strategy slots/i }).click();
  await expect(strategyCommandCenter).toBeVisible();
  await expect(page.getByRole("button", { name: /daily movers/i })).toBeVisible();

  await page.getByRole("button", { name: /daily movers/i }).click();
  await expect(strategyDetail).toBeVisible();

  const overviewScroll = page.locator('[data-testid="strategy-overview-scroll"]:visible');
  await overviewScroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(
    strategyDetail.getByText("Strategy timeline", { exact: true }).first(),
  ).toBeVisible();
  await expect(strategyDetail.getByText("Continuous state", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await strategyDetail.getByRole("tab", { name: "Chat" }).click();
  await expect(page.locator('[data-testid="strategy-chat-scroll"]:visible').first()).toBeVisible();

  const strategyChatScroll = page.locator('[data-testid="strategy-chat-scroll"]:visible').first();
  const strategyComposerInput = page
    .locator('[data-testid="agent-composer-input"]:visible')
    .first();
  const strategyComposerSend = page.locator('[data-testid="agent-composer-send"]:visible').first();
  await strategyChatScroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await strategyComposerInput.click();
  await strategyComposerInput.fill("Tighten this strategy before the MLB slate.");
  await expect(strategyComposerInput).toHaveValue("Tighten this strategy before the MLB slate.");
  const strategyComposerBounds = await strategyComposerSend.boundingBox();
  const mobileViewportHeight = page.viewportSize()?.height ?? 844;
  expect(strategyComposerBounds?.y ?? 0).toBeGreaterThan(0);
  expect(
    (strategyComposerBounds?.y ?? 0) + (strategyComposerBounds?.height ?? 0),
  ).toBeLessThanOrEqual(mobileViewportHeight);
  await expect(
    strategyChatScroll.getByText("This strategy already tracks the daily movers.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await context.close();
});

test("creating a new strategy from an empty slot opens a dedicated strategy chat", async ({
  page,
}) => {
  await mockAgentShell(page);

  await page.goto("/agent", { waitUntil: "domcontentloaded" });
  await waitForAgentShell(page);

  await getWorkspaceTab(page, "Strategies").click();
  await page.getByRole("button", { name: "Create new" }).nth(0).click();

  const strategyDetail = page.locator('[data-testid="strategy-detail"]:visible').first();
  await expect(strategyDetail).toBeVisible();
  await expect(strategyDetail.getByRole("tab", { name: "Chat" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.locator('[data-testid="strategy-chat-scroll"]:visible').first()).toBeVisible();
});

test("saving the current chat as a strategy opens the separate strategy workspace", async ({
  page,
}) => {
  await mockAgentShell(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agent", { waitUntil: "domcontentloaded" });
  await waitForAgentShell(page);

  await getWorkspaceTab(page, "Chat").click();
  await page.getByTestId("agent-shell-more-menu-trigger").click();
  await page.getByTestId("agent-shell-save-as-strategy-menu-item").click();

  const strategyDetail = page.locator('[data-testid="strategy-detail"]:visible').first();
  await expect(strategyDetail).toBeVisible();
  await expect(strategyDetail.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("chat renders formatted leaderboard output and opens player modal from structured rows", async ({
  page,
}) => {
  await mockAgentShell(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agent", { waitUntil: "domcontentloaded" });
  await waitForAgentShell(page);
  await getWorkspaceTab(page, "Chat").click();

  const chatScroll = page.getByTestId("agent-chat-scroll");
  await chatScroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });

  const leaderboard = page.locator('[data-testid="agent-ui-leaderboard-table"]:visible').last();
  await expect(leaderboard).toBeVisible();
  await expect(leaderboard).toContainText("Aaron Judge");
  await expect(leaderboard).toContainText("Freddie Freeman");
  await expect(page.getByText("Mookie Betts")).toHaveCount(0);

  await leaderboard.getByRole("button", { name: /Aaron Judge/i }).click();
  await expect(page.getByTestId("dialog-player-modal")).toBeVisible();
  await expect(page.getByTestId("text-player-modal-title")).toContainText("Aaron Judge");
});

test("slash commands auto-send standard prompts and keep /team insert-only", async ({ page }) => {
  const mock = await mockAgentShell(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/agent", { waitUntil: "domcontentloaded" });
  await waitForAgentShell(page);
  await getWorkspaceTab(page, "Chat").click();

  const composerInput = page.getByTestId("agent-composer-input").first();

  await composerInput.click();
  await composerInput.fill("/");
  await expect(page.getByRole("button", { name: /\/boost/i })).toBeVisible();

  await composerInput.press("ArrowDown");
  await composerInput.press("ArrowDown");
  await composerInput.press("ArrowDown");
  await composerInput.press("Enter");

  await expect.poll(() => mock.postedMessages.length).toBe(1);
  await expect
    .poll(() => mock.postedMessages[0]?.message)
    .toBe("Check my boost slots and recommend assignments.");
  await expect(
    page.getByText("Hermes handled: Check my boost slots and recommend assignments."),
  ).toBeVisible();

  await composerInput.fill("/team");
  await expect(page.getByRole("button", { name: /\/team/i })).toBeVisible();
  await composerInput.press("Enter");

  await expect.poll(() => mock.postedMessages.length).toBe(1);
  await expect(composerInput).toHaveValue("Show me the roster and upcoming games for ");
});

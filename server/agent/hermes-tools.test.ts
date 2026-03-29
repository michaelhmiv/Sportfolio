import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentCapabilities: vi.fn(),
  getScoutAgentProfile: vi.fn(),
  loadScoutAgentContext: vi.fn(),
  listAgentKnowledgeArticles: vi.fn(),
  getBuyQuote: vi.fn(),
  getLpPosition: vi.fn(),
  getOrCreatePool: vi.fn(),
  getSellQuote: vi.fn(),
  getUserLpPositions: vi.fn(),
  getZapAddQuoteSbOnly: vi.fn(),
  getZapAddQuoteSharesOnly: vi.fn(),
  buildHermesMemoryContext: vi.fn(),
  persistProposedMemoryWrites: vi.fn(),
  archiveUserAgentMemory: vi.fn(),
  cancelAgentThread: vi.fn(),
  confirmAgentThread: vi.fn(),
  createAgentThread: vi.fn(),
  getAgentThread: vi.fn(),
  listAgentThreadMessages: vi.fn(),
  sendAgentThreadMessage: vi.fn(),
  planDirectAgentOperation: vi.fn(),
  planHostedWebResearch: vi.fn(),
  storage: {
    getAvailableBalance: vi.fn(),
    getBoostPayoutHistory: vi.fn(),
    getCommunityBoostsAllSports: vi.fn(),
    getCommunityBoostsForDate: vi.fn(),
    getDailyGames: vi.fn(),
    getEligiblePlayersForBoost: vi.fn(),
    getFinancialMarketScanners: vi.fn(),
    getHoldingMultiplierState: vi.fn(),
    getLpTransactionHistory: vi.fn(),
    getMarketActivity: vi.fn(),
    getPlayer: vi.fn(),
    getPlayers: vi.fn(),
    getPlayerFinancialMetrics: vi.fn(),
    getPlayerRecentGamesFromLogs: vi.fn(),
    getPlayerSeasonStatsFromLogs: vi.fn(),
    getPortfolioSnapshotsInRange: vi.fn(),
    getUserCommunityBoostShares: vi.fn(),
    getUserHoldingsWithPlayers: vi.fn(),
    getWatchlistItems: vi.fn(),
    getWatchlists: vi.fn(),
    getPlayerWatchlists: vi.fn(),
    getDailyBoostsAllSports: vi.fn(),
    createWatchlist: vi.fn(),
    updateWatchlist: vi.fn(),
    deleteWatchlist: vi.fn(),
    addToWatchList: vi.fn(),
    removeFromWatchList: vi.fn(),
  },
  listAgentScheduleTemplates: vi.fn(),
  listUserAgentSchedules: vi.fn(),
  removeUserAgentSchedule: vi.fn(),
  upsertUserAgentSchedule: vi.fn(),
  archiveAgentSkill: vi.fn(),
  createOrUpdateUserSkill: vi.fn(),
  listAgentSkillCandidates: vi.fn(),
  listAvailableAgentSkills: vi.fn(),
  proposeGlobalSkillCandidate: vi.fn(),
  getInternalMlbMcpToolCatalog: vi.fn(),
  isInternalMlbMcpProjectedTool: vi.fn(),
  runInternalMlbMcpReadTool: vi.fn(),
}));

vi.mock("./service", () => ({
  getAgentCapabilities: mocks.getAgentCapabilities,
  getScoutAgentProfile: mocks.getScoutAgentProfile,
}));

vi.mock("./context-loader", () => ({
  loadScoutAgentContext: mocks.loadScoutAgentContext,
}));

vi.mock("../docs-service", () => ({
  listAgentKnowledgeArticles: mocks.listAgentKnowledgeArticles,
}));

vi.mock("../lib/time", () => ({
  getETDayBoundaries: () => ({
    startOfDay: new Date("2026-03-02T05:00:00.000Z"),
  }),
  getTodayET: () => "2026-03-02",
}));

vi.mock("../amm/pool", () => ({
  getBuyQuote: mocks.getBuyQuote,
  getLpPosition: mocks.getLpPosition,
  getOrCreatePool: mocks.getOrCreatePool,
  getSellQuote: mocks.getSellQuote,
  getUserLpPositions: mocks.getUserLpPositions,
  getZapAddQuoteSbOnly: mocks.getZapAddQuoteSbOnly,
  getZapAddQuoteSharesOnly: mocks.getZapAddQuoteSharesOnly,
}));

vi.mock("./memory", () => ({
  buildHermesMemoryContext: mocks.buildHermesMemoryContext,
  persistProposedMemoryWrites: mocks.persistProposedMemoryWrites,
  archiveUserAgentMemory: mocks.archiveUserAgentMemory,
}));

vi.mock("./thread-service", () => ({
  cancelAgentThread: mocks.cancelAgentThread,
  confirmAgentThread: mocks.confirmAgentThread,
  createAgentThread: mocks.createAgentThread,
  getAgentThread: mocks.getAgentThread,
  listAgentThreadMessages: mocks.listAgentThreadMessages,
  sendAgentThreadMessage: mocks.sendAgentThreadMessage,
}));

vi.mock("./operations-planner", () => ({
  planDirectAgentOperation: mocks.planDirectAgentOperation,
}));

vi.mock("./research", () => ({
  planHostedWebResearch: mocks.planHostedWebResearch,
}));

vi.mock("../storage", () => ({
  storage: mocks.storage,
}));

vi.mock("./schedules", () => ({
  listAgentScheduleTemplates: mocks.listAgentScheduleTemplates,
  listUserAgentSchedules: mocks.listUserAgentSchedules,
  removeUserAgentSchedule: mocks.removeUserAgentSchedule,
  upsertUserAgentSchedule: mocks.upsertUserAgentSchedule,
}));

vi.mock("./skills", () => ({
  archiveAgentSkill: mocks.archiveAgentSkill,
  createOrUpdateUserSkill: mocks.createOrUpdateUserSkill,
  listAgentSkillCandidates: mocks.listAgentSkillCandidates,
  listAvailableAgentSkills: mocks.listAvailableAgentSkills,
  proposeGlobalSkillCandidate: mocks.proposeGlobalSkillCandidate,
}));

vi.mock("./internal-mlb-mcp", () => ({
  getInternalMlbMcpToolCatalog: mocks.getInternalMlbMcpToolCatalog,
  isInternalMlbMcpProjectedTool: mocks.isInternalMlbMcpProjectedTool,
  runInternalMlbMcpReadTool: mocks.runInternalMlbMcpReadTool,
}));

import {
  runHermesActionTool,
  runHermesPlanTool,
  runHermesReadTool,
  runHermesScanTool,
} from "./hermes-tools";

describe("hermes-tools", () => {
  beforeEach(() => {
    for (const value of Object.values(mocks)) {
      if (typeof value === "function") {
        value.mockReset();
      }
    }
    for (const value of Object.values(mocks.storage)) {
      value.mockReset();
    }

    mocks.getScoutAgentProfile.mockResolvedValue({
      profile: {
        displayName: "Agent",
        internalMlbMcpEnabled: true,
      },
    });
    mocks.loadScoutAgentContext.mockResolvedValue({
      maxScouts: 5,
      remainingScouts: 2,
      defaultSport: "NBA",
      selectionWindow: {
        label: "Tonight",
        date: "2026-03-02",
        gameCount: 2,
        sportScope: ["NBA"],
      },
      recommendedTargets: [
        {
          playerId: "nba_1",
          name: "Jalen Brunson",
          sport: "NBA",
          score: 88,
          reason: "Strong form with a live window.",
        },
        {
          playerId: "nba_2",
          name: "Anthony Edwards",
          sport: "NBA",
          score: 79,
          reason: "Strong next-window setup.",
        },
      ],
      operatorOverview: {
        availableBalance: 314,
        portfolioPlayerCount: 2,
        totalPlayerShares: 6,
        stackedHoldingRows: 1,
        stackReadyHoldingRows: 1,
        watchlistCount: 1,
        watchlistEntryCount: 3,
        communitySharesAvailable: 1,
        activeDailyBoostSlots: 1,
        openDailyBoostSlots: 3,
        topHoldings: [],
        nextBestLevers: ["deploy idle balance", "fill an open boost slot"],
      },
    });
    mocks.storage.getWatchlists.mockResolvedValue([{ id: "watch_1" }]);
    mocks.storage.getPlayer.mockResolvedValue({
      id: "nba_1",
      firstName: "Jalen",
      lastName: "Brunson",
      marketCap: "500.00",
      lastTradePrice: "5.00",
    });
    mocks.storage.getPlayers.mockResolvedValue([
      {
        id: "nba_1",
        firstName: "Jalen",
        lastName: "Brunson",
        marketCap: "500.00",
        lastTradePrice: "5.00",
      },
    ]);
    mocks.storage.getDailyGames.mockResolvedValue([
      {
        gameId: "game_1",
        sport: "NBA",
        homeTeam: "NYK",
        awayTeam: "BOS",
        status: "scheduled",
        startTime: new Date("2026-03-03T00:30:00.000Z"),
      },
    ]);
    mocks.storage.getFinancialMarketScanners.mockResolvedValue({
      undervalued: [],
      premium: [],
      sentiment: [],
      momentum: [],
    });
    mocks.storage.getCommunityBoostsForDate.mockResolvedValue([]);
    mocks.listAvailableAgentSkills.mockResolvedValue([]);
    mocks.listAgentSkillCandidates.mockResolvedValue([]);
    mocks.getInternalMlbMcpToolCatalog.mockResolvedValue([]);
    mocks.isInternalMlbMcpProjectedTool.mockReturnValue(false);
    mocks.runInternalMlbMcpReadTool.mockReset();
  });

  it("materializes a native pool buy preview into a staged plan", async () => {
    mocks.storage.getAvailableBalance.mockResolvedValue(125);
    mocks.getOrCreatePool.mockResolvedValue({
      currentPrice: 4.5,
      lpSharesTotal: 100,
      shares: 200,
    });
    mocks.getBuyQuote.mockResolvedValue({
      sharesOut: 5.2,
      newPoolPrice: 4.8,
      effectivePrice: 4.62,
      slippagePercent: 0.03,
    });
    mocks.planDirectAgentOperation.mockResolvedValue({
      domain: "player_pools",
      requestMessage: "buy $24 of Jalen Brunson",
      replyText: "Queued the buy.",
      summary: "Buy Jalen Brunson",
      observations: ["Estimated fill prepared."],
      warnings: [],
      actions: [
        {
          actionType: "pool_buy",
          playerId: "nba_1",
          playerName: "Jalen Brunson",
          sbAmount: 24,
          reasoning: "Test plan",
          confidence: 0.9,
        },
      ],
      errorMessage: null,
      contextSnapshot: {},
      trace: {},
    });

    const result = (await runHermesPlanTool({
      toolName: "preview_pool_buy",
      userId: "user_1",
      args: {
        playerId: "nba_1",
        sbAmount: 24,
      },
    })) as any;

    expect(result.summary).toBe("Buy Jalen Brunson");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].actionType).toBe("pool_buy");
    expect(result.contextSnapshot.preview.afterState.estimatedSharesOut).toBe(5.2);
    expect(mocks.planDirectAgentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        message: "buy $24 of Jalen Brunson",
        profile: expect.objectContaining({
          displayName: "Agent",
        }),
      }),
    );
  });

  it("resolves a name-like playerId into a canonical player before building a buy preview", async () => {
    mocks.storage.getPlayer.mockResolvedValueOnce(null).mockResolvedValue({
      id: "nba_1",
      firstName: "Jalen",
      lastName: "Brunson",
      marketCap: "500.00",
      lastTradePrice: "5.00",
    });
    mocks.storage.getPlayers.mockResolvedValue([
      {
        id: "nba_1",
        firstName: "Jalen",
        lastName: "Brunson",
        marketCap: "500.00",
        lastTradePrice: "5.00",
      },
    ]);
    mocks.storage.getAvailableBalance.mockResolvedValue(125);
    mocks.getOrCreatePool.mockResolvedValue({
      currentPrice: 4.5,
      lpSharesTotal: 100,
      shares: 200,
    });
    mocks.getBuyQuote.mockResolvedValue({
      sharesOut: 5.2,
      newPoolPrice: 4.8,
      effectivePrice: 4.62,
      slippagePercent: 0.03,
    });
    mocks.planDirectAgentOperation.mockResolvedValue({
      domain: "player_pools",
      requestMessage: "buy $24 of Jalen Brunson",
      replyText: "Queued the buy.",
      summary: "Buy Jalen Brunson",
      observations: ["Estimated fill prepared."],
      warnings: [],
      actions: [],
      errorMessage: null,
      contextSnapshot: {},
      trace: {},
    });

    await runHermesPlanTool({
      toolName: "preview_pool_buy",
      userId: "user_1",
      args: {
        playerId: "Jalen Brunson",
        sbAmount: 24,
      },
    });

    expect(mocks.storage.getPlayers).toHaveBeenCalledWith({ search: "Jalen Brunson" });
    expect(mocks.planDirectAgentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        message: "buy $24 of Jalen Brunson",
        profile: expect.objectContaining({
          displayName: "Agent",
        }),
      }),
    );
  });

  it("prefers the resolved player name when building parser-backed preview messages", async () => {
    mocks.planDirectAgentOperation.mockResolvedValue({
      domain: "scouting",
      requestMessage: "set Jalen Brunson scouts to 3",
      replyText: "Queued the scout move.",
      summary: "Set Jalen Brunson scouts to 3",
      observations: [],
      warnings: [],
      actions: [],
      errorMessage: null,
      contextSnapshot: {},
      trace: {},
      pendingClarification: null,
    });

    await runHermesPlanTool({
      toolName: "preview_scout_adjustment",
      userId: "user_1",
      args: {
        playerId: "nba_1",
        targetCount: 3,
      },
    });

    expect(mocks.planDirectAgentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        message: "set Jalen Brunson scouts to 3",
        profile: expect.objectContaining({
          displayName: "Agent",
        }),
      }),
    );
  });

  it("returns watchlist items through the dedicated read tool", async () => {
    mocks.storage.getWatchlistItems.mockResolvedValue(["nba_1", "nba_2"]);

    const result = (await runHermesReadTool({
      toolName: "get_watchlist_items",
      userId: "user_1",
      args: {
        watchlistId: "watch_1",
      },
    })) as any;

    expect(result).toEqual({
      watchlistId: "watch_1",
      playerIds: ["nba_1", "nba_2"],
    });
  });

  it("merges projected internal MLB MCP tools into get_tool_catalog", async () => {
    mocks.getInternalMlbMcpToolCatalog.mockResolvedValue([
      {
        toolName: "mlb_mcp__home_run_leaders",
        category: "read",
        description: "Internal MLB leaderboard capability.",
        whenToUse: ["Need HR leaderboard context."],
        whenNotToUse: [],
        examplePrompts: ["who led mlb in home runs last year?"],
        requiresConfirmation: false,
        riskLevel: "low",
      },
    ]);

    const result = (await runHermesReadTool({
      toolName: "get_tool_catalog",
      userId: "user_1",
    })) as any[];
    const toolNames = result.map((entry) => entry.toolName);

    expect(toolNames).toContain("mlb_mcp__home_run_leaders");
    expect(toolNames).toContain("get_balance_state");
  });

  it("exposes team scan tools with the expected input contracts", async () => {
    const result = (await runHermesReadTool({
      toolName: "get_tool_catalog",
      userId: "user_1",
    })) as any[];

    const sportSlateTool = result.find((entry) => entry.toolName === "scan_sport_slate");
    const teamRosterTool = result.find((entry) => entry.toolName === "scan_team_roster");

    expect(sportSlateTool?.inputSchema).toMatchObject({
      properties: {
        sport: expect.any(Object),
        date: expect.any(Object),
        team: expect.any(Object),
      },
    });
    expect(teamRosterTool?.inputSchema).toMatchObject({
      required: ["team"],
      properties: {
        team: expect.any(Object),
        sport: expect.any(Object),
      },
    });
    expect(sportSlateTool?.presentationProfile).toBe("schedule");
    expect(sportSlateTool?.preferredColumns).toContain("venue");
    expect(teamRosterTool?.presentationProfile).toBe("leaderboard");
    expect(teamRosterTool?.primaryEntityType).toBe("player");
  });

  it("omits built-in MLB MCP tools from get_tool_catalog when the source is disabled", async () => {
    mocks.getScoutAgentProfile.mockResolvedValue({
      profile: {
        displayName: "Agent",
        internalMlbMcpEnabled: false,
      },
    });
    mocks.getInternalMlbMcpToolCatalog.mockResolvedValue([
      {
        toolName: "mlb_mcp__home_run_leaders",
        category: "read",
        description: "Internal MLB leaderboard capability.",
        whenToUse: ["Need HR leaderboard context."],
        whenNotToUse: [],
        examplePrompts: ["who led mlb in home runs last year?"],
        requiresConfirmation: false,
        riskLevel: "low",
      },
    ]);

    const result = (await runHermesReadTool({
      toolName: "get_tool_catalog",
      userId: "user_1",
    })) as any[];

    expect(result.map((entry) => entry.toolName)).not.toContain("mlb_mcp__home_run_leaders");
  });

  it("routes prefixed MLB MCP read tools through the internal provider bridge", async () => {
    mocks.isInternalMlbMcpProjectedTool.mockReturnValue(true);
    mocks.runInternalMlbMcpReadTool.mockResolvedValue({
      summary: "Loaded MLB data via home_run_leaders.",
      replyText: "Aaron Judge led MLB in home runs last season.",
      context: {
        provider: "internal_mlb_mcp",
      },
    });

    const result = (await runHermesReadTool({
      toolName: "mlb_mcp__home_run_leaders",
      userId: "user_1",
      args: {
        season: 2025,
      },
    })) as any;

    expect(mocks.runInternalMlbMcpReadTool).toHaveBeenCalledWith({
      toolName: "mlb_mcp__home_run_leaders",
      args: {
        season: 2025,
      },
    });
    expect(result.replyText).toContain("home runs");
  });

  it("scans daily boost candidates through the dedicated scan tool", async () => {
    mocks.getScoutAgentProfile.mockResolvedValue({
      profile: {
        displayName: "Agent",
        defaultSport: "NBA",
      },
    });
    mocks.storage.getEligiblePlayersForBoost.mockResolvedValue([
      {
        player: {
          id: "nba_1",
          firstName: "Jalen",
          lastName: "Brunson",
        },
        availableShares: 2,
        multiplier: "3.00",
        effectiveShares: "3.00",
        gameStartTime: new Date("2026-03-03T00:30:00.000Z"),
      },
    ]);
    mocks.storage.getDailyBoostsAllSports.mockResolvedValue([
      {
        slotTier: 5,
        playerId: "nba_9",
      },
    ]);

    const result = (await runHermesScanTool({
      toolName: "scan_daily_boost_candidates",
      userId: "user_1",
      args: {},
    })) as any;

    expect(result.toolName).toBe("scan_daily_boost_candidates");
    expect(result.replyText).toContain("open daily boost slot");
    expect(result.context.openSlots).toEqual([4, 3, 2]);
    expect(result.context.candidates[0].playerName).toBe("Jalen Brunson");
  });

  it("keeps idle-balance scans focused on cash deployment", async () => {
    const result = (await runHermesScanTool({
      toolName: "scan_idle_balance_options",
      userId: "user_1",
      args: {},
    })) as any;

    expect(mocks.loadScoutAgentContext).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        displayName: "Agent",
      }),
      {
        chatRequest: "what should i do with my idle balance?",
        sportOverride: null,
      },
    );
    expect(result.intentFocus).toBe("cash_deployment");
    expect(result.summary).toBe("Reviewed idle-balance deployment options.");
    expect(result.context.availableBalance).toBe(314);
    expect(result.context.recommendedTargets[0].name).toBe("Jalen Brunson");
    expect(result.replyText.toLowerCase()).not.toContain("scout");
    expect(result.replyText.toLowerCase()).not.toContain("community boost");
  });

  it("scans community boost candidates without falling back to the deterministic planner", async () => {
    mocks.storage.getUserCommunityBoostShares.mockResolvedValue(1);
    mocks.storage.getPlayers.mockResolvedValue([
      {
        id: "nba_1",
        firstName: "Jalen",
        lastName: "Brunson",
        sport: "NBA",
        team: "NYK",
        isActive: true,
      },
    ]);
    mocks.storage.getDailyGames.mockResolvedValue([
      {
        gameId: "game_community_1",
        sport: "NBA",
        homeTeam: "NYK",
        awayTeam: "BOS",
        status: "scheduled",
        startTime: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mocks.storage.getFinancialMarketScanners.mockResolvedValue({
      undervalued: [],
      premium: [],
      sentiment: [{ player: { id: "nba_1" } }],
      momentum: [{ player: { id: "nba_1" } }],
    });
    mocks.storage.getCommunityBoostsForDate.mockResolvedValue([]);

    const result = (await runHermesScanTool({
      toolName: "scan_community_boost_candidates",
      userId: "user_1",
      args: {
        sport: "NBA",
      },
    })) as any;

    expect(mocks.planDirectAgentOperation).not.toHaveBeenCalled();
    expect(result.summary.toLowerCase()).toContain("community boost");
    expect(result.context.communitySharesAvailable).toBe(1);
    expect(result.context.candidate).toMatchObject({
      playerId: "nba_1",
      playerName: "Jalen Brunson",
    });
  });

  it("creates a thread and stages an action bundle through the action tool", async () => {
    mocks.createAgentThread.mockResolvedValue({
      id: "thread_new",
    });
    mocks.sendAgentThreadMessage.mockResolvedValue({
      thread: {
        id: "thread_new",
      },
    });

    const result = (await runHermesActionTool({
      toolName: "stage_action_bundle",
      userId: "user_1",
      args: {
        message: "buy $10 of Jalen Brunson",
      },
    })) as any;

    expect(mocks.createAgentThread).toHaveBeenCalledTimes(1);
    expect(mocks.sendAgentThreadMessage).toHaveBeenCalledWith("user_1", "thread_new", {
      message: "buy $10 of Jalen Brunson",
    });
    expect(result.threadId).toBe("thread_new");
  });

  it("builds a multi-action bundle preview for chained stack shares and boost requests", async () => {
    mocks.planDirectAgentOperation
      .mockResolvedValueOnce({
        replyText: "Stack Shares Amen",
        summary: "Stack Shares Amen",
        warnings: [],
        observations: [],
        actions: [
          {
            actionType: "holdings_stack_shares",
            playerId: "nba_amen",
            playerName: "Amen Thompson",
            sharesToStack: 2,
            expectedMultiplierGained: 1,
            reasoning: "Stack Shares first",
          },
        ],
        trace: [],
      })
      .mockResolvedValueOnce({
        replyText: "Boost Amen",
        summary: "Boost Amen",
        warnings: [],
        observations: [],
        actions: [
          {
            actionType: "daily_boost_assign",
            playerId: "nba_amen",
            playerName: "Amen Thompson",
            slotTier: 4,
            boostDate: "2026-03-02",
            reasoning: "Boost next",
          },
        ],
        trace: [],
      });
    mocks.storage.getUserHoldingsWithPlayers.mockResolvedValue([
      {
        holding: {
          quantity: 4,
        },
        player: {
          id: "nba_amen",
          firstName: "Amen",
          lastName: "Thompson",
        },
        totalLocked: 0,
      },
    ]);

    const result = (await runHermesPlanTool({
      toolName: "preview_multi_action_bundle",
      userId: "user_1",
      args: {
        message: "stack shares Amen and then put him at 4x",
      },
    })) as any;

    expect(result.actions).toHaveLength(2);
    expect(result.generatedMessages).toEqual([
      "stack shares 4 Amen Thompson shares",
      "put Amen Thompson in my 4x boost slot today",
    ]);
  });

  it("does not reuse the previous player when an explicit boost target cannot be resolved", async () => {
    mocks.planDirectAgentOperation.mockResolvedValueOnce({
      replyText: "Stack Shares Amen",
      summary: "Stack Shares Amen",
      warnings: [],
      observations: [],
      actions: [
        {
          actionType: "holdings_stack_shares",
          playerId: "nba_amen",
          playerName: "Amen Thompson",
          sharesToStack: 2,
          expectedMultiplierGained: 1,
          reasoning: "Stack Shares first",
        },
      ],
      trace: [],
    });
    mocks.storage.getUserHoldingsWithPlayers.mockResolvedValue([
      {
        holding: {
          quantity: 4,
        },
        player: {
          id: "nba_amen",
          firstName: "Amen",
          lastName: "Thompson",
        },
        totalLocked: 0,
      },
    ]);

    const result = (await runHermesPlanTool({
      toolName: "preview_multi_action_bundle",
      userId: "user_1",
      args: {
        message: "stack shares Amen and then put unknown guy at 4x",
      },
    })) as any;

    expect(mocks.planDirectAgentOperation).toHaveBeenCalledTimes(1);
    expect(result.generatedMessages).toEqual(["stack shares 4 Amen Thompson shares"]);
    expect(result.warnings).toContain(
      'I could not find an unlocked holding for "unknown guy" to place in a boost slot.',
    );
  });

  it("upserts a user schedule through the action tool", async () => {
    mocks.upsertUserAgentSchedule.mockResolvedValue({
      id: "sched_1",
      jobType: "pre_lock_nudge",
    });

    const result = (await runHermesActionTool({
      toolName: "upsert_user_schedule",
      userId: "user_1",
      args: {
        jobType: "pre_lock_nudge",
        enabled: true,
        channelTargets: ["in_app", "sms"],
      },
    })) as any;

    expect(mocks.upsertUserAgentSchedule).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: "sched_1",
      jobType: "pre_lock_nudge",
    });
  });
});

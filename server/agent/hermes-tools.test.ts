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
    getEligiblePlayersForBoost: vi.fn(),
    getHoldingWithPowerLevel: vi.fn(),
    getLpTransactionHistory: vi.fn(),
    getMarketActivity: vi.fn(),
    getPlayer: vi.fn(),
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

import { runHermesActionTool, runHermesPlanTool, runHermesReadTool } from "./hermes-tools";

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
  });

  it("builds a native pool buy preview", async () => {
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

    const result = (await runHermesPlanTool({
      toolName: "preview_pool_buy",
      userId: "user_1",
      args: {
        playerId: "nba_1",
        sbAmount: 24,
      },
    })) as any;

    expect(result.supported).toBe(true);
    expect(result.canStage).toBe(true);
    expect(result.stageMessage).toContain("buy $24");
    expect(result.afterState.estimatedSharesOut).toBe(5.2);
    expect(mocks.planDirectAgentOperation).not.toHaveBeenCalled();
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

  it("reports contests as disabled through the read tool", async () => {
    const result = (await runHermesReadTool({
      toolName: "get_contests",
      userId: "user_1",
    })) as any;

    expect(result.supported).toBe(false);
    expect(result.reason).toContain("Contests");
  });
});

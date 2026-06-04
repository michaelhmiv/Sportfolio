import { beforeEach, describe, expect, it, vi } from "vitest";

const schedulerMocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  syncNascarStats: vi.fn(),
  createJobLog: vi.fn(),
  updateJobLog: vi.fn(),
}));

const defaultJobResult = {
  requestCount: 0,
  recordsProcessed: 0,
  errorCount: 0,
};

vi.mock("node-cron", () => ({
  schedule: schedulerMocks.schedule,
}));

vi.mock("../storage", () => ({
  storage: {
    createJobLog: schedulerMocks.createJobLog,
    updateJobLog: schedulerMocks.updateJobLog,
  },
}));

vi.mock("../lib/log-utility", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  createThrottledLogger: () => vi.fn(),
}));

vi.mock("./sync-roster", () => ({ syncRoster: vi.fn().mockResolvedValue(defaultJobResult) }));
vi.mock("./sync-schedule", () => ({ syncSchedule: vi.fn().mockResolvedValue(defaultJobResult) }));
vi.mock("./sync-stats", () => ({ syncStats: vi.fn().mockResolvedValue(defaultJobResult) }));
vi.mock("./sync-all-live-stats", () => ({
  syncAllLiveStats: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./sync-player-game-logs", () => ({
  syncPlayerGameLogs: vi.fn().mockResolvedValue(defaultJobResult),
}));

vi.mock("./scout-distribution", () => ({
  distributeScoutShares: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./daily-snapshot", () => ({ dailySnapshot: vi.fn().mockResolvedValue(defaultJobResult) }));
vi.mock("./weekly-roundup", () => ({
  generateWeeklyRoundup: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./market-snapshot", () => ({
  backfillMarketSnapshots: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./sync-nfl-schedule", () => ({
  syncNFLSchedule: vi.fn().mockResolvedValue({ gamesProcessed: 0, errors: [] }),
}));
vi.mock("./sync-nfl-stats", () => ({
  syncNFLStats: vi.fn().mockResolvedValue({ statsProcessed: 0, errors: [] }),
}));
vi.mock("./sync-nfl-roster", () => ({
  syncNFLRoster: vi.fn().mockResolvedValue({ playersAdded: 0, playersUpdated: 0, errors: [] }),
}));
vi.mock("./sync-mlb-schedule", () => ({
  syncMLBSchedule: vi.fn().mockResolvedValue({ gamesProcessed: 0, errors: [] }),
}));
vi.mock("./sync-mlb-stats", () => ({
  syncMLBStats: vi.fn().mockResolvedValue({ statsProcessed: 0, errors: [] }),
}));
vi.mock("./sync-mlb-roster", () => ({
  syncMLBRoster: vi.fn().mockResolvedValue({ playersAdded: 0, playersUpdated: 0, errors: [] }),
}));
vi.mock("./sync-nascar-roster", () => ({
  syncNascarRoster: vi.fn().mockResolvedValue(defaultJobResult),
  syncNascarActiveRoster: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./sync-nascar-schedule", () => ({
  syncNascarSchedule: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./sync-nascar-live", () => ({
  syncNascarLive: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./sync-nascar-stats", () => ({
  syncNascarStats: schedulerMocks.syncNascarStats,
}));
vi.mock("./sync-injuries", () => ({
  syncPlayerInjuries: vi.fn().mockResolvedValue({ synced: 0, cleared: 0 }),
}));
vi.mock("./fetch-news", () => ({
  fetchNews: vi.fn().mockResolvedValue({
    storiesProcessed: 0,
    success: true,
    stories: [],
    error: null,
  }),
}));
vi.mock("./discord-posting", () => ({
  postDiscordHourlyMarketDigest: vi.fn().mockResolvedValue(defaultJobResult),
  postDiscordNewsUpdates: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./compile-digest", () => ({
  compileAllDigests: vi.fn().mockResolvedValue({ usersProcessed: 0, errors: 0 }),
}));
vi.mock("./lock-boost-shares", () => ({
  lockBoostShares: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./settle-boosts", () => ({ settleBoosts: vi.fn().mockResolvedValue(defaultJobResult) }));
vi.mock("./settle-community-boosts", () => ({
  settleCommunityBoosts: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./snapshot-share-payouts", () => ({
  snapshotSharePayouts: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./settle-share-payouts", () => ({
  settleSharePayouts: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./notification-signals", () => ({
  runNotificationSignalDetectors: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./cleanup-job-logs", () => ({
  cleanupJobLogs: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./prune-price-history", () => ({
  prunePriceHistory: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./update-collections", () => ({
  updateCollectionsJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./check-milestones", () => ({ checkMilestonesJob: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./refresh-player-metrics", () => ({
  refreshPlayerMarketMetricsJob: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./refresh-player-volume-24h", () => ({
  refreshPlayerVolume24hJob: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("../bot/bot-engine", () => ({
  runBotEngineTick: vi.fn().mockResolvedValue({ botsProcessed: 0, errors: 0 }),
}));
vi.mock("../health/api-health-check", () => ({
  runApiHealthCheck: vi.fn().mockResolvedValue({}),
  toApiHealthJobResult: vi.fn().mockReturnValue(defaultJobResult),
}));
vi.mock("../agent/schedules", () => ({
  runDueUserAgentSchedules: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("../agent/strategy-runner", () => ({
  runDueUserAgentStrategies: vi.fn().mockResolvedValue(defaultJobResult),
  runTriggeredUserAgentStrategies: vi.fn().mockResolvedValue(defaultJobResult),
}));

describe("JobScheduler NASCAR stats registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    schedulerMocks.schedule.mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn(),
    }));
    schedulerMocks.syncNascarStats.mockResolvedValue({
      requestCount: 2,
      recordsProcessed: 78,
      errorCount: 0,
    });
    schedulerMocks.createJobLog.mockResolvedValue({ id: "job-log-1" });
    schedulerMocks.updateJobLog.mockResolvedValue(undefined);
  });

  it("includes nascar_stats_sync in available manual job names", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    expect(scheduler.getAvailableManualJobNames()).toContain("nascar_stats_sync");
  }, 20000);

  it("registers nascar_stats_sync in configured job names when API jobs initialize", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    await scheduler.initializeApiJobs();

    expect(scheduler.getConfiguredJobNames()).toContain("nascar_stats_sync");
  });

  it("routes manual nascar_stats_sync triggers through syncNascarStats", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    const result = await scheduler.triggerJob("nascar_stats_sync");

    expect(schedulerMocks.syncNascarStats).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      requestCount: 2,
      recordsProcessed: 78,
      errorCount: 0,
    });
  });
});

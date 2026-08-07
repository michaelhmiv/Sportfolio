import { beforeEach, describe, expect, it, vi } from "vitest";

const schedulerMocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  syncNascarStats: vi.fn(),
  syncNascarActiveRoster: vi.fn(),
  fetchNews: vi.fn(),
  syncMLBSchedule: vi.fn(),
  syncMLBStats: vi.fn(),
  syncMLBRoster: vi.fn(),
  updateCollectionsJob: vi.fn(),
  runBotEngineTick: vi.fn(),
  runApiHealthCheck: vi.fn(),
  toApiHealthJobResult: vi.fn(),
  createJobLog: vi.fn(),
  updateJobLog: vi.fn(),
  lockQuery: vi.fn(),
  lockRelease: vi.fn(),
  connect: vi.fn(),
}));

const defaultJobResult = {
  requestCount: 0,
  recordsProcessed: 0,
  errorCount: 0,
};

const expectedScheduledJobs = {
  scout_distribution: "0 * * * *",
  news_fetch: "0 * * * *",
  discord_hourly_market_digest: "0 * * * *",
  discord_news_post: "5 * * * *",
  bot_engine:
    process.env.BOT_ENGINE_SCHEDULE ||
    (process.env.NODE_ENV === "production" ? "*/15 * * * *" : "* * * * *"),
  lock_boost_shares: "0-59/5 * * * *",
  snapshot_share_payouts: "1-59/5 * * * *",
  settle_boosts: "5-59/10 * * * *",
  settle_share_payouts: "7-59/10 * * * *",
  settle_community_boosts: "9-59/10 * * * *",
  notification_signals: "*/15 * * * *",
  cleanup_job_logs: "0 2 * * 0",
  prune_price_history: "0 3 * * 0",
  api_health_check: "15 7 * * *",
  update_collections: "7-59/15 * * * *",
  check_milestones: "3-59/15 * * * *",
  refresh_player_metrics: "12-59/15 * * * *",
  refresh_player_volume_24h: "4-59/10 * * * *",
  stats_sync_live: "4-59/5 * * * *",
  mlb_roster_sync: "15 4 * * *",
  mlb_schedule_sync: "50 * * * *",
  nhl_live_stats_sync: "4-59/5 * * * *",
  nhl_schedule_sync: "50 * * * *",
  nhl_roster_sync: "20 4 * * *",
  nascar_roster_sync: "30 3 * * *",
  nascar_active_roster_sync: "0 4 * * *",
  nascar_schedule_sync: "45 3 * * *",
  nascar_stats_sync: "20 * * * *",
  nascar_live_sync: "*/5 * * * *",
} as const;

const expectedAdvertisedManualJobs = [
  "stats_sync_live",
  "backfill_market_snapshots",
  "scout_distribution",
  "news_fetch",
  "discord_hourly_market_digest",
  "discord_news_post",
  "lock_boost_shares",
  "snapshot_share_payouts",
  "settle_boosts",
  "settle_share_payouts",
  "settle_community_boosts",
  "notification_signals",
  "cleanup_job_logs",
  "prune_price_history",
  "update_collections",
  "check_milestones",
  "refresh_player_metrics",
  "refresh_player_volume_24h",
  "bot_engine",
  "api_health_check",
  "mlb_schedule_sync",
  "mlb_stats_sync",
  "mlb_roster_sync",
  "nhl_schedule_sync",
  "nhl_live_stats_sync",
  "nhl_roster_sync",
  "nascar_roster_sync",
  "nascar_schedule_sync",
  "nascar_stats_sync",
  "nascar_live_sync",
] as const;

vi.mock("node-cron", () => ({
  schedule: schedulerMocks.schedule,
}));

vi.mock("../storage", () => ({
  storage: {
    createJobLog: schedulerMocks.createJobLog,
    updateJobLog: schedulerMocks.updateJobLog,
  },
}));

vi.mock("../db", () => ({
  jobLockPool: { connect: schedulerMocks.connect },
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
  syncNFLSchedule: vi.fn().mockResolvedValue({ requestCount: 0, gamesProcessed: 0, errors: [] }),
}));
vi.mock("./sync-nfl-stats", () => ({
  syncNFLStats: vi.fn().mockResolvedValue({ statsProcessed: 0, errors: [] }),
}));
vi.mock("./sync-nfl-roster", () => ({
  syncNFLRoster: vi.fn().mockResolvedValue({ playersAdded: 0, playersUpdated: 0, errors: [] }),
}));
vi.mock("./sync-mlb-schedule", () => ({
  syncMLBSchedule: schedulerMocks.syncMLBSchedule,
}));
vi.mock("./sync-mlb-stats", () => ({
  syncMLBStats: schedulerMocks.syncMLBStats,
}));
vi.mock("./sync-mlb-roster", () => ({
  syncMLBRoster: schedulerMocks.syncMLBRoster,
}));
vi.mock("./sync-nhl-schedule", () => ({
  syncNhlSchedule: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./sync-nhl-stats", () => ({
  syncNhlStats: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./sync-nhl-roster", () => ({
  syncNhlRoster: vi.fn().mockResolvedValue({
    requestCount: 0,
    playersAdded: 0,
    playersUpdated: 0,
    errors: [],
  }),
}));
vi.mock("./sync-nascar-roster", () => ({
  syncNascarRoster: vi.fn().mockResolvedValue(defaultJobResult),
  syncNascarActiveRoster: schedulerMocks.syncNascarActiveRoster,
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
  fetchNews: schedulerMocks.fetchNews,
}));
vi.mock("./discord-posting", () => ({
  postDiscordHourlyMarketDigest: vi.fn().mockResolvedValue(defaultJobResult),
  postDiscordNewsUpdates: vi.fn().mockResolvedValue(defaultJobResult),
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
  updateCollectionsJob: schedulerMocks.updateCollectionsJob,
}));
vi.mock("./check-milestones", () => ({ checkMilestonesJob: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./refresh-player-metrics", () => ({
  refreshPlayerMarketMetricsJob: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("./refresh-player-volume-24h", () => ({
  refreshPlayerVolume24hJob: vi.fn().mockResolvedValue(defaultJobResult),
}));
vi.mock("../bot/bot-engine", () => ({
  runBotEngineTick: schedulerMocks.runBotEngineTick,
}));
vi.mock("../health/api-health-check", () => ({
  runApiHealthCheck: schedulerMocks.runApiHealthCheck,
  toApiHealthJobResult: schedulerMocks.toApiHealthJobResult,
}));

describe("JobScheduler registration and manual dispatch", () => {
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
    schedulerMocks.syncNascarActiveRoster.mockResolvedValue({
      requestCount: 3,
      recordsProcessed: 14,
      errorCount: 1,
    });
    schedulerMocks.fetchNews.mockResolvedValue({
      storiesProcessed: 4,
      success: false,
      stories: [{ id: "story-1" }],
      error: "partial source failure",
    });
    schedulerMocks.syncMLBSchedule.mockResolvedValue({
      gamesProcessed: 12,
      errors: ["schedule-error"],
    });
    schedulerMocks.syncMLBStats.mockResolvedValue({ statsProcessed: 34, errors: [] });
    schedulerMocks.syncMLBRoster.mockResolvedValue({
      playersAdded: 5,
      playersUpdated: 8,
      errors: ["roster-error"],
    });
    schedulerMocks.updateCollectionsJob.mockResolvedValue(undefined);
    schedulerMocks.runBotEngineTick.mockResolvedValue({ botsProcessed: 9, errors: 1 });
    schedulerMocks.runApiHealthCheck.mockResolvedValue({ status: "degraded" });
    schedulerMocks.toApiHealthJobResult.mockReturnValue({
      requestCount: 6,
      recordsProcessed: 5,
      errorCount: 1,
    });
    schedulerMocks.createJobLog.mockResolvedValue({ id: "job-log-1" });
    schedulerMocks.updateJobLog.mockResolvedValue(undefined);
    schedulerMocks.lockQuery.mockImplementation((statement: string) =>
      Promise.resolve({
        rows: [
          statement.includes("pg_try_advisory_lock") ? { acquired: true } : { unlocked: true },
        ],
      }),
    );
    schedulerMocks.connect.mockResolvedValue({
      query: schedulerMocks.lockQuery,
      release: schedulerMocks.lockRelease,
    });
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

  it("routes the registered NASCAR stats cron callback to its exact handler", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    await scheduler.initializeApiJobs();
    const statsScheduleCall = schedulerMocks.schedule.mock.calls.find(
      ([schedule]) => schedule === "20 * * * *",
    );

    expect(statsScheduleCall).toBeDefined();
    await statsScheduleCall?.[1]();
    expect(schedulerMocks.syncNascarStats).toHaveBeenCalledTimes(1);
  });

  it("preserves progress forwarding, suppression, and news compatibility fields", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();
    const progress = vi.fn();

    const newsResult = await scheduler.triggerJob("news_fetch", progress);
    await scheduler.triggerJob("nascar_stats_sync", progress);

    expect(schedulerMocks.fetchNews).toHaveBeenCalledWith(progress);
    expect(schedulerMocks.syncNascarStats).toHaveBeenCalledWith();
    expect(newsResult).toMatchObject({
      requestCount: 1,
      recordsProcessed: 4,
      errorCount: 1,
      stories: [{ id: "story-1" }],
      error: "partial source failure",
    });
  });

  it("preserves custom manual result adapters and fixed handler arguments", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    await expect(scheduler.triggerJob("mlb_schedule_sync")).resolves.toEqual({
      requestCount: 0,
      recordsProcessed: 12,
      errorCount: 1,
    });
    await expect(scheduler.triggerJob("mlb_stats_sync")).resolves.toEqual({
      requestCount: 0,
      recordsProcessed: 34,
      errorCount: 0,
    });
    await expect(scheduler.triggerJob("mlb_roster_sync")).resolves.toEqual({
      requestCount: 0,
      recordsProcessed: 13,
      errorCount: 1,
    });
    await expect(scheduler.triggerJob("nascar_active_roster_sync")).resolves.toEqual({
      requestCount: 3,
      recordsProcessed: 14,
      errorCount: 1,
    });
    expect(schedulerMocks.syncNascarActiveRoster).toHaveBeenCalledWith(14, 7);
  });

  it("preserves void, bot-engine, and API-health adapters", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    await expect(scheduler.triggerJob("update_collections")).resolves.toEqual(defaultJobResult);
    await expect(scheduler.triggerJob("bot_engine")).resolves.toEqual({
      requestCount: 1,
      recordsProcessed: 9,
      errorCount: 1,
    });
    await expect(scheduler.triggerJob("api_health_check")).resolves.toEqual({
      requestCount: 6,
      recordsProcessed: 5,
      errorCount: 1,
    });
    expect(schedulerMocks.updateCollectionsJob).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.runBotEngineTick).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.toApiHealthJobResult).toHaveBeenCalledWith({ status: "degraded" });
  });

  it("preserves every configured schedule and the ET cron timezone", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    await scheduler.initializeCoreJobs();
    await scheduler.initializeApiJobs();

    expect(
      scheduler
        .getConfiguredJobs()
        .map(({ name, schedule, enabled }) => ({ name, schedule, enabled })),
    ).toEqual(
      Object.entries(expectedScheduledJobs).map(([name, schedule]) => ({
        name,
        schedule,
        enabled: true,
      })),
    );
    expect(scheduler.getConfiguredJobs()).toHaveLength(29);
    expect(schedulerMocks.schedule).toHaveBeenCalledTimes(29);
    for (const [, , options] of schedulerMocks.schedule.mock.calls) {
      expect(options).toEqual({ timezone: "America/New_York" });
    }
  });

  it("preserves the exact advertised manual-job order", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    expect(scheduler.getAvailableManualJobNames()).toEqual(expectedAdvertisedManualJobs);
  });

  it("keeps all 30 retained manual dispatch handlers executable", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();
    const executableJobNames = [
      ...expectedAdvertisedManualJobs.filter((name) => name !== "backfill_market_snapshots"),
      "nascar_active_roster_sync",
    ];

    expect(executableJobNames).toHaveLength(30);
    for (const jobName of executableJobNames) {
      await expect(scheduler.triggerJob(jobName)).resolves.toMatchObject({
        requestCount: expect.any(Number),
        recordsProcessed: expect.any(Number),
        errorCount: expect.any(Number),
      });
    }
  });

  it("preserves the advertised backfill job as an unknown manual trigger", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    expect(scheduler.getAvailableManualJobNames()).toContain("backfill_market_snapshots");
    await expect(scheduler.triggerJob("backfill_market_snapshots")).rejects.toThrow(
      "Unknown job: backfill_market_snapshots",
    );
  });

  it("preserves nascar_active_roster_sync as triggerable but unadvertised", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    expect(scheduler.getAvailableManualJobNames()).not.toContain("nascar_active_roster_sync");
    await expect(scheduler.triggerJob("nascar_active_roster_sync")).resolves.toEqual({
      requestCount: 3,
      recordsProcessed: 14,
      errorCount: 1,
    });
  });

  it("defines every scheduler job exactly once in the canonical registry", async () => {
    const { jobDefinitions } = await import("./job-registry");
    const names = jobDefinitions.map((job) => job.name);

    expect(names).toHaveLength(31);
    expect(new Set(names).size).toBe(names.length);
    expect(jobDefinitions.filter((job) => job.schedule)).toHaveLength(29);
    expect(jobDefinitions.filter((job) => job.manualHandler)).toHaveLength(30);
    expect(jobDefinitions.filter((job) => job.advertiseManual)).toHaveLength(30);

    for (const group of ["core", "api"] as const) {
      const orders = jobDefinitions
        .filter((job) => job.group === group)
        .map((job) => job.scheduleOrder)
        .sort((left, right) => (left ?? -1) - (right ?? -1));
      expect(orders).toEqual(orders.map((_, index) => index));
    }

    const advertisedOrders = jobDefinitions
      .filter((job) => job.advertiseManual)
      .map((job) => job.manualOrder)
      .sort((left, right) => (left ?? -1) - (right ?? -1));
    expect(advertisedOrders).toEqual(advertisedOrders.map((_, index) => index));

    expect(jobDefinitions.find((job) => job.name === "backfill_market_snapshots")).toMatchObject({
      advertiseManual: true,
      manualHandler: undefined,
      schedule: undefined,
    });
    expect(jobDefinitions.find((job) => job.name === "nascar_active_roster_sync")).toMatchObject({
      advertiseManual: false,
    });
  });

  it("rejects incomplete scheduling metadata before a job can silently disappear", async () => {
    const { validateJobDefinitions } = await import("./job-registry");

    expect(() =>
      validateJobDefinitions([
        { name: "broken_schedule", group: "core", advertiseManual: false },
      ] as never),
    ).toThrow("Job broken_schedule has incomplete scheduling metadata");
  });

  it("rejects malformed runtime scheduling values", async () => {
    const { validateJobDefinitions } = await import("./job-registry");
    const validScheduledDefinition = {
      name: "runtime_candidate",
      group: "core",
      schedule: "0 * * * *",
      scheduleOrder: 0,
      enabled: true,
      scheduledHandler: vi.fn(),
      advertiseManual: false,
    };

    expect(() =>
      validateJobDefinitions([{ ...validScheduledDefinition, group: "worker" }] as never),
    ).toThrow("Job runtime_candidate has an invalid scheduling group");
    expect(() =>
      validateJobDefinitions([{ ...validScheduledDefinition, enabled: "yes" }] as never),
    ).toThrow("Job runtime_candidate has an invalid enabled flag");
    expect(() =>
      validateJobDefinitions([{ ...validScheduledDefinition, scheduledHandler: "run" }] as never),
    ).toThrow("Job runtime_candidate has an invalid scheduled handler");
  });

  it("rejects duplicate job names and ordering metadata", async () => {
    const { jobDefinitions, validateJobDefinitions } = await import("./job-registry");
    const duplicateName = [...jobDefinitions, jobDefinitions[0]];
    const duplicateManualOrder = jobDefinitions.map((job) =>
      job.manualOrder === 1 ? { ...job, manualOrder: 0 } : job,
    );

    expect(() => validateJobDefinitions(duplicateName)).toThrow(
      "Duplicate job name: scout_distribution",
    );
    expect(() => validateJobDefinitions(duplicateManualOrder)).toThrow(
      "Manual job order must be contiguous and unique",
    );
  });

  it("exports a runtime-immutable registry snapshot", async () => {
    const { jobDefinitions } = await import("./job-registry");

    expect(Object.isFrozen(jobDefinitions)).toBe(true);
    expect(jobDefinitions.every((job) => Object.isFrozen(job))).toBe(true);
  });

  it("preserves the unknown-job error contract", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    await expect(scheduler.triggerJob("not_a_job")).rejects.toThrow("Unknown job: not_a_job");
  });

  it("skips a scheduled run cleanly when another process holds its advisory lock", async () => {
    schedulerMocks.lockQuery.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    await scheduler.initializeApiJobs();
    const statsScheduleCall = schedulerMocks.schedule.mock.calls.find(
      ([schedule]) => schedule === "20 * * * *",
    );
    await statsScheduleCall?.[1]();

    expect(schedulerMocks.syncNascarStats).not.toHaveBeenCalled();
    expect(schedulerMocks.createJobLog).not.toHaveBeenCalled();
    expect(schedulerMocks.lockRelease).toHaveBeenCalledTimes(1);
  });

  it("returns the existing-compatible already-running error for manual lock contention", async () => {
    schedulerMocks.lockQuery.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    const result = scheduler.triggerJob("nascar_stats_sync");

    await expect(result).rejects.toMatchObject({
      message: "Job nascar_stats_sync is already running",
      statusCode: 409,
    });
    expect(schedulerMocks.syncNascarStats).not.toHaveBeenCalled();
    expect(schedulerMocks.createJobLog).not.toHaveBeenCalled();
  });

  it("keeps manual dispatch callable without scheduler initialization", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();

    await expect(scheduler.triggerJob("nascar_stats_sync")).resolves.toMatchObject({
      recordsProcessed: 78,
    });
    expect(schedulerMocks.schedule).not.toHaveBeenCalled();
  });
});
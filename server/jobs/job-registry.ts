import type { ProgressCallback } from "../lib/admin-stream";
import { runDueUserAgentSchedules } from "../agent/schedules";
import {
  runDueUserAgentStrategies,
  runTriggeredUserAgentStrategies,
} from "../agent/strategy-runner";
import { runBotEngineTick } from "../bot/bot-engine";
import { runApiHealthCheck, toApiHealthJobResult } from "../health/api-health-check";
import { checkMilestonesJob } from "./check-milestones";
import { cleanupJobLogs } from "./cleanup-job-logs";
import { compileAllDigests } from "./compile-digest";
import { postDiscordHourlyMarketDigest, postDiscordNewsUpdates } from "./discord-posting";
import { fetchNews } from "./fetch-news";
import { lockBoostShares } from "./lock-boost-shares";
import { runNotificationSignalDetectors } from "./notification-signals";
import { prunePriceHistory } from "./prune-price-history";
import { refreshPlayerMarketMetricsJob } from "./refresh-player-metrics";
import { refreshPlayerVolume24hJob } from "./refresh-player-volume-24h";
import { distributeScoutShares } from "./scout-distribution";
import { settleBoosts } from "./settle-boosts";
import { settleCommunityBoosts } from "./settle-community-boosts";
import { settleSharePayouts } from "./settle-share-payouts";
import { snapshotSharePayouts } from "./snapshot-share-payouts";
import { syncAllLiveStats } from "./sync-all-live-stats";
import { syncMLBRoster } from "./sync-mlb-roster";
import { syncMLBSchedule } from "./sync-mlb-schedule";
import { syncMLBStats } from "./sync-mlb-stats";
import { syncNascarLive } from "./sync-nascar-live";
import { syncNascarRoster, syncNascarActiveRoster } from "./sync-nascar-roster";
import { syncNascarSchedule } from "./sync-nascar-schedule";
import { syncNascarStats } from "./sync-nascar-stats";
import { syncNhlRoster } from "./sync-nhl-roster";
import { syncNhlSchedule } from "./sync-nhl-schedule";
import { syncNhlStats } from "./sync-nhl-stats";
import { updateCollectionsJob } from "./update-collections";
import type { JobResult } from "./types";

export type JobGroup = "core" | "api";
export type ScheduledJobHandler = () => Promise<JobResult>;
export type ManualJobHandler = (progressCallback?: ProgressCallback) => Promise<JobResult>;

interface JobDefinitionBase<Name extends string> {
  readonly name: Name;
}

interface ScheduledCapability {
  readonly group: JobGroup;
  readonly schedule: string;
  readonly scheduleOrder: number;
  readonly enabled: boolean;
  readonly scheduledHandler: ScheduledJobHandler;
}

interface UnscheduledCapability {
  readonly group?: undefined;
  readonly schedule?: undefined;
  readonly scheduleOrder?: undefined;
  readonly enabled?: undefined;
  readonly scheduledHandler?: undefined;
}

type ManualCapability =
  | {
      readonly advertiseManual: true;
      readonly manualOrder: number;
      readonly manualHandler?: ManualJobHandler;
    }
  | {
      readonly advertiseManual: false;
      readonly manualOrder?: undefined;
      readonly manualHandler: ManualJobHandler;
    }
  | {
      readonly advertiseManual: false;
      readonly manualOrder?: undefined;
      readonly manualHandler?: undefined;
    };

export type JobDefinition<Name extends string = string> = JobDefinitionBase<Name> &
  (ScheduledCapability | UnscheduledCapability) &
  ManualCapability;

export type ScheduledJobDefinition<Name extends string = string> = JobDefinitionBase<Name> &
  ScheduledCapability &
  ManualCapability;
const isProduction = process.env.NODE_ENV === "production";
const botEngineSchedule =
  process.env.BOT_ENGINE_SCHEDULE || (isProduction ? "*/15 * * * *" : "* * * * *");

function runWithoutProgress(handler: ScheduledJobHandler): {
  scheduledHandler: ScheduledJobHandler;
  manualHandler: ManualJobHandler;
} {
  return {
    scheduledHandler: handler,
    manualHandler: () => handler(),
  };
}

function runWithOptionalProgress(handler: ManualJobHandler): {
  scheduledHandler: ScheduledJobHandler;
  manualHandler: ManualJobHandler;
} {
  return {
    scheduledHandler: () => handler(),
    manualHandler: handler,
  };
}

async function runNewsScheduled(): Promise<JobResult> {
  const result = await fetchNews();
  return {
    requestCount: 1,
    recordsProcessed: result.storiesProcessed,
    errorCount: result.success ? 0 : 1,
  };
}

async function runNewsManually(progressCallback?: ProgressCallback): Promise<JobResult> {
  const result = await fetchNews(progressCallback);
  return {
    requestCount: 1,
    recordsProcessed: result.storiesProcessed,
    errorCount: result.success ? 0 : 1,
    // Runtime compatibility: the admin UI consumes these additional fields.
    stories: result.stories || [],
    error: result.error || null,
  } as JobResult;
}

async function runDigest(progressCallback?: ProgressCallback): Promise<JobResult> {
  const result = await compileAllDigests(progressCallback);
  return {
    requestCount: 0,
    recordsProcessed: result.usersProcessed,
    errorCount: result.errors,
  };
}

async function runBotEngine(): Promise<JobResult> {
  const result = await runBotEngineTick();
  return {
    requestCount: 1,
    recordsProcessed: result.botsProcessed,
    errorCount: result.errors,
  };
}

async function runVoidJob(handler: () => Promise<void>): Promise<JobResult> {
  await handler();
  return { requestCount: 0, recordsProcessed: 0, errorCount: 0 };
}

async function runMlbSchedule(): Promise<JobResult> {
  const result = await syncMLBSchedule();
  return {
    requestCount: 0,
    recordsProcessed: result.gamesProcessed,
    errorCount: result.errors.length,
  };
}

async function runMlbStats(): Promise<JobResult> {
  const result = await syncMLBStats();
  return {
    requestCount: 0,
    recordsProcessed: result.statsProcessed,
    errorCount: result.errors.length,
  };
}

async function runMlbRoster(): Promise<JobResult> {
  const result = await syncMLBRoster();
  return {
    requestCount: 0,
    recordsProcessed: result.playersAdded + result.playersUpdated,
    errorCount: result.errors.length,
  };
}

async function runNhlRoster(): Promise<JobResult> {
  const result = await syncNhlRoster();
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.playersAdded + result.playersUpdated,
    errorCount: result.errors.length,
  };
}

async function runNascarRoster(): Promise<JobResult> {
  const result = await syncNascarRoster();
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.recordsProcessed,
    errorCount: result.errorCount,
  };
}

async function runNascarActiveRoster(): Promise<JobResult> {
  const result = await syncNascarActiveRoster(14, 7);
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.recordsProcessed,
    errorCount: result.errorCount,
  };
}

async function runNascarSchedule(): Promise<JobResult> {
  const result = await syncNascarSchedule();
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.recordsProcessed,
    errorCount: result.errorCount,
  };
}

async function runNascarStats(): Promise<JobResult> {
  const result = await syncNascarStats();
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.recordsProcessed,
    errorCount: result.errorCount,
  };
}

async function runNascarLive(): Promise<JobResult> {
  const result = await syncNascarLive();
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.recordsProcessed,
    errorCount: result.errorCount,
  };
}

const rawJobDefinitions = [
  {
    name: "scout_distribution",
    group: "core",
    schedule: "0 * * * *",
    scheduleOrder: 0,
    enabled: true,
    advertiseManual: true,
    manualOrder: 2,
    ...runWithoutProgress(distributeScoutShares),
  },
  {
    name: "news_fetch",
    group: "core",
    schedule: "0 * * * *",
    scheduleOrder: 1,
    enabled: true,
    advertiseManual: true,
    manualOrder: 3,
    scheduledHandler: runNewsScheduled,
    manualHandler: runNewsManually,
  },
  {
    name: "discord_hourly_market_digest",
    group: "core",
    schedule: "0 * * * *",
    scheduleOrder: 2,
    enabled: true,
    advertiseManual: true,
    manualOrder: 4,
    ...runWithoutProgress(postDiscordHourlyMarketDigest),
  },
  {
    name: "discord_news_post",
    group: "core",
    schedule: "5 * * * *",
    scheduleOrder: 3,
    enabled: true,
    advertiseManual: true,
    manualOrder: 5,
    ...runWithoutProgress(postDiscordNewsUpdates),
  },
  {
    name: "bot_engine",
    group: "core",
    schedule: botEngineSchedule,
    scheduleOrder: 4,
    enabled: true,
    advertiseManual: true,
    manualOrder: 22,
    ...runWithoutProgress(runBotEngine),
  },
  {
    name: "compile_digest",
    group: "core",
    schedule: "0 6 * * *",
    scheduleOrder: 5,
    enabled: true,
    advertiseManual: true,
    manualOrder: 6,
    ...runWithOptionalProgress(runDigest),
  },
  {
    name: "agent_advisory_schedules",
    group: "core",
    schedule: "*/15 * * * *",
    scheduleOrder: 6,
    enabled: true,
    advertiseManual: true,
    manualOrder: 7,
    ...runWithoutProgress(runDueUserAgentSchedules),
  },
  {
    name: "agent_live_strategies",
    group: "core",
    schedule: "*/15 * * * *",
    scheduleOrder: 7,
    enabled: true,
    advertiseManual: true,
    manualOrder: 8,
    ...runWithoutProgress(runDueUserAgentStrategies),
  },
  {
    name: "agent_strategy_events",
    group: "core",
    schedule: "*/10 * * * *",
    scheduleOrder: 8,
    enabled: true,
    advertiseManual: true,
    manualOrder: 9,
    ...runWithoutProgress(runTriggeredUserAgentStrategies),
  },
  {
    name: "lock_boost_shares",
    group: "core",
    schedule: "0-59/5 * * * *",
    scheduleOrder: 9,
    enabled: true,
    advertiseManual: true,
    manualOrder: 10,
    ...runWithOptionalProgress(lockBoostShares),
  },
  {
    name: "snapshot_share_payouts",
    group: "core",
    schedule: "1-59/5 * * * *",
    scheduleOrder: 10,
    enabled: true,
    advertiseManual: true,
    manualOrder: 11,
    ...runWithOptionalProgress(snapshotSharePayouts),
  },
  {
    name: "settle_boosts",
    group: "core",
    schedule: "5-59/10 * * * *",
    scheduleOrder: 11,
    enabled: true,
    advertiseManual: true,
    manualOrder: 12,
    ...runWithOptionalProgress(settleBoosts),
  },
  {
    name: "settle_share_payouts",
    group: "core",
    schedule: "7-59/10 * * * *",
    scheduleOrder: 12,
    enabled: true,
    advertiseManual: true,
    manualOrder: 13,
    ...runWithOptionalProgress(settleSharePayouts),
  },
  {
    name: "settle_community_boosts",
    group: "core",
    schedule: "9-59/10 * * * *",
    scheduleOrder: 13,
    enabled: true,
    advertiseManual: true,
    manualOrder: 14,
    ...runWithOptionalProgress(settleCommunityBoosts),
  },
  {
    name: "notification_signals",
    group: "core",
    schedule: "*/15 * * * *",
    scheduleOrder: 14,
    enabled: true,
    advertiseManual: true,
    manualOrder: 15,
    ...runWithOptionalProgress(runNotificationSignalDetectors),
  },
  {
    name: "cleanup_job_logs",
    group: "core",
    schedule: "0 2 * * 0",
    scheduleOrder: 15,
    enabled: true,
    advertiseManual: true,
    manualOrder: 16,
    ...runWithOptionalProgress(cleanupJobLogs),
  },
  {
    name: "prune_price_history",
    group: "core",
    schedule: "0 3 * * 0",
    scheduleOrder: 16,
    enabled: true,
    advertiseManual: true,
    manualOrder: 17,
    ...runWithOptionalProgress(prunePriceHistory),
  },
  {
    name: "api_health_check",
    group: "core",
    schedule: "15 7 * * *",
    scheduleOrder: 17,
    enabled: true,
    advertiseManual: true,
    manualOrder: 23,
    scheduledHandler: async () =>
      toApiHealthJobResult(await runApiHealthCheck({ reason: "scheduled" })),
    manualHandler: async () =>
      toApiHealthJobResult(await runApiHealthCheck({ reason: "manual_trigger" })),
  },
  {
    name: "update_collections",
    group: "core",
    schedule: "7-59/15 * * * *",
    scheduleOrder: 18,
    enabled: true,
    advertiseManual: true,
    manualOrder: 18,
    ...runWithoutProgress(() => runVoidJob(updateCollectionsJob)),
  },
  {
    name: "check_milestones",
    group: "core",
    schedule: "3-59/15 * * * *",
    scheduleOrder: 19,
    enabled: true,
    advertiseManual: true,
    manualOrder: 19,
    ...runWithoutProgress(() => runVoidJob(checkMilestonesJob)),
  },
  {
    name: "refresh_player_metrics",
    group: "core",
    schedule: "12-59/15 * * * *",
    scheduleOrder: 20,
    enabled: true,
    advertiseManual: true,
    manualOrder: 20,
    ...runWithOptionalProgress(refreshPlayerMarketMetricsJob),
  },
  {
    name: "refresh_player_volume_24h",
    group: "core",
    schedule: "4-59/10 * * * *",
    scheduleOrder: 21,
    enabled: true,
    advertiseManual: true,
    manualOrder: 21,
    ...runWithOptionalProgress(refreshPlayerVolume24hJob),
  },
  {
    name: "stats_sync_live",
    group: "api",
    schedule: "4-59/5 * * * *",
    scheduleOrder: 0,
    enabled: true,
    advertiseManual: true,
    manualOrder: 0,
    ...runWithOptionalProgress(syncAllLiveStats),
  },
  {
    name: "mlb_roster_sync",
    group: "api",
    schedule: "15 4 * * *",
    scheduleOrder: 1,
    enabled: true,
    advertiseManual: true,
    manualOrder: 26,
    ...runWithoutProgress(runMlbRoster),
  },
  {
    name: "mlb_schedule_sync",
    group: "api",
    schedule: "50 * * * *",
    scheduleOrder: 2,
    enabled: true,
    advertiseManual: true,
    manualOrder: 24,
    ...runWithoutProgress(runMlbSchedule),
  },
  {
    name: "nhl_live_stats_sync",
    group: "api",
    schedule: "4-59/5 * * * *",
    scheduleOrder: 3,
    enabled: true,
    advertiseManual: true,
    manualOrder: 28,
    ...runWithoutProgress(syncNhlStats),
  },
  {
    name: "nhl_schedule_sync",
    group: "api",
    schedule: "50 * * * *",
    scheduleOrder: 4,
    enabled: true,
    advertiseManual: true,
    manualOrder: 27,
    ...runWithoutProgress(syncNhlSchedule),
  },
  {
    name: "nhl_roster_sync",
    group: "api",
    schedule: "20 4 * * *",
    scheduleOrder: 5,
    enabled: true,
    advertiseManual: true,
    manualOrder: 29,
    ...runWithoutProgress(runNhlRoster),
  },
  {
    name: "nascar_roster_sync",
    group: "api",
    schedule: "30 3 * * *",
    scheduleOrder: 6,
    enabled: true,
    advertiseManual: true,
    manualOrder: 30,
    ...runWithoutProgress(runNascarRoster),
  },
  {
    name: "nascar_active_roster_sync",
    group: "api",
    schedule: "0 4 * * *",
    scheduleOrder: 7,
    enabled: true,
    advertiseManual: false,
    ...runWithoutProgress(runNascarActiveRoster),
  },
  {
    name: "nascar_schedule_sync",
    group: "api",
    schedule: "45 3 * * *",
    scheduleOrder: 8,
    enabled: true,
    advertiseManual: true,
    manualOrder: 31,
    ...runWithoutProgress(runNascarSchedule),
  },
  {
    name: "nascar_stats_sync",
    group: "api",
    schedule: "20 * * * *",
    scheduleOrder: 9,
    enabled: true,
    advertiseManual: true,
    manualOrder: 32,
    ...runWithoutProgress(runNascarStats),
  },
  {
    name: "nascar_live_sync",
    group: "api",
    schedule: "*/5 * * * *",
    scheduleOrder: 10,
    enabled: true,
    advertiseManual: true,
    manualOrder: 33,
    ...runWithoutProgress(runNascarLive),
  },
  {
    name: "mlb_stats_sync",
    advertiseManual: true,
    manualOrder: 25,
    manualHandler: () => runMlbStats(),
  },
  {
    // Compatibility marker: advertised by the current API but intentionally not executable.
    name: "backfill_market_snapshots",
    advertiseManual: true,
    manualOrder: 1,
    schedule: undefined,
    manualHandler: undefined,
  },
] as const satisfies readonly JobDefinition[];

export type JobName = (typeof rawJobDefinitions)[number]["name"];

function assertContiguousOrder(label: string, orders: number[]): void {
  const sorted = [...orders].sort((left, right) => left - right);
  if (sorted.some((order, index) => order !== index)) {
    throw new Error(`${label} must be contiguous and unique`);
  }
}

interface JobDefinitionCandidate {
  readonly name: unknown;
  readonly group?: unknown;
  readonly schedule?: unknown;
  readonly scheduleOrder?: unknown;
  readonly enabled?: unknown;
  readonly scheduledHandler?: unknown;
  readonly advertiseManual: unknown;
  readonly manualOrder?: unknown;
}

export function validateJobDefinitions(definitions: readonly JobDefinitionCandidate[]): void {
  const names = new Set<string>();

  for (const definition of definitions) {
    if (typeof definition.name !== "string" || definition.name.length === 0) {
      throw new Error("Job name must be a non-empty string");
    }
    if (names.has(definition.name)) {
      throw new Error(`Duplicate job name: ${definition.name}`);
    }
    names.add(definition.name);

    if (typeof definition.advertiseManual !== "boolean") {
      throw new Error(`Job ${definition.name} has an invalid advertiseManual flag`);
    }

    const schedulingValues = [
      definition.group,
      definition.schedule,
      definition.scheduleOrder,
      definition.enabled,
      definition.scheduledHandler,
    ];
    const definedSchedulingValues = schedulingValues.filter((value) => value !== undefined);
    if (
      definedSchedulingValues.length > 0 &&
      definedSchedulingValues.length !== schedulingValues.length
    ) {
      throw new Error(`Job ${definition.name} has incomplete scheduling metadata`);
    }
    if (definedSchedulingValues.length === schedulingValues.length) {
      if (definition.group !== "core" && definition.group !== "api") {
        throw new Error(`Job ${definition.name} has an invalid scheduling group`);
      }
      if (typeof definition.schedule !== "string" || definition.schedule.length === 0) {
        throw new Error(`Job ${definition.name} has an invalid schedule`);
      }
      if (
        typeof definition.scheduleOrder !== "number" ||
        !Number.isInteger(definition.scheduleOrder) ||
        definition.scheduleOrder < 0
      ) {
        throw new Error(`Job ${definition.name} has an invalid schedule order`);
      }
      if (typeof definition.enabled !== "boolean") {
        throw new Error(`Job ${definition.name} has an invalid enabled flag`);
      }
      if (typeof definition.scheduledHandler !== "function") {
        throw new Error(`Job ${definition.name} has an invalid scheduled handler`);
      }
    }

    if (
      definition.advertiseManual &&
      (typeof definition.manualOrder !== "number" ||
        !Number.isInteger(definition.manualOrder) ||
        definition.manualOrder < 0)
    ) {
      throw new Error(`Job ${definition.name} is advertised without a manual order`);
    }
    if (!definition.advertiseManual && definition.manualOrder !== undefined) {
      throw new Error(`Job ${definition.name} is hidden but has a manual order`);
    }
  }

  for (const group of ["core", "api"] as const) {
    assertContiguousOrder(
      `Scheduled ${group} job order`,
      definitions
        .filter((definition) => definition.group === group)
        .map((definition) => definition.scheduleOrder as number),
    );
  }

  assertContiguousOrder(
    "Manual job order",
    definitions
      .filter((definition) => definition.advertiseManual)
      .map((definition) => definition.manualOrder as number),
  );
}

const frozenJobDefinitions = rawJobDefinitions.map((definition) =>
  Object.freeze(definition),
) as unknown as readonly JobDefinition<JobName>[];
validateJobDefinitions(frozenJobDefinitions);
export const jobDefinitions = Object.freeze(frozenJobDefinitions);

const manualHandlers = new Map<string, ManualJobHandler>(
  jobDefinitions.flatMap((job) => (job.manualHandler ? [[job.name, job.manualHandler]] : [])),
);

export function getScheduledJobDefinitions(group: JobGroup): ScheduledJobDefinition<JobName>[] {
  return jobDefinitions
    .filter(
      (job): job is ScheduledJobDefinition<JobName> =>
        job.group === group &&
        typeof job.schedule === "string" &&
        typeof job.scheduleOrder === "number" &&
        typeof job.enabled === "boolean" &&
        typeof job.scheduledHandler === "function",
    )
    .sort((left, right) => left.scheduleOrder - right.scheduleOrder);
}

export function getManualJobHandler(jobName: string): ManualJobHandler | undefined {
  return manualHandlers.get(jobName);
}

export function getAdvertisedManualJobNames(): JobName[] {
  return jobDefinitions
    .filter(
      (job): job is JobDefinition<JobName> & { manualOrder: number } =>
        job.advertiseManual && typeof job.manualOrder === "number",
    )
    .sort((left, right) => left.manualOrder - right.manualOrder)
    .map((job) => job.name);
}

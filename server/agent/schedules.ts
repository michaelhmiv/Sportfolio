import { userAgentMessages, userAgentSchedules, userAgentThreads } from "@shared/schema";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { toZonedTime } from "date-fns-tz";
import { db } from "../db";
import { analyzeScoutAgent } from "./service";
import type { AgentChannel, AgentScheduleJobType, AgentUserSchedule } from "./types";

const DEFAULT_IN_APP_CHANNELS: AgentChannel[] = ["in_app"];
const ET_TIMEZONE = "America/New_York";
let userAgentScheduleSchemaEnsured = false;

const DEFAULT_SCHEDULE_CONFIG: Record<
  AgentScheduleJobType,
  {
    scheduleCron: string;
    intervalMs: number;
    prompt: string;
    title: string;
  }
> = {
  daily_setup_review: {
    scheduleCron: "0 8 * * *",
    intervalMs: 24 * 60 * 60 * 1000,
    prompt:
      "Give me a proactive setup review for today with the single highest-leverage thing I should pay attention to, but do not stage any actions automatically.",
    title: "Daily Setup Review",
  },
  pre_lock_nudge: {
    scheduleCron: "0 */6 * * *",
    intervalMs: 6 * 60 * 60 * 1000,
    prompt:
      "Give me a quick pre-lock nudge based on my current setup and tell me if any immediate risk stands out, but do not stage any actions automatically.",
    title: "Pre-Lock Nudge",
  },
  injury_watch: {
    scheduleCron: "15 */6 * * *",
    intervalMs: 6 * 60 * 60 * 1000,
    prompt:
      "Check for any current injury or availability context that materially affects my setup and summarize only the highest-signal update, without staging actions automatically.",
    title: "Injury Watch",
  },
  idle_balance_nudge: {
    scheduleCron: "30 9 * * *",
    intervalMs: 24 * 60 * 60 * 1000,
    prompt:
      "Review my available balance and tell me if it looks idle enough to justify attention today, without staging any actions automatically.",
    title: "Idle Balance Nudge",
  },
  boost_window: {
    scheduleCron: "0 */8 * * *",
    intervalMs: 8 * 60 * 60 * 1000,
    prompt:
      "Check my boost window and tell me if there is an obvious open-slot or timing issue I should care about, without staging any actions automatically.",
    title: "Boost Window Check",
  },
};

function isKnownScheduleJobType(value: string): value is AgentScheduleJobType {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SCHEDULE_CONFIG, value);
}

export function listAgentScheduleTemplates(): Array<{
  jobType: AgentScheduleJobType;
  title: string;
  scheduleCron: string;
  defaultChannels: AgentChannel[];
}> {
  return (
    Object.entries(DEFAULT_SCHEDULE_CONFIG) as Array<
      [AgentScheduleJobType, (typeof DEFAULT_SCHEDULE_CONFIG)[AgentScheduleJobType]]
    >
  ).map(([jobType, config]) => ({
    jobType,
    title: config.title,
    scheduleCron: config.scheduleCron,
    defaultChannels: DEFAULT_IN_APP_CHANNELS,
  }));
}

function mapScheduleRow(row: typeof userAgentSchedules.$inferSelect): AgentUserSchedule {
  const channelTargets = Array.isArray(row.channelTargets)
    ? row.channelTargets.filter(
        (entry): entry is AgentChannel => entry === "in_app" || entry === "sms" || entry === "cli",
      )
    : DEFAULT_IN_APP_CHANNELS;

  return {
    id: row.id,
    userId: row.userId,
    jobType: row.jobType as AgentScheduleJobType,
    enabled: row.enabled,
    scheduleCron: row.scheduleCron,
    channelTargets: channelTargets.length > 0 ? channelTargets : DEFAULT_IN_APP_CHANNELS,
    policy: (row.policy as Record<string, unknown>) || {},
    lastRunAt: row.lastRunAt || null,
    nextRunAt: row.nextRunAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getFallbackIntervalMs(jobType: AgentScheduleJobType): number {
  const config = DEFAULT_SCHEDULE_CONFIG[jobType];
  return config.intervalMs;
}

function parseCronSegment(
  segment: string,
  minValue: number,
  maxValue: number,
  normalize?: (value: number) => number,
): number[] | null {
  const normalizedSegment = segment.trim();
  if (!normalizedSegment) {
    return null;
  }

  if (normalizedSegment === "*") {
    return Array.from({ length: maxValue - minValue + 1 }, (_, index) => minValue + index);
  }

  const [rangePart, stepPart] = normalizedSegment.split("/");
  const step = stepPart ? Number(stepPart) : 1;
  if (!Number.isInteger(step) || step <= 0) {
    return null;
  }

  let start = minValue;
  let end = maxValue;

  if (rangePart !== "*") {
    const [rangeStart, rangeEnd] = rangePart.split("-");
    if (rangeEnd !== undefined) {
      start = Number(rangeStart);
      end = Number(rangeEnd);
    } else {
      start = Number(rangePart);
      end = Number(rangePart);
    }
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
    return null;
  }

  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    const normalizedValue = normalize ? normalize(value) : value;
    if (normalizedValue < minValue || normalizedValue > maxValue) {
      return null;
    }
    values.push(normalizedValue);
  }

  return values;
}

function matchesCronField(
  expression: string,
  value: number,
  minValue: number,
  maxValue: number,
  normalize?: (entry: number) => number,
): boolean {
  return expression
    .split(",")
    .some((segment) => parseCronSegment(segment, minValue, maxValue, normalize)?.includes(value));
}

function matchesCronExpression(cronExpression: string, date: Date): boolean {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;
  const weekday = date.getDay();
  const dayOfMonthMatches = matchesCronField(dayPart, date.getDate(), 1, 31);
  const weekdayMatches = matchesCronField(weekdayPart, weekday, 0, 6, (entry) =>
    entry === 7 ? 0 : entry,
  );
  const dayMatches =
    dayPart === "*" || weekdayPart === "*"
      ? dayOfMonthMatches && weekdayMatches
      : dayOfMonthMatches || weekdayMatches;

  return (
    matchesCronField(minutePart, date.getMinutes(), 0, 59) &&
    matchesCronField(hourPart, date.getHours(), 0, 23) &&
    matchesCronField(monthPart, date.getMonth() + 1, 1, 12) &&
    dayMatches
  );
}

export function computeNextScheduledRunAt(
  cronExpression: string,
  jobType: AgentScheduleJobType,
  from = new Date(),
): Date {
  const fallbackIntervalMs = getFallbackIntervalMs(jobType);
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const maxIterations = 366 * 24 * 60;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const zonedCandidate = toZonedTime(cursor, ET_TIMEZONE);
    if (matchesCronExpression(cronExpression, zonedCandidate)) {
      return new Date(cursor);
    }

    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return new Date(from.getTime() + fallbackIntervalMs);
}

export function buildUserAgentScheduleWriteState(input: {
  jobType: AgentScheduleJobType;
  enabled?: boolean;
  scheduleCron?: string;
  channelTargets?: AgentChannel[] | null;
  policy?: Record<string, unknown>;
  existing?: Pick<
    typeof userAgentSchedules.$inferSelect,
    "enabled" | "scheduleCron" | "channelTargets" | "policy" | "nextRunAt"
  > | null;
  now?: Date;
}): {
  enabled: boolean;
  scheduleCron: string;
  channelTargets: AgentChannel[];
  policy: Record<string, unknown>;
  nextRunAt: Date | null;
} {
  const now = input.now || new Date();
  const existing = input.existing || null;
  const scheduleCron =
    input.scheduleCron?.trim() ||
    existing?.scheduleCron ||
    DEFAULT_SCHEDULE_CONFIG[input.jobType].scheduleCron;
  const enabled = input.enabled ?? existing?.enabled ?? true;
  const channelTargets =
    input.channelTargets !== undefined
      ? normalizeChannelTargets(input.channelTargets)
      : Array.isArray(existing?.channelTargets)
        ? normalizeChannelTargets(existing.channelTargets as AgentChannel[])
        : DEFAULT_IN_APP_CHANNELS;
  const policy =
    input.policy !== undefined
      ? input.policy
      : (existing?.policy as Record<string, unknown> | null) || {};

  const cronChanged = Boolean(existing && scheduleCron !== existing.scheduleCron);
  const enabledChanged = input.enabled !== undefined && input.enabled !== existing?.enabled;
  const shouldRecomputeNextRun =
    enabled && (!existing || cronChanged || enabledChanged || !existing.nextRunAt);

  return {
    enabled,
    scheduleCron,
    channelTargets,
    policy,
    nextRunAt: enabled
      ? shouldRecomputeNextRun
        ? computeNextScheduledRunAt(scheduleCron, input.jobType, now)
        : (existing?.nextRunAt ?? computeNextScheduledRunAt(scheduleCron, input.jobType, now))
      : (existing?.nextRunAt ?? null),
  };
}

function normalizeChannelTargets(channelTargets?: AgentChannel[] | null): AgentChannel[] {
  const normalized = (channelTargets || []).filter(
    (entry): entry is AgentChannel => entry === "in_app" || entry === "sms" || entry === "cli",
  );

  return normalized.length > 0 ? normalized : DEFAULT_IN_APP_CHANNELS;
}

async function ensureUserAgentScheduleSchema(): Promise<void> {
  if (userAgentScheduleSchemaEnsured) {
    return;
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_schedules" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "job_type" text NOT NULL,
      "enabled" boolean NOT NULL DEFAULT true,
      "schedule_cron" text NOT NULL,
      "channel_targets" jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
      "policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "last_run_at" timestamp,
      "next_run_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_schedules_user_job_idx"
      ON "user_agent_schedules" ("user_id", "job_type");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_schedules_due_run_idx"
      ON "user_agent_schedules" ("enabled", "next_run_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_schedules_user_updated_idx"
      ON "user_agent_schedules" ("user_id", "updated_at");
  `);

  userAgentScheduleSchemaEnsured = true;
}

async function getOrCreateScheduleThread(
  userId: string,
  jobType: AgentScheduleJobType,
): Promise<string> {
  const externalThreadKey = `schedule:${jobType}`;
  const [existing] = await db
    .select({ id: userAgentThreads.id })
    .from(userAgentThreads)
    .where(
      and(
        eq(userAgentThreads.userId, userId),
        eq(userAgentThreads.channel, "in_app"),
        eq(userAgentThreads.status, "active"),
        eq(userAgentThreads.externalThreadKey, externalThreadKey),
      ),
    )
    .orderBy(desc(userAgentThreads.updatedAt))
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await db
    .insert(userAgentThreads)
    .values({
      userId,
      channel: "in_app",
      domain: "sportfolio",
      status: "active",
      title: DEFAULT_SCHEDULE_CONFIG[jobType].title,
      externalThreadKey,
    })
    .returning({ id: userAgentThreads.id });

  return created.id;
}

async function appendScheduledAssistantMessage(input: {
  threadId: string;
  userId: string;
  runId: string;
  contentText: string;
  summary: string | null;
  jobType: AgentScheduleJobType;
  citations: unknown[];
}) {
  const [message] = await db
    .insert(userAgentMessages)
    .values({
      threadId: input.threadId,
      userId: input.userId,
      role: "assistant",
      messageType: "chat",
      contentText: input.contentText,
      runId: input.runId,
      structuredPayload: {
        scheduleJobType: input.jobType,
        generatedBy: "hermes_schedule",
        summary: input.summary,
        citations: input.citations,
      },
    })
    .returning({ createdAt: userAgentMessages.createdAt });

  await db
    .update(userAgentThreads)
    .set({
      lastMessageAt: message.createdAt,
      updatedAt: message.createdAt,
    })
    .where(eq(userAgentThreads.id, input.threadId));
}

export async function ensureDefaultUserAgentSchedules(userId: string): Promise<void> {
  await ensureUserAgentScheduleSchema();

  const now = new Date();
  const config = DEFAULT_SCHEDULE_CONFIG.daily_setup_review;

  await db
    .insert(userAgentSchedules)
    .values({
      userId,
      jobType: "daily_setup_review",
      enabled: true,
      scheduleCron: config.scheduleCron,
      channelTargets: DEFAULT_IN_APP_CHANNELS,
      policy: {
        createdBy: "system_default",
        autoSeeded: true,
      },
      nextRunAt: computeNextScheduledRunAt(config.scheduleCron, "daily_setup_review", now),
    })
    .onConflictDoNothing({
      target: [userAgentSchedules.userId, userAgentSchedules.jobType],
    });
}

export async function listUserAgentSchedules(userId: string): Promise<AgentUserSchedule[]> {
  await ensureUserAgentScheduleSchema();

  const rows = await db
    .select()
    .from(userAgentSchedules)
    .where(eq(userAgentSchedules.userId, userId))
    .orderBy(userAgentSchedules.jobType);

  return rows.filter((row) => isKnownScheduleJobType(row.jobType)).map(mapScheduleRow);
}

export async function upsertUserAgentSchedule(input: {
  userId: string;
  jobType: AgentScheduleJobType;
  enabled?: boolean;
  scheduleCron?: string;
  channelTargets?: AgentChannel[] | null;
  policy?: Record<string, unknown>;
}): Promise<AgentUserSchedule> {
  await ensureUserAgentScheduleSchema();

  const now = new Date();
  const [existing] = await db
    .select()
    .from(userAgentSchedules)
    .where(
      and(
        eq(userAgentSchedules.userId, input.userId),
        eq(userAgentSchedules.jobType, input.jobType),
      ),
    )
    .limit(1);
  const scheduleState = buildUserAgentScheduleWriteState({
    ...input,
    existing,
    now,
  });

  const [row] = existing
    ? await db
        .update(userAgentSchedules)
        .set({
          enabled: scheduleState.enabled,
          scheduleCron: scheduleState.scheduleCron,
          channelTargets: scheduleState.channelTargets,
          policy: scheduleState.policy,
          nextRunAt: scheduleState.nextRunAt,
          updatedAt: now,
        })
        .where(eq(userAgentSchedules.id, existing.id))
        .returning()
    : await db
        .insert(userAgentSchedules)
        .values({
          userId: input.userId,
          jobType: input.jobType,
          enabled: scheduleState.enabled,
          scheduleCron: scheduleState.scheduleCron,
          channelTargets: scheduleState.channelTargets,
          policy: scheduleState.policy,
          nextRunAt: scheduleState.nextRunAt,
          updatedAt: now,
        })
        .returning();

  return mapScheduleRow(row);
}

export async function removeUserAgentSchedule(
  userId: string,
  jobType: AgentScheduleJobType,
): Promise<{ deleted: boolean }> {
  await ensureUserAgentScheduleSchema();

  const rows = await db
    .delete(userAgentSchedules)
    .where(and(eq(userAgentSchedules.userId, userId), eq(userAgentSchedules.jobType, jobType)))
    .returning({ id: userAgentSchedules.id });

  return {
    deleted: rows.length > 0,
  };
}

export async function runDueUserAgentSchedules(limit = 20): Promise<{
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
}> {
  await ensureUserAgentScheduleSchema();

  const now = new Date();
  const rows = await db
    .select()
    .from(userAgentSchedules)
    .where(and(eq(userAgentSchedules.enabled, true), lte(userAgentSchedules.nextRunAt, now)))
    .orderBy(userAgentSchedules.nextRunAt)
    .limit(limit);

  let recordsProcessed = 0;
  let errorCount = 0;

  for (const row of rows) {
    if (!isKnownScheduleJobType(row.jobType)) {
      await db
        .update(userAgentSchedules)
        .set({
          enabled: false,
          updatedAt: now,
        })
        .where(eq(userAgentSchedules.id, row.id));
      continue;
    }

    const schedule = mapScheduleRow(row);
    try {
      const threadId = await getOrCreateScheduleThread(schedule.userId, schedule.jobType);
      const prompt = DEFAULT_SCHEDULE_CONFIG[schedule.jobType].prompt;
      const analysis = await analyzeScoutAgent(schedule.userId, {
        threadId,
        message: prompt,
        mode: "discussion",
      });

      if (analysis.status === "completed" && analysis.replyText) {
        await appendScheduledAssistantMessage({
          threadId,
          userId: schedule.userId,
          runId: analysis.runId,
          contentText: analysis.replyText,
          summary: analysis.summary,
          jobType: schedule.jobType,
          citations: analysis.citations || [],
        });
      }

      await db
        .update(userAgentSchedules)
        .set({
          lastRunAt: now,
          nextRunAt: computeNextScheduledRunAt(schedule.scheduleCron, schedule.jobType, now),
          updatedAt: now,
        })
        .where(eq(userAgentSchedules.id, schedule.id));

      recordsProcessed += 1;
    } catch (error) {
      errorCount += 1;
      await db
        .update(userAgentSchedules)
        .set({
          nextRunAt: computeNextScheduledRunAt(schedule.scheduleCron, schedule.jobType, now),
          updatedAt: now,
        })
        .where(eq(userAgentSchedules.id, schedule.id));
      console.warn(
        "[Hermes Schedules] Could not run user schedule:",
        schedule.id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    requestCount: rows.length,
    recordsProcessed,
    errorCount,
  };
}

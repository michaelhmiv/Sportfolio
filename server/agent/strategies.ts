import {
  playerPools,
  players,
  userAgentMessages,
  userAgentStrategies,
  userAgentStrategyEvents,
  userAgentStrategyRuns,
  type UserAgentStrategy,
  type UserAgentStrategyEvent,
  type UserAgentStrategyRun,
} from "@shared/schema";
import {
  normalizeAgentStrategyTimeline,
  summarizeAgentStrategyTrigger,
  type AgentStrategyStage,
  type AgentStrategyTimeline,
  type AgentStrategyTriggerAnchor,
  type AgentStrategyTriggerKind,
} from "@shared/agent-strategy";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  buildDefaultStrategyGuardrails,
  DEFAULT_AUTONOMOUS_STRATEGY_ACTION_TYPES,
} from "./strategy-policy";
import { buildAgentContinuityState } from "./continuity-state";
import { computeStrategyNextRunAt } from "./strategy-timeline";
import {
  createAgentThread,
  getAgentThread,
  listAgentThreadMessages,
  updateAgentThreadMetadata,
} from "./thread-service";
import type {
  AgentAction,
  AgentStrategyDetailRecord,
  AgentStrategyEventRecord,
  AgentStrategyPerformanceSummary,
  AgentStrategyRecord,
  AgentStrategyReviewStatus,
  AgentStrategyRunRecord,
} from "./types";

export const AGENT_STRATEGY_SLOT_LIMITS = {
  maxSaved: 10,
  maxLive: 3,
} as const;
const STRATEGY_EVENT_SUBSCRIPTIONS = ["schedule", "gameplay_event", "research_refresh"] as const;
const STRATEGY_ACTION_TYPES = [...DEFAULT_AUTONOMOUS_STRATEGY_ACTION_TYPES] as [
  AgentAction["actionType"],
  ...AgentAction["actionType"][],
];

const createAgentStrategyInputSchema = z
  .object({
    threadId: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    summary: z.string().trim().min(1).max(4000).optional(),
    mandateText: z.string().trim().min(1).max(4000).optional(),
    scheduleCron: z.string().trim().min(1).max(120).nullable().optional(),
    eventSubscriptions: z
      .array(z.enum(STRATEGY_EVENT_SUBSCRIPTIONS))
      .max(STRATEGY_EVENT_SUBSCRIPTIONS.length)
      .optional(),
    allowedActionTypes: z
      .array(z.enum(STRATEGY_ACTION_TYPES))
      .max(STRATEGY_ACTION_TYPES.length)
      .optional(),
    guardrails: z.record(z.unknown()).optional(),
    linkedSkillId: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict();

const updateAgentStrategyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    summary: z.string().trim().min(1).max(4000).optional(),
    mandateText: z.string().trim().min(1).max(4000).optional(),
    scheduleCron: z.string().trim().min(1).max(120).nullable().optional(),
    eventSubscriptions: z
      .array(z.enum(STRATEGY_EVENT_SUBSCRIPTIONS))
      .max(STRATEGY_EVENT_SUBSCRIPTIONS.length)
      .optional(),
    allowedActionTypes: z
      .array(z.enum(STRATEGY_ACTION_TYPES))
      .max(STRATEGY_ACTION_TYPES.length)
      .optional(),
    guardrails: z.record(z.unknown()).optional(),
    normalizedRuleSheet: z.record(z.unknown()).optional(),
    linkedSkillId: z.string().trim().min(1).max(120).nullable().optional(),
    lastOutcomeSummary: z.string().trim().min(1).max(4000).nullable().optional(),
  })
  .strict();

let agentStrategySchemaEnsured = false;

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function toActionTypeArray(value: unknown): AgentAction["actionType"][] {
  const allowed = new Set<string>(STRATEGY_ACTION_TYPES);
  return toStringArray(value).filter((entry): entry is AgentAction["actionType"] =>
    allowed.has(entry),
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getStrategyReviewState(value: unknown): {
  status: AgentStrategyReviewStatus;
  reviewedAt: Date | null;
  lastMaterialUpdateAt: Date | null;
  summary: string | null;
} {
  const record = toRecord(value);
  return {
    status: record.status === "approved" ? "approved" : "pending",
    reviewedAt: toDateOrNull(record.reviewedAt),
    lastMaterialUpdateAt: toDateOrNull(record.lastMaterialUpdateAt),
    summary:
      typeof record.summary === "string" && record.summary.trim().length > 0
        ? record.summary.trim()
        : null,
  };
}

function serializeStrategyReviewState(input: {
  status: AgentStrategyReviewStatus;
  reviewedAt: Date | null;
  lastMaterialUpdateAt: Date | null;
  summary: string | null;
}) {
  return {
    status: input.status,
    reviewedAt: input.reviewedAt ? input.reviewedAt.toISOString() : null,
    lastMaterialUpdateAt: input.lastMaterialUpdateAt
      ? input.lastMaterialUpdateAt.toISOString()
      : null,
    summary: input.summary,
  } satisfies Record<string, unknown>;
}

function buildPendingReviewState(updatedAt: Date, summary?: string | null) {
  return {
    status: "pending" as const,
    reviewedAt: null,
    lastMaterialUpdateAt: updatedAt,
    summary:
      summary ||
      "Review the saved stages, triggers, and action scope before this strategy can go live.",
  };
}

function buildApprovedReviewState(input: {
  lastMaterialUpdateAt: Date | null;
  reviewedAt: Date;
  summary?: string | null;
}) {
  return {
    status: "approved" as const,
    reviewedAt: input.reviewedAt,
    lastMaterialUpdateAt: input.lastMaterialUpdateAt,
    summary: input.summary || "The saved strategy has been reviewed and is ready to activate.",
  };
}

function strategyRequiresReview(reviewState: ReturnType<typeof getStrategyReviewState>) {
  return reviewState.status !== "approved";
}

function mapStrategyRow(row: UserAgentStrategy): AgentStrategyRecord {
  const normalizedRuleSheet =
    row.normalizedRuleSheet && typeof row.normalizedRuleSheet === "object"
      ? (row.normalizedRuleSheet as Record<string, unknown>)
      : {};
  const allowedActionTypes = toActionTypeArray(row.allowedActionTypes);
  const reviewState = getStrategyReviewState(toRecord(normalizedRuleSheet.reviewState));
  const timeline = normalizeAgentStrategyTimeline(normalizedRuleSheet, {
    objective: row.summary,
    mandate: row.mandateText,
    scheduleCron: row.scheduleCron || null,
    eventSubscriptions: toStringArray(row.eventSubscriptions),
    allowedActionTypes,
    rawTimingInstruction:
      typeof normalizedRuleSheet.rawTimingInstruction === "string"
        ? normalizedRuleSheet.rawTimingInstruction
        : null,
  });

  return {
    id: row.id,
    userId: row.userId,
    sourceThreadId: row.sourceThreadId || null,
    conversationThreadId: row.sourceThreadId || null,
    name: row.name,
    summary: row.summary,
    mandateText: row.mandateText,
    normalizedRuleSheet,
    timeline,
    status: row.status as AgentStrategyRecord["status"],
    scheduleCron: row.scheduleCron || null,
    eventSubscriptions: toStringArray(row.eventSubscriptions),
    allowedActionTypes,
    guardrails:
      row.guardrails && typeof row.guardrails === "object"
        ? (row.guardrails as Record<string, unknown>)
        : {},
    reviewState,
    requiresReview: strategyRequiresReview(reviewState),
    linkedSkillId: row.linkedSkillId || null,
    lastOutcomeSummary: row.lastOutcomeSummary || null,
    lastRunAt: row.lastRunAt || null,
    nextRunAt: row.nextRunAt || null,
    activatedAt: row.activatedAt || null,
    pausedAt: row.pausedAt || null,
    archivedAt: row.archivedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapStrategyEventRow(row: UserAgentStrategyEvent): AgentStrategyEventRecord {
  return {
    id: row.id,
    strategyId: row.strategyId,
    userId: row.userId,
    strategyRunId: row.strategyRunId || null,
    eventType: row.eventType,
    status:
      row.status === "success" || row.status === "warning" || row.status === "error"
        ? row.status
        : "info",
    title: row.title,
    summary: row.summary || null,
    eventKey: row.eventKey || null,
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt,
  };
}

export function assertCanSaveStrategy(savedCount: number) {
  if (savedCount >= AGENT_STRATEGY_SLOT_LIMITS.maxSaved) {
    throw new Error(
      `You can only keep ${AGENT_STRATEGY_SLOT_LIMITS.maxSaved} saved strategies right now.`,
    );
  }
}

export function assertCanActivateStrategy(otherLiveCount: number) {
  if (otherLiveCount >= AGENT_STRATEGY_SLOT_LIMITS.maxLive) {
    throw new Error(`Only ${AGENT_STRATEGY_SLOT_LIMITS.maxLive} strategies can be live at a time.`);
  }
}

function mapStrategyRunRow(row: UserAgentStrategyRun): AgentStrategyRunRecord {
  return {
    id: row.id,
    strategyId: row.strategyId,
    userId: row.userId,
    threadId: row.threadId || null,
    hermesRunId: row.hermesRunId || null,
    runtimeSessionId: row.runtimeSessionId || null,
    runtimeTransport:
      row.runtimeTransport === "local" || row.runtimeTransport === "sidecar"
        ? row.runtimeTransport
        : null,
    runtimeEndpoint: row.runtimeEndpoint || null,
    runtimeCorrelationId: row.runtimeCorrelationId || null,
    triggerSource: row.triggerSource,
    status: row.status,
    outcomeSummary: row.outcomeSummary || null,
    toolTrace: Array.isArray(row.toolTrace)
      ? (row.toolTrace as AgentStrategyRunRecord["toolTrace"])
      : [],
    appliedActions: Array.isArray(row.appliedActions)
      ? (row.appliedActions as AgentStrategyRunRecord["appliedActions"])
      : [],
    adaptationNotes: row.adaptationNotes || null,
    failureReason: row.failureReason || null,
    createdAt: row.createdAt,
    completedAt: row.completedAt || null,
  };
}

function buildDefaultStrategyName(base: string, count: number) {
  const trimmed = base.trim();
  if (!trimmed) {
    return `Strategy ${count + 1}`;
  }

  return trimmed.length > 80 ? `${trimmed.slice(0, 77).trimEnd()}...` : trimmed;
}

function buildStageId(index: number) {
  return `stage_${index + 1}`;
}

function inferAnchorFromEventSubscription(eventSubscription: string): AgentStrategyTriggerAnchor {
  switch (eventSubscription) {
    case "research_refresh":
      return "research_refresh";
    case "gameplay_event":
    default:
      return "day_close";
  }
}

function buildTimelineFromInputs(input: {
  objective: string;
  mandateText: string;
  scheduleCron: string | null;
  eventSubscriptions: string[];
  allowedActionTypes: AgentAction["actionType"][];
  rawTimingInstruction?: string | null;
  existingTimeline?: AgentStrategyTimeline | null;
}): AgentStrategyTimeline {
  if (input.existingTimeline && input.existingTimeline.stages.length > 0) {
    return {
      ...input.existingTimeline,
      objective: input.objective,
      currentStageId:
        input.existingTimeline.currentStageId || input.existingTimeline.stages[0]?.id || null,
    };
  }

  const decomposedStages = decomposeDirectiveIntoStages({
    mandateText: input.mandateText,
    scheduleCron: input.scheduleCron,
    allowedActionTypes: input.allowedActionTypes,
  });

  if (decomposedStages.length > 0) {
    return {
      objective: input.objective,
      currentStageId:
        decomposedStages.find((stage) => stage.status === "active")?.id ||
        decomposedStages[0]?.id ||
        null,
      stages: decomposedStages,
    };
  }

  const stages: AgentStrategyStage[] = [];
  if (input.scheduleCron) {
    stages.push({
      id: buildStageId(stages.length),
      title: "Scheduled review",
      summary: "Hermes re-evaluates this strategy on the saved recurring schedule.",
      status: "active",
      actionScope: input.allowedActionTypes,
      triggerPolicy: {
        kind: "recurring_cron" satisfies AgentStrategyTriggerKind,
        anchor: "daily_at_time",
        scheduleCron: input.scheduleCron,
        rawTimingInstruction: input.rawTimingInstruction || input.scheduleCron,
        timezone: "America/New_York",
      },
    });
  }

  for (const eventSubscription of input.eventSubscriptions) {
    if (eventSubscription === "schedule") {
      continue;
    }

    stages.push({
      id: buildStageId(stages.length),
      title: summarizeAgentStrategyTrigger({
        kind: "event_window",
        anchor: inferAnchorFromEventSubscription(eventSubscription),
        eventType: eventSubscription,
      }),
      summary: `Hermes wakes again when ${eventSubscription.replace(/_/g, " ")} becomes relevant.`,
      status: stages.length === 0 ? "active" : "pending",
      actionScope: input.allowedActionTypes,
      triggerPolicy: {
        kind: "event_window",
        anchor: inferAnchorFromEventSubscription(eventSubscription),
        eventType: eventSubscription,
        rawTimingInstruction: input.rawTimingInstruction || null,
        timezone: "America/New_York",
      },
    });
  }

  if (stages.length === 0) {
    stages.push({
      id: buildStageId(0),
      title: "Manual review",
      summary: "This strategy still needs a saved schedule or trigger.",
      status: "pending",
      actionScope: input.allowedActionTypes,
      triggerPolicy: {
        kind: "event_window",
        anchor: "day_close",
        rawTimingInstruction: input.rawTimingInstruction || null,
        timezone: "America/New_York",
      },
    });
  }

  return {
    objective: input.objective,
    currentStageId: stages.find((stage) => stage.status === "active")?.id || stages[0]?.id || null,
    stages,
  };
}

const SCOUT_PATTERNS = /\b(scout|scouting|find|research|identify|discover|look for)\b/i;
const STACK_PATTERNS = /\b(stack|condense|stack shares|stacking)\b/i;
const BOOST_PATTERNS = /\b(boost|daily boost|put in.*slot|assign.*boost)\b/i;
const BUY_PATTERNS = /\b(buy|purchase|invest|deploy|acquire|get shares)\b/i;
const SELL_PATTERNS = /\b(sell|exit|liquidate|reduce|trim)\b/i;
const SPORT_PATTERNS = /\b(MLB|NBA|NFL|NASCAR|baseball|basketball|football)\b/i;
const TIME_PATTERNS = /\b(this week|tonight|today|tomorrow|before.*game|when.*start|at game time|pre.?lock)\b/i;

export function decomposeDirectiveIntoStages(input: {
  mandateText: string;
  scheduleCron: string | null;
  allowedActionTypes: AgentAction["actionType"][];
}): AgentStrategyStage[] {
  const mandate = input.mandateText;
  const stages: AgentStrategyStage[] = [];

  const hasScout = SCOUT_PATTERNS.test(mandate);
  const hasStack = STACK_PATTERNS.test(mandate);
  const hasBoost = BOOST_PATTERNS.test(mandate);
  const hasBuy = BUY_PATTERNS.test(mandate);
  const hasSell = SELL_PATTERNS.test(mandate);
  const hasSport = SPORT_PATTERNS.test(mandate);
  const hasTimeAwareness = TIME_PATTERNS.test(mandate);

  const sportMatch = mandate.match(SPORT_PATTERNS);
  const sportLabel = sportMatch ? sportMatch[0].toUpperCase() : null;

  const multiPhaseDetected =
    [hasScout, hasStack, hasBoost, hasBuy, hasSell].filter(Boolean).length >= 2;

  if (!multiPhaseDetected) {
    return [];
  }

  if (hasScout || hasBuy) {
    const scoutActions: AgentAction["actionType"][] = [];
    if (hasScout) scoutActions.push("scout_set_count");
    if (hasBuy) scoutActions.push("pool_buy");
    scoutActions.push("watchlist_add_player");

    stages.push({
      id: buildStageId(stages.length),
      title: sportLabel ? `Research & scout ${sportLabel} targets` : "Research & scout targets",
      summary: `Scan available players${sportLabel ? ` in ${sportLabel}` : ""}, evaluate opportunities, and set up initial positions or scout assignments.`,
      status: "active",
      actionScope: scoutActions,
      triggerPolicy: {
        kind: input.scheduleCron ? "recurring_cron" : "event_window",
        anchor: input.scheduleCron ? "daily_at_time" : "research_refresh",
        scheduleCron: input.scheduleCron || null,
        rawTimingInstruction: input.scheduleCron || "Morning research window",
        timezone: "America/New_York",
      },
    });
  }

  if (hasStack) {
    stages.push({
      id: buildStageId(stages.length),
      title: "Stack acquired shares",
      summary: "Review holdings from the scouting phase and stack shares where eligible to maximize boost multipliers.",
      status: "pending",
      actionScope: ["holdings_stack_shares"],
      triggerPolicy: {
        kind: "event_window",
        anchor: "day_close",
        rawTimingInstruction: "After scouting positions are established",
        timezone: "America/New_York",
      },
    });
  }

  if (hasBoost) {
    stages.push({
      id: buildStageId(stages.length),
      title: sportLabel ? `Boost ${sportLabel} players at game time` : "Assign boosts before games",
      summary: `Assign daily boost slots to the strongest eligible players${sportLabel ? ` from ${sportLabel}` : ""} before their games lock.`,
      status: "pending",
      actionScope: ["daily_boost_assign", "daily_boost_remove"],
      triggerPolicy: {
        kind: "event_window",
        anchor: "pre_lock",
        offsetMinutes: 30,
        rawTimingInstruction: "30 minutes before game lock",
        timezone: "America/New_York",
      },
    });
  }

  if (hasSell) {
    stages.push({
      id: buildStageId(stages.length),
      title: "Post-game evaluation",
      summary: "After games settle, evaluate performance and trim or exit positions that no longer fit the mandate.",
      status: "pending",
      actionScope: ["pool_sell", "pool_remove_liquidity", "daily_boost_remove"],
      triggerPolicy: {
        kind: "event_window",
        anchor: "post_settlement",
        rawTimingInstruction: "After boost settlement",
        timezone: "America/New_York",
      },
    });
  }

  if (stages.length > 0 && !hasSell && (hasBoost || hasStack)) {
    stages.push({
      id: buildStageId(stages.length),
      title: "Review & adapt",
      summary: "After games complete, review results and decide whether to continue, adjust, or wind down positions.",
      status: "pending",
      actionScope: input.allowedActionTypes,
      triggerPolicy: {
        kind: "event_window",
        anchor: "post_game",
        rawTimingInstruction: "After games finish for the day",
        timezone: "America/New_York",
      },
    });
  }

  return stages;
}

function hasStrategyMaterialChanges(input: {
  existing: UserAgentStrategy;
  nextName: string;
  nextSummary: string;
  nextMandateText: string;
  nextScheduleCron: string | null;
  nextEventSubscriptions: string[];
  nextAllowedActionTypes: AgentAction["actionType"][];
  nextGuardrails: Record<string, unknown>;
  nextTimeline: AgentStrategyTimeline;
}) {
  return (
    input.nextName !== input.existing.name ||
    input.nextSummary !== input.existing.summary ||
    input.nextMandateText !== input.existing.mandateText ||
    input.nextScheduleCron !== (input.existing.scheduleCron || null) ||
    JSON.stringify(input.nextEventSubscriptions) !==
      JSON.stringify(toStringArray(input.existing.eventSubscriptions)) ||
    JSON.stringify(input.nextAllowedActionTypes) !==
      JSON.stringify(toActionTypeArray(input.existing.allowedActionTypes)) ||
    JSON.stringify(input.nextGuardrails) !== JSON.stringify(toRecord(input.existing.guardrails)) ||
    JSON.stringify(input.nextTimeline) !==
      JSON.stringify(
        normalizeAgentStrategyTimeline(toRecord(input.existing.normalizedRuleSheet), {
          objective: input.existing.summary,
          mandate: input.existing.mandateText,
          scheduleCron: input.existing.scheduleCron || null,
          eventSubscriptions: toStringArray(input.existing.eventSubscriptions),
          allowedActionTypes: toActionTypeArray(input.existing.allowedActionTypes),
          rawTimingInstruction:
            typeof toRecord(input.existing.normalizedRuleSheet).rawTimingInstruction === "string"
              ? (toRecord(input.existing.normalizedRuleSheet).rawTimingInstruction as string)
              : null,
        }),
      )
  );
}

async function appendStrategySeedMessage(input: {
  userId: string;
  threadId: string;
  strategyName: string;
  sourceThreadTitle?: string | null;
}) {
  const contentText = input.sourceThreadTitle
    ? `This strategy was created from "${input.sourceThreadTitle}". Use this chat to refine how ${input.strategyName} should run over time.`
    : `Use this chat to build and refine how ${input.strategyName} should run over time.`;

  await db.insert(userAgentMessages).values({
    threadId: input.threadId,
    userId: input.userId,
    role: "assistant",
    messageType: "chat",
    contentText,
    structuredPayload: {
      generatedBy: "assistant",
      summary: contentText,
      warnings: [],
      actions: [],
      citations: [],
      toolTrace: [],
      skillsUsed: [],
      memoryInfluences: [],
      confirmationPreview: null,
      uiBlocks: [
        {
          type: "goal_strip",
          slot: "strategy_overview",
          priority: 10,
          props: {
            eyebrow: "Strategy",
            title: input.strategyName,
            status: "draft",
            summary: input.sourceThreadTitle
              ? `This strategy started from "${input.sourceThreadTitle}" and now has its own dedicated workspace.`
              : "This is a fresh strategy workspace with its own dedicated chat.",
            nextStep: "Use the strategy chat to define the schedule, rules, and desired behavior.",
            badge: "building",
          },
        },
        {
          type: "strategy_draft",
          slot: "strategy_overview",
          priority: 20,
          props: {
            title: input.strategyName,
            summary:
              "Keep refining the idea until the recurring behavior, schedule, and limits are clear.",
            missingDetails: ["schedule", "actions", "limits"],
          },
        },
      ],
      status: "completed",
      pendingClarification: null,
    },
  });
}

export function buildNormalizedStrategyRuleSheet(input: {
  threadId: string;
  threadTitle: string | null;
  threadDomain: string;
  name: string;
  summary: string;
  mandateText: string;
  latestUserInstruction: string | null;
  latestHermesUpdate: string | null;
  pendingBundleSummary: string | null;
  scheduleCron: string | null;
  eventSubscriptions: string[];
  allowedActionTypes: AgentAction["actionType"][];
  guardrails: Record<string, unknown>;
  rawTimingInstruction?: string | null;
  timeline?: AgentStrategyTimeline | null;
  reviewState?: {
    status: AgentStrategyReviewStatus;
    reviewedAt: Date | null;
    lastMaterialUpdateAt: Date | null;
    summary: string | null;
  };
}) {
  const savedAt = new Date();
  const timeline = buildTimelineFromInputs({
    objective: input.summary,
    mandateText: input.mandateText,
    scheduleCron: input.scheduleCron,
    eventSubscriptions: input.eventSubscriptions,
    allowedActionTypes: input.allowedActionTypes,
    rawTimingInstruction: input.rawTimingInstruction || null,
    existingTimeline: input.timeline || null,
  });
  const currentStage =
    timeline.stages.find((stage) => stage.id === timeline.currentStageId) ||
    timeline.stages[0] ||
    null;

  return {
    thread: {
      id: input.threadId,
      title: input.threadTitle,
      domain: input.threadDomain,
    },
    mandate: input.mandateText,
    objective: input.summary,
    latestUserInstruction: input.latestUserInstruction,
    latestHermesUpdate: input.latestHermesUpdate,
    pendingBundleSummary: input.pendingBundleSummary,
    rawTimingInstruction: input.rawTimingInstruction || null,
    timeline,
    currentStageId: timeline.currentStageId,
    triggerPolicy: {
      scheduleCron: input.scheduleCron,
      eventSubscriptions: input.eventSubscriptions,
    },
    currentTrigger: currentStage?.triggerPolicy || null,
    executionEnvelope: {
      allowedActionTypes: input.allowedActionTypes,
      guardrails: input.guardrails,
    },
    reviewState: serializeStrategyReviewState(
      input.reviewState || buildPendingReviewState(savedAt),
    ),
    savedAt: savedAt.toISOString(),
    strategyName: input.name,
  } satisfies Record<string, unknown>;
}

async function countSavedStrategies(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userAgentStrategies)
    .where(and(eq(userAgentStrategies.userId, userId), isNull(userAgentStrategies.archivedAt)))
    .limit(1);

  return row?.count || 0;
}

async function countOtherLiveStrategies(userId: string, strategyId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userAgentStrategies)
    .where(
      and(
        eq(userAgentStrategies.userId, userId),
        eq(userAgentStrategies.status, "live"),
        isNull(userAgentStrategies.archivedAt),
        ne(userAgentStrategies.id, strategyId),
      ),
    )
    .limit(1);

  return row?.count || 0;
}

async function getStrategyRow(userId: string, strategyId: string) {
  const [row] = await db
    .select()
    .from(userAgentStrategies)
    .where(and(eq(userAgentStrategies.userId, userId), eq(userAgentStrategies.id, strategyId)))
    .limit(1);

  if (!row) {
    throw new Error("Strategy not found");
  }

  return row;
}

export async function ensureUserAgentStrategySchema(): Promise<void> {
  if (agentStrategySchemaEnsured) {
    return;
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_strategies" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "source_thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
      "name" text NOT NULL,
      "summary" text NOT NULL,
      "mandate_text" text NOT NULL,
      "normalized_rule_sheet" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "status" text NOT NULL DEFAULT 'draft',
      "schedule_cron" text,
      "event_subscriptions" jsonb NOT NULL DEFAULT '["schedule"]'::jsonb,
      "allowed_action_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "guardrails" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "linked_skill_id" varchar,
      "last_outcome_summary" text,
      "last_run_at" timestamp,
      "next_run_at" timestamp,
      "activated_at" timestamp,
      "paused_at" timestamp,
      "archived_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategies_user_status_updated_idx"
      ON "user_agent_strategies" ("user_id", "status", "updated_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategies_user_archived_idx"
      ON "user_agent_strategies" ("user_id", "archived_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategies_thread_idx"
      ON "user_agent_strategies" ("source_thread_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_strategy_runs" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "strategy_id" varchar NOT NULL REFERENCES "user_agent_strategies"("id") ON DELETE CASCADE,
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
      "hermes_run_id" varchar REFERENCES "user_agent_runs"("id") ON DELETE SET NULL,
      "runtime_session_id" varchar,
      "runtime_transport" text,
      "runtime_endpoint" text,
      "runtime_correlation_id" text,
      "trigger_source" text NOT NULL DEFAULT 'manual',
      "status" text NOT NULL DEFAULT 'pending',
      "outcome_summary" text,
      "tool_trace" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "applied_actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "adaptation_notes" text,
      "failure_reason" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "completed_at" timestamp
    );
  `);

  await db.execute(sql`
    ALTER TABLE "user_agent_strategy_runs"
      ADD COLUMN IF NOT EXISTS "runtime_session_id" varchar;
  `);
  await db.execute(sql`
    ALTER TABLE "user_agent_strategy_runs"
      ADD COLUMN IF NOT EXISTS "runtime_transport" text;
  `);
  await db.execute(sql`
    ALTER TABLE "user_agent_strategy_runs"
      ADD COLUMN IF NOT EXISTS "runtime_endpoint" text;
  `);
  await db.execute(sql`
    ALTER TABLE "user_agent_strategy_runs"
      ADD COLUMN IF NOT EXISTS "runtime_correlation_id" text;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategy_runs_strategy_created_idx"
      ON "user_agent_strategy_runs" ("strategy_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategy_runs_user_created_idx"
      ON "user_agent_strategy_runs" ("user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategy_runs_status_created_idx"
      ON "user_agent_strategy_runs" ("status", "created_at");
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_strategy_runs_active_strategy_unique_idx"
      ON "user_agent_strategy_runs" ("strategy_id")
      WHERE "status" = 'running';
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_strategy_events" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "strategy_id" varchar NOT NULL REFERENCES "user_agent_strategies"("id") ON DELETE CASCADE,
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "strategy_run_id" varchar REFERENCES "user_agent_strategy_runs"("id") ON DELETE SET NULL,
      "event_type" text NOT NULL,
      "status" text NOT NULL DEFAULT 'info',
      "title" text NOT NULL,
      "summary" text,
      "event_key" text,
      "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategy_events_strategy_created_idx"
      ON "user_agent_strategy_events" ("strategy_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategy_events_user_created_idx"
      ON "user_agent_strategy_events" ("user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategy_events_type_created_idx"
      ON "user_agent_strategy_events" ("event_type", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_strategy_events_strategy_event_key_idx"
      ON "user_agent_strategy_events" ("strategy_id", "event_key");
  `);

  agentStrategySchemaEnsured = true;
}

export async function listUserAgentStrategies(userId: string): Promise<AgentStrategyRecord[]> {
  await ensureUserAgentStrategySchema();

  const rows = await db
    .select()
    .from(userAgentStrategies)
    .where(and(eq(userAgentStrategies.userId, userId), isNull(userAgentStrategies.archivedAt)))
    .orderBy(desc(userAgentStrategies.updatedAt));

  const strategies = rows.map(mapStrategyRow);
  if (strategies.length === 0) {
    return [];
  }

  const runRows = await db
    .select()
    .from(userAgentStrategyRuns)
    .where(
      and(
        eq(userAgentStrategyRuns.userId, userId),
        inArray(
          userAgentStrategyRuns.strategyId,
          strategies.map((strategy) => strategy.id),
        ),
      ),
    )
    .orderBy(desc(userAgentStrategyRuns.createdAt))
    .limit(strategies.length * 4);

  const recentRunsByStrategy = new Map<string, AgentStrategyRunRecord[]>();
  for (const row of runRows) {
    const mapped = mapStrategyRunRow(row);
    const existing = recentRunsByStrategy.get(mapped.strategyId) || [];
    if (existing.length >= 3) {
      continue;
    }
    existing.push(mapped);
    recentRunsByStrategy.set(mapped.strategyId, existing);
  }

  return strategies
    .map((strategy) => ({
      ...strategy,
      recentRuns: recentRunsByStrategy.get(strategy.id) || [],
    }))
    .sort(
      (left, right) =>
        Number(right.status === "live") - Number(left.status === "live") ||
        right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
}

export async function listUserAgentStrategyRuns(input: {
  userId: string;
  strategyId: string;
  limit?: number;
}): Promise<AgentStrategyRunRecord[]> {
  await ensureUserAgentStrategySchema();

  const rows = await db
    .select()
    .from(userAgentStrategyRuns)
    .where(
      and(
        eq(userAgentStrategyRuns.userId, input.userId),
        eq(userAgentStrategyRuns.strategyId, input.strategyId),
      ),
    )
    .orderBy(desc(userAgentStrategyRuns.createdAt))
    .limit(Math.max(1, Math.min(input.limit || 10, 50)));

  return rows.map(mapStrategyRunRow);
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function getBuySpend(action: AgentAction): number {
  if (action.actionType !== "pool_buy") {
    return 0;
  }

  return Math.max(0, toFiniteNumber(action.sbAmount));
}

function getBuyShares(action: AgentAction): number {
  if (action.actionType !== "pool_buy") {
    return 0;
  }

  return Math.max(0, toFiniteNumber(action.estimatedSharesOut));
}

function getSellProceeds(action: AgentAction): number {
  if (action.actionType !== "pool_sell") {
    return 0;
  }

  return Math.max(0, toFiniteNumber(action.estimatedSbOut));
}

function getSellShares(action: AgentAction): number {
  if (action.actionType !== "pool_sell") {
    return 0;
  }

  return Math.max(0, toFiniteNumber(action.sharesAmount));
}

export async function recordUserAgentStrategyEvent(input: {
  userId: string;
  strategyId: string;
  strategyRunId?: string | null;
  eventType: string;
  status?: AgentStrategyEventRecord["status"];
  title: string;
  summary?: string | null;
  eventKey?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<AgentStrategyEventRecord> {
  await ensureUserAgentStrategySchema();

  if (input.eventKey) {
    const [existing] = await db
      .select()
      .from(userAgentStrategyEvents)
      .where(
        and(
          eq(userAgentStrategyEvents.strategyId, input.strategyId),
          eq(userAgentStrategyEvents.eventKey, input.eventKey),
        ),
      )
      .limit(1);

    if (existing) {
      return mapStrategyEventRow(existing);
    }
  }

  const [created] = await db
    .insert(userAgentStrategyEvents)
    .values({
      strategyId: input.strategyId,
      userId: input.userId,
      strategyRunId: input.strategyRunId || null,
      eventType: input.eventType,
      status: input.status || "info",
      title: input.title,
      summary: input.summary || null,
      eventKey: input.eventKey || null,
      metadata: input.metadata || {},
    })
    .returning();

  return mapStrategyEventRow(created);
}

export async function listUserAgentStrategyEvents(input: {
  userId: string;
  strategyId: string;
  limit?: number;
}): Promise<AgentStrategyEventRecord[]> {
  await ensureUserAgentStrategySchema();

  const rows = await db
    .select()
    .from(userAgentStrategyEvents)
    .where(
      and(
        eq(userAgentStrategyEvents.userId, input.userId),
        eq(userAgentStrategyEvents.strategyId, input.strategyId),
      ),
    )
    .orderBy(desc(userAgentStrategyEvents.createdAt))
    .limit(Math.max(1, Math.min(input.limit || 20, 100)));

  return rows.map(mapStrategyEventRow);
}

async function buildStrategyPerformanceSummary(input: {
  userId: string;
  strategyId: string;
  runs: AgentStrategyRunRecord[];
}): Promise<AgentStrategyPerformanceSummary> {
  const appliedRuns = input.runs.filter((run) => run.appliedActions.length > 0);
  const positionState = new Map<
    string,
    {
      netShares: number;
      estimatedCostBasis: number;
      playerName: string | null;
      team: string | null;
    }
  >();
  const scoutTargets = new Map<string, number>();

  let buyActionCount = 0;
  let sellActionCount = 0;
  let scoutActionCount = 0;
  let watchlistActionCount = 0;
  let boostActionCount = 0;
  let estimatedSpentSb = 0;
  let estimatedRealizedSb = 0;
  let lastAppliedAt: Date | null = null;

  for (const run of appliedRuns) {
    if (!lastAppliedAt || run.createdAt > lastAppliedAt) {
      lastAppliedAt = run.createdAt;
    }

    for (const action of run.appliedActions) {
      if (action.actionType === "pool_buy") {
        buyActionCount += 1;
        const shares = getBuyShares(action);
        const spend = getBuySpend(action);
        estimatedSpentSb += spend;
        const existing = positionState.get(action.playerId) || {
          netShares: 0,
          estimatedCostBasis: 0,
          playerName: action.playerName || null,
          team: null,
        };
        existing.netShares += shares;
        existing.estimatedCostBasis += spend;
        if (!existing.playerName && action.playerName) {
          existing.playerName = action.playerName;
        }
        positionState.set(action.playerId, existing);
        continue;
      }

      if (action.actionType === "pool_sell") {
        sellActionCount += 1;
        const shares = getSellShares(action);
        const proceeds = getSellProceeds(action);
        estimatedRealizedSb += proceeds;
        const existing = positionState.get(action.playerId) || {
          netShares: 0,
          estimatedCostBasis: 0,
          playerName: action.playerName || null,
          team: null,
        };
        existing.netShares = Math.max(0, existing.netShares - shares);
        positionState.set(action.playerId, existing);
        continue;
      }

      if (action.actionType === "scout_set_count") {
        scoutActionCount += 1;
        scoutTargets.set(action.playerId, Math.max(0, toFiniteNumber(action.targetCount)));
        continue;
      }

      if (
        action.actionType === "watchlist_add_player" ||
        action.actionType === "watchlist_remove_player"
      ) {
        watchlistActionCount += 1;
        continue;
      }

      if (
        action.actionType === "daily_boost_assign" ||
        action.actionType === "daily_boost_remove"
      ) {
        boostActionCount += 1;
      }
    }
  }

  const openPlayerIds = Array.from(positionState.entries())
    .filter(([, position]) => position.netShares > 0)
    .map(([playerId]) => playerId);

  const openPoolRows =
    openPlayerIds.length > 0
      ? await db
          .select({
            playerId: playerPools.playerId,
            firstName: players.firstName,
            lastName: players.lastName,
            team: players.team,
            shares: playerPools.shares,
            playMoney: playerPools.playMoney,
          })
          .from(playerPools)
          .innerJoin(players, eq(playerPools.playerId, players.id))
          .where(inArray(playerPools.playerId, openPlayerIds))
      : [];

  const poolRowByPlayerId = new Map(openPoolRows.map((row) => [row.playerId, row]));
  const positions = Array.from(positionState.entries())
    .filter(([, position]) => position.netShares > 0)
    .map(([playerId, position]) => {
      const poolRow = poolRowByPlayerId.get(playerId);
      const estimatedCurrentPrice =
        poolRow && toFiniteNumber(poolRow.shares) > 0
          ? roundToTwo(toFiniteNumber(poolRow.playMoney) / toFiniteNumber(poolRow.shares))
          : null;
      const estimatedCurrentValue =
        estimatedCurrentPrice !== null
          ? roundToTwo(position.netShares * estimatedCurrentPrice)
          : null;
      const estimatedUnrealizedPnl =
        estimatedCurrentValue !== null
          ? roundToTwo(estimatedCurrentValue - position.estimatedCostBasis)
          : null;

      return {
        playerId,
        playerName:
          position.playerName ||
          (poolRow ? `${poolRow.firstName || ""} ${poolRow.lastName || ""}`.trim() : null),
        team: position.team || poolRow?.team || null,
        netShares: roundToTwo(position.netShares),
        estimatedCostBasis: roundToTwo(position.estimatedCostBasis),
        estimatedCurrentPrice,
        estimatedCurrentValue,
        estimatedUnrealizedPnl,
      };
    })
    .sort(
      (left, right) =>
        (right.estimatedCurrentValue || 0) - (left.estimatedCurrentValue || 0) ||
        (left.playerName || "").localeCompare(right.playerName || ""),
    );

  const estimatedCurrentValueSb = roundToTwo(
    positions.reduce((total, position) => total + (position.estimatedCurrentValue || 0), 0),
  );

  return {
    appliedRunCount: appliedRuns.length,
    completedRunCount: input.runs.filter((run) => run.status === "completed").length,
    blockedRunCount: input.runs.filter((run) => run.status === "blocked").length,
    failedRunCount: input.runs.filter((run) => run.status === "failed").length,
    buyActionCount,
    sellActionCount,
    scoutActionCount,
    watchlistActionCount,
    boostActionCount,
    estimatedSpentSb: roundToTwo(estimatedSpentSb),
    estimatedRealizedSb: roundToTwo(estimatedRealizedSb),
    estimatedCurrentValueSb,
    estimatedNetPnlSb: roundToTwo(estimatedRealizedSb + estimatedCurrentValueSb - estimatedSpentSb),
    openPositionCount: positions.length,
    openScoutTargetCount: Array.from(scoutTargets.values()).reduce(
      (total, count) => total + count,
      0,
    ),
    lastAppliedAt,
    positions,
  };
}

export async function getUserAgentStrategyDetail(
  userId: string,
  strategyId: string,
): Promise<AgentStrategyDetailRecord> {
  await ensureUserAgentStrategySchema();
  const row = await getStrategyRow(userId, strategyId);
  const strategy = mapStrategyRow(row);
  const [recentRuns, recentEvents, performanceRunRows] = await Promise.all([
    listUserAgentStrategyRuns({ userId, strategyId, limit: 20 }),
    listUserAgentStrategyEvents({ userId, strategyId, limit: 30 }),
    db
      .select()
      .from(userAgentStrategyRuns)
      .where(
        and(
          eq(userAgentStrategyRuns.userId, userId),
          eq(userAgentStrategyRuns.strategyId, strategyId),
        ),
      )
      .orderBy(desc(userAgentStrategyRuns.createdAt))
      .limit(500),
  ]);

  const performance = await buildStrategyPerformanceSummary({
    userId,
    strategyId,
    runs: performanceRunRows.map(mapStrategyRunRow),
  });
  const continuity = await buildAgentContinuityState({
    userId,
    threadId: strategy.sourceThreadId,
    strategyId,
  });

  return {
    ...strategy,
    recentRuns,
    recentEvents,
    performance,
    continuity,
  };
}

export async function createUserAgentStrategyFromThread(
  userId: string,
  input: unknown,
): Promise<AgentStrategyRecord> {
  await ensureUserAgentStrategySchema();
  const data = createAgentStrategyInputSchema.parse(input);

  const savedCount = await countSavedStrategies(userId);
  assertCanSaveStrategy(savedCount);

  const sourceThread =
    data.threadId?.trim() && data.threadId.trim().length > 0
      ? await getAgentThread(userId, data.threadId.trim())
      : null;
  const sourceMessages =
    sourceThread && data.threadId
      ? await listAgentThreadMessages(userId, data.threadId.trim())
      : [];
  const latestUserMessage = [...sourceMessages]
    .filter((message) => message.role === "user")
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  const latestAssistantMessage = [...sourceMessages]
    .filter((message) => message.role === "assistant")
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  const inferredAllowedActionTypes =
    sourceThread?.pendingActionBundle?.actions?.map((action) => action.actionType) || [];
  const allowedActionTypes = Array.from(
    new Set(
      (data.allowedActionTypes && data.allowedActionTypes.length > 0
        ? data.allowedActionTypes
        : inferredAllowedActionTypes) as AgentAction["actionType"][],
    ),
  );
  const summary =
    data.summary?.trim() ||
    sourceThread?.pendingActionBundle?.summary ||
    latestAssistantMessage?.contentText ||
    latestUserMessage?.contentText ||
    sourceThread?.title ||
    "New strategy";
  const mandateText =
    data.mandateText?.trim() ||
    latestUserMessage?.contentText ||
    sourceThread?.pendingActionBundle?.summary ||
    summary;
  const name = buildDefaultStrategyName(
    data.name?.trim() || sourceThread?.title || summary,
    savedCount,
  );
  const eventSubscriptions = Array.from(
    new Set(
      (data.eventSubscriptions && data.eventSubscriptions.length > 0
        ? data.eventSubscriptions
        : ["schedule"]) as string[],
    ),
  );
  const guardrails = buildDefaultStrategyGuardrails(data.guardrails);
  const reviewState = buildPendingReviewState(new Date());
  const conversationThread = await createAgentThread(userId, {
    channel: "in_app",
    domain: "sportfolio",
    title: name,
    workspace: "strategy",
  });

  const normalizedRuleSheet = buildNormalizedStrategyRuleSheet({
    threadId: conversationThread.id,
    threadTitle: conversationThread.title,
    threadDomain: conversationThread.domain,
    name,
    summary,
    mandateText,
    latestUserInstruction: latestUserMessage?.contentText || null,
    latestHermesUpdate: latestAssistantMessage?.contentText || null,
    pendingBundleSummary: sourceThread?.pendingActionBundle?.summary || null,
    scheduleCron: data.scheduleCron || null,
    eventSubscriptions,
    allowedActionTypes,
    guardrails,
    rawTimingInstruction: data.scheduleCron || null,
    reviewState,
  });

  const [created] = await db
    .insert(userAgentStrategies)
    .values({
      userId,
      sourceThreadId: conversationThread.id,
      name,
      summary,
      mandateText,
      normalizedRuleSheet,
      status: "draft",
      scheduleCron: data.scheduleCron || null,
      eventSubscriptions,
      allowedActionTypes,
      guardrails,
      linkedSkillId: data.linkedSkillId || null,
      updatedAt: new Date(),
    })
    .returning();

  await updateAgentThreadMetadata({
    userId,
    threadId: conversationThread.id,
    workspace: "strategy",
    strategyId: created.id,
    title: name,
  });

  if (sourceThread) {
    await appendStrategySeedMessage({
      userId,
      threadId: conversationThread.id,
      strategyName: name,
      sourceThreadTitle: sourceThread.title,
    });
  }

  await recordUserAgentStrategyEvent({
    userId,
    strategyId: created.id,
    eventType: "created",
    status: "success",
    title: "Strategy created",
    summary: sourceThread
      ? `${name} was created from your chat and now has its own strategy conversation.`
      : `${name} is ready for you to build out in its own strategy conversation.`,
  });

  await recordUserAgentStrategyEvent({
    userId,
    strategyId: created.id,
    eventType: "review_required",
    status: "warning",
    title: "Review needed before activation",
    summary: reviewState.summary,
  });

  return mapStrategyRow(created);
}

export async function updateUserAgentStrategy(
  userId: string,
  strategyId: string,
  input: unknown,
): Promise<AgentStrategyRecord> {
  await ensureUserAgentStrategySchema();
  const data = updateAgentStrategyInputSchema.parse(input);
  const existing = await getStrategyRow(userId, strategyId);

  const nextName = data.name?.trim() || existing.name;
  const nextSummary = data.summary?.trim() || existing.summary;
  const nextMandateText = data.mandateText?.trim() || existing.mandateText;
  const nextScheduleCron =
    data.scheduleCron === undefined ? existing.scheduleCron : data.scheduleCron || null;
  const nextEventSubscriptions =
    data.eventSubscriptions !== undefined
      ? Array.from(new Set(data.eventSubscriptions))
      : toStringArray(existing.eventSubscriptions);
  const nextAllowedActionTypes: AgentAction["actionType"][] =
    data.allowedActionTypes !== undefined
      ? Array.from(new Set<AgentAction["actionType"]>(data.allowedActionTypes))
      : toActionTypeArray(existing.allowedActionTypes);
  const nextGuardrails =
    data.guardrails !== undefined
      ? data.guardrails
      : existing.guardrails && typeof existing.guardrails === "object"
        ? (existing.guardrails as Record<string, unknown>)
        : {};
  const existingRuleSheet = toRecord(existing.normalizedRuleSheet);
  const existingReviewState = getStrategyReviewState(existingRuleSheet.reviewState);
  const existingTimeline = normalizeAgentStrategyTimeline(existingRuleSheet, {
    objective: existing.summary,
    mandate: existing.mandateText,
    scheduleCron: existing.scheduleCron || null,
    eventSubscriptions: toStringArray(existing.eventSubscriptions),
    allowedActionTypes: toActionTypeArray(existing.allowedActionTypes),
    rawTimingInstruction:
      typeof existingRuleSheet.rawTimingInstruction === "string"
        ? (existingRuleSheet.rawTimingInstruction as string)
        : null,
  });
  const nextTimeline = data.normalizedRuleSheet
    ? normalizeAgentStrategyTimeline(data.normalizedRuleSheet, {
        objective: nextSummary,
        mandate: nextMandateText,
        scheduleCron: nextScheduleCron,
        eventSubscriptions: nextEventSubscriptions,
        allowedActionTypes: nextAllowedActionTypes,
        rawTimingInstruction:
          typeof data.normalizedRuleSheet.rawTimingInstruction === "string"
            ? data.normalizedRuleSheet.rawTimingInstruction
            : null,
      })
    : buildTimelineFromInputs({
        objective: nextSummary,
        mandateText: nextMandateText,
        scheduleCron: nextScheduleCron,
        eventSubscriptions: nextEventSubscriptions,
        allowedActionTypes: nextAllowedActionTypes,
        rawTimingInstruction:
          typeof (existing.normalizedRuleSheet as Record<string, unknown>).rawTimingInstruction ===
          "string"
            ? ((existing.normalizedRuleSheet as Record<string, unknown>)
                .rawTimingInstruction as string)
            : nextScheduleCron,
        existingTimeline,
      });
  const hasMaterialChanges = hasStrategyMaterialChanges({
    existing,
    nextName,
    nextSummary,
    nextMandateText,
    nextScheduleCron,
    nextEventSubscriptions,
    nextAllowedActionTypes,
    nextGuardrails,
    nextTimeline,
  });
  const reviewState = hasMaterialChanges
    ? buildPendingReviewState(
        new Date(),
        existing.status === "live"
          ? "Review the updated stages and limits before Hermes can run this strategy live again."
          : "Review the updated stages, triggers, and action scope before activation.",
      )
    : existingReviewState;
  const nextStatus =
    hasMaterialChanges && existing.status === "live"
      ? ("paused" as const)
      : (existing.status as AgentStrategyRecord["status"]);

  const normalizedRuleSheet = buildNormalizedStrategyRuleSheet({
    threadId: existing.sourceThreadId || "detached",
    threadTitle: null,
    threadDomain: "sportfolio",
    name: nextName,
    summary: nextSummary,
    mandateText: nextMandateText,
    latestUserInstruction:
      typeof existingRuleSheet.latestUserInstruction === "string"
        ? (existingRuleSheet.latestUserInstruction as string)
        : null,
    latestHermesUpdate:
      typeof existingRuleSheet.latestHermesUpdate === "string"
        ? (existingRuleSheet.latestHermesUpdate as string)
        : null,
    pendingBundleSummary:
      typeof existingRuleSheet.pendingBundleSummary === "string"
        ? (existingRuleSheet.pendingBundleSummary as string)
        : null,
    scheduleCron: nextScheduleCron,
    eventSubscriptions: nextEventSubscriptions,
    allowedActionTypes: nextAllowedActionTypes,
    guardrails: nextGuardrails,
    rawTimingInstruction:
      typeof (data.normalizedRuleSheet as Record<string, unknown> | undefined)
        ?.rawTimingInstruction === "string"
        ? ((data.normalizedRuleSheet as Record<string, unknown>).rawTimingInstruction as string)
        : typeof existingRuleSheet.rawTimingInstruction === "string"
          ? (existingRuleSheet.rawTimingInstruction as string)
          : nextScheduleCron,
    timeline: nextTimeline,
    reviewState,
  });
  const nextRunAt =
    nextStatus === "live"
      ? computeStrategyNextRunAt(
          mapStrategyRow({
            ...existing,
            name: nextName,
            summary: nextSummary,
            mandateText: nextMandateText,
            status: nextStatus,
            scheduleCron: nextScheduleCron,
            eventSubscriptions: nextEventSubscriptions,
            allowedActionTypes: nextAllowedActionTypes,
            guardrails: nextGuardrails,
            normalizedRuleSheet,
          }),
          new Date(),
        )
      : nextStatus === "paused"
        ? null
        : existing.nextRunAt;

  const [updated] = await db
    .update(userAgentStrategies)
    .set({
      status: nextStatus,
      name: nextName,
      summary: nextSummary,
      mandateText: nextMandateText,
      scheduleCron: nextScheduleCron,
      eventSubscriptions: nextEventSubscriptions,
      allowedActionTypes: nextAllowedActionTypes,
      guardrails: nextGuardrails,
      linkedSkillId:
        data.linkedSkillId === undefined ? existing.linkedSkillId : data.linkedSkillId || null,
      lastOutcomeSummary:
        data.lastOutcomeSummary === undefined
          ? existing.lastOutcomeSummary
          : data.lastOutcomeSummary || null,
      nextRunAt,
      normalizedRuleSheet,
      updatedAt: new Date(),
    })
    .where(eq(userAgentStrategies.id, strategyId))
    .returning();

  if (updated.sourceThreadId) {
    await updateAgentThreadMetadata({
      userId,
      threadId: updated.sourceThreadId,
      workspace: "strategy",
      strategyId: updated.id,
      title: nextName,
    });
  }

  await recordUserAgentStrategyEvent({
    userId,
    strategyId,
    eventType: "updated",
    status: "info",
    title: "Strategy updated",
    summary:
      hasMaterialChanges && existing.status === "live"
        ? `${nextName} was paused until you review the updated saved playbook.`
        : `${nextName} now uses the latest strategy details, schedule, and limits.`,
  });

  if (hasMaterialChanges) {
    await recordUserAgentStrategyEvent({
      userId,
      strategyId,
      eventType: "review_required",
      status: "warning",
      title:
        existing.status === "live" ? "Review required before going live again" : "Review required",
      summary: reviewState.summary,
    });
  }

  return mapStrategyRow(updated);
}

export async function activateUserAgentStrategy(
  userId: string,
  strategyId: string,
): Promise<AgentStrategyRecord> {
  await ensureUserAgentStrategySchema();
  const existing = await getStrategyRow(userId, strategyId);
  if (existing.archivedAt) {
    throw new Error("Archived strategies cannot be activated");
  }
  const reviewState = getStrategyReviewState(
    toRecord(toRecord(existing.normalizedRuleSheet).reviewState),
  );
  if (strategyRequiresReview(reviewState)) {
    throw new Error("Review the saved strategy changes before activating it.");
  }

  const liveCount = await countOtherLiveStrategies(userId, strategyId);
  assertCanActivateStrategy(liveCount);

  const now = new Date();
  const [updated] = await db
    .update(userAgentStrategies)
    .set({
      status: "live",
      activatedAt: existing.activatedAt || now,
      pausedAt: null,
      nextRunAt: computeStrategyNextRunAt(mapStrategyRow(existing), now),
      updatedAt: now,
    })
    .where(eq(userAgentStrategies.id, strategyId))
    .returning();

  await recordUserAgentStrategyEvent({
    userId,
    strategyId,
    eventType: "activated",
    status: "success",
    title: "Strategy live",
    summary: `${updated.name} is now holding the single live strategy slot.`,
  });

  return mapStrategyRow(updated);
}

export async function reviewUserAgentStrategy(
  userId: string,
  strategyId: string,
): Promise<AgentStrategyRecord> {
  await ensureUserAgentStrategySchema();
  const existing = await getStrategyRow(userId, strategyId);
  if (existing.archivedAt) {
    throw new Error("Archived strategies cannot be reviewed");
  }

  const existingRuleSheet = toRecord(existing.normalizedRuleSheet);
  const currentReviewState = getStrategyReviewState(existingRuleSheet.reviewState);
  const reviewedAt = new Date();
  const nextReviewState = buildApprovedReviewState({
    lastMaterialUpdateAt: currentReviewState.lastMaterialUpdateAt,
    reviewedAt,
  });
  const normalizedRuleSheet = {
    ...existingRuleSheet,
    reviewState: serializeStrategyReviewState(nextReviewState),
    savedAt: reviewedAt.toISOString(),
  } satisfies Record<string, unknown>;

  const [updated] = await db
    .update(userAgentStrategies)
    .set({
      normalizedRuleSheet,
      updatedAt: reviewedAt,
    })
    .where(eq(userAgentStrategies.id, strategyId))
    .returning();

  await recordUserAgentStrategyEvent({
    userId,
    strategyId,
    eventType: "reviewed",
    status: "success",
    title: "Strategy reviewed",
    summary: "The saved playbook was approved and can be activated when you are ready.",
  });

  return mapStrategyRow(updated);
}

export async function pauseUserAgentStrategy(
  userId: string,
  strategyId: string,
): Promise<AgentStrategyRecord> {
  await ensureUserAgentStrategySchema();
  await getStrategyRow(userId, strategyId);

  const now = new Date();
  const [updated] = await db
    .update(userAgentStrategies)
    .set({
      status: "paused",
      pausedAt: now,
      nextRunAt: null,
      updatedAt: now,
    })
    .where(eq(userAgentStrategies.id, strategyId))
    .returning();

  await recordUserAgentStrategyEvent({
    userId,
    strategyId,
    eventType: "paused",
    status: "warning",
    title: "Strategy paused",
    summary: `${updated.name} will not wake again until it is reactivated.`,
  });

  return mapStrategyRow(updated);
}

export async function archiveUserAgentStrategy(
  userId: string,
  strategyId: string,
): Promise<AgentStrategyRecord> {
  await ensureUserAgentStrategySchema();
  await getStrategyRow(userId, strategyId);

  const now = new Date();
  const [updated] = await db
    .update(userAgentStrategies)
    .set({
      status: "archived",
      archivedAt: now,
      nextRunAt: null,
      updatedAt: now,
    })
    .where(eq(userAgentStrategies.id, strategyId))
    .returning();

  await recordUserAgentStrategyEvent({
    userId,
    strategyId,
    eventType: "archived",
    status: "info",
    title: "Strategy archived",
    summary: `${updated.name} was moved out of the active strategy deck.`,
  });

  return mapStrategyRow(updated);
}

import {
  userAgentMessages,
  userAgentStrategyEvents,
  userAgentStrategyRuns,
  userAgentStrategies,
  userAgentThreads,
  type UserAgentStrategy,
} from "@shared/schema";
import { normalizeAgentStrategyTimeline } from "@shared/agent-strategy";
import { and, eq, gt, gte, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "../db";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { executeAgentActions } from "./executor";
import {
  buildDefaultStrategyGuardrails,
  DEFAULT_AUTONOMOUS_STRATEGY_ACTION_TYPES,
  validateBroadStrategyActionMix,
} from "./strategy-policy";
import { analyzePortfolioAgent } from "./service";
import { ensureUserAgentStrategySchema, recordUserAgentStrategyEvent } from "./strategies";
import {
  advanceStrategyTimelineAfterRun,
  buildStrategyStagePrompt,
  computeStrategyNextRunAt,
  getActiveStrategyStage,
  getStageOutcomes,
  getStrategyStageEventTrigger,
  type StrategyStageOutcome,
} from "./strategy-timeline";
import { listAgentThreadMessages, listAgentThreadResearchSources } from "./thread-service";
import type { AgentAction, AgentStrategyRecord, AgentStrategyRunRecord } from "./types";

const MAX_CONVERSATION_HISTORY = 12;
const DEFAULT_STRATEGY_MAX_ACTIONS_PER_RUN = 3;
const DEFAULT_STRATEGY_MAX_ACTIONS_PER_DAY = 8;
const PAYMENT_BLOCKED_ACTION_PATTERN = /(payment|checkout|whop|premium_checkout|add_cash)/i;
const AUTO_EXECUTABLE_STRATEGY_ACTION_TYPES = new Set<AgentAction["actionType"]>(
  DEFAULT_AUTONOMOUS_STRATEGY_ACTION_TYPES,
);
const AUTO_EXECUTABLE_STRATEGY_ACTION_TYPE_SET = new Set<string>(
  DEFAULT_AUTONOMOUS_STRATEGY_ACTION_TYPES,
);

export type StrategyRunTrigger = "strategy_schedule" | "strategy_event" | "manual_retry";
const ACTIVE_STRATEGY_RUN_UNIQUE_INDEX = "user_agent_strategy_runs_active_strategy_unique_idx";
type StrategyWakeCursor = { updatedAt: Date; id: string };
let lastTriggeredWakeCursor: StrategyWakeCursor | null = null;

export class StrategyRunAlreadyInProgressError extends Error {
  constructor(strategyId: string) {
    super(`Strategy ${strategyId} already has an active run in progress.`);
    this.name = "StrategyRunAlreadyInProgressError";
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function toActionTypeArray(value: unknown): AgentAction["actionType"][] {
  return toStringArray(value).filter((entry): entry is AgentAction["actionType"] =>
    AUTO_EXECUTABLE_STRATEGY_ACTION_TYPE_SET.has(entry),
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function mapStrategyRow(row: UserAgentStrategy): AgentStrategyRecord {
  const normalizedRuleSheet = toRecord(row.normalizedRuleSheet);
  const allowedActionTypes = toActionTypeArray(row.allowedActionTypes);
  const reviewStateRecord = toRecord(normalizedRuleSheet.reviewState);
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
    guardrails: toRecord(row.guardrails),
    reviewState: {
      status: reviewStateRecord.status === "approved" ? "approved" : "pending",
      reviewedAt: toDateOrNull(reviewStateRecord.reviewedAt),
      lastMaterialUpdateAt: toDateOrNull(reviewStateRecord.lastMaterialUpdateAt),
      summary:
        typeof reviewStateRecord.summary === "string" && reviewStateRecord.summary.trim().length > 0
          ? reviewStateRecord.summary
          : null,
    },
    requiresReview: reviewStateRecord.status !== "approved",
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

function mapStrategyRunRow(row: typeof userAgentStrategyRuns.$inferSelect): AgentStrategyRunRecord {
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

function getGuardrailInteger(
  guardrails: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const rawValue = guardrails[key];
  const parsed =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string"
        ? Number.parseInt(rawValue, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function getGuardrailNumber(
  guardrails: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const rawValue = guardrails[key];
  const parsed =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string"
        ? Number.parseFloat(rawValue)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function buildStrategyOutcomeSummary(input: {
  strategy: AgentStrategyRecord;
  appliedActions: AgentAction[];
  assistantText: string | null | undefined;
  summary: string | null | undefined;
}) {
  if (input.summary?.trim()) {
    return input.summary.trim();
  }
  if (input.assistantText?.trim()) {
    return input.assistantText.trim();
  }
  if (input.appliedActions.length > 0) {
    return `Hermes applied ${input.appliedActions.length} action${input.appliedActions.length === 1 ? "" : "s"} for ${input.strategy.name}.`;
  }

  return `Hermes checked ${input.strategy.name} and did not apply any action.`;
}

function getActionEstimatedSpend(action: AgentAction): number {
  switch (action.actionType) {
    case "pool_buy":
      return toFiniteNumber(action.sbAmount);
    case "pool_add_liquidity":
      return toFiniteNumber(action.playMoney);
    case "pool_add_liquidity_optimal":
      return toFiniteNumber(action.maxPlayMoney);
    case "pool_zap_add_sb":
      return toFiniteNumber(action.sb);
    default:
      return 0;
  }
}

async function findFreshResearchWake(strategy: AgentStrategyRecord) {
  const activeStage =
    strategy.timeline.stages.find((stage) => stage.id === strategy.timeline.currentStageId) ||
    strategy.timeline.stages[0] ||
    null;

  if (
    !strategy.sourceThreadId ||
    activeStage?.triggerPolicy.anchor !== "research_refresh" ||
    activeStage.triggerPolicy.kind !== "event_window"
  ) {
    return null;
  }

  const sources = await listAgentThreadResearchSources(strategy.userId, strategy.sourceThreadId);
  const freshestSource = [...sources].sort(
    (left, right) => new Date(right.retrievedAt).getTime() - new Date(left.retrievedAt).getTime(),
  )[0];

  if (!freshestSource) {
    return null;
  }

  const retrievedAt = new Date(freshestSource.retrievedAt);
  if (strategy.lastRunAt && retrievedAt <= strategy.lastRunAt) {
    return null;
  }

  return {
    eventType: "research_refresh",
    title: "Fresh research arrived",
    summary: freshestSource.title || freshestSource.factSummary,
    eventKey: `research_refresh:${freshestSource.id}:${retrievedAt.toISOString()}`,
  };
}

async function getStrategyRowForRun(userId: string, strategyId: string) {
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

async function buildStrategyConversationHistory(userId: string, threadId: string) {
  const messages = await listAgentThreadMessages(userId, threadId);
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_CONVERSATION_HISTORY)
    .map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      contentText: message.contentText,
    }));
}

async function countAppliedActionsToday(strategyId: string): Promise<number> {
  const { startOfDay, endOfDay } = getETDayBoundaries(getTodayET());
  const rows = await db
    .select({ appliedActions: userAgentStrategyRuns.appliedActions })
    .from(userAgentStrategyRuns)
    .where(
      and(
        eq(userAgentStrategyRuns.strategyId, strategyId),
        gte(userAgentStrategyRuns.createdAt, startOfDay),
        lt(userAgentStrategyRuns.createdAt, endOfDay),
      ),
    );

  return rows.reduce((total, row) => {
    return total + (Array.isArray(row.appliedActions) ? row.appliedActions.length : 0);
  }, 0);
}

function validateStrategyActions(input: {
  strategy: AgentStrategyRecord;
  actions: AgentAction[];
  appliedActionCountToday: number;
}) {
  const effectiveGuardrails = buildDefaultStrategyGuardrails(input.strategy.guardrails);
  const maxActionsPerRun = getGuardrailInteger(
    effectiveGuardrails,
    "maxActionsPerRun",
    DEFAULT_STRATEGY_MAX_ACTIONS_PER_RUN,
  );
  const maxActionsPerDay = getGuardrailInteger(
    effectiveGuardrails,
    "maxActionsPerDay",
    DEFAULT_STRATEGY_MAX_ACTIONS_PER_DAY,
  );
  const maxSpendPerRun = getGuardrailNumber(effectiveGuardrails, "maxSpendPerRun", 0);

  if (input.actions.length > maxActionsPerRun) {
    throw new Error(
      `Hermes proposed ${input.actions.length} actions, which exceeds the strategy cap of ${maxActionsPerRun} per run.`,
    );
  }

  if (input.appliedActionCountToday + input.actions.length > maxActionsPerDay) {
    throw new Error(
      `Executing now would exceed the daily strategy cap of ${maxActionsPerDay} actions.`,
    );
  }

  if (maxSpendPerRun > 0) {
    const estimatedSpend = input.actions.reduce(
      (total, action) => total + getActionEstimatedSpend(action),
      0,
    );

    if (estimatedSpend > maxSpendPerRun) {
      throw new Error(
        `Executing now would exceed the spend cap of ${maxSpendPerRun.toFixed(2)} play money for one run.`,
      );
    }
  }

  for (const action of input.actions) {
    if (PAYMENT_BLOCKED_ACTION_PATTERN.test(action.actionType)) {
      throw new Error(
        `Action ${action.actionType} is not allowed because Hermes must never process payments or checkout flows.`,
      );
    }

    if (
      input.strategy.allowedActionTypes.length > 0 &&
      !input.strategy.allowedActionTypes.includes(action.actionType)
    ) {
      throw new Error(`Action ${action.actionType} is outside this strategy's saved action scope.`);
    }

    if (!AUTO_EXECUTABLE_STRATEGY_ACTION_TYPES.has(action.actionType)) {
      throw new Error(
        `Action ${action.actionType} is not in the live strategy auto-execution allowlist yet.`,
      );
    }
  }

  validateBroadStrategyActionMix({
    strategy: {
      mandateText: input.strategy.mandateText,
      guardrails: effectiveGuardrails,
    },
    actions: input.actions,
  });
}

async function appendStrategyAssistantMessage(input: {
  strategy: AgentStrategyRecord;
  runId: string;
  hermesRunId: string | null;
  contentText: string;
  messageType: "chat" | "result" | "error";
  summary: string | null;
  warnings: string[];
  citations: unknown[];
  toolTrace: unknown[];
  skillsUsed: string[];
  memoryInfluences: string[];
  confirmationPreview: unknown;
  uiBlocks: unknown[];
  runtimeTransport: "local" | "sidecar" | null;
}) {
  if (!input.strategy.sourceThreadId) {
    return;
  }

  const [message] = await db
    .insert(userAgentMessages)
    .values({
      threadId: input.strategy.sourceThreadId,
      userId: input.strategy.userId,
      role: "assistant",
      messageType: input.messageType,
      contentText: input.contentText,
      runId: input.hermesRunId,
      structuredPayload: {
        generatedBy: "hermes_strategy",
        strategyId: input.strategy.id,
        strategyName: input.strategy.name,
        strategyRunId: input.runId,
        summary: input.summary,
        warnings: input.warnings,
        citations: input.citations,
        toolTrace: input.toolTrace,
        skillsUsed: input.skillsUsed,
        memoryInfluences: input.memoryInfluences,
        confirmationPreview: input.confirmationPreview,
        uiBlocks: input.uiBlocks,
        runtimeTransport: input.runtimeTransport,
      },
    })
    .returning({ createdAt: userAgentMessages.createdAt });

  await db
    .update(userAgentThreads)
    .set({
      lastMessageAt: message.createdAt,
      updatedAt: message.createdAt,
    })
    .where(eq(userAgentThreads.id, input.strategy.sourceThreadId));
}

async function createPendingStrategyRun(input: {
  strategy: AgentStrategyRecord;
  triggerSource: StrategyRunTrigger;
}) {
  let row: typeof userAgentStrategyRuns.$inferSelect | undefined;
  try {
    [row] = await db
      .insert(userAgentStrategyRuns)
      .values({
        strategyId: input.strategy.id,
        userId: input.strategy.userId,
        threadId: input.strategy.sourceThreadId,
        triggerSource: input.triggerSource,
        status: "running",
      })
      .returning();
  } catch (error) {
    if (isActiveStrategyRunUniqueViolation(error)) {
      throw new StrategyRunAlreadyInProgressError(input.strategy.id);
    }
    throw error;
  }
  if (!row) {
    throw new Error(`Failed to create a running record for strategy ${input.strategy.id}.`);
  }

  return row;
}

function isActiveStrategyRunUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; constraint?: string } | null;
  return candidate?.code === "23505" && candidate.constraint === ACTIVE_STRATEGY_RUN_UNIQUE_INDEX;
}

async function listTriggeredStrategiesWithFairRotation(limit: number) {
  const baseWhere = and(
    eq(userAgentStrategies.status, "live"),
    isNull(userAgentStrategies.archivedAt),
  );
  const orderedRowsAfterCursor = lastTriggeredWakeCursor
    ? await db
        .select()
        .from(userAgentStrategies)
        .where(
          and(
            baseWhere,
            or(
              gt(userAgentStrategies.updatedAt, lastTriggeredWakeCursor.updatedAt),
              and(
                eq(userAgentStrategies.updatedAt, lastTriggeredWakeCursor.updatedAt),
                gt(userAgentStrategies.id, lastTriggeredWakeCursor.id),
              ),
            ),
          ),
        )
        .orderBy(userAgentStrategies.updatedAt, userAgentStrategies.id)
        .limit(limit)
    : [];

  if (orderedRowsAfterCursor.length >= limit) {
    return orderedRowsAfterCursor;
  }

  const remainingLimit = limit - orderedRowsAfterCursor.length;
  const wrapRows = await db
    .select()
    .from(userAgentStrategies)
    .where(baseWhere)
    .orderBy(userAgentStrategies.updatedAt, userAgentStrategies.id)
    .limit(remainingLimit);
  if (orderedRowsAfterCursor.length === 0) {
    return wrapRows;
  }

  const existingIds = new Set(orderedRowsAfterCursor.map((row) => row.id));
  return [...orderedRowsAfterCursor, ...wrapRows.filter((row) => !existingIds.has(row.id))];
}

function buildStageOutcome(input: {
  strategy: AgentStrategyRecord;
  appliedActions: AgentAction[];
  outcomeSummary: string | null;
  toolTrace: unknown[];
}): StrategyStageOutcome | null {
  const activeStage = getActiveStrategyStage(input.strategy);
  if (!activeStage) {
    return null;
  }

  const actionsSummary = input.appliedActions.map((action) => {
    const name = action.playerName || action.playerId;
    return `${action.actionType}: ${name}`;
  });

  const observations: string[] = [];
  if (input.outcomeSummary) {
    observations.push(input.outcomeSummary);
  }

  const traceObservations = (input.toolTrace as Array<{ summary?: string; status?: string }>)
    .filter((trace) => trace.status === "ok" && trace.summary)
    .map((trace) => trace.summary!)
    .slice(0, 3);
  observations.push(...traceObservations);

  const deferredItems: string[] = [];
  if (input.appliedActions.length === 0 && input.outcomeSummary) {
    deferredItems.push("No actions taken this run - conditions may not have been met yet.");
  }

  return {
    stageId: activeStage.id,
    stageTitle: activeStage.title,
    completedAt: new Date().toISOString(),
    actionsSummary,
    observations: observations.slice(0, 5),
    deferredItems,
  };
}

function mergeStageOutcomes(
  existing: StrategyStageOutcome[],
  newOutcome: StrategyStageOutcome | null,
): StrategyStageOutcome[] {
  if (!newOutcome) {
    return existing;
  }

  const filtered = existing.filter((outcome) => outcome.stageId !== newOutcome.stageId);
  return [...filtered, newOutcome].slice(-10);
}

async function finalizeStrategyRun(input: {
  strategy: AgentStrategyRecord;
  strategyRunId: string;
  hermesRunId: string | null;
  runtimeSessionId: string | null;
  runtimeTransport: "local" | "sidecar" | null;
  runtimeEndpoint: string | null;
  runtimeCorrelationId: string | null;
  status: string;
  outcomeSummary: string | null;
  toolTrace: unknown[];
  appliedActions: AgentAction[];
  adaptationNotes?: string | null;
  failureReason?: string | null;
  nextStatus?: AgentStrategyRecord["status"] | null;
}) {
  const now = new Date();
  const nextStatus = input.nextStatus || input.strategy.status;

  const stageOutcome =
    input.status === "applied" || input.status === "completed"
      ? buildStageOutcome({
          strategy: input.strategy,
          appliedActions: input.appliedActions,
          outcomeSummary: input.outcomeSummary,
          toolTrace: input.toolTrace,
        })
      : null;

  const nextTimeline =
    input.status === "applied" || input.status === "completed"
      ? advanceStrategyTimelineAfterRun(input.strategy)
      : input.strategy.timeline;
  const nextActiveStage =
    nextTimeline.stages.find((stage) => stage.id === nextTimeline.currentStageId) ||
    nextTimeline.stages[0] ||
    null;

  const existingOutcomes = getStageOutcomes(input.strategy);
  const mergedOutcomes = mergeStageOutcomes(existingOutcomes, stageOutcome);

  const nextNormalizedRuleSheet = {
    ...input.strategy.normalizedRuleSheet,
    timeline: nextTimeline,
    currentStageId: nextTimeline.currentStageId,
    currentTrigger: nextActiveStage?.triggerPolicy || null,
    stageOutcomes: mergedOutcomes,
    lastRunContext: {
      runId: input.strategyRunId,
      status: input.status,
      appliedActionCount: input.appliedActions.length,
      outcomeSummary: input.outcomeSummary,
      completedAt: now.toISOString(),
      activeStageId: getActiveStrategyStage(input.strategy)?.id || null,
    },
    savedAt: now.toISOString(),
  } satisfies Record<string, unknown>;
  const nextRunAt =
    nextStatus === "live"
      ? computeStrategyNextRunAt(
          {
            ...input.strategy,
            normalizedRuleSheet: nextNormalizedRuleSheet,
            timeline: nextTimeline,
          },
          now,
        )
      : null;

  const [runRow] = await db
    .update(userAgentStrategyRuns)
    .set({
      hermesRunId: input.hermesRunId,
      runtimeSessionId: input.runtimeSessionId,
      runtimeTransport: input.runtimeTransport,
      runtimeEndpoint: input.runtimeEndpoint,
      runtimeCorrelationId: input.runtimeCorrelationId,
      status: input.status,
      outcomeSummary: input.outcomeSummary,
      toolTrace: input.toolTrace,
      appliedActions: input.appliedActions,
      adaptationNotes: input.adaptationNotes || null,
      failureReason: input.failureReason || null,
      completedAt: now,
    })
    .where(eq(userAgentStrategyRuns.id, input.strategyRunId))
    .returning();

  await db
    .update(userAgentStrategies)
    .set({
      status: nextStatus,
      lastRunAt: now,
      lastOutcomeSummary: input.outcomeSummary,
      nextRunAt,
      normalizedRuleSheet: nextNormalizedRuleSheet,
      updatedAt: now,
    })
    .where(eq(userAgentStrategies.id, input.strategy.id));

  return mapStrategyRunRow(runRow);
}

async function blockStrategyRun(input: {
  strategy: AgentStrategyRecord;
  strategyRunId: string;
  hermesRunId: string | null;
  runtimeSessionId: string | null;
  runtimeTransport: "local" | "sidecar" | null;
  runtimeEndpoint: string | null;
  runtimeCorrelationId: string | null;
  toolTrace: unknown[];
  failureReason: string;
}) {
  return finalizeStrategyRun({
    strategy: input.strategy,
    strategyRunId: input.strategyRunId,
    hermesRunId: input.hermesRunId,
    runtimeSessionId: input.runtimeSessionId,
    runtimeTransport: input.runtimeTransport,
    runtimeEndpoint: input.runtimeEndpoint,
    runtimeCorrelationId: input.runtimeCorrelationId,
    status: "blocked",
    outcomeSummary: input.failureReason,
    toolTrace: input.toolTrace,
    appliedActions: [],
    failureReason: input.failureReason,
    nextStatus: "blocked",
  });
}

export async function runUserAgentStrategy(input: {
  userId: string;
  strategyId: string;
  triggerSource: StrategyRunTrigger;
  triggerLabel?: string | null;
  eventType?: string | null;
}): Promise<{
  strategy: AgentStrategyRecord;
  run: AgentStrategyRunRecord;
}> {
  await ensureUserAgentStrategySchema();
  const strategy = mapStrategyRow(await getStrategyRowForRun(input.userId, input.strategyId));
  if (strategy.archivedAt) {
    throw new Error("Archived strategies cannot run");
  }
  if (!strategy.sourceThreadId) {
    throw new Error("This strategy is no longer linked to a Hermes thread");
  }
  if (input.triggerSource === "strategy_schedule" && strategy.status !== "live") {
    throw new Error("Only live strategies can run on schedule");
  }
  if (input.triggerSource === "strategy_event" && strategy.status !== "live") {
    throw new Error("Only live strategies can run from a strategy event wakeup");
  }
  if (
    input.triggerSource === "manual_retry" &&
    strategy.status !== "live" &&
    strategy.status !== "blocked"
  ) {
    throw new Error("Only live or blocked strategies can be run manually");
  }

  const pendingRun = await createPendingStrategyRun({
    strategy,
    triggerSource: input.triggerSource,
  });

  try {
    const conversationHistory = await buildStrategyConversationHistory(
      input.userId,
      strategy.sourceThreadId,
    );
    const analysis = await analyzePortfolioAgent(input.userId, {
      threadId: strategy.sourceThreadId,
      message: buildStrategyStagePrompt(strategy),
      mode: "commit",
      conversationHistory,
      conversationMode: "strategy_review",
      strategyContext: {
        strategyId: strategy.id,
        sourceThreadId: strategy.sourceThreadId,
        status: strategy.status,
        mandate: strategy.mandateText,
        normalizedRuleSheet: strategy.normalizedRuleSheet,
        guardrails: strategy.guardrails,
        reviewState: {
          status: strategy.reviewState.status,
          reviewedAt: strategy.reviewState.reviewedAt?.toISOString() || null,
          lastMaterialUpdateAt: strategy.reviewState.lastMaterialUpdateAt?.toISOString() || null,
          summary: strategy.reviewState.summary,
        },
      },
      triggerContext: {
        source: input.triggerSource,
        label: input.triggerLabel || strategy.name,
        eventType: input.eventType || null,
        requestedAt: new Date().toISOString(),
      },
      executionContext: {
        kind: "strategy_run",
        allowAutoExecution: true,
        requiresExplicitConfirmation: false,
      },
    });

    const toolTrace = analysis.toolTrace || [];
    const runtimeMetadata = analysis.runtimeMetadata || null;
    if (analysis.status !== "completed") {
      const failureReason = analysis.errorMessage || "Hermes strategy run failed.";
      const run = await finalizeStrategyRun({
        strategy,
        strategyRunId: pendingRun.id,
        hermesRunId: analysis.runId,
        runtimeSessionId: runtimeMetadata?.sessionId || null,
        runtimeTransport: runtimeMetadata?.transport || null,
        runtimeEndpoint: runtimeMetadata?.endpoint || null,
        runtimeCorrelationId: runtimeMetadata?.correlationId || null,
        status: "failed",
        outcomeSummary: failureReason,
        toolTrace,
        appliedActions: [],
        failureReason,
      });

      await appendStrategyAssistantMessage({
        strategy,
        runId: run.id,
        hermesRunId: analysis.runId,
        contentText: failureReason,
        messageType: "error",
        summary: analysis.summary,
        warnings: analysis.warnings,
        citations: analysis.citations || [],
        toolTrace,
        skillsUsed: analysis.skillsUsed || [],
        memoryInfluences: analysis.memoryInfluences || [],
        confirmationPreview: analysis.confirmationPreview || null,
        uiBlocks: analysis.uiBlocks || [],
        runtimeTransport: runtimeMetadata?.transport || null,
      });

      await recordUserAgentStrategyEvent({
        userId: strategy.userId,
        strategyId: strategy.id,
        strategyRunId: run.id,
        eventType: "run_failed",
        status: "error",
        title: "Strategy run failed",
        summary: failureReason,
        metadata: {
          triggerSource: input.triggerSource,
          runtimeTransport: runtimeMetadata?.transport || null,
          eventType: input.eventType || null,
        },
      });

      return {
        strategy: {
          ...strategy,
          lastOutcomeSummary: run.outcomeSummary,
          lastRunAt: run.completedAt,
        },
        run,
      };
    }

    const actions = analysis.actions || [];
    const appliedActionCountToday = await countAppliedActionsToday(strategy.id);
    if (actions.length > 0) {
      try {
        validateStrategyActions({
          strategy,
          actions,
          appliedActionCountToday,
        });
      } catch (error: any) {
        const failureReason = error?.message || "The strategy output violated its guardrails.";
        const run = await blockStrategyRun({
          strategy,
          strategyRunId: pendingRun.id,
          hermesRunId: analysis.runId,
          runtimeSessionId: runtimeMetadata?.sessionId || null,
          runtimeTransport: runtimeMetadata?.transport || null,
          runtimeEndpoint: runtimeMetadata?.endpoint || null,
          runtimeCorrelationId: runtimeMetadata?.correlationId || null,
          toolTrace,
          failureReason,
        });

        await appendStrategyAssistantMessage({
          strategy,
          runId: run.id,
          hermesRunId: analysis.runId,
          contentText: failureReason,
          messageType: "error",
          summary: analysis.summary,
          warnings: analysis.warnings,
          citations: analysis.citations || [],
          toolTrace,
          skillsUsed: analysis.skillsUsed || [],
          memoryInfluences: analysis.memoryInfluences || [],
          confirmationPreview: analysis.confirmationPreview || null,
          uiBlocks: analysis.uiBlocks || [],
          runtimeTransport: runtimeMetadata?.transport || null,
        });

        await recordUserAgentStrategyEvent({
          userId: strategy.userId,
          strategyId: strategy.id,
          strategyRunId: run.id,
          eventType: "run_blocked",
          status: "warning",
          title: "Strategy blocked",
          summary: failureReason,
          metadata: {
            triggerSource: input.triggerSource,
            runtimeTransport: runtimeMetadata?.transport || null,
            eventType: input.eventType || null,
          },
        });

        return {
          strategy: {
            ...strategy,
            status: "blocked",
            lastOutcomeSummary: run.outcomeSummary,
            lastRunAt: run.completedAt,
          },
          run,
        };
      }
    }

    if (actions.length > 0) {
      await executeAgentActions(input.userId, actions);
    }

    const outcomeSummary = buildStrategyOutcomeSummary({
      strategy,
      appliedActions: actions,
      assistantText: analysis.replyText,
      summary: analysis.summary,
    });
    const nextStatus = strategy.status === "blocked" ? "live" : strategy.status;
    const run = await finalizeStrategyRun({
      strategy,
      strategyRunId: pendingRun.id,
      hermesRunId: analysis.runId,
      runtimeSessionId: runtimeMetadata?.sessionId || null,
      runtimeTransport: runtimeMetadata?.transport || null,
      runtimeEndpoint: runtimeMetadata?.endpoint || null,
      runtimeCorrelationId: runtimeMetadata?.correlationId || null,
      status: actions.length > 0 ? "applied" : "completed",
      outcomeSummary,
      toolTrace,
      appliedActions: actions,
      nextStatus,
    });

    const contentText =
      actions.length > 0
        ? `${analysis.replyText || analysis.summary || `Hermes executed ${actions.length} strategy action${actions.length === 1 ? "" : "s"}.`} Executed automatically within the saved strategy guardrails.`
        : analysis.replyText ||
          analysis.summary ||
          "Hermes checked the strategy and did not apply any action.";

    await appendStrategyAssistantMessage({
      strategy,
      runId: run.id,
      hermesRunId: analysis.runId,
      contentText,
      messageType: actions.length > 0 ? "result" : "chat",
      summary: analysis.summary,
      warnings: analysis.warnings,
      citations: analysis.citations || [],
      toolTrace,
      skillsUsed: analysis.skillsUsed || [],
      memoryInfluences: analysis.memoryInfluences || [],
      confirmationPreview: analysis.confirmationPreview || null,
      uiBlocks: analysis.uiBlocks || [],
      runtimeTransport: runtimeMetadata?.transport || null,
    });

    await recordUserAgentStrategyEvent({
      userId: strategy.userId,
      strategyId: strategy.id,
      strategyRunId: run.id,
      eventType: actions.length > 0 ? "run_auto_applied" : "run_completed",
      status: "success",
      title: actions.length > 0 ? "Strategy applied actions" : "Strategy completed",
      summary: outcomeSummary,
      metadata: {
        triggerSource: input.triggerSource,
        runtimeTransport: runtimeMetadata?.transport || null,
        actionCount: actions.length,
        eventType: input.eventType || null,
      },
    });

    return {
      strategy: {
        ...strategy,
        status: nextStatus,
        lastOutcomeSummary: run.outcomeSummary,
        lastRunAt: run.completedAt,
      },
      run,
    };
  } catch (error: any) {
    const failureReason = error?.message || "Strategy run failed.";
    const run = await finalizeStrategyRun({
      strategy,
      strategyRunId: pendingRun.id,
      hermesRunId: null,
      runtimeSessionId: null,
      runtimeTransport: null,
      runtimeEndpoint: null,
      runtimeCorrelationId: null,
      status: "failed",
      outcomeSummary: failureReason,
      toolTrace: [],
      appliedActions: [],
      failureReason,
    });

    await appendStrategyAssistantMessage({
      strategy,
      runId: run.id,
      hermesRunId: null,
      contentText: failureReason,
      messageType: "error",
      summary: null,
      warnings: [failureReason],
      citations: [],
      toolTrace: [],
      skillsUsed: [],
      memoryInfluences: [],
      confirmationPreview: null,
      uiBlocks: [],
      runtimeTransport: null,
    });

    await recordUserAgentStrategyEvent({
      userId: strategy.userId,
      strategyId: strategy.id,
      strategyRunId: run.id,
      eventType: "run_failed",
      status: "error",
      title: "Strategy run failed",
      summary: failureReason,
      metadata: {
        triggerSource: input.triggerSource,
        runtimeTransport: null,
        eventType: input.eventType || null,
      },
    });

    return {
      strategy: {
        ...strategy,
        lastOutcomeSummary: run.outcomeSummary,
        lastRunAt: run.completedAt,
      },
      run,
    };
  }
}

export async function runDueUserAgentStrategies(limit = 10): Promise<{
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
}> {
  await ensureUserAgentStrategySchema();
  const now = new Date();
  const rows = await db
    .select()
    .from(userAgentStrategies)
    .where(
      and(
        eq(userAgentStrategies.status, "live"),
        isNull(userAgentStrategies.archivedAt),
        lte(userAgentStrategies.nextRunAt, now),
      ),
    )
    .orderBy(userAgentStrategies.nextRunAt)
    .limit(limit);

  let recordsProcessed = 0;
  let errorCount = 0;
  for (const row of rows) {
    try {
      const result = await runUserAgentStrategy({
        userId: row.userId,
        strategyId: row.id,
        triggerSource: "strategy_schedule",
      });
      if (result.run.status === "failed" || result.run.status === "blocked") {
        errorCount += 1;
      } else {
        recordsProcessed += 1;
      }
    } catch (error) {
      if (error instanceof StrategyRunAlreadyInProgressError) {
        continue;
      }
      errorCount += 1;
      console.warn(
        "[Hermes Strategies] Could not run strategy:",
        row.id,
        error instanceof Error ? error.message : error,
      );

      await db
        .update(userAgentStrategies)
        .set({
          nextRunAt: computeStrategyNextRunAt(mapStrategyRow(row), now),
          updatedAt: now,
        })
        .where(eq(userAgentStrategies.id, row.id));
    }
  }

  return {
    requestCount: rows.length,
    recordsProcessed,
    errorCount,
  };
}

export async function runTriggeredUserAgentStrategies(limit = 10): Promise<{
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
}> {
  await ensureUserAgentStrategySchema();
  const now = new Date();
  const rows = await listTriggeredStrategiesWithFairRotation(limit);
  const lastRow = rows[rows.length - 1];
  if (lastRow?.updatedAt instanceof Date) {
    lastTriggeredWakeCursor = { updatedAt: lastRow.updatedAt, id: lastRow.id };
  } else if (rows.length === 0) {
    lastTriggeredWakeCursor = null;
  }

  let recordsProcessed = 0;
  let errorCount = 0;

  for (const row of rows) {
    const strategy = mapStrategyRow(row);
    try {
      let trigger: { eventType: string; title: string; summary: string; eventKey: string } | null =
        null;
      const stageTrigger = await getStrategyStageEventTrigger({ strategy, now });
      if (stageTrigger) {
        const [existingStageEvent] = await db
          .select({ id: userAgentStrategyEvents.id })
          .from(userAgentStrategyEvents)
          .where(
            and(
              eq(userAgentStrategyEvents.strategyId, strategy.id),
              eq(userAgentStrategyEvents.eventKey, stageTrigger.eventKey),
            ),
          )
          .limit(1);

        if (!existingStageEvent) {
          trigger = stageTrigger;
        }
      }

      if (!trigger) {
        const researchTrigger = await findFreshResearchWake(strategy);
        if (researchTrigger) {
          const [existingResearchEvent] = await db
            .select({ id: userAgentStrategyEvents.id })
            .from(userAgentStrategyEvents)
            .where(
              and(
                eq(userAgentStrategyEvents.strategyId, strategy.id),
                eq(userAgentStrategyEvents.eventKey, researchTrigger.eventKey),
              ),
            )
            .limit(1);

          if (!existingResearchEvent) {
            trigger = researchTrigger;
          }
        }
      }

      if (!trigger) {
        continue;
      }

      await recordUserAgentStrategyEvent({
        userId: strategy.userId,
        strategyId: strategy.id,
        eventType: trigger.eventType,
        status: "info",
        title: trigger.title,
        summary: trigger.summary,
        eventKey: trigger.eventKey,
      });

      const result = await runUserAgentStrategy({
        userId: strategy.userId,
        strategyId: strategy.id,
        triggerSource: "strategy_event",
        triggerLabel: trigger.title,
        eventType: trigger.eventType,
      });

      if (result.run.status === "failed" || result.run.status === "blocked") {
        errorCount += 1;
      } else {
        recordsProcessed += 1;
      }
    } catch (error) {
      if (error instanceof StrategyRunAlreadyInProgressError) {
        continue;
      }
      errorCount += 1;
      console.warn(
        "[Hermes Strategies] Could not run triggered strategy:",
        row.id,
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

export const __strategyRunner = {
  AUTO_EXECUTABLE_STRATEGY_ACTION_TYPES,
  buildStrategyStagePrompt,
  getGuardrailInteger,
  resetTriggeredWakeCursor: () => {
    lastTriggeredWakeCursor = null;
  },
  validateStrategyActions,
};

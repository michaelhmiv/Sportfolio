import {
  userAgentActionBundles,
  userAgentMessages,
  userAgentSchedules,
  userAgentStrategies,
  userAgentStrategyRuns,
} from "@shared/schema";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../db";
import type {
  AgentAction,
  AgentCitation,
  AgentContinuityActionView,
  AgentContinuityEvidenceView,
  AgentContinuityOpenLoopView,
  AgentContinuityStateView,
  AgentContinuityStrategyView,
  AgentStrategyStatus,
} from "./types";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function sanitizeCitations(value: unknown): AgentCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = toNullableString(record.id);
      const title = toNullableString(record.title);
      const url = toNullableString(record.url);
      const retrievedAt = toDateOrNull(record.retrievedAt);
      if (!id || !title || !url || !retrievedAt) {
        return null;
      }

      return {
        id,
        title,
        sourceName: toNullableString(record.sourceName) || "Unknown",
        url,
        publishedAt: toNullableString(record.publishedAt),
        retrievedAt: retrievedAt.toISOString(),
        factSummary: toNullableString(record.factSummary) || "Fresh evidence was attached.",
        relevanceScore: typeof record.relevanceScore === "number" ? record.relevanceScore : 0,
      } satisfies AgentCitation;
    })
    .filter((entry): entry is AgentCitation => Boolean(entry));
}

function extractCitations(structuredPayload: unknown): AgentCitation[] {
  const record = toRecord(structuredPayload);
  return sanitizeCitations(record.citations);
}

function toActionArray(value: unknown): AgentAction[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is AgentAction => {
        return !!entry && typeof entry === "object" && !Array.isArray(entry);
      })
    : [];
}

function summarizeAction(action: AgentAction) {
  switch (action.actionType) {
    case "pool_buy":
      return {
        title: `Bought ${action.playerName || "player"}`,
        summary:
          typeof action.sbAmount === "number"
            ? `Deployed $${action.sbAmount.toFixed(2)} into ${action.playerName || "that position"}.`
            : action.reasoning || "Hermes added a position.",
      };
    case "pool_sell":
      return {
        title: `Sold ${action.playerName || "player"}`,
        summary:
          typeof action.sharesAmount === "number"
            ? `Reduced ${action.playerName || "that position"} by ${action.sharesAmount} share${action.sharesAmount === 1 ? "" : "s"}.`
            : action.reasoning || "Hermes reduced a position.",
      };
    case "daily_boost_assign":
      return {
        title: `Assigned boost to ${action.playerName || "player"}`,
        summary:
          action.slotTier != null
            ? `Placed ${action.playerName || "the player"} into the ${action.slotTier}x slot.`
            : action.reasoning || "Hermes updated a daily boost slot.",
      };
    case "daily_boost_remove":
      return {
        title: `Removed boost from ${action.playerName || "player"}`,
        summary: action.reasoning || "Hermes removed a boost assignment.",
      };
    case "watchlist_add_player":
      return {
        title: `Tracked ${action.playerName || "player"}`,
        summary:
          action.watchlistName != null
            ? `Added ${action.playerName || "the player"} to ${action.watchlistName}.`
            : action.reasoning || "Hermes updated a watchlist.",
      };
    case "watchlist_remove_player":
      return {
        title: `Stopped tracking ${action.playerName || "player"}`,
        summary: action.reasoning || "Hermes removed a watchlist entry.",
      };
    case "scout_set_count":
      return {
        title: `Updated scouts on ${action.playerName || "player"}`,
        summary:
          typeof action.targetCount === "number"
            ? `Set ${action.playerName || "that player"} to ${action.targetCount} scout${action.targetCount === 1 ? "" : "s"}.`
            : action.reasoning || "Hermes changed scout allocation.",
      };
    default:
      return {
        title: action.playerName
          ? `${action.actionType.replace(/_/g, " ")}: ${action.playerName}`
          : action.actionType.replace(/_/g, " "),
        summary: action.reasoning || "Hermes applied an action.",
      };
  }
}

function buildHeadline(input: {
  waitingCount: number;
  scheduledCount: number;
  activeStrategyCount: number;
  recentActionCount: number;
}) {
  if (input.waitingCount > 0) {
    return "Hermes has operator work waiting on you.";
  }
  if (input.activeStrategyCount > 0) {
    return "Hermes is carrying active strategy context forward.";
  }
  if (input.recentActionCount > 0 || input.scheduledCount > 0) {
    return "Hermes has recent activity and scheduled follow-up work.";
  }
  return "Hermes is ready and has no open operator loops yet.";
}

function buildSummary(input: {
  waitingCount: number;
  scheduledCount: number;
  blockedCount: number;
  activeStrategyCount: number;
  evidenceCount: number;
}) {
  const parts = [
    `${input.activeStrategyCount} active strategy context${input.activeStrategyCount === 1 ? "" : "s"}`,
    `${input.waitingCount} waiting item${input.waitingCount === 1 ? "" : "s"}`,
    `${input.scheduledCount} scheduled follow-up${input.scheduledCount === 1 ? "" : "s"}`,
  ];

  if (input.blockedCount > 0) {
    parts.push(`${input.blockedCount} blocker${input.blockedCount === 1 ? "" : "s"}`);
  }
  if (input.evidenceCount > 0) {
    parts.push(
      `${input.evidenceCount} fresh evidence update${input.evidenceCount === 1 ? "" : "s"}`,
    );
  }

  return `Hermes should reason from ongoing operator state: ${parts.join(", ")}.`;
}

export async function buildAgentContinuityState(input: {
  userId: string;
  threadId?: string | null;
  strategyId?: string | null;
}): Promise<AgentContinuityStateView> {
  const [strategyRows, runRows, scheduleRows, pendingBundleRows, messageRows] = await Promise.all([
    db
      .select()
      .from(userAgentStrategies)
      .where(
        and(eq(userAgentStrategies.userId, input.userId), isNull(userAgentStrategies.archivedAt)),
      )
      .orderBy(desc(userAgentStrategies.updatedAt))
      .limit(8),
    db
      .select()
      .from(userAgentStrategyRuns)
      .where(eq(userAgentStrategyRuns.userId, input.userId))
      .orderBy(desc(userAgentStrategyRuns.createdAt))
      .limit(16),
    db
      .select()
      .from(userAgentSchedules)
      .where(and(eq(userAgentSchedules.userId, input.userId), eq(userAgentSchedules.enabled, true)))
      .orderBy(desc(userAgentSchedules.updatedAt))
      .limit(8),
    input.threadId
      ? db
          .select()
          .from(userAgentActionBundles)
          .where(
            and(
              eq(userAgentActionBundles.userId, input.userId),
              eq(userAgentActionBundles.threadId, input.threadId),
              or(
                eq(userAgentActionBundles.status, "pending_confirmation"),
                eq(userAgentActionBundles.status, "pending_clarification"),
              ),
            ),
          )
          .orderBy(desc(userAgentActionBundles.createdAt))
          .limit(1)
      : Promise.resolve([]),
    input.threadId
      ? db
          .select({
            id: userAgentMessages.id,
            createdAt: userAgentMessages.createdAt,
            structuredPayload: userAgentMessages.structuredPayload,
          })
          .from(userAgentMessages)
          .where(
            and(
              eq(userAgentMessages.userId, input.userId),
              eq(userAgentMessages.threadId, input.threadId),
            ),
          )
          .orderBy(desc(userAgentMessages.createdAt))
          .limit(20)
      : Promise.resolve([]),
  ]);

  const prioritizedStrategies = [...strategyRows].sort((left, right) => {
    if (input.strategyId && left.id === input.strategyId) return -1;
    if (input.strategyId && right.id === input.strategyId) return 1;
    if (left.status === "live" && right.status !== "live") return -1;
    if (right.status === "live" && left.status !== "live") return 1;
    const leftNext = left.nextRunAt ? left.nextRunAt.getTime() : Number.MAX_SAFE_INTEGER;
    const rightNext = right.nextRunAt ? right.nextRunAt.getTime() : Number.MAX_SAFE_INTEGER;
    return leftNext - rightNext || right.updatedAt.getTime() - left.updatedAt.getTime();
  });

  const activeStrategies: AgentContinuityStrategyView[] = prioritizedStrategies
    .filter((row) => row.status !== "archived")
    .slice(0, 4)
    .map((row) => ({
      strategyId: row.id,
      name: row.name,
      status: row.status as AgentStrategyStatus,
      nextRunAt: row.nextRunAt || null,
      lastOutcomeSummary: row.lastOutcomeSummary || null,
    }));

  const recentActions: AgentContinuityActionView[] = [];
  for (const run of runRows) {
    const appliedActions = toActionArray(run.appliedActions);
    for (const action of appliedActions) {
      const summary = summarizeAction(action);
      recentActions.push({
        id: `${run.id}:${action.actionType}:${action.playerId}`,
        title: summary.title,
        summary: summary.summary,
        createdAt: run.createdAt || null,
        source: "strategy_run",
      });
      if (recentActions.length >= 4) {
        break;
      }
    }
    if (recentActions.length >= 4) {
      break;
    }
  }

  const pendingBundle = pendingBundleRows[0] || null;
  if (pendingBundle) {
    recentActions.unshift({
      id: pendingBundle.id,
      title: "Pending plan is still staged",
      summary: pendingBundle.summary,
      createdAt: pendingBundle.createdAt,
      source: "pending_bundle",
    });
  }

  const openLoops: AgentContinuityOpenLoopView[] = [];
  if (pendingBundle) {
    openLoops.push({
      id: pendingBundle.id,
      title: pendingBundle.summary,
      summary:
        pendingBundle.status === "pending_clarification"
          ? "Hermes still needs one more detail before it can complete this plan."
          : "Hermes already staged this plan and is still waiting for confirmation or cancellation.",
      status:
        pendingBundle.status === "pending_clarification" ? "waiting_on_you" : "waiting_on_you",
      dueAt: pendingBundle.createdAt,
      source: "pending_bundle",
    });
  }

  for (const strategy of activeStrategies) {
    if (strategy.status === "blocked") {
      openLoops.push({
        id: `blocked:${strategy.strategyId}`,
        title: `${strategy.name} is blocked`,
        summary:
          strategy.lastOutcomeSummary || "Hermes needs operator attention before it can continue.",
        status: "blocked",
        dueAt: strategy.nextRunAt,
        source: "strategy",
      });
      continue;
    }

    if (strategy.status === "live" && strategy.nextRunAt) {
      openLoops.push({
        id: `strategy:${strategy.strategyId}`,
        title: `${strategy.name} wakes again soon`,
        summary:
          strategy.lastOutcomeSummary ||
          "Hermes has a saved live strategy with another planned evaluation.",
        status: "scheduled",
        dueAt: strategy.nextRunAt,
        source: "strategy",
      });
    }
  }

  for (const schedule of scheduleRows.slice(0, 2)) {
    openLoops.push({
      id: `schedule:${schedule.id}`,
      title: `${schedule.jobType.replace(/_/g, " ")} is scheduled`,
      summary: "Hermes has a saved advisory schedule that will keep watching the account state.",
      status: "scheduled",
      dueAt: schedule.nextRunAt || null,
      source: "schedule",
    });
  }

  const evidenceByUrl = new Map<string, AgentContinuityEvidenceView>();
  for (const row of messageRows) {
    for (const citation of extractCitations(row.structuredPayload)) {
      if (evidenceByUrl.has(citation.url)) {
        continue;
      }

      evidenceByUrl.set(citation.url, {
        id: citation.id,
        title: citation.title,
        summary: citation.factSummary,
        createdAt: toDateOrNull(citation.retrievedAt),
        sourceName: citation.sourceName,
      });
    }
  }

  const evidenceUpdates = [...evidenceByUrl.values()]
    .sort((left, right) => (right.createdAt?.getTime() || 0) - (left.createdAt?.getTime() || 0))
    .slice(0, 3);

  if (!pendingBundle && evidenceUpdates[0]) {
    openLoops.push({
      id: `research:${evidenceUpdates[0].id}`,
      title: evidenceUpdates[0].title,
      summary: evidenceUpdates[0].summary,
      status: "tracking",
      dueAt: evidenceUpdates[0].createdAt,
      source: "research",
    });
  }

  const waitingCount = openLoops.filter((item) => item.status === "waiting_on_you").length;
  const scheduledCount = openLoops.filter((item) => item.status === "scheduled").length;
  const blockedCount = openLoops.filter((item) => item.status === "blocked").length;

  return {
    headline: buildHeadline({
      waitingCount,
      scheduledCount,
      activeStrategyCount: activeStrategies.length,
      recentActionCount: recentActions.length,
    }),
    summary: buildSummary({
      waitingCount,
      scheduledCount,
      blockedCount,
      activeStrategyCount: activeStrategies.length,
      evidenceCount: evidenceUpdates.length,
    }),
    recentActions,
    openLoops: openLoops.slice(0, 5),
    activeStrategies,
    evidenceUpdates,
  };
}

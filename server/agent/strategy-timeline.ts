import { dailyGames } from "@shared/schema";
import {
  normalizeAgentStrategyTimeline,
  summarizeAgentStrategyTrigger,
  type AgentStrategyStage,
  type AgentStrategyTimeline,
} from "@shared/agent-strategy";
import { and, asc, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { storage } from "../storage";
import { computeNextScheduledRunAt } from "./schedules";
import { buildStrategyAutonomyPolicyLines } from "./strategy-policy";
import type { AgentStrategyRecord } from "./types";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeStrategyTimeline(strategy: AgentStrategyRecord): AgentStrategyTimeline {
  return normalizeAgentStrategyTimeline(strategy.normalizedRuleSheet, {
    objective: strategy.summary,
    mandate: strategy.mandateText,
    scheduleCron: strategy.scheduleCron,
    eventSubscriptions: strategy.eventSubscriptions,
    allowedActionTypes: strategy.allowedActionTypes,
    rawTimingInstruction:
      typeof toRecord(strategy.normalizedRuleSheet).rawTimingInstruction === "string"
        ? (toRecord(strategy.normalizedRuleSheet).rawTimingInstruction as string)
        : strategy.scheduleCron,
  });
}

export function getActiveStrategyStage(strategy: AgentStrategyRecord): AgentStrategyStage | null {
  const timeline = strategy.timeline || normalizeStrategyTimeline(strategy);
  return (
    timeline.stages.find((stage) => stage.id === timeline.currentStageId) ||
    timeline.stages[0] ||
    null
  );
}

export function advanceStrategyTimelineAfterRun(
  strategy: AgentStrategyRecord,
): AgentStrategyTimeline {
  const timeline = strategy.timeline || normalizeStrategyTimeline(strategy);
  if (timeline.stages.length === 0) {
    return timeline;
  }

  const currentIndex = Math.max(
    0,
    timeline.stages.findIndex((stage) => stage.id === timeline.currentStageId),
  );
  const currentStage = timeline.stages[currentIndex] || timeline.stages[0];
  const nextStage = timeline.stages[currentIndex + 1] || null;
  const firstRecurringStage =
    timeline.stages.find((stage) => stage.triggerPolicy.kind === "recurring_cron") || null;

  if (nextStage) {
    return {
      ...timeline,
      currentStageId: nextStage.id,
      stages: timeline.stages.map((stage, index) => ({
        ...stage,
        status:
          index < currentIndex + 1
            ? "completed"
            : index === currentIndex + 1
              ? "active"
              : "pending",
      })),
    };
  }

  if (currentStage.triggerPolicy.kind === "recurring_cron") {
    return {
      ...timeline,
      currentStageId: currentStage.id,
      stages: timeline.stages.map((stage, index) => ({
        ...stage,
        status: index === currentIndex ? "active" : index < currentIndex ? "completed" : "pending",
      })),
    };
  }

  if (firstRecurringStage) {
    return {
      ...timeline,
      currentStageId: firstRecurringStage.id,
      stages: timeline.stages.map((stage) => ({
        ...stage,
        status: stage.id === firstRecurringStage.id ? "active" : "pending",
      })),
    };
  }

  if (currentStage.triggerPolicy.kind === "one_time_at") {
    return {
      ...timeline,
      currentStageId: null,
      stages: timeline.stages.map((stage, index) => ({
        ...stage,
        status: index === currentIndex ? "completed" : stage.status,
      })),
    };
  }

  return {
    ...timeline,
    currentStageId: currentStage.id,
    stages: timeline.stages.map((stage, index) => ({
      ...stage,
      status: index === currentIndex ? "active" : stage.status,
    })),
  };
}

export function computeStrategyNextRunAt(
  strategy: AgentStrategyRecord,
  now: Date = new Date(),
): Date | null {
  const activeStage = getActiveStrategyStage(strategy);
  if (!activeStage) {
    return null;
  }

  const policy = activeStage.triggerPolicy;
  if (policy.kind === "recurring_cron" && policy.scheduleCron) {
    return computeNextScheduledRunAt(policy.scheduleCron, "daily_setup_review", now);
  }

  if (policy.kind === "one_time_at" && policy.runAt) {
    const runAt = toDate(policy.runAt);
    if (!runAt) {
      return null;
    }

    return runAt > now ? runAt : null;
  }

  return null;
}

async function getGamesForToday(stage: AgentStrategyStage) {
  const { startOfDay, endOfDay } = getETDayBoundaries(getTodayET());
  const sports = Array.isArray(stage.actionScope)
    ? Array.from(
        new Set(
          stage.actionScope
            .map((entry) => entry.toUpperCase())
            .filter(
              (entry) =>
                entry === "NBA" || entry === "NFL" || entry === "MLB" || entry === "NASCAR",
            ),
        ),
      )
    : [];

  const conditions = [gte(dailyGames.startTime, startOfDay), lte(dailyGames.startTime, endOfDay)];
  if (sports.length > 0) {
    conditions.push(inArray(dailyGames.sport, sports));
  }

  return db
    .select({
      gameId: dailyGames.gameId,
      sport: dailyGames.sport,
      status: dailyGames.status,
      startTime: dailyGames.startTime,
    })
    .from(dailyGames)
    .where(and(...conditions))
    .orderBy(asc(dailyGames.startTime));
}

async function getDayCloseEvent(
  strategy: AgentStrategyRecord,
  stage: AgentStrategyStage,
): Promise<{ eventType: string; title: string; summary: string; eventKey: string } | null> {
  const todayET = getTodayET();
  const games = await getGamesForToday(stage);
  if (games.length === 0) {
    return null;
  }

  const unresolved = games.filter((game) => {
    const status = String(game.status || "").toLowerCase();
    return !["completed", "final", "processed", "postponed", "cancelled"].includes(status);
  });
  if (unresolved.length > 0) {
    return null;
  }

  return {
    eventType: "day_close",
    title: "Day close reached",
    summary:
      "All scheduled games for the current ET day are finished, so Hermes can evaluate the next step.",
    eventKey: `day_close:${strategy.id}:${todayET}:${stage.id}`,
  };
}

async function getPreLockEvent(
  strategy: AgentStrategyRecord,
  stage: AgentStrategyStage,
  now: Date,
): Promise<{ eventType: string; title: string; summary: string; eventKey: string } | null> {
  const games = await getGamesForToday(stage);
  const offsetMinutes = stage.triggerPolicy.offsetMinutes ?? 15;
  const upcoming = games.find((game) => {
    const startTime = new Date(game.startTime);
    const diffMs = startTime.getTime() - now.getTime();
    return diffMs > 0 && diffMs <= offsetMinutes * 60 * 1000;
  });
  if (!upcoming) {
    return null;
  }

  return {
    eventType: "pre_lock",
    title: "Pre-lock window opened",
    summary: `A game is starting within ${offsetMinutes} minutes, so Hermes can prepare the next step.`,
    eventKey: `pre_lock:${strategy.id}:${stage.id}:${upcoming.gameId}`,
  };
}

async function getPostSettlementEvent(
  strategy: AgentStrategyRecord,
  stage: AgentStrategyStage,
): Promise<{ eventType: string; title: string; summary: string; eventKey: string } | null> {
  const boosts = await storage.getDailyBoostsAllSports(strategy.userId, new Date());
  const processed = boosts
    .filter((boost) => boost.status === "processed" && boost.processedAt)
    .sort(
      (left, right) =>
        new Date(right.processedAt || 0).getTime() - new Date(left.processedAt || 0).getTime(),
    )[0];

  if (!processed?.processedAt) {
    return null;
  }

  if (strategy.lastRunAt && new Date(processed.processedAt) <= strategy.lastRunAt) {
    return null;
  }

  return {
    eventType: "post_settlement",
    title: "Boost settlement completed",
    summary: "A settled boost changed the available state, so Hermes can evaluate the next stage.",
    eventKey: `post_settlement:${strategy.id}:${stage.id}:${new Date(processed.processedAt).toISOString()}`,
  };
}

export async function getStrategyStageEventTrigger(input: {
  strategy: AgentStrategyRecord;
  now?: Date;
}): Promise<{ eventType: string; title: string; summary: string; eventKey: string } | null> {
  const now = input.now || new Date();
  const stage = getActiveStrategyStage(input.strategy);
  if (!stage || stage.triggerPolicy.kind !== "event_window") {
    return null;
  }

  switch (stage.triggerPolicy.anchor) {
    case "research_refresh":
      return {
        eventType: "research_refresh",
        title: "Fresh research arrived",
        summary: "Hermes can review the stage again with fresh hosted research.",
        eventKey: `research_refresh:${input.strategy.id}:${stage.id}`,
      };
    case "day_close":
    case "post_game":
      return getDayCloseEvent(input.strategy, stage);
    case "pre_lock":
      return getPreLockEvent(input.strategy, stage, now);
    case "post_settlement":
      return getPostSettlementEvent(input.strategy, stage);
    default:
      return null;
  }
}

export function buildStrategyStagePrompt(strategy: AgentStrategyRecord): string {
  const activeStage = getActiveStrategyStage(strategy);
  if (!activeStage) {
    return `Review the saved strategy "${strategy.name}" and explain what timing or rules are still missing before it can run.`;
  }

  const policy = buildStrategyAutonomyPolicyLines({
    mandateText: strategy.mandateText,
    guardrails: strategy.guardrails,
    allowedActionTypes: strategy.allowedActionTypes,
  });

  return [
    `Run the saved strategy "${strategy.name}" using its mandate and normalized stage timeline.`,
    `Focus on the active stage "${activeStage.title}" (${summarizeAgentStrategyTrigger(activeStage.triggerPolicy)}).`,
    activeStage.summary || null,
    "Use the approved gameplay tools to inspect live state, decide whether the strategy should act now, and if so return only actions that fit the saved guardrails.",
    "If the strategy should not act right now, return an advisory update with no actions.",
    ...policy.lines,
    "Do not assume access beyond the provided tool surface.",
  ]
    .filter(Boolean)
    .join(" ");
}

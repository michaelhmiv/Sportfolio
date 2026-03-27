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

export interface StrategyLastRunContext {
  runId: string;
  status: string;
  appliedActionCount: number;
  outcomeSummary: string | null;
  completedAt: string;
  activeStageId: string | null;
}

export function getLastRunContext(strategy: AgentStrategyRecord): StrategyLastRunContext | null {
  const record = toRecord(strategy.normalizedRuleSheet);
  const ctx = toRecord(record.lastRunContext);
  if (!ctx.runId || typeof ctx.runId !== "string") {
    return null;
  }

  return {
    runId: ctx.runId,
    status: typeof ctx.status === "string" ? ctx.status : "unknown",
    appliedActionCount: typeof ctx.appliedActionCount === "number" ? ctx.appliedActionCount : 0,
    outcomeSummary: typeof ctx.outcomeSummary === "string" ? ctx.outcomeSummary : null,
    completedAt: typeof ctx.completedAt === "string" ? ctx.completedAt : "",
    activeStageId: typeof ctx.activeStageId === "string" ? ctx.activeStageId : null,
  };
}

export interface StrategyStageOutcome {
  stageId: string;
  stageTitle: string;
  completedAt: string;
  actionsSummary: string[];
  observations: string[];
  deferredItems: string[];
}

export function getStageOutcomes(strategy: AgentStrategyRecord): StrategyStageOutcome[] {
  const record = toRecord(strategy.normalizedRuleSheet);
  const outcomes = record.stageOutcomes;
  if (!Array.isArray(outcomes)) {
    return [];
  }

  return outcomes
    .filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object" && !Array.isArray(entry),
    )
    .map((entry) => ({
      stageId: typeof entry.stageId === "string" ? entry.stageId : "",
      stageTitle: typeof entry.stageTitle === "string" ? entry.stageTitle : "",
      completedAt: typeof entry.completedAt === "string" ? entry.completedAt : "",
      actionsSummary: Array.isArray(entry.actionsSummary)
        ? entry.actionsSummary.filter((item): item is string => typeof item === "string")
        : [],
      observations: Array.isArray(entry.observations)
        ? entry.observations.filter((item): item is string => typeof item === "string")
        : [],
      deferredItems: Array.isArray(entry.deferredItems)
        ? entry.deferredItems.filter((item): item is string => typeof item === "string")
        : [],
    }))
    .filter((outcome) => outcome.stageId);
}

function buildPriorStageContext(
  strategy: AgentStrategyRecord,
  activeStage: AgentStrategyStage,
): string[] {
  const outcomes = getStageOutcomes(strategy);
  if (outcomes.length === 0) {
    return [];
  }

  const timeline = strategy.timeline || normalizeStrategyTimeline(strategy);
  const activeIndex = timeline.stages.findIndex((stage) => stage.id === activeStage.id);

  const priorOutcomes = outcomes.filter((outcome) => {
    const stageIndex = timeline.stages.findIndex((stage) => stage.id === outcome.stageId);
    return stageIndex >= 0 && stageIndex < activeIndex;
  });

  if (priorOutcomes.length === 0) {
    return [];
  }

  const lines: string[] = ["Prior stage results that inform this stage:"];
  for (const outcome of priorOutcomes) {
    lines.push(`- Stage "${outcome.stageTitle}" (completed ${outcome.completedAt}):`);
    for (const action of outcome.actionsSummary.slice(0, 5)) {
      lines.push(`  Action: ${action}`);
    }
    for (const obs of outcome.observations.slice(0, 3)) {
      lines.push(`  Observation: ${obs}`);
    }
    for (const deferred of outcome.deferredItems.slice(0, 3)) {
      lines.push(`  Deferred: ${deferred}`);
    }
  }

  return lines;
}

const KNOWN_SPORTS = ["NBA", "NFL", "MLB", "NASCAR"] as const;

function detectMandateSports(mandateText: string): string[] {
  const text = mandateText.toUpperCase();
  return KNOWN_SPORTS.filter((sport) => text.includes(sport));
}

function buildSportContextInstructions(sports: string[], anchor: string | undefined): string[] {
  if (sports.length === 0) {
    return [];
  }

  const sportList = sports.join(", ");
  const lines: string[] = [
    `This strategy targets ${sportList}. Use the scan_sport_slate tool to get today's ${sportList} game schedule, teams, and active players before deciding on actions.`,
  ];

  if (anchor === "daily_at_time" || anchor === "research_refresh" || !anchor) {
    lines.push(
      `Use scan_player_upcoming_games to check upcoming schedules for any players you are considering.`,
    );
  }

  if (anchor === "pre_lock") {
    lines.push(
      `Games are imminent. Use scan_sport_slate to confirm which ${sportList} games are about to lock, then finalize boost assignments for players in those games.`,
    );
  }

  return lines;
}

function buildStageFocusInstructions(
  activeStage: AgentStrategyStage,
  strategy: AgentStrategyRecord,
): string[] {
  const lines: string[] = [];
  const actionScope = activeStage.actionScope;

  if (actionScope.length > 0) {
    lines.push(`This stage's action scope is limited to: ${actionScope.join(", ")}.`);
    lines.push("Only propose actions within this scope for this stage.");
  }

  const anchor = activeStage.triggerPolicy.anchor;
  switch (anchor) {
    case "daily_at_time":
    case "research_refresh":
      lines.push(
        "This is a research/scouting phase. Focus on gathering data, scanning opportunities, and preparing positions. Prefer scout and watchlist actions over aggressive trading.",
      );
      break;
    case "pre_lock":
      lines.push(
        "This is a pre-lock phase. Games are about to start. Focus on finalizing boost assignments and last-minute positioning adjustments.",
      );
      break;
    case "post_game":
    case "day_close":
      lines.push(
        "This is a post-game evaluation phase. Review what happened, assess results, and prepare for the next cycle. Prefer advisory observations over new positions.",
      );
      break;
    case "post_settlement":
      lines.push(
        "Boosts have settled. Evaluate outcomes and decide whether to reinvest, rebalance, or hold. Use settlement results to inform the next stage.",
      );
      break;
    default:
      break;
  }

  const mandateSports = detectMandateSports(strategy.mandateText);
  lines.push(...buildSportContextInstructions(mandateSports, anchor));

  return lines;
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

  const priorContext = buildPriorStageContext(strategy, activeStage);
  const focusInstructions = buildStageFocusInstructions(activeStage, strategy);
  const lastRun = getLastRunContext(strategy);

  const timeline = strategy.timeline || normalizeStrategyTimeline(strategy);
  const stageIndex = timeline.stages.findIndex((stage) => stage.id === activeStage.id);
  const totalStages = timeline.stages.length;
  const stageProgress = totalStages > 1 ? `Stage ${stageIndex + 1} of ${totalStages}.` : null;

  const lastRunLine = lastRun
    ? `Last run (${lastRun.completedAt}): ${lastRun.status}, ${lastRun.appliedActionCount} action${lastRun.appliedActionCount === 1 ? "" : "s"} applied.${lastRun.outcomeSummary ? ` Summary: ${lastRun.outcomeSummary}` : ""}`
    : null;

  return [
    `Run the saved strategy "${strategy.name}" using its mandate and normalized stage timeline.`,
    `Mandate: "${strategy.mandateText}"`,
    stageProgress,
    lastRunLine,
    `Focus on the active stage "${activeStage.title}" (${summarizeAgentStrategyTrigger(activeStage.triggerPolicy)}).`,
    activeStage.summary || null,
    ...priorContext,
    ...focusInstructions,
    "Use the approved gameplay tools to inspect live state, decide whether the strategy should act now, and if so return only actions that fit the saved guardrails.",
    "If the strategy should not act right now, return an advisory update with no actions.",
    "In your response, include brief observations about what you found and any items that should be deferred to a later stage.",
    ...policy.lines,
    "Do not assume access beyond the provided tool surface.",
  ]
    .filter(Boolean)
    .join(" ");
}

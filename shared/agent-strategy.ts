export const AGENT_STRATEGY_STAGE_STATUSES = ["pending", "active", "completed", "blocked"] as const;

export const AGENT_STRATEGY_TRIGGER_KINDS = [
  "recurring_cron",
  "one_time_at",
  "event_window",
] as const;

export const AGENT_STRATEGY_TRIGGER_ANCHORS = [
  "daily_at_time",
  "once_at_datetime",
  "day_close",
  "pre_lock",
  "post_game",
  "post_settlement",
  "research_refresh",
] as const;

export type AgentStrategyStageStatus = (typeof AGENT_STRATEGY_STAGE_STATUSES)[number];
export type AgentStrategyTriggerKind = (typeof AGENT_STRATEGY_TRIGGER_KINDS)[number];
export type AgentStrategyTriggerAnchor = (typeof AGENT_STRATEGY_TRIGGER_ANCHORS)[number];

export interface AgentStrategyTriggerPolicy {
  kind: AgentStrategyTriggerKind;
  anchor: AgentStrategyTriggerAnchor;
  rawTimingInstruction?: string | null;
  timezone?: string | null;
  scheduleCron?: string | null;
  runAt?: string | null;
  offsetMinutes?: number | null;
  eventType?: string | null;
}

export interface AgentStrategyStage {
  id: string;
  title: string;
  summary?: string | null;
  status: AgentStrategyStageStatus;
  actionScope: string[];
  triggerPolicy: AgentStrategyTriggerPolicy;
}

export interface AgentStrategyTimeline {
  objective: string;
  currentStageId: string | null;
  stages: AgentStrategyStage[];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function normalizeStageStatus(value: unknown): AgentStrategyStageStatus {
  return value === "active" || value === "completed" || value === "blocked" ? value : "pending";
}

function normalizeTriggerKind(value: unknown): AgentStrategyTriggerKind | null {
  return value === "recurring_cron" || value === "one_time_at" || value === "event_window"
    ? value
    : null;
}

function normalizeTriggerAnchor(value: unknown): AgentStrategyTriggerAnchor | null {
  return value === "daily_at_time" ||
    value === "once_at_datetime" ||
    value === "day_close" ||
    value === "pre_lock" ||
    value === "post_game" ||
    value === "post_settlement" ||
    value === "research_refresh"
    ? value
    : null;
}

function inferAnchorFromLegacyEvent(value: string | null): AgentStrategyTriggerAnchor {
  switch (value) {
    case "research_refresh":
      return "research_refresh";
    case "pre_lock":
      return "pre_lock";
    case "post_game":
      return "post_game";
    case "post_settlement":
      return "post_settlement";
    case "gameplay_event":
    default:
      return "day_close";
  }
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildLegacyTimeline(input: {
  objective: string;
  mandate: string;
  scheduleCron?: string | null;
  eventSubscriptions?: string[];
  allowedActionTypes?: string[];
  rawTimingInstruction?: string | null;
}): AgentStrategyTimeline {
  const stages: AgentStrategyStage[] = [];

  if (input.scheduleCron) {
    stages.push({
      id: "stage_schedule",
      title: "Scheduled review",
      summary: "Hermes wakes on the saved recurring schedule and evaluates what to do next.",
      status: "active",
      actionScope: input.allowedActionTypes || [],
      triggerPolicy: {
        kind: "recurring_cron",
        anchor: "daily_at_time",
        scheduleCron: input.scheduleCron,
        rawTimingInstruction: input.rawTimingInstruction || input.scheduleCron,
        timezone: "America/New_York",
      },
    });
  }

  for (const [index, eventType] of (input.eventSubscriptions || []).entries()) {
    if (eventType === "schedule") {
      continue;
    }

    stages.push({
      id: `stage_event_${index + 1}`,
      title: `${titleCase(eventType)} review`,
      summary: `Hermes wakes again when ${titleCase(eventType).toLowerCase()} is detected.`,
      status: stages.length === 0 ? "active" : "pending",
      actionScope: input.allowedActionTypes || [],
      triggerPolicy: {
        kind: "event_window",
        anchor: inferAnchorFromLegacyEvent(eventType),
        eventType,
        rawTimingInstruction: input.rawTimingInstruction || titleCase(eventType),
        timezone: "America/New_York",
      },
    });
  }

  if (stages.length === 0) {
    stages.push({
      id: "stage_manual",
      title: "Manual review",
      summary:
        "Hermes is waiting for a saved schedule or trigger before this strategy can wake up.",
      status: "pending",
      actionScope: input.allowedActionTypes || [],
      triggerPolicy: {
        kind: "event_window",
        anchor: "day_close",
        rawTimingInstruction: input.rawTimingInstruction || null,
        timezone: "America/New_York",
      },
    });
  }

  return {
    objective: input.objective || input.mandate,
    currentStageId: stages.find((stage) => stage.status === "active")?.id || stages[0]?.id || null,
    stages,
  };
}

export function normalizeAgentStrategyTimeline(
  value: unknown,
  fallback: {
    objective: string;
    mandate: string;
    scheduleCron?: string | null;
    eventSubscriptions?: string[];
    allowedActionTypes?: string[];
    rawTimingInstruction?: string | null;
  },
): AgentStrategyTimeline {
  const record = toRecord(value);
  const timelineRecord = toRecord(record.timeline);
  const stagesValue = Array.isArray(timelineRecord.stages)
    ? timelineRecord.stages
    : Array.isArray(record.stages)
      ? record.stages
      : null;

  if (!stagesValue || stagesValue.length === 0) {
    return buildLegacyTimeline(fallback);
  }

  const stages = stagesValue
    .map((entry, index) => {
      const stage = toRecord(entry);
      const triggerPolicyRecord = toRecord(stage.triggerPolicy);
      const triggerKind =
        normalizeTriggerKind(triggerPolicyRecord.kind) ||
        (toNullableString(triggerPolicyRecord.scheduleCron) ? "recurring_cron" : null) ||
        (toNullableString(triggerPolicyRecord.runAt) ? "one_time_at" : null) ||
        "event_window";
      const triggerAnchor =
        normalizeTriggerAnchor(triggerPolicyRecord.anchor) ||
        (triggerKind === "recurring_cron"
          ? "daily_at_time"
          : triggerKind === "one_time_at"
            ? "once_at_datetime"
            : inferAnchorFromLegacyEvent(toNullableString(triggerPolicyRecord.eventType) || null));

      return {
        id: toNullableString(stage.id) || `stage_${index + 1}`,
        title: toNullableString(stage.title) || `Stage ${index + 1}`,
        summary: toNullableString(stage.summary),
        status: normalizeStageStatus(stage.status),
        actionScope: toStringArray(stage.actionScope),
        triggerPolicy: {
          kind: triggerKind,
          anchor: triggerAnchor,
          rawTimingInstruction: toNullableString(triggerPolicyRecord.rawTimingInstruction),
          timezone: toNullableString(triggerPolicyRecord.timezone) || "America/New_York",
          scheduleCron: toNullableString(triggerPolicyRecord.scheduleCron),
          runAt: toNullableString(triggerPolicyRecord.runAt),
          offsetMinutes:
            typeof triggerPolicyRecord.offsetMinutes === "number" &&
            Number.isFinite(triggerPolicyRecord.offsetMinutes)
              ? triggerPolicyRecord.offsetMinutes
              : null,
          eventType: toNullableString(triggerPolicyRecord.eventType),
        },
      } satisfies AgentStrategyStage;
    })
    .filter((stage) => Boolean(stage.title));

  if (stages.length === 0) {
    return buildLegacyTimeline(fallback);
  }

  const currentStageId =
    toNullableString(timelineRecord.currentStageId) ||
    stages.find((stage) => stage.status === "active")?.id ||
    stages[0]?.id ||
    null;

  return {
    objective: toNullableString(timelineRecord.objective) || fallback.objective || fallback.mandate,
    currentStageId,
    stages,
  };
}

export function summarizeAgentStrategyTrigger(policy: AgentStrategyTriggerPolicy): string {
  switch (policy.anchor) {
    case "daily_at_time":
      return policy.scheduleCron || policy.rawTimingInstruction || "Recurring schedule";
    case "once_at_datetime":
      return policy.runAt || policy.rawTimingInstruction || "One-time run";
    case "day_close":
      return "After all games today";
    case "pre_lock":
      return policy.offsetMinutes
        ? `${policy.offsetMinutes} minutes before lock`
        : "Right before lock";
    case "post_game":
      return "After the relevant games end";
    case "post_settlement":
      return "After boosts settle";
    case "research_refresh":
      return "When fresh research arrives";
    default:
      return policy.rawTimingInstruction || "Timed stage";
  }
}

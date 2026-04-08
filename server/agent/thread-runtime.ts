import { getAgentToolCatalog } from "./hermes-tools";
import { buildAgentContinuityState } from "./continuity-state";
import { buildScopedHermesToolAllowlist } from "./runtime-adapter";
import { listAgentScheduleTemplates, listUserAgentSchedules } from "./schedules";
import {
  getAgentThread,
  listAgentThreadMessages,
  listAgentThreadResearchSources,
} from "./thread-service";
import type {
  AgentCapabilityGroupView,
  AgentIsolationBoundaryView,
  AgentThreadMessage,
  AgentThreadObjectiveView,
  AgentThreadRuntimeDetails,
  AgentThreadSummary,
  AgentThreadTimelineEvent,
  AgentThreadTimelineEventType,
  AgentToolDefinition,
} from "./types";

const VISIBLE_TOOL_EXPOSURES = new Set(["default", "advanced"]);

const ISOLATION_BOUNDARY: AgentIsolationBoundaryView = {
  gameplayOnly: true,
  codebaseAccess: false,
  arbitraryDatabaseAccess: false,
  genericFileAccess: false,
  adminAccess: false,
  riskyMutationsRequireConfirmation: true,
};

const SCHEDULE_TITLE_BY_JOB = new Map(
  listAgentScheduleTemplates().map((entry) => [entry.jobType, entry.title] as const),
);

function truncate(text: string | null | undefined, maxLength: number) {
  const normalized = (text || "").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeCapabilityGroup(tool: AgentToolDefinition): AgentCapabilityGroupView["key"] {
  if (
    tool.toolName === "get_user_schedules" ||
    tool.toolName === "get_schedule_templates" ||
    tool.toolName === "upsert_user_schedule" ||
    tool.toolName === "delete_user_schedule"
  ) {
    return "schedules";
  }

  if (tool.toolName === "get_hosted_research") {
    return "research";
  }

  switch (tool.category) {
    case "scan":
      return "scan";
    case "plan":
      return "plan";
    case "action":
      return "action";
    case "memory":
      return "memory";
    case "read":
    default:
      return "read";
  }
}

function buildCapabilityGroups(tools: AgentToolDefinition[]): AgentCapabilityGroupView[] {
  const grouped = new Map<AgentCapabilityGroupView["key"], AgentCapabilityGroupView>();
  const labels: Record<AgentCapabilityGroupView["key"], string> = {
    read: "Read",
    scan: "Scan",
    research: "Research",
    plan: "Plan",
    action: "Action",
    memory: "Memory",
    schedules: "Schedules",
  };

  for (const tool of tools) {
    if (!VISIBLE_TOOL_EXPOSURES.has(tool.exposure || "default")) {
      continue;
    }

    const key = normalizeCapabilityGroup(tool);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        label: labels[key],
        tools: [],
      });
    }

    grouped.get(key)!.tools.push({
      toolName: tool.toolName,
      description: tool.description,
      requiresConfirmation: tool.requiresConfirmation,
      riskLevel: tool.riskLevel,
      examplePrompts: tool.examplePrompts.slice(0, 3),
    });
  }

  const order: AgentCapabilityGroupView["key"][] = [
    "read",
    "scan",
    "research",
    "plan",
    "action",
    "memory",
    "schedules",
  ];

  return order
    .map((key) => grouped.get(key))
    .filter((entry): entry is AgentCapabilityGroupView => Boolean(entry))
    .map((entry) => ({
      ...entry,
      tools: [...entry.tools].sort((left, right) => left.toolName.localeCompare(right.toolName)),
    }))
    .filter((entry) => entry.tools.length > 0);
}

function deriveEventType(message: AgentThreadMessage): AgentThreadTimelineEventType {
  if (message.role === "user") {
    return "user_turn";
  }

  if (message.generatedBy === "hermes_schedule") {
    return "scheduled_advisory";
  }

  if (message.actionBundle) {
    if (message.pendingClarification || message.actionBundle.status === "pending_clarification") {
      return "clarification_needed";
    }
    if (message.messageType === "plan") {
      return "plan_staged";
    }
    if (message.actionBundle.status === "applied") {
      return "plan_applied";
    }
    if (message.actionBundle.status === "rejected") {
      return "plan_cancelled";
    }
    if (message.actionBundle.status === "failed") {
      return "plan_failed";
    }
  }

  if ((message.citations || []).length > 0) {
    return "research_update";
  }

  return "assistant_run";
}

function deriveEventStatus(
  message: AgentThreadMessage,
  type: AgentThreadTimelineEventType,
): AgentThreadTimelineEvent["status"] {
  if (type === "user_turn") {
    return "info";
  }
  if (type === "clarification_needed" || message.pendingClarification) {
    return "waiting_on_you";
  }
  if (type === "plan_staged") {
    return "waiting_on_you";
  }
  if (type === "plan_applied") {
    return "completed";
  }
  if (type === "plan_cancelled") {
    return "blocked";
  }
  if (type === "plan_failed" || message.messageType === "error") {
    return "failed";
  }
  if (type === "scheduled_advisory") {
    return "tracking";
  }

  return "tracking";
}

function deriveEventTitle(message: AgentThreadMessage, type: AgentThreadTimelineEventType): string {
  if (type === "user_turn") {
    return message.messageType === "confirmation" ? "You updated the plan state" : "You checked in";
  }

  if (type === "scheduled_advisory") {
    return (
      SCHEDULE_TITLE_BY_JOB.get(message.scheduleJobType || "daily_setup_review") ||
      "Scheduled Advisory"
    );
  }

  if (type === "plan_staged") {
    return message.actionBundle?.summary || "Plan staged for confirmation";
  }

  if (type === "clarification_needed") {
    return message.actionBundle?.summary || "Hermes needs one more detail";
  }

  if (type === "plan_applied") {
    return message.actionBundle?.summary || "Plan applied";
  }

  if (type === "plan_cancelled") {
    return message.actionBundle?.summary || "Plan dismissed";
  }

  if (type === "plan_failed") {
    return message.actionBundle?.summary || "Plan failed";
  }

  if (type === "research_update") {
    return "Research-backed update";
  }

  return truncate(message.contentText, 72) || "Hermes update";
}

function buildTimeline(messages: AgentThreadMessage[]): AgentThreadTimelineEvent[] {
  return [...messages]
    .map((message) => {
      const type = deriveEventType(message);

      return {
        id: message.id,
        type,
        title: deriveEventTitle(message, type),
        summary: truncate(message.contentText, 220),
        status: deriveEventStatus(message, type),
        createdAt: new Date(message.createdAt),
        runId: message.runId || null,
        citations: message.citations || [],
        toolTrace: message.toolTrace || [],
        skillsUsed: message.skillsUsed || [],
        memoryInfluences: message.memoryInfluences || [],
        confirmationPreview: message.confirmationPreview || null,
      } satisfies AgentThreadTimelineEvent;
    })
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

function buildObjectiveFromPendingBundle(
  thread: AgentThreadSummary,
): AgentThreadObjectiveView | null {
  if (!thread.pendingActionBundle) {
    return null;
  }

  const pendingClarification =
    thread.pendingActionBundle.status === "pending_clarification" ||
    Boolean(thread.pendingActionBundle.pendingClarification);

  return {
    title: thread.pendingActionBundle.summary,
    status: "waiting_on_you",
    summary: pendingClarification
      ? "Hermes has a staged workflow but needs one more detail before it can finish the plan."
      : "Hermes has already translated the latest request into a staged move and is waiting for confirmation.",
    nextStep: pendingClarification
      ? thread.pendingActionBundle.pendingClarification?.prompt || "Reply with the missing detail."
      : "Review the staged move and confirm or cancel it.",
    source: pendingClarification ? "clarification" : "pending_bundle",
    updatedAt: new Date(thread.pendingActionBundle.createdAt),
    runId: thread.pendingActionBundle.runId,
  };
}

function buildObjectiveFromTimeline(
  timeline: AgentThreadTimelineEvent[],
): AgentThreadObjectiveView | null {
  const latest = timeline.find((event) => event.type !== "user_turn");
  if (!latest) {
    return null;
  }

  if (latest.type === "scheduled_advisory") {
    return {
      title: latest.title,
      status: "tracking",
      summary:
        latest.summary || "Hermes is continuing to watch this setup through scheduled advisories.",
      nextStep:
        "Review the latest advisory or send a direct instruction when you want a concrete move.",
      source: "scheduled_advisory",
      updatedAt: latest.createdAt,
      runId: latest.runId,
    };
  }

  if (latest.type === "plan_applied") {
    return {
      title: latest.title,
      status: "completed",
      summary: latest.summary || "The latest staged workflow has already been applied.",
      nextStep: "Review the result and tell Hermes what to track next.",
      source: "applied_result",
      updatedAt: latest.createdAt,
      runId: latest.runId,
    };
  }

  if (latest.type === "research_update" || latest.type === "assistant_run") {
    return {
      title: latest.title,
      status: "tracking",
      summary: latest.summary || "Hermes has an active read on the current setup.",
      nextStep:
        "Ask Hermes to turn the latest read into a concrete staged move if you want to act.",
      source: "assistant_run",
      updatedAt: latest.createdAt,
      runId: latest.runId,
    };
  }

  return null;
}

function buildSinceLastUserMessage(
  messages: AgentThreadMessage[],
  timeline: AgentThreadTimelineEvent[],
) {
  const lastUserMessage = [...messages]
    .filter((message) => message.role === "user")
    .sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )[0];

  const anchorAt = lastUserMessage ? new Date(lastUserMessage.createdAt) : null;
  const updates = anchorAt
    ? timeline.filter(
        (event) => event.type !== "user_turn" && event.createdAt.getTime() > anchorAt.getTime(),
      )
    : timeline.filter((event) => event.type !== "user_turn").slice(0, 4);

  if (!anchorAt && updates.length === 0) {
    return null;
  }

  const headline =
    updates.length === 0
      ? "Hermes has no newer updates since your last message."
      : updates.length === 1
        ? "Hermes has 1 update since your last message."
        : `Hermes has ${updates.length} updates since your last message.`;

  return {
    anchorAt,
    eventCount: updates.length,
    headline,
    items: updates.slice(0, 4).map((event) => ({
      id: event.id,
      title: event.title,
      createdAt: event.createdAt,
      type: event.type,
    })),
  };
}

export async function getAgentThreadRuntimeDetails(
  userId: string,
  threadId: string,
): Promise<AgentThreadRuntimeDetails> {
  const [thread, messages, researchSources, schedules, continuity] = await Promise.all([
    getAgentThread(userId, threadId),
    listAgentThreadMessages(userId, threadId),
    listAgentThreadResearchSources(userId, threadId),
    listUserAgentSchedules(userId),
    buildAgentContinuityState({
      userId,
      threadId,
    }),
  ]);

  const timeline = buildTimeline(messages);
  const activeObjective =
    buildObjectiveFromPendingBundle(thread) || buildObjectiveFromTimeline(timeline);

  const defaultCapabilityToolNames = new Set(
    buildScopedHermesToolAllowlist({
      toolCatalog: getAgentToolCatalog(),
      message: "",
      capabilities: {
        domains: ["sportfolio"],
        actionTypes: [],
        canAnalyze: true,
        canAutoExecute: false,
        canUseWebResearch: true,
        runtime: "hermes",
        hasDurableMemory: true,
        canScheduleAdvisories: true,
        dataSources: undefined,
      },
      conversationMode: "general_chat",
    }),
  );

  return {
    activeObjective,
    sinceLastUserMessage: buildSinceLastUserMessage(messages, timeline),
    continuity,
    timeline,
    researchSources,
    schedules,
    capabilityGroups: buildCapabilityGroups(
      getAgentToolCatalog().filter((tool) => defaultCapabilityToolNames.has(tool.toolName)),
    ),
    isolation: ISOLATION_BOUNDARY,
  };
}

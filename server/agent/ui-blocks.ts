import {
  isAgentUiBlockSlot,
  isAgentUiBlockType,
  type AgentUiBlock,
  type AgentUiBlockSlot,
} from "@shared/agent-ui";
import {
  normalizeAgentStrategyTimeline,
  summarizeAgentStrategyTrigger,
} from "@shared/agent-strategy";
import type {
  AgentCitation,
  AgentPendingClarification,
  HermesConversationMode,
  HermesRespondResult,
  HermesStrategyContext,
} from "./types";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function normalizeBlockSlot(value: unknown): AgentUiBlockSlot | null {
  return isAgentUiBlockSlot(value) ? value : null;
}

function getPrimarySlot(mode: HermesConversationMode | null | undefined): AgentUiBlockSlot {
  return mode && mode !== "general_chat" ? "strategy_overview" : "chat_header";
}

function getInlineSlot(mode: HermesConversationMode | null | undefined): AgentUiBlockSlot {
  return mode && mode !== "general_chat" ? "strategy_chat" : "chat_inline";
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getStrategyTimeline(strategyContext: HermesStrategyContext | null | undefined) {
  if (!strategyContext) {
    return null;
  }

  return normalizeAgentStrategyTimeline(strategyContext.normalizedRuleSheet, {
    objective: strategyContext.mandate,
    mandate: strategyContext.mandate,
    rawTimingInstruction: null,
  });
}

function formatScheduleLabel(
  strategyContext: HermesStrategyContext | null | undefined,
): string | null {
  const timeline = getStrategyTimeline(strategyContext);
  const activeStage =
    timeline?.stages.find((stage) => stage.id === timeline.currentStageId) || timeline?.stages[0];
  if (activeStage) {
    return summarizeAgentStrategyTrigger(activeStage.triggerPolicy);
  }

  const normalizedRuleSheet = toRecord(strategyContext?.normalizedRuleSheet);
  const triggerPolicy = toRecord(normalizedRuleSheet.triggerPolicy);
  const scheduleCron = toString(triggerPolicy.scheduleCron);
  if (scheduleCron) {
    return scheduleCron;
  }

  const eventSubscriptions = toStringArray(triggerPolicy.eventSubscriptions);
  if (eventSubscriptions.length > 0) {
    return eventSubscriptions.map(titleCase).join(" + ");
  }

  return null;
}

function extractStrategyActionScope(
  strategyContext: HermesStrategyContext | null | undefined,
  result: HermesRespondResult,
): string[] {
  const normalizedRuleSheet = toRecord(strategyContext?.normalizedRuleSheet);
  const timeline = getStrategyTimeline(strategyContext);
  const activeStage =
    timeline?.stages.find((stage) => stage.id === timeline.currentStageId) || timeline?.stages[0];
  const executionEnvelope = toRecord(normalizedRuleSheet.executionEnvelope);
  const normalizedScope = toStringArray(normalizedRuleSheet.actionScope);
  const stageScope = activeStage?.actionScope || [];
  const envelopeScope = toStringArray(executionEnvelope.allowedActionTypes);
  const proposedScope = result.proposedActions
    .map((action) => action.actionType)
    .filter((entry) => entry.trim().length > 0);

  return Array.from(
    new Set(
      [...normalizedScope, ...envelopeScope, ...proposedScope]
        .concat(stageScope)
        .map((entry) => titleCase(entry))
        .filter((entry) => entry.trim().length > 0),
    ),
  ).slice(0, 5);
}

function extractMissingDetails(
  strategyContext: HermesStrategyContext | null | undefined,
  result: HermesRespondResult,
): string[] {
  const normalizedRuleSheet = toRecord(strategyContext?.normalizedRuleSheet);
  const normalizedMissing = toStringArray(normalizedRuleSheet.missingDetails);

  if (normalizedMissing.length > 0) {
    return normalizedMissing.slice(0, 4);
  }

  if (!result.pendingClarification) {
    return [];
  }

  return [
    ...toStringArray(result.pendingClarification.missingFields),
    ...toStringArray(result.pendingClarification.workflowPreviewSteps),
  ].slice(0, 4);
}

function buildStrategyRuleItems(
  strategyContext: HermesStrategyContext | null | undefined,
  result: HermesRespondResult,
): Array<{ label: string; value: string }> {
  if (!strategyContext) {
    return [];
  }

  const normalizedRuleSheet = toRecord(strategyContext.normalizedRuleSheet);
  const executionEnvelope = toRecord(normalizedRuleSheet.executionEnvelope);
  const guardrails = toRecord(executionEnvelope.guardrails);
  const items: Array<{ label: string; value: string }> = [];
  const actionScope = extractStrategyActionScope(strategyContext, result);

  if (strategyContext.reviewState?.status === "pending") {
    items.push({
      label: "Review",
      value: "Approve the saved playbook before activation",
    });
  }

  if (actionScope.length > 0) {
    items.push({
      label: "Actions",
      value: actionScope.join(", "),
    });
  }

  if (typeof guardrails.maxActionsPerRun === "number") {
    items.push({
      label: "Run cap",
      value: String(guardrails.maxActionsPerRun),
    });
  }

  if (typeof guardrails.maxActionsPerDay === "number") {
    items.push({
      label: "Daily cap",
      value: String(guardrails.maxActionsPerDay),
    });
  }

  return items.slice(0, 4);
}

export function normalizeAgentUiBlocks(value: unknown): AgentUiBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const block = toRecord(entry);
    const type = block.type;
    if (!isAgentUiBlockType(type)) {
      return [];
    }

    return [
      {
        type,
        slot: normalizeBlockSlot(block.slot),
        priority: typeof block.priority === "number" ? block.priority : null,
        props: toRecord(block.props),
      } as AgentUiBlock,
    ];
  });
}

function buildGoalBlock(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
  strategyContext: HermesStrategyContext | null | undefined;
}): AgentUiBlock {
  const title =
    input.strategyContext?.mandate ||
    input.result.summary ||
    input.result.assistantText ||
    "Hermes is ready.";

  const summary =
    input.result.summary ||
    (input.conversationMode === "strategy_builder"
      ? "Keep defining the recurring strategy until its rules and schedule are clear."
      : input.conversationMode === "strategy_refinement"
        ? "This chat is editing an existing saved strategy."
        : input.conversationMode === "strategy_review"
          ? "Use this workspace to review the latest strategy behavior and tweak it if needed."
          : "Continue the portfolio conversation from here.");

  const badge =
    input.conversationMode === "strategy_builder"
      ? "building"
      : input.conversationMode === "strategy_refinement"
        ? "editing"
        : input.conversationMode === "strategy_review"
          ? "review"
          : null;

  return {
    type: "goal_strip",
    slot: getPrimarySlot(input.conversationMode),
    priority: 10,
    props: {
      eyebrow: input.conversationMode === "general_chat" ? "Goal" : "Strategy",
      title,
      status: input.result.outcome === "error" ? "blocked" : "tracking",
      summary,
      nextStep: input.result.pendingClarification
        ? "Answer the missing detail to keep going."
        : input.result.requiresConfirmation
          ? "Review the pending plan before it can move forward."
          : null,
      badge,
    },
  };
}

function buildPendingDecisionBlock(input: {
  summary: string;
  riskClass?: "low" | "medium" | "high" | null;
  helper?: string | null;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock {
  return {
    type: "pending_decision",
    slot: getInlineSlot(input.conversationMode),
    priority: 20,
    props: {
      title: "Waiting on you",
      summary: input.summary,
      risk: input.riskClass || null,
      helper: input.helper || null,
      actionLabel: "Review the staged plan below",
    },
  };
}

function buildExecutionChecklistBlock(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
  strategyContext: HermesStrategyContext | null | undefined;
}): AgentUiBlock | null {
  if (input.result.pendingClarification) {
    return {
      type: "execution_checklist",
      slot: getInlineSlot(input.conversationMode),
      priority: 18,
      props: {
        title: "Execution flow",
        summary: "Hermes needs one detail before it can continue the workflow.",
        items: [
          {
            id: "clarify",
            label: "Reply with the missing detail",
            detail: input.result.pendingClarification.prompt,
            status: "in_progress",
          },
          {
            id: "resume",
            label: "Hermes resumes the run",
            detail: "Once you answer, Hermes continues in the same thread context.",
            status: "pending",
          },
        ],
      },
    };
  }

  if (input.result.requiresConfirmation) {
    return {
      type: "execution_checklist",
      slot: getInlineSlot(input.conversationMode),
      priority: 18,
      props: {
        title: "Execution flow",
        summary: "The plan is staged but not applied yet.",
        items: [
          {
            id: "review",
            label: "Review the staged impact",
            detail:
              input.result.confirmationPreview?.actionSummary ||
              input.result.summary ||
              "Check the proposed change before confirming it.",
            status: "ready",
          },
          {
            id: "confirm",
            label: "Confirm or cancel",
            detail: "Sportfolio only applies the change after an explicit confirm action.",
            status: "pending",
          },
        ],
      },
    };
  }

  if (input.strategyContext?.reviewState?.status === "pending") {
    return {
      type: "execution_checklist",
      slot: "strategy_overview",
      priority: 22,
      props: {
        title: "Review flow",
        summary: "Saved strategy changes still need approval before activation.",
        items: [
          {
            id: "review_strategy",
            label: "Review the saved playbook",
            detail:
              input.strategyContext.reviewState.summary ||
              "Check the saved stages, triggers, and action scope before activation.",
            status: "ready",
          },
          {
            id: "approve_strategy",
            label: "Approve before activation",
            detail: "Leave the strategy inactive until you explicitly review and approve it.",
            status: "pending",
          },
        ],
      },
    };
  }

  return null;
}

function buildClarificationBlock(input: {
  clarification: AgentPendingClarification;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock {
  return {
    type: "clarification_card",
    slot: getInlineSlot(input.conversationMode),
    priority: 20,
    props: {
      title: "One detail is missing",
      prompt: input.clarification.prompt,
      helper: "Reply naturally and Hermes will keep going.",
      choices: input.clarification.workflowPreviewSteps || [],
    },
  };
}

function buildSourceBlock(input: {
  citations: AgentCitation[];
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock | null {
  if (input.citations.length === 0) {
    return null;
  }

  return {
    type: "source_list",
    slot: getInlineSlot(input.conversationMode),
    priority: 40,
    props: {
      title: "Sources",
      sources: input.citations.slice(0, 3).map((citation) => ({
        id: citation.id,
        title: citation.title,
        sourceName: citation.sourceName,
        retrievedAt: citation.retrievedAt,
        url: citation.url,
        factSummary: citation.factSummary,
      })),
    },
  };
}

function buildStrategyStatusOrDraftBlock(input: {
  result: HermesRespondResult;
  strategyContext: HermesStrategyContext;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock {
  const normalizedRuleSheet = toRecord(input.strategyContext.normalizedRuleSheet);
  const isDraft =
    input.strategyContext.status === "draft" &&
    (input.conversationMode === "strategy_builder" ||
      input.conversationMode === "strategy_refinement");

  if (isDraft) {
    return {
      type: "strategy_draft",
      slot: "strategy_overview",
      priority: 25,
      props: {
        title: input.strategyContext.mandate,
        summary: input.result.summary || null,
        schedule: formatScheduleLabel(input.strategyContext),
        actionScope: extractStrategyActionScope(input.strategyContext, input.result),
        missingDetails: extractMissingDetails(input.strategyContext, input.result),
      },
    };
  }

  return {
    type: "strategy_status",
    slot: "strategy_overview",
    priority: 25,
    props: {
      title: input.strategyContext.mandate,
      status: input.strategyContext.status || "draft",
      summary: input.result.summary || null,
      lastResult: input.result.assistantText || null,
    },
  };
}

function buildStrategyScheduleBlock(
  strategyContext: HermesStrategyContext | null | undefined,
): AgentUiBlock | null {
  if (!strategyContext) {
    return null;
  }

  const normalizedRuleSheet = toRecord(strategyContext.normalizedRuleSheet);
  const scheduleLabel = formatScheduleLabel(strategyContext);
  if (!scheduleLabel) {
    return null;
  }

  return {
    type: "schedule_summary",
    slot: "strategy_overview",
    priority: 35,
    props: {
      title: "Schedule",
      scheduleLabel,
      helper:
        strategyContext.status === "live"
          ? "Hermes will wake this strategy on its saved cadence."
          : "This cadence will be used when the strategy is active.",
    },
  };
}

function buildStrategyRulesBlock(input: {
  strategyContext: HermesStrategyContext | null | undefined;
  result: HermesRespondResult;
}): AgentUiBlock | null {
  const items = buildStrategyRuleItems(input.strategyContext, input.result);
  if (items.length === 0) {
    return null;
  }

  return {
    type: "rules_summary",
    slot: "strategy_overview",
    priority: 40,
    props: {
      title: "Rules",
      items,
    },
  };
}

function buildRunSummaryBlock(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock | null {
  if (!input.result.summary && !input.result.assistantText) {
    return null;
  }

  return {
    type: "run_summary",
    slot: getInlineSlot(input.conversationMode),
    priority: 60,
    props: {
      title: "Latest Hermes run",
      summary: input.result.summary || input.result.assistantText,
      status: input.result.outcome,
      transport: input.result.runtimeMetadata?.transport || null,
      createdAt: null,
      trigger: input.result.runtimeMetadata?.triggerSource || null,
    },
  };
}

export function buildFallbackAgentUiBlocks(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
  strategyContext: HermesStrategyContext | null | undefined;
}): AgentUiBlock[] {
  const blocks: AgentUiBlock[] = [buildGoalBlock(input)];
  const executionChecklistBlock = buildExecutionChecklistBlock(input);
  if (executionChecklistBlock) {
    blocks.push(executionChecklistBlock);
  }

  if (input.result.pendingClarification) {
    blocks.push(
      buildClarificationBlock({
        clarification: input.result.pendingClarification,
        conversationMode: input.conversationMode,
      }),
    );
  } else if (input.result.requiresConfirmation) {
    blocks.push(
      buildPendingDecisionBlock({
        conversationMode: input.conversationMode,
        summary:
          input.result.confirmationPreview?.actionSummary ||
          input.result.summary ||
          "A staged plan is waiting for review.",
        riskClass: input.result.confirmationPreview?.riskClass || null,
        helper:
          input.result.confirmationPreview?.estimatedImpact ||
          input.result.confirmationPreview?.warnings[0] ||
          null,
      }),
    );
  } else if (input.strategyContext?.reviewState?.status === "pending") {
    blocks.push(
      buildPendingDecisionBlock({
        conversationMode: input.conversationMode,
        summary:
          input.strategyContext.reviewState.summary ||
          "Review the saved stages, triggers, and action scope before activation.",
        helper: "Use the strategy Rules or Overview tab to approve the latest saved playbook.",
      }),
    );
  }

  const sourceBlock = buildSourceBlock({
    citations: input.result.citations,
    conversationMode: input.conversationMode,
  });
  if (sourceBlock) {
    blocks.push(sourceBlock);
  }

  if (input.strategyContext) {
    blocks.push(
      buildStrategyStatusOrDraftBlock({
        result: input.result,
        strategyContext: input.strategyContext,
        conversationMode: input.conversationMode,
      }),
    );

    const scheduleBlock = buildStrategyScheduleBlock(input.strategyContext);
    if (scheduleBlock) {
      blocks.push(scheduleBlock);
    }

    const rulesBlock = buildStrategyRulesBlock({
      strategyContext: input.strategyContext,
      result: input.result,
    });
    if (rulesBlock) {
      blocks.push(rulesBlock);
    }
  }

  const runBlock = buildRunSummaryBlock({
    result: input.result,
    conversationMode: input.conversationMode,
  });
  if (runBlock) {
    blocks.push(runBlock);
  }

  return blocks;
}

export function materializeAgentUiBlocks(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
  strategyContext: HermesStrategyContext | null | undefined;
}): AgentUiBlock[] {
  return input.result.uiBlocks && input.result.uiBlocks.length > 0
    ? normalizeAgentUiBlocks(input.result.uiBlocks)
    : buildFallbackAgentUiBlocks(input);
}

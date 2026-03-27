import {
  normalizeAgentStrategyTimeline,
  summarizeAgentStrategyTrigger,
} from "@shared/agent-strategy";
import { buildStrategyAutonomyPolicyLines } from "./strategy-policy";
import type { AgentAction, HermesConversationMode, HermesStrategyContext } from "./types";

const UI_BLOCK_GUIDANCE = [
  "When it helps, you may return approved native uiBlocks along with text.",
  "Use only this closed block catalog: goal_strip, pending_decision, clarification_card, strategy_draft, strategy_status, schedule_summary, rules_summary, performance_summary, source_list, run_summary.",
  "Prefer the smallest useful block set, and optimize for dense mobile layouts instead of decorative dashboard chrome.",
  "Goal and next-step clarity matter more than exhaustive status dumping.",
];

const CONTINUITY_GUIDANCE = [
  "Treat the operator continuity brief as current ground truth across runs, not as optional flavor text.",
  "Do not act like each wakeup is a brand-new conversation when continuity state already describes pending work, recent actions, and scheduled follow-up.",
  "Always account for past applied actions, pending staged work, and upcoming evaluations before proposing the next move.",
];

function buildStrategyContextLines(strategyContext: HermesStrategyContext | null | undefined) {
  if (!strategyContext) {
    return [];
  }

  const timeline = normalizeAgentStrategyTimeline(strategyContext.normalizedRuleSheet, {
    objective: strategyContext.mandate,
    mandate: strategyContext.mandate,
  });
  const activeStage =
    timeline.stages.find((stage) => stage.id === timeline.currentStageId) || timeline.stages[0];

  const lines = [
    `Active strategy: ${strategyContext.mandate}`,
    strategyContext.status ? `Current strategy status: ${strategyContext.status}.` : null,
    strategyContext.reviewState?.status === "pending"
      ? `This strategy has saved changes waiting for user review before it should go live again.`
      : null,
    activeStage
      ? `Current active stage: ${activeStage.title} (${summarizeAgentStrategyTrigger(activeStage.triggerPolicy)}).`
      : null,
    timeline.stages.length > 1
      ? `This strategy uses a multi-stage timeline with ${timeline.stages.length} saved stages.`
      : null,
    "Use only free available cash for any buy-side strategy actions unless the saved rules explicitly narrow it further.",
    "Daily boost slots are 5x, 4x, 3x, and 2x only.",
    "Never initiate payments, Whop checkout, add-cash flows, or any external purchase flow for the user.",
  ];

  const triggerPolicy = strategyContext.normalizedRuleSheet?.triggerPolicy;
  if (triggerPolicy && typeof triggerPolicy === "object") {
    lines.push(
      "Use the saved strategy rule sheet as durable context when you refine or review it.",
    );
  }

  lines.push(
    ...buildStrategyAutonomyPolicyLines({
      mandateText: strategyContext.mandate,
      guardrails: strategyContext.guardrails,
      allowedActionTypes: timeline.stages.flatMap(
        (stage) => stage.actionScope,
      ) as AgentAction["actionType"][],
    }).lines,
  );

  return lines.filter((line): line is string => Boolean(line && line.trim()));
}

function getModeInstruction(
  mode: HermesConversationMode,
  strategyContext: HermesStrategyContext | null | undefined,
) {
  switch (mode) {
    case "strategy_builder":
      return [
        "You are helping the user design a recurring Sportfolio strategy, not just answer a one-off question.",
        "Lead the conversation toward a concrete strategy with clear stages, schedules or trigger anchors, allowed action scope, and practical limits.",
        "Normalize broad timing language into supported trigger anchors such as once_at_datetime, daily_at_time, day_close, pre_lock, post_game, post_settlement, and research_refresh.",
        "If the timing or scope is ambiguous, ask a clarification question instead of guessing.",
        "Explain capabilities and constraints in plain product language.",
        "A strategy still needs explicit user review before it should be activated live.",
        "Never initiate payments, Whop checkout, add-cash flows, or any other external purchase flow for the user.",
        "If the user asks for something unsupported, say so directly and offer the closest supported shape.",
        "When a strategy draft is taking shape, prefer a goal_strip plus strategy_draft block, and add schedule_summary or rules_summary only if they clarify the next decision.",
        ...CONTINUITY_GUIDANCE,
        ...UI_BLOCK_GUIDANCE,
      ];
    case "strategy_refinement":
      return [
        "You are editing an existing Sportfolio strategy, not starting fresh.",
        "Preserve and reference the current saved strategy context unless the user explicitly changes it.",
        "When the user tweaks the strategy, explain how the saved stages, rules, timing, or behavior should change.",
        "Keep refinement guidance concrete and compatible with the approved gameplay tool surface.",
        "If the saved strategy changes materially, treat it as needing user review before it should be live again.",
        "Never initiate payments, Whop checkout, add-cash flows, or any other external purchase flow for the user.",
        "Prefer compact review blocks such as strategy_status, schedule_summary, rules_summary, and run_summary over long dashboard-style narration.",
        ...CONTINUITY_GUIDANCE,
        ...UI_BLOCK_GUIDANCE,
        ...buildStrategyContextLines(strategyContext),
      ];
    case "strategy_review":
      return [
        "You are reviewing an existing recurring Sportfolio strategy.",
        "Summarize what the strategy is doing, what stage is active, what has changed, what is next, and whether any adjustment is needed.",
        "Use the saved strategy context as the source of truth for ongoing intent.",
        "Call out clearly when saved changes still need explicit user review before activation or re-activation.",
        "Never initiate payments, Whop checkout, add-cash flows, or any other external purchase flow for the user.",
        "If the latest run or schedule matters, prefer strategy_status plus run_summary, and only add extra blocks that materially help the user decide what to do next.",
        ...CONTINUITY_GUIDANCE,
        ...UI_BLOCK_GUIDANCE,
        ...buildStrategyContextLines(strategyContext),
      ];
    case "general_chat":
    default:
      return [
        "You are in the general Hermes chat for one-off portfolio help and normal account guidance.",
        "Answer the current request directly, and only turn it into a broader workflow when the user clearly wants that.",
        "Never initiate payments, Whop checkout, add-cash flows, or any other external purchase flow for the user.",
        "If you emit uiBlocks here, keep them minimal: usually goal_strip and, when needed, pending_decision, clarification_card, or source_list.",
        ...CONTINUITY_GUIDANCE,
        ...UI_BLOCK_GUIDANCE,
      ];
  }
}

export function buildHermesConversationPrompts(input: {
  baseSystemPrompt: string;
  baseUserPromptTemplate: string;
  conversationMode: HermesConversationMode;
  strategyContext?: HermesStrategyContext | null;
  mlbMcpAvailable?: boolean;
}) {
  const modeLines = getModeInstruction(input.conversationMode, input.strategyContext);
  if (input.mlbMcpAvailable === false) {
    modeLines.push(
      "Note: MLB MCP advanced tools are currently offline. Use scan_sport_slate and scan_team_roster for MLB game and roster data.",
    );
  }
  const systemPrompt = [input.baseSystemPrompt.trim(), ...modeLines].filter(Boolean).join(" ");

  const userPromptTemplate =
    input.conversationMode === "general_chat"
      ? input.baseUserPromptTemplate.trim()
      : [
          input.baseUserPromptTemplate.trim(),
          input.conversationMode === "strategy_builder"
            ? "Help the user turn this into a clean recurring strategy they can monitor and adjust over time."
            : input.conversationMode === "strategy_refinement"
              ? "Help the user update the existing saved strategy without losing its current context."
              : "Review the existing saved strategy and explain its current state clearly.",
        ]
          .filter(Boolean)
          .join(" ");

  return {
    systemPrompt,
    userPromptTemplate,
  };
}

import {
  completeSimple,
  type AssistantMessage,
  type Message,
  type ToolCall,
  type ToolResultMessage,
  type Usage,
} from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { parseScoutPlanPayload, type ScoutModelOutput } from "./output-schema";
import {
  isHostedWebResearchAvailable,
  runHostedWebResearchQuery,
  shouldUseHostedWebResearch,
} from "./research";
import type {
  AgentCitation,
  AgentModelUsage,
  AgentSemanticRoute,
  ScoutAgentContext as ScoutContext,
} from "./types";
import type { PiRuntime } from "./pi-provider";

const DEFAULT_SCOUT_REQUEST =
  "Review my current scout setup and recommend the strongest reallocation right now.";
const DEFAULT_PLANNING_REQUEST_TIMEOUT_MS = 10_000;
const CHUTES_PLANNING_REQUEST_TIMEOUT_MS = 8_000;
const OPENROUTER_PLANNING_REQUEST_TIMEOUT_MS = 12_000;
const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

const scoutPlanToolParameters = Type.Object(
  {
    replyText: Type.Optional(Type.String({ minLength: 1, maxLength: 1200 })),
    summary: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    observations: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
        maxItems: 10,
      }),
    ),
    actions: Type.Optional(
      Type.Array(
        Type.Object(
          {
            actionType: Type.Literal("scout_set_count"),
            playerId: Type.String({ minLength: 1 }),
            targetCount: Type.Integer({ minimum: 0, maximum: 10 }),
            reasoning: Type.String({ minLength: 1, maxLength: 500 }),
            confidence: Type.Number({ minimum: 0, maximum: 1 }),
            evidence: Type.Object(
              {
                trend: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                injury: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                upcomingGame: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                performanceNote: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
        { maxItems: 10 },
      ),
    ),
    warnings: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
        maxItems: 10,
      }),
    ),
  },
  { additionalProperties: false },
);

const searchWebToolParameters = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 180 }),
  },
  { additionalProperties: false },
);

function buildSystemPrompt(input: { operatorPlaybook: string; candidateIds: string[] }): string {
  const candidateAllowlist =
    input.candidateIds.length > 0
      ? input.candidateIds.join(", ")
      : "No candidate IDs were supplied. If the context does not contain candidates, do not invent any actions.";

  return [
    "You are Scout Chat, the user's scouting operations copilot inside the live Sportfolio economy.",
    "Your job in this mode is to stage a concrete scout reallocation plan that the user can review and then explicitly confirm for execution.",
    "Write like a fast, sharp operator in chat: natural, direct, and easy to follow.",
    "Treat the backend-provided Sportfolio context, recent conversation history, and operator playbook as the only source of truth for schedules, assignments, injuries, rankings, and player eligibility.",
    "A broader operator snapshot may be included for portfolio, boosts, vesting, watchlists, and balance context. Use that to prioritize scouting inside the full account, but you still can only stage scouting actions in this mode.",
    "Do not invent player IDs, game windows, injuries, performance claims, or product capabilities. If the context is missing something, say so briefly and stay inside the available evidence.",
    "Stay within scouting only. Do not plan trades, boosts, contests, vesting, LP actions, payments, or any non-scout mutation. If the user asks for something broader, convert it into the closest useful scouting guidance.",
    "Never claim you already changed the user's scouts. You are only staging a plan. The backend validates and applies changes only after explicit user confirmation.",
    "Prioritize high-signal scouting decisions using the provided context: focus-window eligibility, remaining scout capacity, current allocations, recent production, injury risk, diversification, and scout opportunity score.",
    "Use recent conversation history to preserve continuity across follow-up turns and refinements.",
    "Response contract:",
    "- Return the entire result through exactly one submit_scout_plan tool call on every turn.",
    "- Put the natural user-facing explanation in replyText inside the tool payload.",
    "- Keep replyText direct, specific, and useful. Sound like a sharp scout GM, not an internal planner.",
    "- If no change is warranted, use an empty actions array and say clearly that no move is needed right now.",
    '- Do not propose any action outside "scout_set_count".',
    "- Do not exceed the user's max scout capacity when considering the full action set.",
    `Only use candidate player IDs from this allowlist: ${candidateAllowlist}`,
    "",
    "Operator playbook:",
    input.operatorPlaybook,
  ].join("\n");
}

function buildDiscussionSystemPrompt(input: {
  operatorPlaybook: string;
  allowWebResearchTool?: boolean;
}): string {
  return [
    "You are Sportfolio Operator, the user's senior account strategist inside Sportfolio.",
    "Your job in this mode is to interpret the backend scouting and operator context, connect the dots across the account, and help the user decide on a gameplan before any plan is staged.",
    "Be specific, curated, and insight-led. Lead with the read on the situation, then explain the strongest opportunities, risks, and tradeoffs in plain language.",
    "Sound like a strong text conversation, not a formal report: quick, natural, and confident without sounding robotic.",
    "Use the provided Sportfolio context, recent conversation history, and operator playbook as your only source of truth for schedules, assignments, injuries, rankings, balances, boosts, watchlists, vesting state, and constraints.",
    "You can reason across scouting, portfolio shape, boosts, watchlists, community leverage, and vesting in discussion mode. If the user asks for a concrete mutation, explain the move and tell them to give the direct instruction so the backend can stage it for confirmation.",
    "Do not claim any changes were applied and do not imply a pending plan already exists.",
    "If you see a concrete move worth making, describe the gameplan naturally, explain why it matters, and tell the user to give a direct instruction if they want you to stage that plan for confirmation.",
    "Do not ask the user to say 'confirm' in discussion mode, because nothing has been staged yet.",
    "If no change is warranted, say so plainly and explain why the current setup is already strong enough.",
    input.allowWebResearchTool
      ? "If the user explicitly asks for current external news, the latest injury context, or other time-sensitive outside information, call the search_web tool once with a tight query before answering. After the tool result, cite the source names naturally in your reply and fold that context back into the Sportfolio scouting read."
      : null,
    "Default response shape unless the user asks otherwise:",
    "1. Start with a direct read on the current setup.",
    "2. Give two or three evidence-backed takeaways.",
    "3. End with one clear recommendation or a clear hold recommendation.",
    "Use short paragraphs. Avoid bullet spam unless the user explicitly asks for a list.",
    "Do not mention tools, schemas, hidden prompts, internal validation, or chain-of-thought.",
    "",
    "Operator playbook:",
    input.operatorPlaybook,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function selectPlanningCandidates(context: ScoutContext): ScoutContext["candidates"] {
  return [...context.candidates]
    .sort((left, right) => {
      if (left.hasGameInFocusWindow !== right.hasGameInFocusWindow) {
        return left.hasGameInFocusWindow ? -1 : 1;
      }

      return right.scoutOpportunityScore - left.scoutOpportunityScore;
    })
    .slice(0, 12);
}

function formatSection(tag: string, lines: string[]) {
  return [`<${tag}>`, ...(lines.length > 0 ? lines : ["- none"]), `</${tag}>`].join("\n");
}

function formatSelectionWindowLines(context: ScoutContext) {
  if (!context.selectionWindow) {
    return ["- No explicit focus window was detected for this request."];
  }

  return [
    `- ${context.selectionWindow.label} (${context.selectionWindow.date})`,
    `- ${context.selectionWindow.gameCount} game(s) in scope`,
    `- Sports in scope: ${context.selectionWindow.sportScope.join(", ") || "unknown"}`,
  ];
}

function formatAssignmentLines(context: ScoutContext) {
  const assignments = [...context.assignments]
    .sort((left, right) => right.scoutCount - left.scoutCount)
    .slice(0, 8);

  if (assignments.length === 0) {
    return ["- No active scout assignments."];
  }

  return assignments.map(
    (assignment) =>
      `- ${assignment.name} (${assignment.playerId}) | ${assignment.scoutCount} scout(s) | ${assignment.sport} | global competition ${assignment.globalScoutCount}`,
  );
}

function formatRecommendedTargetLines(context: ScoutContext) {
  const targets = context.recommendedTargets.slice(0, 6);
  if (targets.length === 0) {
    return ["- No recommended targets were produced by the backend ranking engine."];
  }

  return targets.map(
    (target) => `- ${target.name} (${target.playerId}) | score ${target.score} | ${target.reason}`,
  );
}

function formatCandidateLines(planningCandidates: ScoutContext["candidates"]) {
  if (planningCandidates.length === 0) {
    return ["- No eligible candidates were supplied."];
  }

  return planningCandidates.slice(0, 10).map((candidate) => {
    const injuryNote = candidate.injuryStatus ? ` | injury ${candidate.injuryStatus}` : "";
    const gameNote = candidate.upcomingGame ? ` | game ${candidate.upcomingGame}` : "";

    return `- ${candidate.name} (${candidate.playerId}) | ${candidate.sport} ${candidate.team} ${candidate.position} | opportunity ${candidate.scoutOpportunityScore}${gameNote}${injuryNote} | current ${candidate.currentScoutCount} | global ${candidate.globalScoutCount}`;
  });
}

function formatConversationHistoryLines(
  conversationHistory?: Array<{
    role: "user" | "assistant";
    contentText: string;
  }>,
) {
  if (!conversationHistory || conversationHistory.length === 0) {
    return ["- No recent conversation history."];
  }

  return conversationHistory
    .slice(-6)
    .map(
      (entry) =>
        `- ${entry.role === "user" ? "User" : "Sportfolio Operator"}: ${entry.contentText}`,
    );
}

function buildDiscussionInsightLines(
  context: ScoutContext,
  planningCandidates: ScoutContext["candidates"],
) {
  const sortedAssignments = [...context.assignments].sort(
    (left, right) => right.scoutCount - left.scoutCount,
  );
  const leadAssignment = sortedAssignments[0];
  const assignedCounts = new Map(
    context.assignments.map((assignment) => [assignment.playerId, assignment.scoutCount]),
  );
  const topUncoveredTarget = context.recommendedTargets.find(
    (target) => (assignedCounts.get(target.playerId) || 0) === 0,
  );
  const focusWindowCandidates = planningCandidates.filter(
    (candidate) => candidate.hasGameInFocusWindow,
  );

  const lines = [
    `- Capacity: ${context.totalScouts}/${context.maxScouts} scouts currently allocated; ${context.remainingScouts} open.`,
  ];

  if (leadAssignment) {
    lines.push(
      `- Largest concentration: ${leadAssignment.name} holds ${leadAssignment.scoutCount} scout(s), which is ${Math.round((leadAssignment.scoutCount / Math.max(context.maxScouts, 1)) * 100)}% of total capacity.`,
    );
  } else {
    lines.push("- There is no current concentration because no scouts are assigned yet.");
  }

  if (topUncoveredTarget) {
    lines.push(
      `- Strongest uncovered opportunity: ${topUncoveredTarget.name} (score ${topUncoveredTarget.score}) because ${topUncoveredTarget.reason}.`,
    );
  } else if (context.recommendedTargets[0]) {
    lines.push(
      `- Your top ranked target is already covered: ${context.recommendedTargets[0].name}.`,
    );
  }

  if (focusWindowCandidates.length > 0) {
    lines.push(
      `- ${focusWindowCandidates.length} candidate(s) are in the active focus window, so near-term slate context matters for this answer.`,
    );
  }

  const operatorOverview = getOperatorOverview(context);

  if (operatorOverview.claimableVestingShares > 0) {
    lines.push(
      `- There are ${operatorOverview.claimableVestingShares} vesting share(s) claimable now, so immediate account leverage is not limited to scouting alone.`,
    );
  }

  if (operatorOverview.openDailyBoostSlots > 0) {
    lines.push(
      `- ${operatorOverview.openDailyBoostSlots} daily boost slot(s) are still open, so same-day upside can be paired with scouting decisions.`,
    );
  }

  if (operatorOverview.availableBalance >= 25) {
    lines.push(
      `- $${operatorOverview.availableBalance.toFixed(2)} is still available, so the user has room to pair scouting conviction with a market move if they ask for it.`,
    );
  }

  return lines;
}

function getOperatorOverview(context: ScoutContext): ScoutContext["operatorOverview"] {
  return (
    (context as Partial<ScoutContext>).operatorOverview || {
      availableBalance: 0,
      portfolioPlayerCount: 0,
      totalPlayerShares: 0,
      poweredHoldingRows: 0,
      powerReadyHoldingRows: 0,
      watchlistCount: 0,
      watchlistEntryCount: 0,
      communitySharesAvailable: 0,
      activeDailyBoostSlots: 0,
      openDailyBoostSlots: 0,
      claimableVestingShares: 0,
      topHoldings: [],
      nextBestLevers: [],
    }
  );
}

function formatOperatorOverviewLines(context: ScoutContext) {
  const overview = getOperatorOverview(context);

  return [
    `- Available balance: $${overview.availableBalance.toFixed(2)}`,
    `- Portfolio: ${overview.portfolioPlayerCount} player holding row(s), ${overview.totalPlayerShares.toFixed(0)} total shares`,
    `- Power state: ${overview.poweredHoldingRows} powered row(s), ${overview.powerReadyHoldingRows} raw row(s) ready to condense`,
    `- Daily boosts: ${overview.activeDailyBoostSlots} active, ${overview.openDailyBoostSlots} open`,
    `- Watchlists: ${overview.watchlistCount} list(s), ${overview.watchlistEntryCount} tracked entry(ies)`,
    `- Community shares available: ${overview.communitySharesAvailable}`,
    `- Claimable vesting shares: ${overview.claimableVestingShares}`,
  ];
}

function formatOperatorTopHoldingsLines(context: ScoutContext) {
  const topHoldings = getOperatorOverview(context).topHoldings;
  if (topHoldings.length === 0) {
    return ["- No active player holdings are currently in the portfolio snapshot."];
  }

  return topHoldings.map((holding) => {
    const nextGameNote = holding.nextGameAt ? ` | next game ${holding.nextGameAt}` : "";

    return `- ${holding.name} (${holding.playerId}) | ${holding.sport} | ${holding.shares.toFixed(0)} share(s) | power ${holding.power} | available ${holding.availableShares.toFixed(0)}${nextGameNote}`;
  });
}

function formatOperatorLeversLines(context: ScoutContext) {
  const levers = getOperatorOverview(context).nextBestLevers;
  if (levers.length === 0) {
    return [
      "- No obvious non-urgent cleanup lever was detected from the current operator snapshot.",
    ];
  }

  return levers.slice(0, 6).map((lever) => `- ${lever}`);
}

function buildPromptPayload(input: {
  chatRequest?: string | null;
  strategyTemplate: string;
  context: ScoutContext;
  planningCandidates: ScoutContext["candidates"];
  conversationHistory?: Array<{
    role: "user" | "assistant";
    contentText: string;
  }>;
}) {
  const task =
    typeof input.chatRequest === "string" && input.chatRequest.trim().length > 0
      ? input.chatRequest.trim()
      : DEFAULT_SCOUT_REQUEST;

  return [
    "<request_mode>",
    "commit",
    "</request_mode>",
    "<user_task>",
    task,
    "</user_task>",
    "<reply_contract>",
    "Stage a concrete scout plan the user can review and confirm. Keep replyText concise, clear, and naturally phrased.",
    "</reply_contract>",
    "<strategy_template>",
    input.strategyTemplate,
    "</strategy_template>",
    formatSection("selection_window", formatSelectionWindowLines(input.context)),
    formatSection("scout_capacity", [
      `- Max scouts: ${input.context.maxScouts}`,
      `- Currently allocated: ${input.context.totalScouts}`,
      `- Remaining open: ${input.context.remainingScouts}`,
      `- Default sport: ${input.context.defaultSport || "not set"}`,
    ]),
    formatSection("operator_state", formatOperatorOverviewLines(input.context)),
    formatSection("portfolio_snapshot", formatOperatorTopHoldingsLines(input.context)),
    formatSection("next_best_levers", formatOperatorLeversLines(input.context)),
    formatSection("current_assignments", formatAssignmentLines(input.context)),
    formatSection("recommended_targets", formatRecommendedTargetLines(input.context)),
    formatSection("candidate_allowlist", formatCandidateLines(input.planningCandidates)),
    formatSection("recent_conversation", formatConversationHistoryLines(input.conversationHistory)),
  ].join("\n");
}

function buildDiscussionPromptPayload(input: {
  chatRequest?: string | null;
  strategyTemplate: string;
  context: ScoutContext;
  planningCandidates: ScoutContext["candidates"];
  conversationHistory?: Array<{
    role: "user" | "assistant";
    contentText: string;
  }>;
}) {
  const task =
    typeof input.chatRequest === "string" && input.chatRequest.trim().length > 0
      ? input.chatRequest.trim()
      : DEFAULT_SCOUT_REQUEST;

  return [
    "<request_mode>",
    "discussion",
    "</request_mode>",
    "<user_task>",
    task,
    "</user_task>",
    "<conversation_goal>",
    "Help the user understand the setup, surface the best gameplan, and wait for a direct instruction before staging any plan.",
    "</conversation_goal>",
    "<strategy_template>",
    input.strategyTemplate,
    "</strategy_template>",
    formatSection("selection_window", formatSelectionWindowLines(input.context)),
    formatSection("scout_capacity", [
      `- Max scouts: ${input.context.maxScouts}`,
      `- Currently allocated: ${input.context.totalScouts}`,
      `- Remaining open: ${input.context.remainingScouts}`,
      `- Default sport: ${input.context.defaultSport || "not set"}`,
    ]),
    formatSection("operator_state", formatOperatorOverviewLines(input.context)),
    formatSection("portfolio_snapshot", formatOperatorTopHoldingsLines(input.context)),
    formatSection("next_best_levers", formatOperatorLeversLines(input.context)),
    formatSection("current_assignments", formatAssignmentLines(input.context)),
    formatSection(
      "analyst_brief",
      buildDiscussionInsightLines(input.context, input.planningCandidates),
    ),
    formatSection("recommended_targets", formatRecommendedTargetLines(input.context)),
    formatSection("candidate_snapshot", formatCandidateLines(input.planningCandidates).slice(0, 6)),
    formatSection("recent_conversation", formatConversationHistoryLines(input.conversationHistory)),
  ].join("\n");
}

function createHistoryMessage(
  entry: {
    role: "user" | "assistant";
    contentText: string;
  },
  index: number,
  runtime: PiRuntime,
): Message {
  const timestamp = Date.now() - 1000 * (12 - index);

  if (entry.role === "user") {
    return {
      role: "user",
      content: entry.contentText,
      timestamp,
    };
  }

  return {
    role: "assistant",
    content: [{ type: "text", text: entry.contentText }],
    api: runtime.model.api,
    provider: runtime.model.provider,
    model: runtime.model.id,
    usage: ZERO_USAGE,
    stopReason: "stop",
    timestamp,
  };
}

function extractAssistantText(message: AssistantMessage): string | null {
  const text = message.content
    .filter(
      (block): block is Extract<(typeof message.content)[number], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!text) {
    return null;
  }

  const sanitized = text
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<\/?think>/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return sanitized || null;
}

function summarizeUsage(message: AssistantMessage | null): AgentModelUsage | undefined {
  if (!message) {
    return undefined;
  }

  return {
    promptTokens: message.usage.input,
    completionTokens: message.usage.output,
    totalTokens: message.usage.totalTokens,
  };
}

function resolveToolChoice(api: PiRuntime["model"]["api"]) {
  switch (api) {
    case "openai-completions":
      return {
        type: "function",
        function: {
          name: "submit_scout_plan",
        },
      };
    case "anthropic-messages":
      return {
        type: "tool",
        name: "submit_scout_plan",
      };
    default:
      return undefined;
  }
}

function resolvePlanningRequestTimeoutMs(runtime: PiRuntime): number {
  switch (runtime.model.provider) {
    case "chutes":
      return CHUTES_PLANNING_REQUEST_TIMEOUT_MS;
    case "openrouter":
      return OPENROUTER_PLANNING_REQUEST_TIMEOUT_MS;
    default:
      return DEFAULT_PLANNING_REQUEST_TIMEOUT_MS;
  }
}

function createPlanningError(
  message: string,
  rawTrace: ScoutPlanningTurnResult["rawTrace"],
  usage?: AgentModelUsage,
): Error & {
  rawTrace: ScoutPlanningTurnResult["rawTrace"];
  usage?: AgentModelUsage;
} {
  return Object.assign(new Error(message), {
    rawTrace,
    ...(usage ? { usage } : {}),
  });
}

function withAttemptError(
  attempts: ScoutPlanningTurnResult["rawTrace"]["attempts"],
  errorMessage: string,
) {
  if (attempts.length === 0) {
    return attempts;
  }

  return attempts.map((attempt, index) =>
    index === attempts.length - 1
      ? {
          ...attempt,
          errorMessage,
        }
      : attempt,
  );
}

function buildSyntheticErrorMessage(
  runtime: PiRuntime,
  errorMessage: string,
  timestamp: number,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: runtime.model.api,
    provider: runtime.model.provider,
    model: runtime.model.id,
    usage: ZERO_USAGE,
    stopReason: "error",
    errorMessage,
    timestamp,
  };
}

function extractToolCalls(message: AssistantMessage) {
  return message.content.filter(
    (
      block,
    ): block is Extract<
      (typeof message.content)[number],
      { type: "toolCall"; arguments: unknown }
    > => block.type === "toolCall",
  );
}

function extractToolCallByName(message: AssistantMessage, toolName: string) {
  return extractToolCalls(message).find((toolCall) => toolCall.name === toolName) || null;
}

function readSearchToolQuery(toolCall: ToolCall | null): string | null {
  if (!toolCall || !toolCall.arguments || typeof toolCall.arguments !== "object") {
    return null;
  }

  const query = (toolCall.arguments as Record<string, unknown>).query;
  return typeof query === "string" && query.trim().length > 0 ? query.trim() : null;
}

function buildSearchToolResultMessage(input: {
  toolCall: ToolCall;
  query: string;
  citations: AgentCitation[];
  errorMessage: string | null;
}): ToolResultMessage<{
  query: string;
  citations: AgentCitation[];
}> {
  const contentText =
    input.citations.length > 0
      ? [
          `Hosted Brave search results for "${input.query}":`,
          ...input.citations.map(
            (citation) =>
              `- ${citation.sourceName}: ${citation.title}. ${citation.factSummary} (${citation.url})`,
          ),
        ].join("\n")
      : `Hosted Brave search did not return usable results for "${input.query}". ${input.errorMessage || "No matching sources were found."}`;

  return {
    role: "toolResult",
    toolCallId: input.toolCall.id,
    toolName: input.toolCall.name,
    content: [{ type: "text", text: contentText }],
    details: {
      query: input.query,
      citations: input.citations,
    },
    isError: Boolean(input.errorMessage && input.citations.length === 0),
    timestamp: Date.now(),
  };
}

function buildFallbackReplyFromCitations(input: {
  query: string;
  citations: AgentCitation[];
}): string {
  if (input.citations.length === 0) {
    return `I checked hosted Brave search for "${input.query}", but I did not get a strong external result set back.`;
  }

  const lead = input.citations[0];
  const otherSources = input.citations
    .slice(1, 3)
    .map((citation) => citation.sourceName)
    .join(", ");

  return `I checked hosted Brave search for "${input.query}". The strongest external signal is from ${lead.sourceName}: ${lead.factSummary}${otherSources ? ` I also cross-checked ${otherSources}.` : ""}`;
}

function buildFallbackReplyText(output: ScoutModelOutput): string {
  const actionPreview =
    output.actions.length > 0
      ? `I found ${output.actions.length} change${output.actions.length === 1 ? "" : "s"} worth making.`
      : "I do not recommend any scout changes right now.";
  const observationPreview =
    output.observations.length > 0 ? ` ${output.observations.slice(0, 2).join(" ")}` : "";

  return `${output.summary}. ${actionPreview}${observationPreview} Confirm if you want me to apply this plan.`
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackSummaryFromToolArguments(args: unknown): string {
  const actionCount = Array.isArray((args as Record<string, unknown> | null)?.actions)
    ? ((args as Record<string, unknown>).actions as unknown[]).length
    : 0;

  return actionCount > 0
    ? `Prepared a scout plan with ${actionCount} proposed change${actionCount === 1 ? "" : "s"}.`
    : "Prepared a scout review with no recommended changes.";
}

function getRequestedScoutTargetCount(
  chatRequest: string | null | undefined,
  maxScouts: number,
): number {
  if (!chatRequest) {
    return Math.min(maxScouts, 5);
  }

  const normalized = chatRequest.toLowerCase();
  const digitMatch = normalized.match(/\btop\s+(\d+)\b/);
  if (digitMatch) {
    return Math.max(1, Math.min(maxScouts, Number(digitMatch[1])));
  }

  const wordMatch = normalized.match(
    /\btop\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/,
  );
  if (wordMatch) {
    return Math.max(1, Math.min(maxScouts, COUNT_WORDS[wordMatch[1]] || maxScouts));
  }

  return Math.min(maxScouts, 5);
}

function shouldUseDeterministicFallback(
  chatRequest: string | null | undefined,
  context: ScoutContext,
  semanticRouteHint?: AgentSemanticRoute | null,
): boolean {
  if (semanticRouteHint === "top_targets_today" && context.recommendedTargets.length > 0) {
    return true;
  }

  if (!chatRequest) {
    return false;
  }

  const normalized = chatRequest.toLowerCase();
  const asksForTopTargets = /\b(top|best|strongest)\b/.test(normalized);
  const asksForCurrentSlate = /\b(today|tonight|playing today)\b/.test(normalized);

  return asksForTopTargets && asksForCurrentSlate && context.recommendedTargets.length > 0;
}

function buildDeterministicFallbackPlan(input: {
  context: ScoutContext;
  chatRequest?: string | null;
  semanticRouteHint?: AgentSemanticRoute | null;
  source?: "fast_path" | "fallback";
}): ScoutModelOutput | null {
  if (!shouldUseDeterministicFallback(input.chatRequest, input.context, input.semanticRouteHint)) {
    return null;
  }

  const desiredTargetCount = getRequestedScoutTargetCount(
    input.chatRequest,
    Math.max(input.context.maxScouts, 1),
  );
  const targets = input.context.recommendedTargets.slice(0, desiredTargetCount);

  if (targets.length === 0) {
    return null;
  }

  const distribution = new Map<string, number>();
  let scoutsRemaining = input.context.maxScouts;

  for (const target of targets) {
    if (scoutsRemaining <= 0) {
      break;
    }

    distribution.set(target.playerId, 1);
    scoutsRemaining -= 1;
  }

  while (scoutsRemaining > 0) {
    const leadTargetId = targets[0]?.playerId;
    if (!leadTargetId) {
      break;
    }

    distribution.set(leadTargetId, (distribution.get(leadTargetId) || 0) + 1);
    scoutsRemaining -= 1;
  }

  const currentAssignmentsById = new Map(
    input.context.assignments.map((assignment) => [assignment.playerId, assignment]),
  );
  const nextTargetIds = new Set(distribution.keys());

  const actions: ScoutModelOutput["actions"] = [];

  for (const assignment of input.context.assignments) {
    if (nextTargetIds.has(assignment.playerId)) {
      continue;
    }

    actions.push({
      actionType: "scout_set_count",
      playerId: assignment.playerId,
      targetCount: 0,
      reasoning: `Freeing scouts from ${assignment.name} to reallocate onto stronger current-slate targets.`,
      confidence: 0.78,
      evidence: {
        trend: null,
        injury: null,
        upcomingGame: null,
        performanceNote: "Current allocation is being rotated into higher-ranked targets.",
      },
    });
  }

  for (const target of targets) {
    const currentAssignment = currentAssignmentsById.get(target.playerId);
    const targetCount = distribution.get(target.playerId) || 0;

    if ((currentAssignment?.scoutCount || 0) === targetCount) {
      continue;
    }

    actions.push({
      actionType: "scout_set_count",
      playerId: target.playerId,
      targetCount,
      reasoning: `Backend fallback selected ${target.name} because ${target.reason}.`,
      confidence: 0.82,
      evidence: {
        trend: target.reason,
        injury: null,
        upcomingGame: input.context.selectionWindow?.label || "current slate",
        performanceNote: "Ranked by the deterministic scout opportunity engine.",
      },
    });
  }

  const targetNames = targets.map((target) => target.name).join(", ");
  if (actions.length === 0) {
    return {
      summary: `Current scouts already match the top ${targets.length} ranked players in the current slate.`,
      observations: [
        `The backend ranking engine confirmed the existing scout allocation is already aligned: ${targetNames}.`,
      ],
      actions: [],
      warnings: [],
      replyText: `You're already scouting the top ${targets.length} ranked players for today: ${targetNames}. No changes are needed right now.`,
    };
  }

  if (actions.length > 10) {
    return null;
  }

  const summary = `Reallocate scouts to the top ${targets.length} ranked players in the current slate.`;
  const detailLine =
    input.source === "fast_path"
      ? "This request matched a deterministic scouting flow, so the backend prepared the plan immediately."
      : "This fallback was used because the model did not return a complete structured plan in time.";

  return {
    summary,
    observations: [`The backend ranking engine selected: ${targetNames}.`, detailLine],
    actions,
    warnings: [],
    replyText:
      input.source === "fast_path"
        ? `I prepared a scout plan using the backend's top ${targets.length} ranked targets for today: ${targetNames}. Confirm if you want me to apply these changes.`
        : `I prepared a fallback scout plan using the backend's top ${targets.length} ranked targets for today: ${targetNames}. Confirm if you want me to apply these changes.`,
  };
}

function shouldUseDeterministicAdjustmentPlan(
  chatRequest: string | null | undefined,
  context: ScoutContext,
  semanticRouteHint?: AgentSemanticRoute | null,
): boolean {
  if (semanticRouteHint === "single_adjustment" && context.recommendedTargets.length > 0) {
    return true;
  }

  if (!chatRequest || context.recommendedTargets.length === 0) {
    return false;
  }

  const normalized = chatRequest.toLowerCase();
  return (
    /\breview\b.*\bscout/.test(normalized) ||
    /\bsuggest\b.*\bone\b.*\badjustment\b/.test(normalized) ||
    /\bone\b.*\badjustment\b/.test(normalized) ||
    /\bone\b.*\bchange\b/.test(normalized) ||
    /\bstrongest\b.*\breallocation\b/.test(normalized) ||
    /\bbest\b.*\breallocation\b/.test(normalized) ||
    /\breallocation\b.*\b(option|move)\b/.test(normalized)
  );
}

function shouldUseDeterministicReviewPlan(
  chatRequest: string | null | undefined,
  context: ScoutContext,
  semanticRouteHint?: AgentSemanticRoute | null,
): boolean {
  if (
    (semanticRouteHint === "review_setup" || semanticRouteHint === "general_scouting") &&
    (context.assignments.length > 0 || context.recommendedTargets.length > 0)
  ) {
    return true;
  }

  if (
    !chatRequest ||
    (context.assignments.length === 0 && context.recommendedTargets.length === 0)
  ) {
    return false;
  }

  const normalized = chatRequest.toLowerCase();
  const asksForSetupReview =
    /\bwhat should i know\b/.test(normalized) ||
    /\bbefore i make any changes\b/.test(normalized) ||
    /\btradeoffs?\b/.test(normalized) ||
    /\boverexposed\b/.test(normalized) ||
    /\bexposure\b/.test(normalized) ||
    /\bmissed opportunity\b/.test(normalized) ||
    /\bbiggest edge\b/.test(normalized) ||
    /\bsharp(er)? approach\b/.test(normalized) ||
    /\bdiversif(y|ied|ication)\b/.test(normalized) ||
    /\bconcentrat(e|ing|ion)\b/.test(normalized) ||
    /\bspread out\b/.test(normalized) ||
    /\bupside\b/.test(normalized) ||
    /\bphilosophy\b/.test(normalized) ||
    /\bconviction\b/.test(normalized) ||
    /\bpatience\b/.test(normalized) ||
    /\bnext few slates\b/.test(normalized) ||
    (/\bcurrent\b/.test(normalized) &&
      /\bscout\b/.test(normalized) &&
      /\bsetup\b/.test(normalized)) ||
    (/\breview\b/.test(normalized) &&
      /\bscout\b/.test(normalized) &&
      /\badjustment\b/.test(normalized) === false &&
      /\bchange\b/.test(normalized) === false);

  return asksForSetupReview;
}

function isConcentrationTradeoffPrompt(chatRequest: string | null | undefined) {
  if (!chatRequest) {
    return false;
  }

  const normalized = chatRequest.toLowerCase();
  return (
    /\bdiversif(y|ied|ication)\b/.test(normalized) ||
    /\bconcentrat(e|ing|ion)\b/.test(normalized) ||
    /\bspread out\b/.test(normalized) ||
    /\bupside\b/.test(normalized) ||
    /\bsharp(er)? approach\b/.test(normalized)
  );
}

function isScoutingPhilosophyPrompt(chatRequest: string | null | undefined) {
  if (!chatRequest) {
    return false;
  }

  const normalized = chatRequest.toLowerCase();
  return (
    /\bphilosophy\b/.test(normalized) ||
    /\bconviction\b/.test(normalized) ||
    /\bpatience\b/.test(normalized) ||
    /\bnext few slates\b/.test(normalized)
  );
}

function buildDeterministicAdjustmentPlan(input: {
  context: ScoutContext;
  chatRequest?: string | null;
  semanticRouteHint?: AgentSemanticRoute | null;
  source?: "fast_path" | "fallback";
  force?: boolean;
}): ScoutModelOutput | null {
  if (
    !input.force &&
    !shouldUseDeterministicAdjustmentPlan(input.chatRequest, input.context, input.semanticRouteHint)
  ) {
    return null;
  }

  const currentAssignmentsById = new Map(
    input.context.assignments.map((assignment) => [assignment.playerId, assignment]),
  );
  const recommendedRank = new Map(
    input.context.recommendedTargets.map((target, index) => [target.playerId, index]),
  );
  const bestUnscoutedTarget = input.context.recommendedTargets.find(
    (target) => (currentAssignmentsById.get(target.playerId)?.scoutCount || 0) === 0,
  );

  if (!bestUnscoutedTarget) {
    const currentTargetNames = input.context.assignments
      .map((assignment) => assignment.name)
      .join(", ");
    return {
      summary: "Current scouts already cover the strongest ranked targets right now.",
      observations: [
        `The backend ranking engine found no higher-priority unscouted target beyond: ${currentTargetNames}.`,
      ],
      actions: [],
      warnings: [],
      replyText: `Your current scouts already cover the strongest ranked targets right now. I don't recommend a one-player adjustment at the moment.`,
    };
  }

  let donorAssignment =
    [...input.context.assignments]
      .filter((assignment) => assignment.playerId !== bestUnscoutedTarget.playerId)
      .sort((left, right) => {
        if (left.scoutCount !== right.scoutCount) {
          return right.scoutCount - left.scoutCount;
        }

        return (
          (recommendedRank.get(right.playerId) ?? -1) - (recommendedRank.get(left.playerId) ?? -1)
        );
      })
      .find((assignment) => assignment.scoutCount > 1) || null;

  if (!donorAssignment && input.context.remainingScouts <= 0) {
    donorAssignment =
      [...input.context.assignments]
        .filter((assignment) => assignment.playerId !== bestUnscoutedTarget.playerId)
        .sort(
          (left, right) =>
            (recommendedRank.get(right.playerId) ?? Number.MAX_SAFE_INTEGER) -
            (recommendedRank.get(left.playerId) ?? Number.MAX_SAFE_INTEGER),
        )[0] || null;
  }

  const actions: ScoutModelOutput["actions"] = [];
  if (donorAssignment && input.context.remainingScouts <= 0) {
    actions.push({
      actionType: "scout_set_count",
      playerId: donorAssignment.playerId,
      targetCount: Math.max(0, donorAssignment.scoutCount - 1),
      reasoning: `Move one scout off ${donorAssignment.name} to open room for a higher-upside ranked target.`,
      confidence: 0.76,
      evidence: {
        trend: null,
        injury: null,
        upcomingGame: null,
        performanceNote: "This one-scout shift improves coverage without changing the whole slate.",
      },
    });
  }

  const currentTargetCount =
    currentAssignmentsById.get(bestUnscoutedTarget.playerId)?.scoutCount || 0;
  if (input.context.remainingScouts > 0 || donorAssignment) {
    actions.push({
      actionType: "scout_set_count",
      playerId: bestUnscoutedTarget.playerId,
      targetCount: currentTargetCount + 1,
      reasoning: `Add one scout to ${bestUnscoutedTarget.name} because ${bestUnscoutedTarget.reason}.`,
      confidence: 0.8,
      evidence: {
        trend: bestUnscoutedTarget.reason,
        injury: null,
        upcomingGame: input.context.selectionWindow?.label || "current slate",
        performanceNote:
          "Selected by the deterministic scout ranking engine as the best unscouted upgrade.",
      },
    });
  }

  if (actions.length === 0 || actions.length > 10) {
    return null;
  }

  const detailLine =
    input.source === "fast_path"
      ? "This request matched a deterministic one-adjustment review flow, so the backend prepared the recommendation immediately."
      : "This fallback was used because the model did not return a complete structured plan in time.";

  return {
    summary: `Make one scout adjustment by adding ${bestUnscoutedTarget.name}.`,
    observations: [
      `The next strongest unscouted target is ${bestUnscoutedTarget.name}.`,
      detailLine,
    ],
    actions,
    warnings: [],
    replyText: `I found one immediate scout adjustment: add ${bestUnscoutedTarget.name}${donorAssignment ? ` and move one scout off ${donorAssignment.name}` : ""}. Confirm if you want me to apply it.`,
  };
}

function buildDeterministicReviewPlan(input: {
  context: ScoutContext;
  chatRequest?: string | null;
  semanticRouteHint?: AgentSemanticRoute | null;
  source?: "fast_path" | "fallback";
}): ScoutModelOutput | null {
  if (
    !shouldUseDeterministicReviewPlan(input.chatRequest, input.context, input.semanticRouteHint)
  ) {
    return null;
  }

  const sortedAssignments = [...input.context.assignments].sort(
    (left, right) => right.scoutCount - left.scoutCount,
  );
  const leadAssignment = sortedAssignments[0] || null;
  const totalScouts = Math.max(input.context.totalScouts, 0);
  const concentrationRatio =
    leadAssignment && totalScouts > 0
      ? Math.round((leadAssignment.scoutCount / totalScouts) * 100)
      : 0;
  const unscoutedTargets = input.context.recommendedTargets.filter(
    (target) =>
      !input.context.assignments.some((assignment) => assignment.playerId === target.playerId),
  );
  const topUnscoutedTargets = unscoutedTargets.slice(0, 2);
  const topAssignedSummary =
    sortedAssignments.length > 0
      ? sortedAssignments
          .slice(0, 3)
          .map((assignment) => `${assignment.name} (${assignment.scoutCount})`)
          .join(", ")
      : "no active scout assignments";
  const topOpportunitySummary =
    topUnscoutedTargets.length > 0
      ? topUnscoutedTargets.map((target) => `${target.name} (${target.reason})`).join("; ")
      : "no clearly better unscouted targets in the current context";

  const observations = [
    `You are currently using ${input.context.totalScouts}/${input.context.maxScouts} scouts.`,
  ];

  if (leadAssignment && concentrationRatio >= 40) {
    observations.push(
      `${leadAssignment.name} is your largest concentration at ${leadAssignment.scoutCount} scout${leadAssignment.scoutCount === 1 ? "" : "s"} (${concentrationRatio}% of your current allocation).`,
    );
  } else if (leadAssignment) {
    observations.push(
      `Your current scouts are relatively spread out. The largest allocation is ${leadAssignment.name} with ${leadAssignment.scoutCount}.`,
    );
  }

  if (topUnscoutedTargets.length > 0) {
    observations.push(
      `The strongest unscouted opportunities right now are ${topOpportunitySummary}.`,
    );
  } else {
    observations.push(
      "The current allocation already covers the strongest ranked targets in this context.",
    );
  }

  const warnings =
    input.context.remainingScouts === 0
      ? [
          "You are fully allocated, so any improvement requires moving scouts off an existing player.",
        ]
      : [];

  const detailLine =
    input.source === "fast_path"
      ? "This review matched a deterministic scout-analysis flow, so the backend answered directly."
      : "This review was generated by the deterministic fallback because the model did not return a complete plan in time.";

  const replyText = isConcentrationTradeoffPrompt(input.chatRequest)
    ? [
        `The sharper approach right now is ${topUnscoutedTargets.length > 0 ? "selective concentration" : "staying diversified"}.`,
        sortedAssignments.length > 0
          ? `You are carrying ${input.context.totalScouts}/${input.context.maxScouts} scouts, with your largest current allocation on ${leadAssignment?.name} (${leadAssignment?.scoutCount}).`
          : `You are carrying ${input.context.totalScouts}/${input.context.maxScouts} scouts and do not have a concentrated position yet.`,
        topUnscoutedTargets.length > 0
          ? `There is still an uncovered edge in ${topOpportunitySummary}, so concentrating only makes sense if you want to press that specific signal.`
          : "I do not see a single uncovered target clearly strong enough to justify collapsing your exposure tonight.",
        input.context.remainingScouts === 0
          ? "Because you are fully allocated, any sharper bet means pulling coverage off an existing player."
          : `You still have ${input.context.remainingScouts} open scout${input.context.remainingScouts === 1 ? "" : "s"}, so you can press conviction without fully giving up diversification.`,
      ]
        .join(" ")
        .trim()
    : isScoutingPhilosophyPrompt(input.chatRequest)
      ? [
          `My baseline scouting philosophy right now is ${topUnscoutedTargets.length > 0 ? "patient, selective conviction" : "patient diversification"}.`,
          topUnscoutedTargets.length > 0
            ? `You already cover the core of the board, and the one extra edge I would consider pressing is ${topOpportunitySummary}.`
            : "You already cover the strongest signals I can support with the current context, so there is no obvious reason to collapse your board into one bet.",
          input.context.remainingScouts === 0
            ? "Because you are fully allocated, I would only move one scout at a time when a player clearly separates instead of rebuilding the whole setup in one swing."
            : `Because you still have ${input.context.remainingScouts} open scout${input.context.remainingScouts === 1 ? "" : "s"}, you can add conviction gradually without giving up your existing coverage.`,
        ]
          .join(" ")
          .trim()
      : [
          `The read: you are currently using ${input.context.totalScouts}/${input.context.maxScouts} scouts.`,
          sortedAssignments.length > 0
            ? `Your current shape is led by ${leadAssignment?.name} (${leadAssignment?.scoutCount}), and your top allocations are ${topAssignedSummary}.`
            : "You do not have any active scout assignments right now.",
          input.context.remainingScouts === 0
            ? "You are fully allocated, so any upgrade requires reallocating an existing scout."
            : `You still have ${input.context.remainingScouts} scout${input.context.remainingScouts === 1 ? "" : "s"} available, so you can add without removing first.`,
          topUnscoutedTargets.length > 0
            ? `The clearest edge I still see is ${topOpportunitySummary}.`
            : "I do not see a clearly better unscouted target than what you already cover.",
        ]
          .join(" ")
          .trim();

  return {
    summary: "Review your current scout setup before making changes.",
    observations: [...observations, detailLine],
    actions: [],
    warnings,
    replyText,
  };
}

function buildDeterministicPlan(input: {
  context: ScoutContext;
  chatRequest?: string | null;
  semanticRouteHint?: AgentSemanticRoute | null;
  source?: "fast_path" | "fallback";
}): ScoutModelOutput | null {
  return (
    buildDeterministicFallbackPlan(input) ||
    buildDeterministicAdjustmentPlan(input) ||
    buildDeterministicReviewPlan(input)
  );
}

function buildEmergencyDeterministicFallbackPlan(input: {
  context: ScoutContext;
}): ScoutModelOutput | null {
  return buildDeterministicAdjustmentPlan({
    context: input.context,
    source: "fallback",
    force: true,
  });
}

function buildDiscussionReplyFromDraftPlan(plan: ScoutModelOutput): string {
  if (plan.actions.length === 0) {
    return plan.replyText || plan.summary;
  }

  const observations = plan.observations.slice(0, 2).join(" ");
  const warnings = plan.warnings.length > 0 ? ` Keep in mind: ${plan.warnings[0]}.` : "";

  return `${plan.summary}. ${observations} The strongest gameplan is ${plan.actions.length} move${plan.actions.length === 1 ? "" : "s"}.${warnings} If you want me to stage that as a pending plan, give me a direct instruction and I'll tee it up for confirmation.`
    .replace(/\s+/g, " ")
    .trim();
}

export interface ScoutDiscussionTurnResult {
  replyText: string;
  summary: string | null;
  warnings: string[];
  draftPlan: ScoutModelOutput | null;
  citations: AgentCitation[];
  usage?: AgentModelUsage;
  rawTrace: {
    framework: "pi-ai-single-turn";
    resolution:
      | "deterministic_discussion"
      | "deterministic_discussion_fallback"
      | "tool_backed_discussion"
      | "model_discussion";
    attempts: Array<{
      label: "discussion" | "discussion_after_search_tool";
      messages: Message[];
      usage?: AgentModelUsage;
      errorMessage?: string | null;
    }>;
    draftPlan: ScoutModelOutput | null;
  };
}

export interface ScoutPlanningTurnResult {
  output: ScoutModelOutput;
  citations?: AgentCitation[];
  usage?: AgentModelUsage;
  rawTrace: {
    framework: "pi-ai-single-turn";
    resolution?: "model" | "deterministic_fast_path" | "deterministic_fallback";
    attempts: Array<{
      label: "primary" | "retry_after_missing_tool";
      messages: Message[];
      toolCallCount: number;
      toolChoice: unknown;
      usage?: AgentModelUsage;
      errorMessage?: string | null;
    }>;
    submittedPlan: ScoutModelOutput | null;
  };
}

export async function runScoutDiscussionTurn(input: {
  runtime: PiRuntime;
  context: ScoutContext;
  chatRequest?: string | null;
  semanticRouteHint?: AgentSemanticRoute | null;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    contentText: string;
  }>;
  operatorPlaybook: string;
  strategyTemplate: string;
  temperature: number;
  maxTokens: number;
}): Promise<ScoutDiscussionTurnResult> {
  const planningCandidates = selectPlanningCandidates(input.context);
  const draftPlan = buildDeterministicPlan({
    context: input.context,
    chatRequest: input.chatRequest,
    semanticRouteHint: input.semanticRouteHint,
    source: "fast_path",
  });
  const fallbackDraftPlan =
    buildDeterministicPlan({
      context: input.context,
      chatRequest: input.chatRequest,
      semanticRouteHint: input.semanticRouteHint,
      source: "fallback",
    }) ||
    buildDeterministicReviewPlan({
      context: input.context,
      chatRequest: input.chatRequest,
      semanticRouteHint: "review_setup",
      source: "fallback",
    });
  const allowWebResearchTool = Boolean(
    input.chatRequest &&
    shouldUseHostedWebResearch(input.chatRequest) &&
    isHostedWebResearchAvailable(),
  );

  if (draftPlan) {
    return {
      replyText: buildDiscussionReplyFromDraftPlan(draftPlan),
      summary: draftPlan.summary,
      warnings: draftPlan.warnings,
      draftPlan,
      citations: [],
      rawTrace: {
        framework: "pi-ai-single-turn",
        resolution: "deterministic_discussion",
        attempts: [],
        draftPlan,
      },
    };
  }

  const promptMessage: Message = {
    role: "user",
    content: buildDiscussionPromptPayload({
      chatRequest: input.chatRequest,
      strategyTemplate: input.strategyTemplate,
      context: input.context,
      planningCandidates,
      conversationHistory: input.conversationHistory,
    }),
    timestamp: Date.now(),
  };
  const contextMessages = (input.conversationHistory || []).map((entry, index) =>
    createHistoryMessage(entry, index, input.runtime),
  );
  const timeoutMs = resolvePlanningRequestTimeoutMs(input.runtime);
  const discussionTools = allowWebResearchTool
    ? [
        {
          name: "search_web",
          description:
            "Search hosted Brave web results for current external sports coverage when the user explicitly asks for live news or other time-sensitive outside context. Use a compact, specific query and call this at most once before answering.",
          parameters: searchWebToolParameters,
        },
      ]
    : undefined;
  const discussionSystemPrompt = buildDiscussionSystemPrompt({
    operatorPlaybook: input.operatorPlaybook,
    allowWebResearchTool,
  });

  const executeDiscussionModelTurn = async (messages: Message[], withTools: boolean) => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await completeSimple(
        input.runtime.model,
        {
          systemPrompt: discussionSystemPrompt,
          messages,
          ...(withTools && discussionTools ? { tools: discussionTools } : {}),
        },
        {
          apiKey: input.runtime.apiKey,
          temperature: Math.max(0.2, Math.min(input.temperature, 0.5)),
          maxTokens: input.maxTokens,
          signal: controller.signal,
          ...(input.runtime.headers ? { headers: input.runtime.headers } : {}),
          ...(input.runtime.onPayload ? { onPayload: input.runtime.onPayload } : {}),
        },
      );
    } catch (error: any) {
      const errorMessage =
        error?.name === "AbortError"
          ? `Provider request timed out after ${timeoutMs}ms`
          : error?.message || "Agent discussion request failed.";

      return buildSyntheticErrorMessage(input.runtime, errorMessage, Date.now());
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

  let assistantMessage = await executeDiscussionModelTurn(
    [...contextMessages, promptMessage],
    allowWebResearchTool,
  );
  const attempts: ScoutDiscussionTurnResult["rawTrace"]["attempts"] = [];
  let usage = summarizeUsage(assistantMessage);
  attempts.push({
    label: "discussion",
    messages: [...contextMessages, promptMessage, assistantMessage],
    ...(usage ? { usage } : {}),
    ...(assistantMessage.errorMessage ? { errorMessage: assistantMessage.errorMessage } : {}),
  });

  let citations: AgentCitation[] = [];
  let searchQuery = input.chatRequest?.trim() || "your request";

  const searchToolCall =
    allowWebResearchTool && !assistantMessage.errorMessage
      ? extractToolCallByName(assistantMessage, "search_web")
      : null;

  if (searchToolCall) {
    searchQuery = readSearchToolQuery(searchToolCall) || searchQuery;
    const searchResult = await runHostedWebResearchQuery(searchQuery);
    citations = searchResult.citations;
    const toolCallMessage = assistantMessage;
    const toolResultMessage = buildSearchToolResultMessage({
      toolCall: searchToolCall,
      query: searchQuery,
      citations: searchResult.citations,
      errorMessage: searchResult.errorMessage,
    });

    assistantMessage = await executeDiscussionModelTurn(
      [...contextMessages, promptMessage, toolCallMessage, toolResultMessage],
      false,
    );
    usage = summarizeUsage(assistantMessage);
    attempts.push({
      label: "discussion_after_search_tool",
      messages: [
        ...contextMessages,
        promptMessage,
        toolCallMessage,
        toolResultMessage,
        assistantMessage,
      ],
      ...(usage ? { usage } : {}),
      ...(assistantMessage.errorMessage || searchResult.errorMessage
        ? {
            errorMessage:
              assistantMessage.errorMessage ||
              searchResult.errorMessage ||
              "The follow-up tool-backed discussion turn failed.",
          }
        : {}),
    });
  }

  const errorMessage = assistantMessage.errorMessage || null;
  const wasProviderTruncated =
    assistantMessage.stopReason === "aborted" || assistantMessage.stopReason === "length";
  const assistantText =
    extractAssistantText(assistantMessage) ||
    (citations.length > 0
      ? buildFallbackReplyFromCitations({
          query: searchQuery,
          citations,
        })
      : "I can talk through the scouting tradeoffs, but I need a clearer angle before I recommend a concrete move.");

  if ((errorMessage || wasProviderTruncated) && fallbackDraftPlan && citations.length === 0) {
    return {
      replyText: buildDiscussionReplyFromDraftPlan(fallbackDraftPlan),
      summary: fallbackDraftPlan.summary,
      warnings: fallbackDraftPlan.warnings,
      draftPlan: fallbackDraftPlan,
      citations: [],
      ...(usage ? { usage } : {}),
      rawTrace: {
        framework: "pi-ai-single-turn",
        resolution: "deterministic_discussion_fallback",
        attempts: attempts.map((attempt, index) =>
          index === attempts.length - 1
            ? {
                ...attempt,
                errorMessage:
                  errorMessage ||
                  "Used deterministic discussion fallback because the provider returned a truncated reply.",
              }
            : attempt,
        ),
        draftPlan: fallbackDraftPlan,
      },
    };
  }

  return {
    replyText: assistantText,
    summary: citations.length > 0 ? `Reviewed hosted external coverage for ${searchQuery}.` : null,
    warnings:
      citations.length > 0 && (errorMessage || wasProviderTruncated)
        ? [
            errorMessage ||
              "The provider returned a truncated follow-up after the hosted research tool call.",
          ]
        : [],
    draftPlan: null,
    citations,
    ...(usage ? { usage } : {}),
    rawTrace: {
      framework: "pi-ai-single-turn",
      resolution: searchToolCall ? "tool_backed_discussion" : "model_discussion",
      attempts,
      draftPlan: null,
    },
  };
}

async function executePlanningAttempt(input: {
  runtime: PiRuntime;
  promptMessage: Message;
  contextMessages: Message[];
  operatorPlaybook: string;
  candidateIds: string[];
  temperature: number;
  maxTokens: number;
  label: "primary" | "retry_after_missing_tool";
  retryReason?: string;
}) {
  const toolChoice = resolveToolChoice(input.runtime.model.api);
  const timeoutMs = resolvePlanningRequestTimeoutMs(input.runtime);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let assistantMessage: AssistantMessage;

  try {
    assistantMessage = await completeSimple(
      input.runtime.model,
      {
        systemPrompt: `${buildSystemPrompt({
          operatorPlaybook: input.operatorPlaybook,
          candidateIds: input.candidateIds,
        })}${input.retryReason ? `\n\nRetry instruction:\n${input.retryReason.trim()}` : ""}`.trim(),
        messages: [...input.contextMessages, input.promptMessage],
        tools: [
          {
            name: "submit_scout_plan",
            description:
              "Submit the single structured scout response for this turn. Put the natural-language explanation in replyText, the plan headline in summary, evidence-backed takeaways in observations, concentration or risk notes in warnings, and any scout_set_count moves in actions. Use an empty actions array if no change is warranted, and never imply the plan was already applied.",
            parameters: scoutPlanToolParameters,
          },
        ],
      },
      {
        apiKey: input.runtime.apiKey,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        signal: controller.signal,
        ...(input.runtime.headers ? { headers: input.runtime.headers } : {}),
        ...(input.runtime.onPayload ? { onPayload: input.runtime.onPayload } : {}),
        ...(toolChoice ? { toolChoice } : {}),
      } as Parameters<typeof completeSimple>[2] & {
        toolChoice?: unknown;
      },
    );
  } catch (error: any) {
    const errorMessage =
      error?.name === "AbortError"
        ? `Provider request timed out after ${timeoutMs}ms`
        : error?.message || "Agent model request failed.";

    assistantMessage = buildSyntheticErrorMessage(input.runtime, errorMessage, Date.now());
  } finally {
    clearTimeout(timeoutHandle);
  }

  const usage = summarizeUsage(assistantMessage);
  const toolCalls = extractToolCalls(assistantMessage);
  const trace = {
    label: input.label,
    messages: [...input.contextMessages, input.promptMessage, assistantMessage],
    toolCallCount: toolCalls.length,
    toolChoice,
    ...(usage ? { usage } : {}),
    ...(assistantMessage.errorMessage ? { errorMessage: assistantMessage.errorMessage } : {}),
  };

  return {
    assistantMessage,
    toolCalls,
    usage,
    trace,
  };
}

export async function runScoutPlanningTurn(input: {
  runtime: PiRuntime;
  context: ScoutContext;
  chatRequest?: string | null;
  semanticRouteHint?: AgentSemanticRoute | null;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    contentText: string;
  }>;
  operatorPlaybook: string;
  strategyTemplate: string;
  temperature: number;
  maxTokens: number;
}): Promise<ScoutPlanningTurnResult> {
  const planningCandidates = selectPlanningCandidates(input.context);
  const deterministicFastPathPlan = buildDeterministicPlan({
    context: input.context,
    chatRequest: input.chatRequest,
    semanticRouteHint: input.semanticRouteHint,
    source: "fast_path",
  });
  if (deterministicFastPathPlan) {
    return {
      output: deterministicFastPathPlan,
      rawTrace: {
        framework: "pi-ai-single-turn",
        resolution: "deterministic_fast_path",
        attempts: [],
        submittedPlan: deterministicFastPathPlan,
      },
    };
  }

  const deterministicFallbackPlan = buildDeterministicPlan({
    context: input.context,
    chatRequest: input.chatRequest,
    semanticRouteHint: input.semanticRouteHint,
    source: "fallback",
  });
  const emergencyDeterministicFallbackPlan = buildEmergencyDeterministicFallbackPlan({
    context: input.context,
  });
  const promptMessage: Message = {
    role: "user",
    content: buildPromptPayload({
      chatRequest: input.chatRequest,
      strategyTemplate: input.strategyTemplate,
      context: input.context,
      planningCandidates,
      conversationHistory: input.conversationHistory,
    }),
    timestamp: Date.now(),
  };

  const contextMessages = (input.conversationHistory || []).map((entry, index) =>
    createHistoryMessage(entry, index, input.runtime),
  );

  const attempts: ScoutPlanningTurnResult["rawTrace"]["attempts"] = [];
  const candidateIds = planningCandidates.map((candidate) => candidate.playerId);

  const firstAttempt = await executePlanningAttempt({
    runtime: input.runtime,
    promptMessage,
    contextMessages,
    operatorPlaybook: input.operatorPlaybook,
    candidateIds,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    label: "primary",
  });
  attempts.push(firstAttempt.trace);

  let selectedAttempt = firstAttempt;
  let usage = firstAttempt.usage;

  if (
    firstAttempt.toolCalls.length === 0 &&
    (firstAttempt.assistantMessage.stopReason === "error" ||
      firstAttempt.assistantMessage.stopReason === "aborted")
  ) {
    if (emergencyDeterministicFallbackPlan) {
      return {
        output: emergencyDeterministicFallbackPlan,
        usage,
        rawTrace: {
          framework: "pi-ai-single-turn",
          resolution: "deterministic_fallback",
          attempts: withAttemptError(
            attempts,
            "Used deterministic fallback because the provider request failed before a plan was returned.",
          ),
          submittedPlan: emergencyDeterministicFallbackPlan,
        },
      };
    }

    const errorMessage =
      firstAttempt.assistantMessage.errorMessage || "Agent model request failed.";
    throw createPlanningError(
      errorMessage,
      {
        framework: "pi-ai-single-turn",
        attempts: withAttemptError(attempts, errorMessage),
        submittedPlan: null,
      },
      usage,
    );
  }

  if (
    firstAttempt.toolCalls.length === 0 &&
    firstAttempt.assistantMessage.stopReason === "length"
  ) {
    if (deterministicFallbackPlan) {
      return {
        output: deterministicFallbackPlan,
        usage,
        rawTrace: {
          framework: "pi-ai-single-turn",
          resolution: "deterministic_fallback",
          attempts: withAttemptError(
            attempts,
            "Used deterministic fallback because the model hit the completion limit before submitting a structured plan.",
          ),
          submittedPlan: deterministicFallbackPlan,
        },
      };
    }

    if (emergencyDeterministicFallbackPlan) {
      return {
        output: emergencyDeterministicFallbackPlan,
        usage,
        rawTrace: {
          framework: "pi-ai-single-turn",
          resolution: "deterministic_fallback",
          attempts: withAttemptError(
            attempts,
            "Used deterministic fallback because the model hit the completion limit before submitting a usable structured plan.",
          ),
          submittedPlan: emergencyDeterministicFallbackPlan,
        },
      };
    }
  }

  if (firstAttempt.toolCalls.length === 0) {
    const retryAttempt = await executePlanningAttempt({
      runtime: input.runtime,
      promptMessage,
      contextMessages,
      operatorPlaybook: input.operatorPlaybook,
      candidateIds,
      temperature: Math.min(input.temperature, 0.2),
      maxTokens: input.maxTokens,
      label: "retry_after_missing_tool",
      retryReason:
        "Your previous attempt failed because you did not submit the required tool call. Respond with exactly one submit_scout_plan tool call now and include replyText in its arguments.",
    });
    attempts.push(retryAttempt.trace);
    selectedAttempt = retryAttempt;
    usage = retryAttempt.usage;

    if (
      retryAttempt.toolCalls.length === 0 &&
      (retryAttempt.assistantMessage.stopReason === "error" ||
        retryAttempt.assistantMessage.stopReason === "aborted")
    ) {
      if (emergencyDeterministicFallbackPlan) {
        return {
          output: emergencyDeterministicFallbackPlan,
          usage,
          rawTrace: {
            framework: "pi-ai-single-turn",
            resolution: "deterministic_fallback",
            attempts: withAttemptError(
              attempts,
              "Used deterministic fallback because the provider request failed before a plan was returned.",
            ),
            submittedPlan: emergencyDeterministicFallbackPlan,
          },
        };
      }

      const errorMessage =
        retryAttempt.assistantMessage.errorMessage || "Agent model request failed.";
      throw createPlanningError(
        errorMessage,
        {
          framework: "pi-ai-single-turn",
          attempts: withAttemptError(attempts, errorMessage),
          submittedPlan: null,
        },
        usage,
      );
    }
  }

  if (selectedAttempt.toolCalls.length === 0) {
    if (deterministicFallbackPlan) {
      return {
        output: deterministicFallbackPlan,
        usage,
        rawTrace: {
          framework: "pi-ai-single-turn",
          resolution: "deterministic_fallback",
          attempts: withAttemptError(
            attempts,
            "Used deterministic fallback because the model did not submit a structured plan.",
          ),
          submittedPlan: deterministicFallbackPlan,
        },
      };
    }

    if (emergencyDeterministicFallbackPlan) {
      return {
        output: emergencyDeterministicFallbackPlan,
        usage,
        rawTrace: {
          framework: "pi-ai-single-turn",
          resolution: "deterministic_fallback",
          attempts: withAttemptError(
            attempts,
            "Used deterministic fallback because the model did not submit a usable structured plan.",
          ),
          submittedPlan: emergencyDeterministicFallbackPlan,
        },
      };
    }

    const errorMessage = "Agent did not submit a structured scout plan.";
    throw createPlanningError(
      errorMessage,
      {
        framework: "pi-ai-single-turn",
        attempts: withAttemptError(attempts, errorMessage),
        submittedPlan: null,
      },
      usage,
    );
  }

  const primaryToolCall = selectedAttempt.toolCalls[0];
  const primaryToolArgsRecord =
    primaryToolCall.arguments && typeof primaryToolCall.arguments === "object"
      ? (primaryToolCall.arguments as Record<string, unknown>)
      : null;
  const normalizedToolArguments = primaryToolArgsRecord
    ? ({
        ...primaryToolArgsRecord,
        summary:
          typeof primaryToolArgsRecord.summary === "string" &&
          primaryToolArgsRecord.summary.trim().length > 0
            ? primaryToolArgsRecord.summary
            : buildFallbackSummaryFromToolArguments(primaryToolCall.arguments),
      } satisfies Record<string, unknown>)
    : {
        summary: buildFallbackSummaryFromToolArguments(primaryToolCall.arguments),
      };

  let basePlan: ScoutModelOutput;
  try {
    basePlan = parseScoutPlanPayload(normalizedToolArguments);
  } catch (error: any) {
    const errorMessage =
      error?.message || "Structured scout plan did not match the required schema.";
    throw createPlanningError(
      errorMessage,
      {
        framework: "pi-ai-single-turn",
        attempts: withAttemptError(attempts, errorMessage),
        submittedPlan: null,
      },
      usage,
    );
  }

  const assistantText = extractAssistantText(selectedAttempt.assistantMessage);
  const replyText = basePlan.replyText?.trim() || assistantText || buildFallbackReplyText(basePlan);

  const submittedPlan: ScoutModelOutput = {
    ...basePlan,
    replyText,
  };

  if (submittedPlan.actions.length === 0 && deterministicFallbackPlan) {
    return {
      output: deterministicFallbackPlan,
      usage,
      rawTrace: {
        framework: "pi-ai-single-turn",
        resolution: "deterministic_fallback",
        attempts: withAttemptError(
          attempts,
          "Used deterministic fallback because the model returned an empty plan.",
        ),
        submittedPlan: deterministicFallbackPlan,
      },
    };
  }

  return {
    output: submittedPlan,
    usage,
    rawTrace: {
      framework: "pi-ai-single-turn",
      resolution: "model",
      attempts,
      submittedPlan,
    },
  };
}

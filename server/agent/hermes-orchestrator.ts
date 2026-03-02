import type { UserAgentProfile, UserAgentSecret } from "@shared/schema";
import { inferMemoryWritesFromMessage } from "./memory";
import { planDirectAgentOperation } from "./operations-planner";
import { planHostedWebResearch } from "./research";
import { runLocalHermesCompatibilityTurn } from "./hermes-local";
import type {
  AgentAction,
  AgentCitation,
  AgentConfirmationPreview,
  AgentToolTrace,
  HermesRespondRequest,
  HermesRespondResult,
  ScoutAgentContext,
} from "./types";

const ACTION_TOOL_ALIASES = new Set([
  "preview_direct_operation",
  "preview_pool_buy",
  "preview_pool_sell",
  "preview_lp_add",
  "preview_lp_add_optimal",
  "preview_lp_remove",
  "preview_lp_zap",
  "preview_condense",
  "preview_daily_boost_assign",
  "preview_daily_boost_remove",
  "preview_watchlist_add",
  "preview_watchlist_remove",
  "preview_community_boost_create",
  "preview_scout_adjustment",
  "preview_multi_action_bundle",
]);

function buildToolTraceEntry(input: {
  toolName: string;
  phase: AgentToolTrace["phase"];
  status: AgentToolTrace["status"];
  startedAt: number;
  summary: string;
}): AgentToolTrace {
  return {
    toolName: input.toolName,
    phase: input.phase,
    status: input.status,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    summary: input.summary,
  };
}

function wantsHostedResearch(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    /\b(latest|today|news|injury|injuries|updated|update|what changed|research|headline|report)\b/.test(
      normalized,
    ) || /\b(search|look up|browse|web)\b/.test(normalized)
  );
}

function summarizeMemoryContext(request: HermesRespondRequest): string | null {
  const topMemory =
    request.memoryMode === "off"
      ? null
      : request.memoryContext.profile[0] ||
        request.memoryContext.semantic[0] ||
        request.memoryContext.episodic[0] ||
        null;

  return topMemory ? topMemory.summary : null;
}

function isFollowUpExplanationRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^(?:what(?:\s+do)?\s+you\s+mean(?:\s+by\s+that)?|explain(?:\s+that)?|tell\s+me\s+more|why(?:\s+that|\s+though)?|how\s+so)\??$/.test(
    normalized,
  );
}

function getLastAssistantMessage(request: HermesRespondRequest): string | null {
  for (let index = request.conversationHistory.length - 1; index >= 0; index -= 1) {
    const entry = request.conversationHistory[index];
    if (entry?.role === "assistant" && entry.contentText.trim()) {
      return entry.contentText.trim();
    }
  }

  return null;
}

function explainLever(lever: string, context: ScoutAgentContext): string {
  const normalized = lever.toLowerCase();

  if (normalized.includes("daily boost slot")) {
    return `That means you still have ${context.operatorOverview.openDailyBoostSlots} open daily boost slot${context.operatorOverview.openDailyBoostSlots === 1 ? "" : "s"} and are leaving a payout multiplier unused. The practical move is to choose an eligible player with a game in the current window and assign exactly one share before lock.`;
  }

  if (normalized.includes("unassigned scout")) {
    return `That means you still have ${context.remainingScouts} scout${context.remainingScouts === 1 ? "" : "s"} not doing anything. Assigning them puts passive share generation back to work instead of leaving that capacity idle.`;
  }

  if (normalized.includes("community share")) {
    return `That means you have ${context.operatorOverview.communitySharesAvailable} community share${context.operatorOverview.communitySharesAvailable === 1 ? "" : "s"} available that could be converted into a live community boost if you want more multiplier leverage on a player.`;
  }

  if (normalized.includes("condense")) {
    return `That means you have raw holding rows that can be condensed into powered shares, which makes each share hit harder in boost payouts without increasing share count.`;
  }

  if (normalized.includes("idle play-money balance")) {
    return `That means your balance is high enough that some of it is probably sitting unused. Instead of leaving all of it idle, you can deploy part of it into a cleaner position once you pick the player or market angle you want to lean into.`;
  }

  return `That lever means: ${lever}.`;
}

function buildFollowUpExplanation(
  request: HermesRespondRequest,
  context: ScoutAgentContext,
  citations: AgentCitation[],
): Pick<
  HermesRespondResult,
  | "assistantText"
  | "summary"
  | "warnings"
  | "citations"
  | "outcome"
  | "proposedActions"
  | "pendingClarification"
  | "requiresConfirmation"
  | "confirmationPreview"
> | null {
  if (!isFollowUpExplanationRequest(request.message)) {
    return null;
  }

  const lastAssistantMessage = getLastAssistantMessage(request);
  if (!lastAssistantMessage) {
    return null;
  }

  const lead = context.operatorOverview.nextBestLevers.slice(0, 2);
  if (lead.length === 0) {
    return {
      outcome: "advisory",
      assistantText:
        "I mean there is no single urgent lever right now. If you want, name the workflow you want to focus on and I will break it down into a concrete next move.",
      summary: "Explained the previous guidance.",
      warnings: [],
      citations,
      proposedActions: [],
      pendingClarification: null,
      requiresConfirmation: false,
      confirmationPreview: null,
    };
  }

  const explanations = lead.map((entry) => explainLever(entry, context));
  const leadLine =
    lead.length === 1
      ? `The main lever I was pointing at is ${lead[0]}.`
      : `The two levers I was pointing at are ${lead[0]} and ${lead[1]}.`;
  const close = lead[0].toLowerCase().includes("daily boost")
    ? "If you want, I can next show you the best eligible boost candidates or stage a specific boost assignment."
    : lead[0].toLowerCase().includes("scout")
      ? "If you want, I can next show you the best scout targets or stage a scout reallocation."
      : "If you want, I can turn that into a concrete staged move for you.";

  return {
    outcome: "advisory",
    assistantText: [leadLine, ...explanations, close].join(" "),
    summary: "Explained the previous guidance.",
    warnings: [],
    citations,
    proposedActions: [],
    pendingClarification: null,
    requiresConfirmation: false,
    confirmationPreview: null,
  };
}

function buildFallbackAdvisory(
  request: HermesRespondRequest,
  context: ScoutAgentContext,
  citations: AgentCitation[],
): Pick<
  HermesRespondResult,
  | "assistantText"
  | "summary"
  | "warnings"
  | "citations"
  | "outcome"
  | "proposedActions"
  | "pendingClarification"
  | "requiresConfirmation"
  | "confirmationPreview"
> {
  const explanationReply = buildFollowUpExplanation(request, context, citations);
  if (explanationReply) {
    return explanationReply;
  }

  const overview = request.canonicalState.operatorOverview;
  const lead = context.operatorOverview.nextBestLevers.slice(0, 2);
  const rememberedPreference = summarizeMemoryContext(request);
  const parts = [
    `You have $${overview.availableBalance.toFixed(2)} available across ${overview.portfolioPlayerCount} player position${overview.portfolioPlayerCount === 1 ? "" : "s"}.`,
  ];

  if (overview.openDailyBoostSlots > 0) {
    parts.push(
      `You still have ${overview.openDailyBoostSlots} open daily boost slot${overview.openDailyBoostSlots === 1 ? "" : "s"} in this window.`,
    );
  }

  if (rememberedPreference) {
    parts.push(`I am still factoring in that you said: "${rememberedPreference}".`);
  }

  if (lead.length > 0) {
    parts.push(`Right now the cleanest next lever is ${lead.join(" then ")}.`);
  } else {
    parts.push(
      "If you want a concrete move, tell me the player or workflow and I will stage it with a before-and-after confirmation preview.",
    );
  }

  if (citations.length > 0) {
    parts.push(
      "I also pulled current external context so the read is grounded in live information.",
    );
  }

  return {
    outcome: "advisory",
    assistantText: parts.join(" "),
    summary: "Hermes operator overview based on current account state.",
    warnings: [],
    citations,
    proposedActions: [],
    pendingClarification: null,
    requiresConfirmation: false,
    confirmationPreview: null,
  };
}

function buildActionDeltaPreview(action: AgentAction): AgentConfirmationPreview {
  const base: AgentConfirmationPreview = {
    actionSummary: action.reasoning || action.actionType,
    beforeState: {},
    afterState: {},
    estimatedImpact: null,
    warnings: [],
    riskClass: "medium",
  };

  switch (action.actionType) {
    case "pool_buy":
      return {
        ...base,
        actionSummary: `Buy ${action.playerName || "player"} with $${action.sbAmount.toFixed(2)}`,
        beforeState: {
          availableBalance: action.availableBalanceBefore ?? null,
        },
        afterState: {
          availableBalance: action.availableBalanceAfter ?? null,
          estimatedSharesOut: action.estimatedSharesOut ?? null,
        },
        estimatedImpact:
          action.estimatedPricePerShare != null
            ? `Estimated ${action.estimatedPricePerShare.toFixed(2)} per share.`
            : null,
        warnings: ["Final fill can move if the pool price changes before confirmation."],
        riskClass: "high",
      };
    case "pool_sell":
      return {
        ...base,
        actionSummary: `Sell ${action.sharesAmount} ${action.playerName || "player"} share${action.sharesAmount === 1 ? "" : "s"}`,
        beforeState: {
          availableBalance: action.availableBalanceBefore ?? null,
          availableShares: action.availableSharesBefore ?? null,
        },
        afterState: {
          availableBalance: action.availableBalanceAfter ?? null,
          availableShares: action.availableSharesAfter ?? null,
          estimatedSbOut: action.estimatedSbOut ?? null,
        },
        warnings: ["Final proceeds can shift with pool movement before confirmation."],
        riskClass: "high",
      };
    case "daily_boost_assign":
      return {
        ...base,
        actionSummary: `Assign ${action.playerName || "player"} to the ${action.slotTier}x slot`,
        beforeState: {
          openBoostSlots: "decreases by 1",
        },
        afterState: {
          boostDate: action.boostDate,
          powerLevel: action.powerLevel ?? null,
        },
        estimatedImpact:
          action.opponent && action.gameStartTime
            ? `${action.opponent} at ${action.gameStartTime}.`
            : null,
        warnings: ["Boost windows close at game start."],
        riskClass: "medium",
      };
    case "daily_boost_remove":
      return {
        ...base,
        actionSummary: `Remove ${action.playerName || "player"} from the ${action.slotTier}x slot`,
        beforeState: {
          boostDate: action.boostDate,
        },
        afterState: {
          openBoostSlots: "increases by 1",
        },
        warnings: ["Removals are blocked after the game locks."],
        riskClass: "medium",
      };
    case "community_boost_create":
      return {
        ...base,
        actionSummary: `Create a community boost for ${action.playerName || "player"}`,
        beforeState: {
          communitySharesAvailable: action.communitySharesAvailable ?? null,
        },
        afterState: {
          communitySharesAvailable:
            action.communitySharesAvailable != null ? action.communitySharesAvailable - 1 : null,
          boostDate: action.boostDate,
        },
        warnings: ["This burns one community share on confirmation."],
        riskClass: "medium",
      };
    case "vesting_claim":
      return {
        ...base,
        actionSummary: `Claim ${action.claimableShares} vested share${action.claimableShares === 1 ? "" : "s"}`,
        beforeState: {
          claimableShares: action.claimableShares,
        },
        afterState: {
          claimableShares: 0,
          target: action.targetDescription || null,
        },
        warnings: ["Claimed vesting shares post with a fresh cost basis."],
        riskClass: "low",
      };
    case "watchlist_add_player":
      return {
        ...base,
        actionSummary: `Add ${action.playerName || "player"} to ${action.watchlistName || "your watchlist"}`,
        beforeState: {},
        afterState: {
          watchlist: action.watchlistName || "default",
        },
        riskClass: "low",
      };
    case "watchlist_remove_player":
      return {
        ...base,
        actionSummary: `Remove ${action.playerName || "player"} from ${action.removeFromAll ? "all watchlists" : action.watchlistName || "the selected watchlist"}`,
        beforeState: {
          removeFromAll: action.removeFromAll,
        },
        afterState: {},
        riskClass: "low",
      };
    case "scout_set_count":
      return {
        ...base,
        actionSummary: `Move ${action.playerName || "player"} scouts from ${action.currentCount} to ${action.targetCount}`,
        beforeState: {
          currentCount: action.currentCount,
        },
        afterState: {
          targetCount: action.targetCount,
        },
        riskClass: "low",
      };
    case "holdings_condense":
      return {
        ...base,
        actionSummary: `Condense ${action.sharesToCondense} share${action.sharesToCondense === 1 ? "" : "s"} of ${action.playerName || "player"}`,
        beforeState: {
          availableShares: action.availableSharesBefore ?? null,
        },
        afterState: {
          availableShares: action.availableSharesAfter ?? null,
          expectedPowerGained: action.expectedPowerGained,
        },
        warnings: ["Only unlocked regular shares can be condensed."],
        riskClass: "medium",
      };
    default:
      return base;
  }
}

function normalizeToolAllowlist(request: HermesRespondRequest): Set<string> {
  return new Set(request.toolAllowlist || []);
}

function buildMemoryWrites(
  request: HermesRespondRequest,
): HermesRespondResult["proposedMemoryWrites"] {
  if (request.memoryMode === "off" || request.memoryMode === "read_only") {
    return [];
  }

  return inferMemoryWritesFromMessage(request.message);
}

function normalizePlannerOutcome(
  result: any,
  proposedMemoryWrites: HermesRespondResult["proposedMemoryWrites"],
  toolTrace: AgentToolTrace[],
): HermesRespondResult {
  const proposedActions = Array.isArray(result.actions) ? (result.actions as AgentAction[]) : [];
  const warnings = Array.isArray(result.warnings)
    ? result.warnings.filter((entry: unknown): entry is string => typeof entry === "string")
    : [];
  const citations = Array.isArray(result.citations) ? (result.citations as AgentCitation[]) : [];
  const pendingClarification = result.pendingClarification || null;
  const outcome = pendingClarification
    ? "clarification"
    : proposedActions.length > 0
      ? "staged_plan"
      : result.replyText
        ? "advisory"
        : "unsupported";
  const confirmationPreview =
    proposedActions.length > 0 ? buildActionDeltaPreview(proposedActions[0]) : null;

  return {
    outcome,
    assistantText: result.replyText || result.summary || "I could not complete that request.",
    summary: result.summary || null,
    warnings,
    proposedActions,
    pendingClarification,
    citations,
    proposedMemoryWrites,
    toolTrace,
    toolCallsUsed: toolTrace.map((entry) => entry.toolName),
    requiresConfirmation: proposedActions.length > 0,
    confirmationPreview,
  };
}

export async function runHermesOrchestrationTurn(input: {
  userId: string;
  profile: UserAgentProfile;
  secret?: UserAgentSecret;
  context: ScoutAgentContext;
  request: HermesRespondRequest;
}): Promise<HermesRespondResult> {
  const toolTrace: AgentToolTrace[] = [];
  const startedAt = Date.now();
  const toolAllowlist = normalizeToolAllowlist(input.request);
  const proposedMemoryWrites = buildMemoryWrites(input.request);

  try {
    if (proposedMemoryWrites.length > 0) {
      toolTrace.push(
        buildToolTraceEntry({
          toolName: "infer_memory_writes",
          phase: "memory",
          status: "ok",
          startedAt,
          summary: `Captured ${proposedMemoryWrites.length} durable memory candidate(s) from the request.`,
        }),
      );
    }

    if (
      toolAllowlist.size === 0 ||
      [...toolAllowlist].some((toolName) => ACTION_TOOL_ALIASES.has(toolName))
    ) {
      const planStartedAt = Date.now();
      const directOperationPlan = await planDirectAgentOperation({
        userId: input.userId,
        message: input.request.message,
        profile: input.profile,
      });

      if (directOperationPlan) {
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "preview_direct_operation",
            phase: "plan",
            status: "ok",
            startedAt: planStartedAt,
            summary:
              directOperationPlan.actions.length > 0
                ? `Prepared ${directOperationPlan.actions.length} confirmation-gated action(s).`
                : "Resolved the request through deterministic agent planning.",
          }),
        );

        return normalizePlannerOutcome(directOperationPlan, proposedMemoryWrites, toolTrace);
      }

      toolTrace.push(
        buildToolTraceEntry({
          toolName: "preview_direct_operation",
          phase: "plan",
          status: "skipped",
          startedAt: planStartedAt,
          summary: "No deterministic action or advisory route matched the request.",
        }),
      );
    }

    const canUseResearch =
      input.request.canonicalState.capabilities.canUseWebResearch &&
      (toolAllowlist.size === 0 || toolAllowlist.has("get_hosted_research"));
    if (canUseResearch && wantsHostedResearch(input.request.message)) {
      const researchStartedAt = Date.now();
      const researchPlan = await planHostedWebResearch({
        message: input.request.message,
        profile: input.profile,
      });

      if (researchPlan) {
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "get_hosted_research",
            phase: "research",
            status: "ok",
            startedAt: researchStartedAt,
            summary: `Pulled ${researchPlan.citations?.length || 0} hosted citation(s) for the request.`,
          }),
        );

        return normalizePlannerOutcome(researchPlan, proposedMemoryWrites, toolTrace);
      }

      toolTrace.push(
        buildToolTraceEntry({
          toolName: "get_hosted_research",
          phase: "research",
          status: "skipped",
          startedAt: researchStartedAt,
          summary:
            "The request hinted at live research, but no hosted research result was available.",
        }),
      );
    }

    const advisoryStartedAt = Date.now();
    const advisory = buildFallbackAdvisory(
      input.request,
      input.context,
      input.request.externalContext.research || [],
    );
    toolTrace.push(
      buildToolTraceEntry({
        toolName: "build_operator_advisory",
        phase: "read",
        status: "ok",
        startedAt: advisoryStartedAt,
        summary:
          "Built a Hermes advisory response from operator state, memory, and canonical knowledge.",
      }),
    );

    return {
      ...advisory,
      proposedMemoryWrites,
      toolTrace,
      toolCallsUsed: toolTrace.map((entry) => entry.toolName),
    };
  } catch (error: any) {
    toolTrace.push(
      buildToolTraceEntry({
        toolName: "hermes_orchestration",
        phase: "plan",
        status: "failed",
        startedAt,
        summary:
          error?.message || "Hermes orchestration failed and is falling back to PI compatibility.",
      }),
    );

    const fallback = await runLocalHermesCompatibilityTurn({
      userId: input.userId,
      channel: input.request.channel,
      profile: input.profile,
      secret: input.secret,
      context: input.context,
      chatRequest: input.request.message,
      semanticRouteHint: input.request.semanticRouteHint,
      conversationHistory: input.request.conversationHistory,
      requestedMode: input.request.requestMode,
    });

    return {
      ...fallback,
      toolTrace: [...toolTrace, ...fallback.toolTrace],
      toolCallsUsed: [
        ...toolTrace.map((entry) => entry.toolName),
        ...fallback.toolTrace.map((entry) => entry.toolName),
      ],
      requiresConfirmation: fallback.proposedActions.length > 0,
      confirmationPreview:
        fallback.proposedActions.length > 0
          ? buildActionDeltaPreview(fallback.proposedActions[0])
          : null,
    };
  }
}

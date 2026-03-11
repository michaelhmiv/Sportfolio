import type { UserAgentProfile, UserAgentSecret } from "@shared/schema";
import { inferMemoryWritesFromMessage } from "./memory";
import { runHermesPlanTool } from "./hermes-tools";
import { createOrUpdateUserSkill, matchAgentSkill, proposeGlobalSkillCandidate } from "./skills";
import { runLocalHermesCompatibilityTurn } from "./hermes-local";
import { runHermesModelToolLoop } from "./model-first-router";
import type {
  AgentAction,
  AgentCitation,
  AgentConfirmationPreview,
  AgentSkillStep,
  AgentToolTrace,
  HermesRespondRequest,
  HermesRespondResult,
  ScoutAgentContext,
} from "./types";

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

  if (normalized.includes("stack")) {
    return `That means you have raw holding rows that can be stacked into stacked shares, which makes each share hit harder in boost payouts without increasing share count.`;
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

function buildNeutralModelFallback(
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
  return {
    outcome: "advisory",
    assistantText:
      "Hermes could not complete the direct tool loop for that turn. I did not ignore your request, but the system did not finish with a usable answer.",
    summary: "Hermes could not complete the direct tool loop for the latest turn.",
    warnings: ["The direct Hermes tool loop did not return a usable answer or plan."],
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
          shareMultiplier: action.shareMultiplier ?? null,
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
    case "holdings_stack_shares":
      return {
        ...base,
        actionSummary: `Stack ${action.sharesToStack} share${action.sharesToStack === 1 ? "" : "s"} of ${action.playerName || "player"}`,
        beforeState: {
          availableShares: action.availableSharesBefore ?? null,
        },
        afterState: {
          availableShares: action.availableSharesAfter ?? null,
          expectedMultiplierGained: action.expectedMultiplierGained,
        },
        warnings: ["Only unlocked regular shares can be stacked."],
        riskClass: "medium",
      };
    default:
      return base;
  }
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
  skillsUsed: string[] = [],
  createdSkillCandidates: string[] = [],
  skillMatchRationale: string | null = null,
  fallbackUsed = false,
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
    skillsUsed,
    createdSkillCandidates,
    skillMatchRationale,
    fallbackUsed,
    requiresConfirmation: proposedActions.length > 0,
    confirmationPreview,
  };
}

function buildModelSelectedToolArgs(input: {
  request: HermesRespondRequest;
  toolName: string;
  toolArgs: Record<string, unknown>;
}) {
  const args = { ...input.toolArgs };

  if (typeof args.message !== "string" || !args.message.trim()) {
    args.message = input.request.message;
  }

  if (
    (input.toolName === "list_user_memories" ||
      input.toolName === "search_user_memories" ||
      input.toolName === "get_user_memory_context") &&
    (typeof args.query !== "string" || !args.query.trim())
  ) {
    args.query = input.request.message;
  }

  return args;
}

function buildSkillStepsFromTrace(toolTrace: AgentToolTrace[]): AgentSkillStep[] {
  return toolTrace
    .filter(
      (entry) =>
        entry.status === "ok" &&
        entry.toolName !== "tool_first_router" &&
        entry.toolName !== "model_first_router" &&
        entry.toolName !== "model_tool_loop" &&
        entry.toolName !== "model_tool_repair_retry" &&
        entry.toolName !== "model_first_read_summary" &&
        entry.toolName !== "model_first_fallback" &&
        entry.toolName !== "infer_memory_writes" &&
        entry.toolName !== "external_hermes_fallback",
    )
    .map((entry) => ({
      stepType: "tool_call" as const,
      toolCategory:
        entry.phase === "scan" || entry.phase === "research"
          ? entry.phase
          : entry.phase === "action"
            ? "action"
            : entry.phase === "memory"
              ? "memory"
              : entry.phase === "read"
                ? "read"
                : "plan",
      toolName: entry.toolName,
      argumentTemplate: {},
    }));
}

async function maybeCreateRuntimeSkill(input: {
  userId: string;
  threadId: string | null;
  request: HermesRespondRequest;
  toolTrace: AgentToolTrace[];
  createdSkillCandidates: string[];
  name: string;
  description: string;
}): Promise<void> {
  if (!input.request.skillPolicy?.allowRuntimeSkillCreation) {
    return;
  }

  const toolSequence = buildSkillStepsFromTrace(input.toolTrace);
  if (toolSequence.length === 0) {
    return;
  }
  const skillStartedAt = Date.now();

  try {
    const userSkill = await createOrUpdateUserSkill({
      userId: input.userId,
      threadId: input.threadId,
      name: input.name,
      description: input.description,
      triggerExamples: [input.request.message],
      toolSequence,
      confidence: 0.72,
    });

    if (!userSkill) {
      return;
    }

    input.createdSkillCandidates.push(userSkill.id);

    const globalCandidate = await proposeGlobalSkillCandidate({
      sourceSkill: userSkill,
    });

    if (globalCandidate) {
      input.createdSkillCandidates.push(globalCandidate.id);
    }
  } catch (error: any) {
    input.toolTrace.push(
      buildToolTraceEntry({
        toolName: "create_runtime_skill",
        phase: "memory",
        status: "failed",
        startedAt: skillStartedAt,
        summary: `Runtime skill persistence failed after planning succeeded: ${String(error?.message || "Unknown error")}`,
      }),
    );
  }
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
  const proposedMemoryWrites = buildMemoryWrites(input.request);
  const skillsUsed: string[] = [];
  const createdSkillCandidates: string[] = [];
  let skillMatchRationale: string | null = null;

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

    const matchedSkillResult = matchAgentSkill(
      input.request.message,
      input.request.availableSkills || [],
    );
    const matchedSkill = matchedSkillResult?.skillId
      ? (input.request.availableSkills || []).find(
          (skill) => skill.id === matchedSkillResult.skillId,
        )
      : null;

    if (matchedSkill) {
      skillsUsed.push(matchedSkill.id);
      skillMatchRationale = matchedSkillResult?.reason || null;
      toolTrace.push(
        buildToolTraceEntry({
          toolName: "match_runtime_skill",
          phase: "memory",
          status: "ok",
          startedAt: Date.now(),
          summary: skillMatchRationale || `Matched the ${matchedSkill.name} runtime skill.`,
        }),
      );
    }

    const explanationReply = buildFollowUpExplanation(
      input.request,
      input.context,
      input.request.externalContext.research || [],
    );
    if (explanationReply) {
      toolTrace.push(
        buildToolTraceEntry({
          toolName: "explain_previous_guidance",
          phase: "read",
          status: "ok",
          startedAt: Date.now(),
          summary:
            "Expanded the prior operator guidance into a direct follow-up explanation for the latest user turn.",
        }),
      );

      return {
        ...explanationReply,
        proposedMemoryWrites,
        toolTrace,
        toolCallsUsed: toolTrace.map((entry) => entry.toolName),
        skillsUsed,
        createdSkillCandidates,
        skillMatchRationale,
        fallbackUsed: false,
      };
    }

    const routedTurn = await runHermesModelToolLoop({
      profile: input.profile,
      secret: input.secret,
      request: input.request,
      matchedSkill: matchedSkill || null,
    });
    toolTrace.push(...routedTurn.toolTrace);

    if (routedTurn.outcome === "answer") {
      return {
        outcome: "advisory",
        assistantText: routedTurn.replyText,
        summary: routedTurn.summary || "Model-first operator reply.",
        warnings: routedTurn.warnings,
        proposedActions: [],
        pendingClarification: null,
        citations: routedTurn.citations,
        proposedMemoryWrites,
        toolTrace,
        toolCallsUsed: toolTrace.map((entry) => entry.toolName),
        skillsUsed,
        createdSkillCandidates,
        skillMatchRationale,
        fallbackUsed: false,
        requiresConfirmation: false,
        confirmationPreview: null,
      };
    }

    if (routedTurn.outcome === "tool" && routedTurn.toolCategory === "plan") {
      const selectedToolArgs = buildModelSelectedToolArgs({
        request: input.request,
        toolName: routedTurn.toolName,
        toolArgs: routedTurn.toolArgs,
      });
      const planStartedAt = Date.now();

      try {
        const planResult = await runHermesPlanTool({
          toolName: routedTurn.toolName,
          userId: input.userId,
          args: selectedToolArgs,
        });

        if (!planResult) {
          toolTrace.push(
            buildToolTraceEntry({
              toolName: routedTurn.toolName,
              phase: "plan",
              status: "skipped",
              startedAt: planStartedAt,
              summary:
                "The model-selected planning tool did not return a usable plan for this turn.",
            }),
          );
        } else {
          toolTrace.push(
            buildToolTraceEntry({
              toolName: routedTurn.toolName,
              phase: "plan",
              status: "ok",
              startedAt: planStartedAt,
              summary:
                planResult &&
                typeof planResult === "object" &&
                Array.isArray((planResult as { actions?: unknown[] }).actions)
                  ? `Prepared ${((planResult as { actions?: unknown[] }).actions || []).length} confirmation-gated action(s).`
                  : "Resolved the request through a model-selected planning tool.",
            }),
          );

          if (
            routedTurn.toolName === "preview_multi_action_bundle" &&
            typeof planResult === "object" &&
            Array.isArray((planResult as { actions?: unknown[] }).actions) &&
            ((planResult as { actions?: unknown[] }).actions || []).length > 0
          ) {
            await maybeCreateRuntimeSkill({
              userId: input.userId,
              threadId: input.request.threadId,
              request: input.request,
              toolTrace,
              createdSkillCandidates,
              name: "compound operation bundle",
              description:
                "Reuses the multi-action bundle planner for compound portfolio requests over approved tools.",
            });
          }

          return normalizePlannerOutcome(
            planResult,
            proposedMemoryWrites,
            toolTrace,
            skillsUsed,
            createdSkillCandidates,
            skillMatchRationale,
          );
        }
      } catch (error: any) {
        toolTrace.push(
          buildToolTraceEntry({
            toolName: routedTurn.toolName,
            phase: "plan",
            status: "failed",
            startedAt: planStartedAt,
            summary:
              error?.message ||
              `${routedTurn.toolName} failed after the model selected it for this turn.`,
          }),
        );
      }
    } else if (routedTurn.outcome === "unsupported" && routedTurn.replyText) {
      return {
        outcome: "advisory",
        assistantText: routedTurn.replyText,
        summary: routedTurn.summary,
        warnings: routedTurn.warnings,
        proposedActions: [],
        pendingClarification: null,
        citations: routedTurn.citations,
        proposedMemoryWrites,
        toolTrace,
        toolCallsUsed: toolTrace.map((entry) => entry.toolName),
        skillsUsed,
        createdSkillCandidates,
        skillMatchRationale,
        fallbackUsed: false,
        requiresConfirmation: false,
        confirmationPreview: null,
      };
    }

    const advisoryStartedAt = Date.now();
    const advisory = buildNeutralModelFallback(routedTurn.citations);
    toolTrace.push(
      buildToolTraceEntry({
        toolName: "model_first_fallback",
        phase: "read",
        status: "ok",
        startedAt: advisoryStartedAt,
        summary:
          "Returned a transparent fallback because the direct Hermes tool loop did not produce a usable answer or plan.",
      }),
    );

    return {
      ...advisory,
      proposedMemoryWrites,
      toolTrace,
      toolCallsUsed: toolTrace.map((entry) => entry.toolName),
      skillsUsed,
      createdSkillCandidates,
      skillMatchRationale,
      fallbackUsed: false,
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
      skillsUsed,
      createdSkillCandidates,
      skillMatchRationale,
      fallbackUsed: true,
      requiresConfirmation: fallback.proposedActions.length > 0,
      confirmationPreview:
        fallback.proposedActions.length > 0
          ? buildActionDeltaPreview(fallback.proposedActions[0])
          : null,
    };
  }
}

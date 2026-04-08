import type { UserAgentProfile, UserAgentSecret } from "@shared/schema";
import { inferMemoryWritesFromMessage } from "./memory";
import { runHermesPlanTool } from "./hermes-tools";
import { createOrUpdateUserSkill, matchAgentSkill, proposeGlobalSkillCandidate } from "./skills";
import { runLocalHermesCompatibilityTurn } from "./hermes-local";
import { compressThreadContext } from "./context-compressor";
import { runHermesModelToolLoop } from "./model-first-router";
import type {
  AgentAction,
  AgentCitation,
  AgentConfirmationPreview,
  AgentSkillStep,
  AgentToolTrace,
  AgentTurnProgressCallback,
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
  details?: Record<string, unknown> | null;
}): AgentToolTrace {
  return {
    toolName: input.toolName,
    phase: input.phase,
    status: input.status,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    summary: input.summary,
    details: input.details || null,
  };
}

function getMemoryInfluences(request: HermesRespondRequest): string[] {
  if (request.memoryMode === "off") {
    return [];
  }

  return [
    ...request.memoryContext.profile,
    ...request.memoryContext.semantic,
    ...request.memoryContext.episodic,
  ]
    .map((entry) => entry.summary.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function isCompatibilityFallbackEnabled() {
  return process.env.HERMES_ENABLE_COMPATIBILITY_FALLBACK === "true";
}

function buildNeutralModelFallback(input: {
  citations: AgentCitation[];
  warnings?: string[];
  terminationReason?: string | null;
  providerFailureClass?: HermesRespondResult["providerFailureClass"];
}): Pick<
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
  const warningLead = input.warnings?.[0] || null;
  const assistantText =
    input.terminationReason === "empty_provider_response"
      ? "Hermes did not get a usable tool call or visible answer back from the active model for that turn. The request reached the direct tool loop, but the provider responded with an empty turn."
      : "Hermes could not complete the direct tool loop for that turn. I did not ignore your request, but the system did not finish with a usable answer.";

  return {
    outcome: "advisory",
    assistantText,
    summary:
      input.terminationReason === "empty_provider_response"
        ? "The active model returned an empty response twice in the Hermes tool loop."
        : "Hermes could not complete the direct tool loop for the latest turn.",
    warnings: [
      warningLead || "The direct Hermes tool loop did not return a usable answer or plan.",
    ],
    citations: input.citations,
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
  metadata: Pick<
    HermesRespondResult,
    | "terminationReason"
    | "compressionApplied"
    | "repairAttempts"
    | "providerFailureClass"
    | "memoryInfluences"
    | "usageMetrics"
  > = {
    terminationReason: null,
    compressionApplied: false,
    repairAttempts: 0,
    providerFailureClass: null,
    memoryInfluences: [],
    usageMetrics: null,
  },
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
    terminationReason: metadata.terminationReason ?? null,
    compressionApplied: Boolean(metadata.compressionApplied),
    repairAttempts: metadata.repairAttempts ?? 0,
    providerFailureClass: metadata.providerFailureClass ?? null,
    memoryInfluences: metadata.memoryInfluences || [],
    usageMetrics: metadata.usageMetrics || null,
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
        entry.toolName !== "model_context_compression" &&
        entry.toolName !== "model_provider_retry" &&
        entry.toolName !== "model_first_read_summary" &&
        entry.toolName !== "model_first_fallback" &&
        entry.toolName !== "infer_memory_writes" &&
        entry.toolName !== "memory_influence_context" &&
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
  onTurnEvent?: AgentTurnProgressCallback;
}): Promise<HermesRespondResult> {
  const toolTrace: AgentToolTrace[] = [];
  const startedAt = Date.now();
  const proposedMemoryWrites = buildMemoryWrites(input.request);
  const skillsUsed: string[] = [];
  const createdSkillCandidates: string[] = [];
  const memoryInfluences = getMemoryInfluences(input.request);
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

    if (memoryInfluences.length > 0) {
      toolTrace.push(
        buildToolTraceEntry({
          toolName: "memory_influence_context",
          phase: "memory",
          status: "ok",
          startedAt: Date.now(),
          summary: `Loaded ${memoryInfluences.length} durable memory influence(s) into the orchestrator context.`,
          details: {
            memoryInfluences,
          },
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

    const compressionResult = compressThreadContext(input.request.conversationHistory);
    let compressionApplied = false;
    const requestForModel = compressionResult.compressed
      ? {
          ...input.request,
          conversationHistory: compressionResult.history,
        }
      : input.request;

    if (compressionResult.compressed) {
      compressionApplied = true;
      toolTrace.push(
        buildToolTraceEntry({
          toolName: "model_context_compression",
          phase: "memory",
          status: "ok",
          startedAt: Date.now(),
          summary: `Compressed ${input.request.conversationHistory.length} conversation turns down to ${compressionResult.history.length} to fit within context limits.`,
        }),
      );
    }

    const routedTurn = await runHermesModelToolLoop({
      profile: input.profile,
      secret: input.secret,
      request: requestForModel,
      matchedSkill: matchedSkill || null,
      onTurnEvent: input.onTurnEvent,
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
        terminationReason: routedTurn.terminationReason,
        compressionApplied: compressionApplied || routedTurn.compressionApplied,
        repairAttempts: routedTurn.repairAttempts,
        providerFailureClass: routedTurn.providerFailureClass,
        memoryInfluences,
        usageMetrics: routedTurn.usageMetrics,
        requiresConfirmation: false,
        confirmationPreview: null,
        uiBlocks: routedTurn.uiBlocks,
      };
    }

    if (routedTurn.outcome === "tool" && routedTurn.toolCategory === "plan") {
      const selectedToolArgs = buildModelSelectedToolArgs({
        request: input.request,
        toolName: routedTurn.toolName,
        toolArgs: routedTurn.toolArgs,
      });
      const planStartedAt = Date.now();
      const planPhase = routedTurn.toolName === "get_hosted_research" ? "research" : "plan";
      input.onTurnEvent?.({
        eventType: "tool_call_started",
        status: "running",
        summary: `Running ${routedTurn.toolName}.`,
        phase: planPhase,
        toolName: routedTurn.toolName,
        passIndex: routedTurn.usageMetrics.modelPassCount,
      });

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
          input.onTurnEvent?.({
            eventType: "tool_call_completed",
            status: "done",
            summary: `${routedTurn.toolName} returned no actionable plan.`,
            phase: planPhase,
            toolName: routedTurn.toolName,
            passIndex: routedTurn.usageMetrics.modelPassCount,
            elapsedMs: Math.max(0, Date.now() - planStartedAt),
          });
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
          input.onTurnEvent?.({
            eventType: "tool_call_completed",
            status: "done",
            summary: `Completed ${routedTurn.toolName}.`,
            phase: planPhase,
            toolName: routedTurn.toolName,
            passIndex: routedTurn.usageMetrics.modelPassCount,
            elapsedMs: Math.max(0, Date.now() - planStartedAt),
          });

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
            false,
            {
              terminationReason: routedTurn.terminationReason,
              compressionApplied: compressionApplied || routedTurn.compressionApplied,
              repairAttempts: routedTurn.repairAttempts,
              providerFailureClass: routedTurn.providerFailureClass,
              memoryInfluences,
              usageMetrics: routedTurn.usageMetrics,
            },
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
        input.onTurnEvent?.({
          eventType: "tool_call_failed",
          status: "failed",
          summary: `${routedTurn.toolName} failed.`,
          phase: planPhase,
          toolName: routedTurn.toolName,
          passIndex: routedTurn.usageMetrics.modelPassCount,
          elapsedMs: Math.max(0, Date.now() - planStartedAt),
          details: {
            error: error?.message || `${routedTurn.toolName} failed.`,
          },
        });
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
        terminationReason: routedTurn.terminationReason,
        compressionApplied: compressionApplied || routedTurn.compressionApplied,
        repairAttempts: routedTurn.repairAttempts,
        providerFailureClass: routedTurn.providerFailureClass,
        memoryInfluences,
        usageMetrics: routedTurn.usageMetrics,
        requiresConfirmation: false,
        confirmationPreview: null,
        uiBlocks: routedTurn.uiBlocks,
      };
    }

    const advisoryStartedAt = Date.now();
    const advisory = buildNeutralModelFallback({
      citations: routedTurn.citations,
      warnings: routedTurn.warnings,
      terminationReason: routedTurn.terminationReason,
      providerFailureClass: routedTurn.providerFailureClass,
    });
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
      terminationReason: routedTurn.terminationReason || "neutral_model_fallback",
      compressionApplied: compressionApplied || routedTurn.compressionApplied,
      repairAttempts: routedTurn.repairAttempts,
      providerFailureClass: routedTurn.providerFailureClass,
      memoryInfluences,
      usageMetrics: routedTurn.usageMetrics,
    };
  } catch (error: any) {
    toolTrace.push(
      buildToolTraceEntry({
        toolName: "hermes_orchestration",
        phase: "plan",
        status: "failed",
        startedAt,
        summary: error?.message || "Hermes orchestration failed.",
      }),
    );

    if (!isCompatibilityFallbackEnabled()) {
      return {
        outcome: "error",
        assistantText: error?.message || "Hermes orchestration failed.",
        summary: null,
        warnings: [],
        proposedActions: [],
        pendingClarification: null,
        citations: [],
        proposedMemoryWrites,
        toolTrace,
        toolCallsUsed: toolTrace.map((entry) => entry.toolName),
        skillsUsed,
        createdSkillCandidates,
        skillMatchRationale,
        fallbackUsed: false,
        terminationReason: "orchestration_exception",
        compressionApplied: false,
        repairAttempts: 0,
        providerFailureClass: null,
        memoryInfluences,
        usageMetrics: null,
        requiresConfirmation: false,
        confirmationPreview: null,
      };
    }

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
      terminationReason: "compatibility_fallback",
      compressionApplied: false,
      repairAttempts: 0,
      providerFailureClass: null,
      memoryInfluences,
      usageMetrics: null,
      requiresConfirmation: fallback.proposedActions.length > 0,
      confirmationPreview:
        fallback.proposedActions.length > 0
          ? buildActionDeltaPreview(fallback.proposedActions[0])
          : null,
    };
  }
}

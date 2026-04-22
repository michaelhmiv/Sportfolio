import { z } from "zod";
import { runHermesOrchestrationTurn } from "./hermes-orchestrator";
import { buildDefaultHermesToolAllowlist, buildHermesTurnRequest } from "./runtime-adapter";
import { logHermesRuntimeSession } from "./runtime-session-logger";
import { normalizeAgentUiBlocks } from "./ui-blocks";
import type {
  AgentProviderFailureClass,
  HermesRespondResult,
  HermesRuntimeTurnInput,
} from "./types";

export { buildDefaultHermesToolAllowlist } from "./runtime-adapter";

const proposedMemoryWriteSchema = z.object({
  scope: z.enum(["profile", "episodic", "semantic"]),
  kind: z.enum([
    "preference",
    "goal",
    "risk_tolerance",
    "favorite_entities",
    "habit",
    "interaction_style",
  ]),
  summary: z.string().trim().min(1),
  content: z.record(z.unknown()),
  confidence: z.number().finite().min(0).max(1),
  reason: z.string().trim().min(1),
});

const agentToolTraceSchema = z.object({
  toolName: z.string().trim().min(1),
  phase: z.enum(["read", "scan", "plan", "action", "memory", "research"]),
  status: z.enum(["ok", "failed", "skipped"]),
  latencyMs: z.number().finite().min(0),
  summary: z.string().trim().min(1),
  details: z.record(z.unknown()).nullable().optional(),
});

const hermesResponseSchema = z.object({
  outcome: z.enum(["advisory", "staged_plan", "clarification", "unsupported", "error"]),
  assistantText: z.string().trim().min(1),
  summary: z.string().trim().nullable().optional(),
  warnings: z.array(z.string()).optional(),
  proposedActions: z.array(z.record(z.any())).optional(),
  pendingClarification: z.record(z.any()).nullable().optional(),
  citations: z.array(z.record(z.any())).optional(),
  proposedMemoryWrites: z.array(proposedMemoryWriteSchema).optional(),
  toolTrace: z.array(agentToolTraceSchema).optional(),
  toolCallsUsed: z.array(z.string()).optional(),
  skillsUsed: z.array(z.string()).optional(),
  createdSkillCandidates: z.array(z.string()).optional(),
  skillMatchRationale: z.string().trim().nullable().optional(),
  fallbackUsed: z.boolean().optional(),
  terminationReason: z.string().trim().nullable().optional(),
  compressionApplied: z.boolean().optional(),
  repairAttempts: z.number().int().min(0).optional(),
  providerFailureClass: z
    .enum(["auth", "context_overflow", "transient", "malformed_response", "unknown"])
    .nullable()
    .optional(),
  memoryInfluences: z.array(z.string()).optional(),
  usageMetrics: z
    .object({
      modelPassCount: z.number().int().min(0),
      nonPlanningToolCallCount: z.number().int().min(0),
      maxModelPasses: z.number().int().min(1),
      maxToolCalls: z.number().int().min(1),
      budgetProfile: z.enum(["default", "aggressive_safe"]),
      finalUsage: z
        .object({
          promptTokens: z.number().int().min(0),
          completionTokens: z.number().int().min(0),
          totalTokens: z.number().int().min(0),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
  requiresConfirmation: z.boolean().optional(),
  confirmationPreview: z.record(z.unknown()).nullable().optional(),
  uiBlocks: z.array(z.record(z.unknown())).optional(),
});

export function normalizeHermesTurnResponse(payload: unknown): HermesRespondResult {
  const parsed = hermesResponseSchema.parse(payload);

  return {
    outcome: parsed.outcome,
    assistantText: parsed.assistantText,
    summary: parsed.summary ?? null,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    proposedActions: Array.isArray(parsed.proposedActions)
      ? (parsed.proposedActions as HermesRespondResult["proposedActions"])
      : [],
    pendingClarification: (parsed.pendingClarification ||
      null) as HermesRespondResult["pendingClarification"],
    citations: Array.isArray(parsed.citations)
      ? (parsed.citations as HermesRespondResult["citations"])
      : [],
    proposedMemoryWrites: Array.isArray(parsed.proposedMemoryWrites)
      ? (parsed.proposedMemoryWrites as HermesRespondResult["proposedMemoryWrites"])
      : [],
    toolTrace: Array.isArray(parsed.toolTrace)
      ? (parsed.toolTrace as HermesRespondResult["toolTrace"])
      : [],
    toolCallsUsed: Array.isArray(parsed.toolCallsUsed)
      ? parsed.toolCallsUsed.filter((entry): entry is string => typeof entry === "string")
      : [],
    skillsUsed: Array.isArray(parsed.skillsUsed)
      ? parsed.skillsUsed.filter((entry): entry is string => typeof entry === "string")
      : [],
    createdSkillCandidates: Array.isArray(parsed.createdSkillCandidates)
      ? parsed.createdSkillCandidates.filter((entry): entry is string => typeof entry === "string")
      : [],
    skillMatchRationale: parsed.skillMatchRationale ?? null,
    fallbackUsed: Boolean(parsed.fallbackUsed),
    terminationReason: parsed.terminationReason ?? null,
    compressionApplied: Boolean(parsed.compressionApplied),
    repairAttempts: parsed.repairAttempts ?? 0,
    providerFailureClass: (parsed.providerFailureClass ?? null) as AgentProviderFailureClass | null,
    memoryInfluences: Array.isArray(parsed.memoryInfluences)
      ? parsed.memoryInfluences.filter((entry): entry is string => typeof entry === "string")
      : [],
    usageMetrics: parsed.usageMetrics || null,
    requiresConfirmation: Boolean(parsed.requiresConfirmation),
    confirmationPreview: (parsed.confirmationPreview ||
      null) as HermesRespondResult["confirmationPreview"],
    uiBlocks: normalizeAgentUiBlocks(parsed.uiBlocks),
  };
}

export async function runHermesAgentTurn(
  input: HermesRuntimeTurnInput,
): Promise<HermesRespondResult> {
  const requestPayload = await buildHermesTurnRequest({
    ...input,
    orchestrationMode: "local_only",
  });

  const startedAt = Date.now();
  try {
    const localResult = await runHermesOrchestrationTurn({
      userId: input.userId,
      profile: input.profile,
      secret: input.secret,
      context: input.context,
      request: requestPayload,
      onTurnEvent: input.onTurnEvent,
    });
    const normalized = normalizeHermesTurnResponse({
      ...localResult,
      toolTrace: [
        {
          toolName: "hermes_orchestrator_local",
          phase: "plan",
          status: localResult.outcome === "error" ? "failed" : "ok",
          latencyMs: Math.max(0, Date.now() - startedAt),
          summary:
            localResult.outcome === "error"
              ? "The in-process Hermes orchestrator ended with an error."
              : "The in-process Hermes orchestrator handled the turn directly.",
          details: {
            orchestrationMode: requestPayload.orchestrationMode,
          },
        },
        ...localResult.toolTrace,
      ],
      fallbackUsed: Boolean(localResult.fallbackUsed),
    });
    const runtimeMetadata = await logHermesRuntimeSession({
      userId: input.userId,
      threadId: input.threadId,
      status: normalized.outcome,
      requestPayload,
      responsePayload: normalized,
      toolTrace: normalized.toolTrace,
      latencyMs: Math.max(0, Date.now() - startedAt),
      transport: "local",
      executionKind: input.executionContext?.kind || null,
      triggerSource: input.triggerContext?.source || null,
      strategyId: input.strategyContext?.strategyId || null,
      providerKey: requestPayload.modelRuntime.providerKey || null,
      model: requestPayload.modelRuntime.model || requestPayload.profile.model || null,
    });

    return {
      ...normalized,
      runtimeMetadata,
    };
  } catch (error: any) {
    const failedResult = normalizeHermesTurnResponse({
      outcome: "error",
      assistantText: error?.message || "Hermes orchestration failed.",
      summary: null,
      warnings: [],
      proposedActions: [],
      pendingClarification: null,
      citations: [],
      proposedMemoryWrites: [],
      toolTrace: [
        {
          toolName: "hermes_orchestrator_local",
          phase: "plan",
          status: "failed",
          latencyMs: Math.max(0, Date.now() - startedAt),
          summary: error?.message || "The in-process Hermes orchestrator failed.",
        },
      ],
      toolCallsUsed: [],
      skillsUsed: [],
      createdSkillCandidates: [],
      skillMatchRationale: null,
      fallbackUsed: false,
      terminationReason: "orchestrator_exception",
      compressionApplied: false,
      repairAttempts: 0,
      providerFailureClass: "unknown",
      memoryInfluences: [],
      requiresConfirmation: false,
      confirmationPreview: null,
      uiBlocks: [],
    });

    const runtimeMetadata = await logHermesRuntimeSession({
      userId: input.userId,
      threadId: input.threadId,
      status: "failed",
      requestPayload,
      responsePayload: failedResult,
      toolTrace: failedResult.toolTrace,
      latencyMs: Math.max(0, Date.now() - startedAt),
      transport: "local",
      executionKind: input.executionContext?.kind || null,
      triggerSource: input.triggerContext?.source || null,
      strategyId: input.strategyContext?.strategyId || null,
      providerKey: requestPayload.modelRuntime.providerKey || null,
      model: requestPayload.modelRuntime.model || requestPayload.profile.model || null,
    });

    return {
      ...failedResult,
      runtimeMetadata,
    };
  }
}

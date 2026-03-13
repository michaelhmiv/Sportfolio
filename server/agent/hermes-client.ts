import { agentRuntimeSessions, type UserAgentProfile, type UserAgentSecret } from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { decryptText } from "../lib/encryption";
import { getManagedProviderRuntimeConfig } from "./provider-registry";
import { runHermesOrchestrationTurn } from "./hermes-orchestrator";
import { getAgentToolCatalog } from "./hermes-tools";
import { getDefaultHermesToolAllowlist } from "./hermes-tool-registry";
import { listAvailableAgentSkills } from "./skills";
import { getActiveManagedProviderSelection } from "./system-settings";
import type {
  AgentChannel,
  AgentModelRuntimeConfig,
  AgentProviderFailureClass,
  AgentSemanticRoute,
  AgentSkillDefinition,
  AgentToolDefinition,
  HermesRespondRequest,
  HermesRespondResult,
  ScoutAgentContext,
} from "./types";

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
  requiresConfirmation: z.boolean().optional(),
  confirmationPreview: z.record(z.unknown()).nullable().optional(),
});

function resolveProfileTemperature(profile: UserAgentProfile): number {
  const parsed = Number(profile.temperature);
  if (!Number.isFinite(parsed)) {
    return 0.4;
  }

  return Math.max(0, Math.min(parsed, 1));
}

async function buildModelRuntimeConfig(
  profile: UserAgentProfile,
  secret: UserAgentSecret | undefined,
): Promise<AgentModelRuntimeConfig> {
  if (profile.providerMode === "byok") {
    if (!secret) {
      throw new Error("BYOK is selected but no API key is configured");
    }
    if (!profile.baseUrl) {
      throw new Error("BYOK is selected but no base URL is configured");
    }

    return {
      providerMode: "byok",
      model: profile.model,
      baseUrl: profile.baseUrl,
      apiKey: decryptText({
        ciphertext: secret.apiKeyCiphertext,
        iv: secret.apiKeyIv,
        authTag: secret.apiKeyAuthTag,
      }),
      headers: null,
      payloadDefaults: null,
    };
  }

  const selection = await getActiveManagedProviderSelection();
  const runtime = getManagedProviderRuntimeConfig(selection.provider);

  if (!runtime.apiKey) {
    throw new Error(`Managed ${runtime.label} provider is not configured`);
  }

  return {
    providerMode: "managed",
    providerKey: selection.provider,
    model: profile.model,
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
    authMode: runtime.authMode,
    headers: runtime.headers || null,
    payloadDefaults: runtime.payloadDefaults || null,
  };
}

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
    requiresConfirmation: Boolean(parsed.requiresConfirmation),
    confirmationPreview: (parsed.confirmationPreview ||
      null) as HermesRespondResult["confirmationPreview"],
  };
}

async function logRuntimeSession(input: {
  userId: string;
  threadId: string | null;
  status: string;
  requestPayload: HermesRespondRequest;
  responsePayload: HermesRespondResult | Record<string, unknown> | null;
  toolTrace: HermesRespondResult["toolTrace"];
  latencyMs: number;
}) {
  const sanitizedRequestPayload = {
    ...input.requestPayload,
    modelRuntime: {
      ...input.requestPayload.modelRuntime,
      apiKey: input.requestPayload.modelRuntime.apiKey ? "[redacted]" : null,
    },
  };

  try {
    await db.insert(agentRuntimeSessions).values({
      userId: input.userId,
      threadId: input.threadId,
      runtime: "hermes",
      status: input.status,
      requestPayload: sanitizedRequestPayload,
      responsePayload: input.responsePayload,
      toolTrace: input.toolTrace,
      latencyMs: input.latencyMs,
    });
  } catch (error: any) {
    console.warn("[Hermes] Could not log runtime session:", error?.message || error);
  }
}

export async function runHermesAgentTurn(input: {
  userId: string;
  threadId: string | null;
  channel: AgentChannel;
  message: string;
  requestMode: HermesRespondRequest["requestMode"];
  profile: UserAgentProfile;
  secret?: UserAgentSecret;
  context: ScoutAgentContext;
  capabilities: HermesRespondRequest["canonicalState"]["capabilities"];
  memoryContext: HermesRespondRequest["memoryContext"];
  conversationHistory?: HermesRespondRequest["conversationHistory"];
  semanticRouteHint?: AgentSemanticRoute | null;
  toolAllowlist?: string[];
  toolCatalog?: AgentToolDefinition[];
  availableSkills?: AgentSkillDefinition[];
  autoExecutionPolicy?: HermesRespondRequest["autoExecutionPolicy"];
  confirmationPolicy?: HermesRespondRequest["confirmationPolicy"];
  externalResearch?: HermesRespondRequest["externalContext"]["research"];
}): Promise<HermesRespondResult> {
  const modelRuntime = await buildModelRuntimeConfig(input.profile, input.secret);
  const availableSkills = input.availableSkills || (await listAvailableAgentSkills(input.userId));
  const toolCatalog = input.toolCatalog || getAgentToolCatalog();
  const toolAllowlist = input.toolAllowlist || [
    ...getDefaultHermesToolAllowlist(),
    ...toolCatalog.map((entry) => entry.toolName),
    "get_agent_capabilities",
    "get_user_profile_summary",
    "get_watchlist_items",
    "get_player_watchlists",
    "get_player_stats",
    "get_daily_boost_history",
    "get_community_boosts_all",
    "list_pattern_candidates",
    "preview_pool_buy",
    "preview_pool_sell",
    "preview_lp_add",
    "preview_lp_add_optimal",
    "preview_lp_remove",
    "preview_lp_zap",
    "preview_stack_shares",
    "preview_daily_boost_assign",
    "preview_daily_boost_remove",
    "preview_watchlist_add",
    "preview_watchlist_remove",
    "preview_community_boost_create",
    "preview_scout_adjustment",
    "create_agent_thread",
    "create_watchlist",
    "update_watchlist",
    "delete_watchlist",
    "add_watchlist_player",
    "remove_watchlist_player",
    "upsert_user_schedule",
    "delete_user_schedule",
    "search_user_memories",
    "get_user_memory_context",
    "write_user_memory",
    "supersede_user_memory",
    "archive_user_memory",
    "archive_runtime_skill",
  ];
  const requestPayload: HermesRespondRequest = {
    userId: input.userId,
    threadId: input.threadId,
    channel: input.channel,
    message: input.message,
    requestMode: input.requestMode,
    orchestrationMode: "local_only",
    toolAllowlist,
    toolCatalog,
    availableSkills,
    skillPolicy: {
      allowRuntimeSkillCreation: true,
      requireAdminApprovalForGlobalSkills: true,
    },
    memoryMode: "read_write",
    autoExecutionPolicy: input.autoExecutionPolicy || {
      allowAdvisoryJobs: true,
      allowRiskyActions: false,
    },
    confirmationPolicy: input.confirmationPolicy || {
      requireExplicitConfirmation: true,
      preferredChannel: input.channel,
    },
    profile: {
      displayName: input.profile.displayName,
      providerMode: input.profile.providerMode as HermesRespondRequest["profile"]["providerMode"],
      model: input.profile.model,
      baseUrl: input.profile.baseUrl,
      systemPrompt: input.profile.systemPrompt,
      userPromptTemplate: input.profile.userPromptTemplate,
      temperature: resolveProfileTemperature(input.profile),
      maxTokens: input.profile.maxTokens,
    },
    modelRuntime,
    canonicalState: {
      threadId: input.threadId,
      pendingBundleId: null,
      operatorOverview: input.context.operatorOverview,
      capabilities: input.capabilities,
    },
    memoryContext: input.memoryContext,
    externalContext: {
      canonicalKnowledge: input.context.knowledgeBrief,
      research: input.externalResearch || [],
    },
    conversationHistory: input.conversationHistory || [],
    semanticRouteHint: input.semanticRouteHint || null,
  };

  const startedAt = Date.now();
  try {
    const localResult = await runHermesOrchestrationTurn({
      userId: input.userId,
      profile: input.profile,
      secret: input.secret,
      context: input.context,
      request: requestPayload,
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
    await logRuntimeSession({
      userId: input.userId,
      threadId: input.threadId,
      status: normalized.outcome,
      requestPayload,
      responsePayload: normalized,
      toolTrace: normalized.toolTrace,
      latencyMs: Math.max(0, Date.now() - startedAt),
    });

    return normalized;
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
    });

    await logRuntimeSession({
      userId: input.userId,
      threadId: input.threadId,
      status: "failed",
      requestPayload,
      responsePayload: failedResult,
      toolTrace: failedResult.toolTrace,
      latencyMs: Math.max(0, Date.now() - startedAt),
    });

    return failedResult;
  }
}

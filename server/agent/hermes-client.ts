import { agentRuntimeSessions, type UserAgentProfile, type UserAgentSecret } from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { decryptText } from "../lib/encryption";
import { getManagedProviderRuntimeConfig } from "./provider-registry";
import { buildHermesInternalHeaders } from "./internal-auth";
import { runHermesOrchestrationTurn } from "./hermes-orchestrator";
import { getAgentToolCatalog } from "./hermes-tools";
import { listAvailableAgentSkills } from "./skills";
import { getActiveManagedProviderSelection } from "./system-settings";
import type {
  AgentChannel,
  AgentModelRuntimeConfig,
  AgentSemanticRoute,
  HermesRespondRequest,
  HermesRespondResult,
  ScoutAgentContext,
} from "./types";

const DEFAULT_HERMES_TIMEOUT_MS = 20_000;

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
  phase: z.enum(["read", "scan", "plan", "memory", "research"]),
  status: z.enum(["ok", "failed", "skipped"]),
  latencyMs: z.number().finite().min(0),
  summary: z.string().trim().min(1),
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
  requiresConfirmation: z.boolean().optional(),
  confirmationPreview: z.record(z.unknown()).nullable().optional(),
});

function getHermesAgentUrl(): string | null {
  const configured = process.env.HERMES_AGENT_URL?.trim() || "";
  return configured ? configured.replace(/\/+$/, "") : null;
}

function getHermesTimeoutMs(): number {
  const parsed = Number(process.env.HERMES_REQUEST_TIMEOUT_MS || "");
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HERMES_TIMEOUT_MS;
  }

  return Math.max(1_000, Math.min(parsed, 60_000));
}

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
    requiresConfirmation: Boolean(parsed.requiresConfirmation),
    confirmationPreview: (parsed.confirmationPreview ||
      null) as HermesRespondResult["confirmationPreview"],
  };
}

async function readHermesResponsePayload(response: Response): Promise<unknown> {
  const rawBody = await response.text();
  if (!rawBody.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return rawBody;
  }
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
}): Promise<HermesRespondResult> {
  const modelRuntime = await buildModelRuntimeConfig(input.profile, input.secret);
  const availableSkills = await listAvailableAgentSkills(input.userId);
  const requestPayload: HermesRespondRequest = {
    userId: input.userId,
    threadId: input.threadId,
    channel: input.channel,
    message: input.message,
    requestMode: input.requestMode,
    orchestrationMode: "hermes_first",
    toolAllowlist: [
      "get_tool_catalog",
      "get_portfolio_summary",
      "get_operator_overview",
      "get_balance_state",
      "get_holdings",
      "get_daily_boost_state",
      "get_daily_boost_eligibility",
      "get_community_boost_state",
      "get_watchlists",
      "get_pending_bundle",
      "get_canonical_knowledge",
      "get_hosted_research",
      "list_user_memories",
      "list_runtime_skills",
      "scan_daily_boost_candidates",
      "scan_open_boost_slots",
      "scan_scout_opportunities",
      "scan_idle_balance_options",
      "scan_portfolio_cleanup_levers",
      "scan_watchlist_targets",
      "scan_community_boost_candidates",
      "scan_news_impact",
      "scan_top_market_opportunities",
      "preview_direct_operation",
      "preview_multi_action_bundle",
      "stage_action_bundle",
      "confirm_pending_bundle",
      "cancel_pending_bundle",
      "create_runtime_skill",
      "archive_runtime_skill",
      "propose_global_pattern",
      "respond_to_user_turn",
    ],
    toolCatalog: getAgentToolCatalog(),
    availableSkills,
    skillPolicy: {
      allowRuntimeSkillCreation: true,
      requireAdminApprovalForGlobalSkills: true,
    },
    memoryMode: "read_write",
    autoExecutionPolicy: {
      allowAdvisoryJobs: true,
      allowRiskyActions: false,
    },
    confirmationPolicy: {
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
      research: [],
    },
    conversationHistory: input.conversationHistory || [],
    semanticRouteHint: input.semanticRouteHint || null,
  };

  const startedAt = Date.now();
  const hermesUrl = getHermesAgentUrl();
  const runLocalFallback = async (
    fallbackReason: string | null,
    externalError?: unknown,
  ): Promise<HermesRespondResult> => {
    const localResult = await runHermesOrchestrationTurn({
      userId: input.userId,
      profile: input.profile,
      secret: input.secret,
      context: input.context,
      request: requestPayload,
    });
    const toolTrace = [...localResult.toolTrace];

    if (fallbackReason) {
      toolTrace.unshift({
        toolName: "external_hermes_fallback",
        phase: "plan",
        status: "failed",
        latencyMs: Math.max(0, Date.now() - startedAt),
        summary: `External Hermes sidecar failed (${fallbackReason}); used the in-process Hermes engine.`,
      });
      console.warn(
        "[Hermes] External sidecar request failed; using the in-process Hermes engine:",
        externalError instanceof Error ? externalError.message : externalError || fallbackReason,
      );
    }

    const fallbackResult: HermesRespondResult = {
      ...localResult,
      toolTrace,
      fallbackUsed: Boolean(fallbackReason),
    };

    await logRuntimeSession({
      userId: input.userId,
      threadId: input.threadId,
      status: fallbackResult.outcome === "error" ? "failed" : fallbackResult.outcome,
      requestPayload,
      responsePayload: fallbackResult,
      toolTrace: fallbackResult.toolTrace,
      latencyMs: Math.max(0, Date.now() - startedAt),
    });

    return fallbackResult;
  };

  if (!hermesUrl) {
    return runLocalFallback(null);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getHermesTimeoutMs());

  try {
    const response = await fetch(`${hermesUrl}/internal/hermes/respond`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...buildHermesInternalHeaders(),
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    const payload = await readHermesResponsePayload(response);
    if (!response.ok) {
      throw new Error(
        payload && typeof payload === "object" && "message" in (payload as Record<string, unknown>)
          ? String((payload as Record<string, unknown>).message)
          : typeof payload === "string" && payload.trim()
            ? `Hermes returned ${response.status}: ${payload.trim()}`
            : `Hermes returned ${response.status}`,
      );
    }

    const normalized = normalizeHermesTurnResponse(payload);
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
    return runLocalFallback(error?.message || "Hermes request failed", error);
  } finally {
    clearTimeout(timeout);
  }
}

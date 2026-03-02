import { agentRuntimeSessions, type UserAgentProfile, type UserAgentSecret } from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { decryptText } from "../lib/encryption";
import { getManagedProviderRuntimeConfig } from "./provider-registry";
import { buildHermesInternalHeaders } from "./internal-auth";
import { runLocalHermesCompatibilityTurn } from "./hermes-local";
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

const hermesResponseSchema = z.object({
  outcome: z.enum(["advisory", "staged_plan", "clarification", "unsupported", "error"]),
  assistantText: z.string().trim().min(1),
  summary: z.string().trim().nullable().optional(),
  warnings: z.array(z.string()).optional(),
  proposedActions: z.array(z.record(z.any())).optional(),
  pendingClarification: z.record(z.any()).nullable().optional(),
  citations: z.array(z.record(z.any())).optional(),
  proposedMemoryWrites: z.array(z.record(z.any())).optional(),
  toolTrace: z.array(z.record(z.any())).optional(),
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
}): Promise<HermesRespondResult> {
  const modelRuntime = await buildModelRuntimeConfig(input.profile, input.secret);
  const requestPayload: HermesRespondRequest = {
    userId: input.userId,
    threadId: input.threadId,
    channel: input.channel,
    message: input.message,
    requestMode: input.requestMode,
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

  if (!hermesUrl) {
    const localResult = await runLocalHermesCompatibilityTurn({
      userId: input.userId,
      profile: input.profile,
      secret: input.secret,
      context: input.context,
      chatRequest: input.message,
      semanticRouteHint: input.semanticRouteHint,
      conversationHistory: input.conversationHistory,
      requestedMode: input.requestMode,
    });

    await logRuntimeSession({
      userId: input.userId,
      threadId: input.threadId,
      status: localResult.outcome,
      requestPayload,
      responsePayload: localResult,
      toolTrace: localResult.toolTrace,
      latencyMs: Math.max(0, Date.now() - startedAt),
    });

    return localResult;
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

    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(
        payload && typeof payload === "object" && "message" in (payload as Record<string, unknown>)
          ? String((payload as Record<string, unknown>).message)
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
    await logRuntimeSession({
      userId: input.userId,
      threadId: input.threadId,
      status: "error",
      requestPayload,
      responsePayload: {
        message: error?.message || "Hermes request failed",
      },
      toolTrace: [],
      latencyMs: Math.max(0, Date.now() - startedAt),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

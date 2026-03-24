import crypto from "node:crypto";
import { HERMES_CORRELATION_HEADER, buildHermesInternalHeaders } from "./internal-auth";
import { runHermesAgentTurn, normalizeHermesTurnResponse } from "./hermes-client";
import { buildHermesTurnRequest } from "./runtime-adapter";
import { logHermesRuntimeSession } from "./runtime-session-logger";
import type { HermesRespondRequest, HermesRespondResult, HermesRuntimeTurnInput } from "./types";
import { isHermesSidecarMode } from "../service-role";

type HermesRuntimeTransport = "local" | "sidecar";
type HermesRuntimeMode = "local_only" | "sidecar_required";

export interface HermesRuntimeAdapter {
  name: HermesRuntimeTransport;
  runTurn(input: HermesRuntimeTurnInput): Promise<HermesRespondResult>;
}

function getConfiguredHermesSidecarUrl(): string | null {
  const configured = (process.env.HERMES_AGENT_URL || "").trim();
  return configured || null;
}

function getHermesRequestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.HERMES_REQUEST_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20_000;
}

function resolveHermesRuntimeMode(): HermesRuntimeMode {
  if (isHermesSidecarMode()) {
    return "local_only";
  }

  const configured = (process.env.HERMES_RUNTIME_MODE || "").trim().toLowerCase();
  if (configured === "local_only") {
    return "local_only";
  }
  if (configured === "sidecar_required") {
    return "sidecar_required";
  }

  return getConfiguredHermesSidecarUrl() ? "sidecar_required" : "local_only";
}

export function resolveHermesRuntimeTransport(): HermesRuntimeTransport {
  return resolveHermesRuntimeMode() === "sidecar_required" ? "sidecar" : "local";
}

function withBaseUrlSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildSidecarEndpoint(baseUrl: string): string {
  return new URL("./internal/hermes/respond", withBaseUrlSlash(baseUrl)).toString();
}

function buildSidecarRequestBody(requestPayload: HermesRespondRequest) {
  return {
    userId: requestPayload.userId,
    channel: requestPayload.channel,
    message: requestPayload.message,
    requestMode: requestPayload.requestMode,
    orchestrationMode: requestPayload.orchestrationMode || "hermes_first",
    toolAllowlist: requestPayload.toolAllowlist,
    toolCatalog: requestPayload.toolCatalog,
    availableSkills: requestPayload.availableSkills,
    skillPolicy: requestPayload.skillPolicy,
    memoryMode: requestPayload.memoryMode,
    autoExecutionPolicy: requestPayload.autoExecutionPolicy,
    confirmationPolicy: requestPayload.confirmationPolicy,
    canonicalState: requestPayload.canonicalState,
    memoryContext: requestPayload.memoryContext,
    externalContext: {
      canonicalKnowledge: requestPayload.externalContext.canonicalKnowledge,
      research: requestPayload.externalContext.research,
    },
    continuityState: requestPayload.continuityState || null,
    conversationHistory: requestPayload.conversationHistory,
    semanticRouteHint: requestPayload.semanticRouteHint || null,
    conversationMode: requestPayload.conversationMode || null,
    strategyContext: requestPayload.strategyContext || null,
    triggerContext: requestPayload.triggerContext || null,
    executionContext: requestPayload.executionContext || null,
  };
}

function prependRuntimeTrace(input: {
  result: HermesRespondResult;
  transport: HermesRuntimeTransport;
  latencyMs: number;
  summary: string;
  details?: Record<string, unknown> | null;
}): HermesRespondResult {
  return {
    ...input.result,
    toolTrace: [
      {
        toolName:
          input.transport === "sidecar"
            ? "hermes_orchestrator_sidecar"
            : "hermes_orchestrator_local",
        phase: "plan",
        status: input.result.outcome === "error" ? "failed" : "ok",
        latencyMs: input.latencyMs,
        summary: input.summary,
        details: input.details || null,
      },
      ...input.result.toolTrace,
    ],
  };
}

const localHermesRuntimeAdapter: HermesRuntimeAdapter = {
  name: "local",
  async runTurn(input) {
    return runHermesAgentTurn(input);
  },
};

const sidecarHermesRuntimeAdapter: HermesRuntimeAdapter = {
  name: "sidecar",
  async runTurn(input) {
    const runtimeMode = resolveHermesRuntimeMode();
    const sidecarUrl = getConfiguredHermesSidecarUrl();
    if (!sidecarUrl) {
      if (runtimeMode === "sidecar_required") {
        const requestPayload = await buildHermesTurnRequest({
          ...input,
          orchestrationMode: "hermes_first",
        });
        const failedResult = prependRuntimeTrace({
          result: normalizeHermesTurnResponse({
            outcome: "error",
            assistantText:
              "Hermes sidecar mode is required, but HERMES_AGENT_URL is not configured.",
            summary: null,
            warnings: [],
            proposedActions: [],
            pendingClarification: null,
            citations: [],
            proposedMemoryWrites: [],
            toolTrace: [],
            toolCallsUsed: [],
            skillsUsed: [],
            createdSkillCandidates: [],
            skillMatchRationale: null,
            fallbackUsed: false,
            terminationReason: "sidecar_not_configured",
            compressionApplied: false,
            repairAttempts: 0,
            providerFailureClass: "unknown",
            memoryInfluences: [],
            requiresConfirmation: false,
            confirmationPreview: null,
          }),
          transport: "sidecar",
          latencyMs: 0,
          summary: "Hermes sidecar execution was required, but no sidecar URL was configured.",
        });
        const runtimeMetadata = await logHermesRuntimeSession({
          userId: input.userId,
          threadId: input.threadId,
          status: "failed",
          requestPayload,
          responsePayload: failedResult,
          toolTrace: failedResult.toolTrace,
          latencyMs: 0,
          transport: "sidecar",
          executionKind: input.executionContext?.kind || null,
          triggerSource: input.triggerContext?.source || null,
          strategyId: input.strategyContext?.strategyId || null,
        });

        return {
          ...failedResult,
          runtimeMetadata,
        };
      }

      return localHermesRuntimeAdapter.runTurn(input);
    }

    const requestPayload = await buildHermesTurnRequest({
      ...input,
      orchestrationMode: "hermes_first",
    });
    const startedAt = Date.now();
    const endpoint = buildSidecarEndpoint(sidecarUrl);
    const correlationId = crypto.randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getHermesRequestTimeoutMs());

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildHermesInternalHeaders(),
          [HERMES_CORRELATION_HEADER]: correlationId,
        },
        body: JSON.stringify(buildSidecarRequestBody(requestPayload)),
        signal: controller.signal,
      });

      const responseCorrelationId =
        response.headers.get(HERMES_CORRELATION_HEADER)?.trim() || correlationId;
      const responseText = await response.text();
      const responseJson = responseText ? JSON.parse(responseText) : {};
      if (!response.ok) {
        throw new Error(
          typeof responseJson?.message === "string"
            ? responseJson.message
            : `Hermes sidecar request failed with ${response.status}`,
        );
      }

      const normalized = prependRuntimeTrace({
        result: normalizeHermesTurnResponse(responseJson),
        transport: "sidecar",
        latencyMs: Math.max(0, Date.now() - startedAt),
        summary: "The Hermes turn executed through the configured sidecar transport.",
        details: {
          endpoint,
          orchestrationMode: requestPayload.orchestrationMode,
        },
      });

      const runtimeMetadata = await logHermesRuntimeSession({
        userId: input.userId,
        threadId: input.threadId,
        status: normalized.outcome,
        requestPayload,
        responsePayload: normalized,
        toolTrace: normalized.toolTrace,
        latencyMs: Math.max(0, Date.now() - startedAt),
        transport: "sidecar",
        endpoint,
        executionKind: input.executionContext?.kind || null,
        triggerSource: input.triggerContext?.source || null,
        strategyId: input.strategyContext?.strategyId || null,
        correlationId: responseCorrelationId,
      });

      return {
        ...normalized,
        runtimeMetadata,
      };
    } catch (error: any) {
      const failedResult = prependRuntimeTrace({
        result: normalizeHermesTurnResponse({
          outcome: "error",
          assistantText:
            error?.name === "AbortError"
              ? "Hermes sidecar timed out."
              : error?.message || "Hermes sidecar request failed.",
          summary: null,
          warnings: [],
          proposedActions: [],
          pendingClarification: null,
          citations: [],
          proposedMemoryWrites: [],
          toolTrace: [],
          toolCallsUsed: [],
          skillsUsed: [],
          createdSkillCandidates: [],
          skillMatchRationale: null,
          fallbackUsed: false,
          terminationReason: error?.name === "AbortError" ? "sidecar_timeout" : "sidecar_exception",
          compressionApplied: false,
          repairAttempts: 0,
          providerFailureClass: "unknown",
          memoryInfluences: [],
          requiresConfirmation: false,
          confirmationPreview: null,
        }),
        transport: "sidecar",
        latencyMs: Math.max(0, Date.now() - startedAt),
        summary:
          error?.name === "AbortError"
            ? "The Hermes sidecar did not respond before the configured timeout."
            : error?.message || "The Hermes sidecar request failed.",
        details: {
          endpoint,
          orchestrationMode: requestPayload.orchestrationMode,
        },
      });

      const runtimeMetadata = await logHermesRuntimeSession({
        userId: input.userId,
        threadId: input.threadId,
        status: "failed",
        requestPayload,
        responsePayload: failedResult,
        toolTrace: failedResult.toolTrace,
        latencyMs: Math.max(0, Date.now() - startedAt),
        transport: "sidecar",
        endpoint,
        executionKind: input.executionContext?.kind || null,
        triggerSource: input.triggerContext?.source || null,
        strategyId: input.strategyContext?.strategyId || null,
        correlationId,
      });

      return {
        ...failedResult,
        runtimeMetadata,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

export function getHermesRuntimeAdapter(): HermesRuntimeAdapter {
  return resolveHermesRuntimeTransport() === "sidecar"
    ? sidecarHermesRuntimeAdapter
    : localHermesRuntimeAdapter;
}

export async function runHermesRuntimeTurn(
  input: HermesRuntimeTurnInput,
): Promise<HermesRespondResult> {
  return getHermesRuntimeAdapter().runTurn(input);
}

export const __runtimeEngine = {
  buildSidecarEndpoint,
  buildSidecarRequestBody,
  resolveHermesRuntimeMode,
  resolveHermesRuntimeTransport,
};

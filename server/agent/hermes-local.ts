import type { UserAgentProfile, UserAgentSecret } from "@shared/schema";
import { decryptText } from "../lib/encryption";
import { resolveAgentRequestModeWithFallback } from "./intent-router";
import { validateScoutPlanAgainstContext } from "./policy-engine";
import {
  normalizeOpenAICompatibleBaseUrl,
  resolveManagedPiRuntime,
  resolveOpenAICompatiblePiRuntime,
} from "./pi-provider";
import { runScoutDiscussionTurn, runScoutPlanningTurn } from "./scout-agent-core";
import { inferMemoryWritesFromMessage } from "./memory";
import type {
  AgentSemanticRoute,
  HermesRespondRequest,
  HermesRespondResult,
  ScoutAgentContext,
} from "./types";

function resolveAnalysisTemperature(profile: UserAgentProfile): number {
  const parsed = Number(profile.temperature);
  if (!Number.isFinite(parsed)) {
    return 0.4;
  }

  return Math.max(0, Math.min(parsed, 1));
}

function resolveAnalysisMaxTokens(profile: UserAgentProfile): number {
  if (!Number.isFinite(profile.maxTokens)) {
    return 512;
  }

  return Math.max(200, Math.min(profile.maxTokens, 4000));
}

function safeInferMemoryWrites(message: string) {
  try {
    return inferMemoryWritesFromMessage(message);
  } catch {
    return [];
  }
}

async function resolveLocalCompatibilityRuntime(
  profile: UserAgentProfile,
  secret: UserAgentSecret | undefined,
) {
  if (profile.providerMode === "byok") {
    if (!secret) {
      throw new Error("BYOK is selected but no API key is configured");
    }
    if (!profile.baseUrl) {
      throw new Error("BYOK is selected but no base URL is configured");
    }

    const apiKey = decryptText({
      ciphertext: secret.apiKeyCiphertext,
      iv: secret.apiKeyIv,
      authTag: secret.apiKeyAuthTag,
    });

    return resolveOpenAICompatiblePiRuntime({
      apiKey,
      baseUrl: normalizeOpenAICompatibleBaseUrl(profile.baseUrl),
      model: profile.model,
    });
  }

  return resolveManagedPiRuntime({
    model: profile.model,
  });
}

export async function runLocalHermesCompatibilityTurn(input: {
  userId: string;
  channel?: HermesRespondRequest["channel"];
  profile: UserAgentProfile;
  secret?: UserAgentSecret;
  context: ScoutAgentContext;
  chatRequest: string;
  semanticRouteHint?: AgentSemanticRoute | null;
  conversationHistory?: HermesRespondRequest["conversationHistory"];
  requestedMode?: HermesRespondRequest["requestMode"];
}): Promise<HermesRespondResult> {
  const toolTrace: HermesRespondResult["toolTrace"] = [];
  const startedAt = Date.now();
  const channel = input.channel || "in_app";

  try {
    const memoryWrites = safeInferMemoryWrites(input.chatRequest);
    const runtime = await resolveLocalCompatibilityRuntime(input.profile, input.secret);
    const modeResolution =
      input.requestedMode &&
      input.requestedMode !== "clarification_resume" &&
      input.requestedMode !== "auto"
        ? {
            mode: input.requestedMode === "plan" ? "commit" : "discussion",
            source: "caller" as const,
            heuristicMode: null,
            heuristicConfidence: null,
            classifierLabel: null,
          }
        : await resolveAgentRequestModeWithFallback({
            runtime,
            message: input.chatRequest,
            semanticRoute: input.semanticRouteHint || null,
            conversationHistory: input.conversationHistory,
          });

    toolTrace.push({
      toolName: "local_compatibility_mode_resolution",
      phase: "plan",
      status: "ok",
      latencyMs: Date.now() - startedAt,
      summary: `Resolved ${modeResolution.mode} mode via ${modeResolution.source} for ${channel}.`,
    });

    const temperature = resolveAnalysisTemperature(input.profile);
    const maxTokens = resolveAnalysisMaxTokens(input.profile);

    if (modeResolution.mode === "discussion") {
      const discussionResult = await runScoutDiscussionTurn({
        runtime,
        context: input.context,
        chatRequest: input.chatRequest,
        semanticRouteHint: input.semanticRouteHint,
        conversationHistory: input.conversationHistory,
        operatorPlaybook: input.profile.systemPrompt,
        strategyTemplate: input.profile.userPromptTemplate,
        temperature,
        maxTokens,
      });

      toolTrace.push({
        toolName: "local_compatibility_discussion",
        phase: "plan",
        status: "ok",
        latencyMs: Math.max(0, Date.now() - startedAt),
        summary: `Used the in-process compatibility bridge for ${channel} while the external Hermes service is not configured.`,
      });

      return {
        outcome: discussionResult.replyText ? "advisory" : "unsupported",
        assistantText:
          discussionResult.replyText ||
          discussionResult.summary ||
          "I could not complete that request.",
        summary: discussionResult.summary,
        warnings: discussionResult.warnings,
        proposedActions: [],
        pendingClarification: null,
        citations: discussionResult.citations || [],
        proposedMemoryWrites: memoryWrites,
        toolTrace,
      };
    }

    const planningResult = await runScoutPlanningTurn({
      runtime,
      context: input.context,
      chatRequest: input.chatRequest,
      semanticRouteHint: input.semanticRouteHint,
      conversationHistory: input.conversationHistory,
      operatorPlaybook: input.profile.systemPrompt,
      strategyTemplate: input.profile.userPromptTemplate,
      temperature,
      maxTokens,
    });
    const validated = validateScoutPlanAgainstContext(planningResult.output, input.context);

    toolTrace.push({
      toolName: "local_compatibility_planning",
      phase: "plan",
      status: "ok",
      latencyMs: Math.max(0, Date.now() - startedAt),
      summary: `Validated ${validated.actions.length} scout action(s) for ${channel} through the compatibility bridge.`,
    });

    return {
      outcome:
        validated.actions.length > 0
          ? "staged_plan"
          : validated.replyText
            ? "advisory"
            : "unsupported",
      assistantText:
        validated.replyText || validated.summary || "I could not build a plan from that request.",
      summary: validated.summary,
      warnings: validated.warnings,
      proposedActions: validated.actions,
      pendingClarification: null,
      citations: planningResult.citations || [],
      proposedMemoryWrites: memoryWrites,
      toolTrace,
    };
  } catch (error: any) {
    const memoryWrites = safeInferMemoryWrites(input.chatRequest);
    toolTrace.push({
      toolName: "local_compatibility_bridge",
      phase: "plan",
      status: "failed",
      latencyMs: Math.max(0, Date.now() - startedAt),
      summary: error?.message || "Local Hermes compatibility bridge failed.",
    });

    return {
      outcome: "error",
      assistantText: error?.message || "Hermes orchestration failed.",
      summary: null,
      warnings: [],
      proposedActions: [],
      pendingClarification: null,
      citations: [],
      proposedMemoryWrites: memoryWrites,
      toolTrace,
    };
  }
}

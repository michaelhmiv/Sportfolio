import type { UserAgentProfile, UserAgentSecret } from "@shared/schema";
import { decryptText } from "../lib/encryption";
import { getManagedProviderRuntimeConfig } from "./provider-registry";
import { listAvailableAgentSkills } from "./skills";
import { getActiveManagedProviderSelection } from "./system-settings";
import { getAgentRuntimeToolCatalog } from "./hermes-tools";
import type {
  AgentModelRuntimeConfig,
  AgentToolDefinition,
  HermesRespondRequest,
  HermesRuntimeTurnInput,
} from "./types";

export function buildDefaultHermesToolAllowlist(toolCatalog: AgentToolDefinition[]): string[] {
  return [
    ...new Set(
      toolCatalog
        .filter(
          (entry) => entry.exposure !== "hidden_fallback" && entry.exposure !== "internal_only",
        )
        .map((entry) => entry.toolName),
    ),
  ];
}

function isStrategyConversationMode(
  mode: HermesRuntimeTurnInput["conversationMode"] | HermesRespondRequest["conversationMode"],
) {
  return (
    mode === "strategy_builder" || mode === "strategy_refinement" || mode === "strategy_review"
  );
}

function normalizeMessage(message: string) {
  return message.trim().toLowerCase();
}

function hasAnyKeyword(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message));
}

function isScheduleIntent(message: string) {
  return hasAnyKeyword(message, [
    /\bschedule\b/,
    /\brecurring\b/,
    /\bdaily setup review\b/,
    /\bpre-lock\b/,
    /\binjury watch\b/,
    /\bidle balance nudge\b/,
    /\bboost window\b/,
    /\bcheck[- ]?in\b/,
    /\bremind me\b/,
  ]);
}

function isMemoryIntent(message: string) {
  return hasAnyKeyword(message, [
    /\bremember\b/,
    /\bmemory\b/,
    /\bforget\b/,
    /\bpreference\b/,
    /\brisk tolerance\b/,
    /\binteraction style\b/,
  ]);
}

function isSkillIntent(message: string) {
  return hasAnyKeyword(message, [/\bskill\b/, /\bworkflow\b/, /\blearned\b/, /\breuse\b/]);
}

function isWatchlistIntent(message: string) {
  return /\bwatchlist\b/.test(message);
}

function isMlbEnrichmentIntent(message: string) {
  return hasAnyKeyword(message, [
    /\bmlb\b/,
    /\bbaseball\b/,
    /\bprobable pitcher\b/,
    /\bprobable pitchers\b/,
    /\bstatcast\b/,
    /\bbox score\b/,
    /\bbatting order\b/,
    /\blineup\b/,
    /\blineups\b/,
  ]);
}

function isExternalSourceIntent(
  message: string,
  capabilities:
    | HermesRuntimeTurnInput["capabilities"]
    | HermesRespondRequest["canonicalState"]["capabilities"],
) {
  const enabledExternalSources =
    capabilities.dataSources?.external.filter((source) => source.enabled && source.available) || [];

  if (enabledExternalSources.length === 0) {
    return false;
  }

  if (
    hasAnyKeyword(message, [
      /\bexternal\b/,
      /\bmcp\b/,
      /\bprojection\b/,
      /\bprojections\b/,
      /\banalytics\b/,
      /\bcustom feed\b/,
      /\bthird[- ]party\b/,
    ])
  ) {
    return true;
  }

  return enabledExternalSources.some((source) => message.includes(normalizeMessage(source.name)));
}

export function buildScopedHermesToolAllowlist(input: {
  toolCatalog: AgentToolDefinition[];
  message: string;
  capabilities:
    | HermesRuntimeTurnInput["capabilities"]
    | HermesRespondRequest["canonicalState"]["capabilities"];
  conversationMode?:
    | HermesRuntimeTurnInput["conversationMode"]
    | HermesRespondRequest["conversationMode"];
}): string[] {
  const normalizedMessage = normalizeMessage(input.message);
  const strategyMode = isStrategyConversationMode(input.conversationMode || null);
  const includeSchedules = strategyMode || isScheduleIntent(normalizedMessage);
  const includeMemories = isMemoryIntent(normalizedMessage);
  const includeSkills = strategyMode || isSkillIntent(normalizedMessage);
  const includeWatchlistAdmin = isWatchlistIntent(normalizedMessage);
  const includeExternalSources =
    strategyMode || isExternalSourceIntent(normalizedMessage, input.capabilities);
  const includeMlbEnrichment = strategyMode || isMlbEnrichmentIntent(normalizedMessage);

  return [
    ...new Set(
      input.toolCatalog
        .filter((entry) => {
          const exposure = entry.exposure || "default";
          if (exposure === "hidden_fallback" || exposure === "internal_only") {
            return false;
          }

          if (exposure === "default") {
            return true;
          }

          if (entry.toolName === "query_external_source") {
            return includeExternalSources;
          }

          if (
            entry.toolName === "get_user_schedules" ||
            entry.toolName === "get_schedule_templates" ||
            entry.toolName === "upsert_user_schedule" ||
            entry.toolName === "delete_user_schedule"
          ) {
            return includeSchedules;
          }

          if (
            entry.toolName === "list_user_memories" ||
            entry.toolName === "search_user_memories" ||
            entry.toolName === "get_user_memory_context"
          ) {
            return includeMemories;
          }

          if (entry.toolName === "list_runtime_skills") {
            return includeSkills;
          }

          if (
            entry.toolName === "create_watchlist" ||
            entry.toolName === "update_watchlist" ||
            entry.toolName === "delete_watchlist"
          ) {
            return includeWatchlistAdmin;
          }

          if (entry.toolName.startsWith("mlb_mcp__")) {
            return includeMlbEnrichment;
          }

          return strategyMode;
        })
        .map((entry) => entry.toolName),
    ),
  ];
}

function resolveProfileTemperature(profile: UserAgentProfile): number {
  const parsed = Number(profile.temperature);
  if (!Number.isFinite(parsed)) {
    return 0.4;
  }

  return Math.max(0, Math.min(parsed, 1));
}

export async function buildAgentModelRuntimeConfig(
  profile: UserAgentProfile,
  secret?: UserAgentSecret,
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

export async function buildHermesTurnRequest(
  input: HermesRuntimeTurnInput & {
    orchestrationMode?: HermesRespondRequest["orchestrationMode"];
  },
): Promise<HermesRespondRequest> {
  const toolCatalog =
    input.toolCatalog ||
    (await getAgentRuntimeToolCatalog({
      includeInternalMlbMcp: input.profile.internalMlbMcpEnabled,
    }));
  const availableSkills = input.availableSkills || (await listAvailableAgentSkills(input.userId));
  const modelRuntime =
    input.modelRuntime || (await buildAgentModelRuntimeConfig(input.profile, input.secret));

  return {
    userId: input.userId,
    threadId: input.threadId,
    channel: input.channel,
    message: input.message,
    requestMode: input.requestMode,
    orchestrationMode: input.orchestrationMode || "local_only",
    toolAllowlist:
      input.toolAllowlist && input.toolAllowlist.length > 0
        ? input.toolAllowlist
        : buildScopedHermesToolAllowlist({
            toolCatalog,
            message: input.message,
            capabilities: input.capabilities,
            conversationMode: input.conversationMode || null,
          }),
    toolCatalog,
    availableSkills,
    skillPolicy: input.skillPolicy || {
      allowRuntimeSkillCreation: true,
      requireAdminApprovalForGlobalSkills: true,
    },
    memoryMode: input.memoryMode || "read_write",
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
      pendingBundleId: input.pendingBundleId || null,
      operatorOverview: input.context.operatorOverview,
      capabilities: input.capabilities,
    },
    memoryContext: input.memoryContext,
    externalContext: {
      canonicalKnowledge: input.canonicalKnowledge || input.context.knowledgeBrief,
      research: input.externalResearch || [],
    },
    continuityState: input.continuityState || null,
    conversationHistory: input.conversationHistory || [],
    semanticRouteHint: input.semanticRouteHint || null,
    conversationMode: input.conversationMode || null,
    strategyContext: input.strategyContext || null,
    triggerContext: input.triggerContext || null,
    executionContext: input.executionContext || null,
  };
}

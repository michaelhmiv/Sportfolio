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
        : buildDefaultHermesToolAllowlist(toolCatalog),
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
    turnBudgetProfile: input.turnBudgetProfile || "default",
  };
}

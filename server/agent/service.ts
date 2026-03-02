import {
  userAgentProfiles,
  userAgentSecrets,
  userAgentRuns,
  userAgentProposals,
  players,
  updateUserAgentProfileInputSchema,
  userAgentByokInputSchema,
  type UserAgentProfile,
  type UserAgentSecret,
} from "@shared/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { encryptText, getEncryptionVersion } from "../lib/encryption";
import { loadScoutAgentContext } from "./context-loader";
import { executeScoutProposalActions } from "./executor";
import { runHermesAgentTurn } from "./hermes-client";
import { buildHermesMemoryContext, persistProposedMemoryWrites } from "./memory";
import { planDirectAgentOperation } from "./operations-planner";
import { normalizeOpenAICompatibleBaseUrl } from "./pi-provider";
import { getManagedProviderStatus } from "./provider-registry";
import { isHostedWebResearchAvailable, planHostedWebResearch } from "./research";
import { getActiveManagedProviderSelection } from "./system-settings";
import { MANAGED_MODEL_PLACEHOLDER } from "./types";
import type {
  AgentAnalysisResult,
  AgentCapabilitiesView,
  AgentProfileView,
  AgentSecretMetadata,
  AgentSemanticRoute,
  ManagedProviderStatus,
  ScoutProposalAction,
} from "./types";

const analyzeScoutAgentInputSchema = z
  .object({
    message: z.string().trim().min(1).max(2000).optional(),
    threadId: z.string().trim().min(1).max(120).optional(),
    mode: z.enum(["discussion", "commit"]).optional(),
    semanticRouteHint: z
      .enum(["top_targets_today", "single_adjustment", "review_setup", "general_scouting"])
      .optional(),
    conversationHistory: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          contentText: z.string().trim().min(1).max(4000),
        }),
      )
      .max(12)
      .optional(),
  })
  .strict();

const STALE_PENDING_RUN_TIMEOUT_MS = 90_000;
const MAX_AGENT_ANALYSES_PER_HOUR = 60;
const SUPPORTED_AGENT_DOMAINS: AgentCapabilitiesView["domains"] = [
  "scouting",
  "player_pools",
  "daily_boosts",
  "community_boosts",
  "watchlists",
  "vesting",
  "sportfolio",
];
const SUPPORTED_AGENT_ACTION_TYPES: AgentCapabilitiesView["actionTypes"] = [
  "scout_set_count",
  "pool_buy",
  "pool_sell",
  "pool_add_liquidity",
  "pool_add_liquidity_optimal",
  "pool_zap_add_shares",
  "pool_zap_add_sb",
  "pool_remove_liquidity",
  "holdings_condense",
  "daily_boost_assign",
  "daily_boost_remove",
  "watchlist_add_player",
  "watchlist_remove_player",
  "community_boost_create",
  "vesting_claim",
];

type AgentRunOutcomeCategory =
  | "staged_plan"
  | "advisory_only"
  | "blocked_clarification"
  | "blocked_unavailable"
  | "research_only"
  | "failed";

function toSecretMetadata(secret?: UserAgentSecret): AgentSecretMetadata {
  return {
    configured: Boolean(secret),
    keyLast4: secret?.keyLast4 || null,
    updatedAt: secret?.updatedAt || null,
  };
}

async function getActiveManagedProviderStatus(): Promise<ManagedProviderStatus> {
  const selection = await getActiveManagedProviderSelection();
  const provider = getManagedProviderStatus(selection.provider);

  return {
    ...provider,
    defaultModel: selection.modelOverride || provider.defaultModel,
  };
}

function buildCapabilities(
  profile: UserAgentProfile,
  managedProvider: ManagedProviderStatus,
  secret?: UserAgentSecret,
) {
  const canAnalyze =
    profile.providerMode === "managed"
      ? managedProvider.configured && Boolean(managedProvider.defaultModel)
      : Boolean(secret && profile.baseUrl && profile.model);

  return {
    canAnalyze,
    canAutoExecute: false,
    canUseWebResearch: isHostedWebResearchAvailable(),
    webResearchProvider: isHostedWebResearchAvailable() ? ("brave" as const) : null,
    runtime: "hermes" as const,
    hasDurableMemory: true,
    canScheduleAdvisories: true,
  };
}

function toNumberString(value: number, digits: number): string {
  return value.toFixed(digits);
}

function classifyAgentRunOutcome(input: {
  actions?: Array<{ actionType: string }> | null;
  pendingClarification?: unknown;
  citations?: Array<unknown> | null;
  summary?: string | null;
  replyText?: string | null;
  errorMessage?: string | null;
}): AgentRunOutcomeCategory {
  if (input.errorMessage) {
    return "failed";
  }

  if (input.pendingClarification) {
    return "blocked_clarification";
  }

  if ((input.actions?.length || 0) > 0) {
    return "staged_plan";
  }

  if ((input.citations?.length || 0) > 0) {
    return "research_only";
  }

  const lowerSignal = `${input.summary || ""} ${input.replyText || ""}`.toLowerCase();
  if (
    /\b(?:i do not|i don't|cannot|can't|could not|couldn't|did not|no\s+\w+|not available|not supported|need a clearer|there are no)\b/.test(
      lowerSignal,
    )
  ) {
    return "blocked_unavailable";
  }

  return "advisory_only";
}

function attachOutcomeCategoryToTrace(
  trace: Record<string, unknown> | null | undefined,
  outcomeCategory: AgentRunOutcomeCategory,
): Record<string, unknown> {
  if (!trace) {
    return { outcomeCategory };
  }

  return {
    ...trace,
    outcomeCategory,
  };
}

function mapProposalRowToAction(
  row: typeof userAgentProposals.$inferSelect & {
    playerName?: string | null;
  },
): ScoutProposalAction {
  const evidence =
    row.evidence && typeof row.evidence === "object"
      ? (row.evidence as Record<string, string | null>)
      : {
          trend: null,
          injury: null,
          upcomingGame: null,
          performanceNote: null,
        };
  const riskFlags =
    row.riskFlags && Array.isArray(row.riskFlags)
      ? row.riskFlags.filter((entry): entry is string => typeof entry === "string")
      : [];

  return {
    actionType: "scout_set_count",
    playerId: row.playerId || "",
    playerName: row.playerName || undefined,
    status: row.status,
    targetCount: row.targetCount || 0,
    currentCount: row.currentCount || 0,
    reasoning: row.reasoning,
    confidence: Number(row.confidence || "0"),
    evidence,
    riskFlags,
  };
}

async function getSecret(userId: string): Promise<UserAgentSecret | undefined> {
  const [secret] = await db
    .select()
    .from(userAgentSecrets)
    .where(eq(userAgentSecrets.userId, userId))
    .limit(1);

  return secret || undefined;
}

async function ensureProfile(
  userId: string,
  managedProvider: ManagedProviderStatus,
): Promise<UserAgentProfile> {
  await db
    .insert(userAgentProfiles)
    .values({
      userId,
      runtime: "hermes",
      model: managedProvider.defaultModel || MANAGED_MODEL_PLACEHOLDER,
    })
    .onConflictDoNothing({ target: userAgentProfiles.userId });

  const [profile] = await db
    .select()
    .from(userAgentProfiles)
    .where(eq(userAgentProfiles.userId, userId))
    .limit(1);

  if (!profile) {
    throw new Error("Failed to initialize agent profile");
  }

  if (
    profile.providerMode === "managed" &&
    managedProvider.defaultModel &&
    profile.model !== managedProvider.defaultModel
  ) {
    const migratedModel = managedProvider.defaultModel || MANAGED_MODEL_PLACEHOLDER;
    const nextUpdatedAt = new Date();

    await db
      .update(userAgentProfiles)
      .set({
        runtime: "hermes",
        model: migratedModel,
        updatedAt: nextUpdatedAt,
      })
      .where(eq(userAgentProfiles.id, profile.id));

    return {
      ...profile,
      runtime: "hermes",
      model: migratedModel,
      updatedAt: nextUpdatedAt,
    };
  }

  if ((profile.runtime || "pi") !== "hermes") {
    const nextUpdatedAt = new Date();

    await db
      .update(userAgentProfiles)
      .set({
        runtime: "hermes",
        updatedAt: nextUpdatedAt,
      })
      .where(eq(userAgentProfiles.id, profile.id));

    return {
      ...profile,
      runtime: "hermes",
      updatedAt: nextUpdatedAt,
    };
  }

  return profile;
}

async function getRunById(userId: string, runId: string) {
  const [run] = await db
    .select()
    .from(userAgentRuns)
    .where(and(eq(userAgentRuns.userId, userId), eq(userAgentRuns.id, runId)))
    .limit(1);

  return run;
}

async function getProposalRowsForRun(userId: string, runId: string) {
  return db
    .select({
      proposal: userAgentProposals,
      playerName: sql<
        string | null
      >`CASE WHEN ${players.id} IS NOT NULL THEN ${players.firstName} || ' ' || ${players.lastName} ELSE NULL END`,
    })
    .from(userAgentProposals)
    .leftJoin(players, eq(userAgentProposals.playerId, players.id))
    .where(and(eq(userAgentProposals.userId, userId), eq(userAgentProposals.runId, runId)))
    .orderBy(desc(userAgentProposals.createdAt));
}

async function expireStalePendingRuns(userId: string) {
  const cutoff = new Date(Date.now() - STALE_PENDING_RUN_TIMEOUT_MS);

  await db
    .update(userAgentRuns)
    .set({
      status: "failed",
      errorMessage: "Agent analysis timed out before completion.",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(userAgentRuns.userId, userId),
        eq(userAgentRuns.status, "pending"),
        lt(userAgentRuns.createdAt, cutoff),
      ),
    );
}

export async function getScoutAgentProfile(userId: string): Promise<AgentProfileView> {
  const [managedProvider, secret] = await Promise.all([
    getActiveManagedProviderStatus(),
    getSecret(userId),
  ]);
  const profile = await ensureProfile(userId, managedProvider);

  return {
    profile,
    secret: toSecretMetadata(secret),
    capabilities: buildCapabilities(profile, managedProvider, secret),
  };
}

export async function getAgentCapabilities(userId: string): Promise<AgentCapabilitiesView> {
  const profileView = await getScoutAgentProfile(userId);

  return {
    domains: SUPPORTED_AGENT_DOMAINS,
    actionTypes: SUPPORTED_AGENT_ACTION_TYPES,
    canAnalyze: profileView.capabilities.canAnalyze,
    canAutoExecute: profileView.capabilities.canAutoExecute,
    canUseWebResearch: profileView.capabilities.canUseWebResearch,
    webResearchProvider: profileView.capabilities.webResearchProvider,
    providerMode: profileView.profile.providerMode as AgentCapabilitiesView["providerMode"],
    runtime: profileView.capabilities.runtime,
    hasDurableMemory: profileView.capabilities.hasDurableMemory,
    canScheduleAdvisories: profileView.capabilities.canScheduleAdvisories,
  };
}

export async function updateScoutAgentProfile(
  userId: string,
  input: unknown,
): Promise<AgentProfileView> {
  const data = updateUserAgentProfileInputSchema.parse(input);
  const managedProvider = await getActiveManagedProviderStatus();
  const profile = await ensureProfile(userId, managedProvider);
  const nextProviderMode = data.providerMode || profile.providerMode;

  const updates: Partial<typeof userAgentProfiles.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.enabled !== undefined) updates.enabled = data.enabled;
  if (data.displayName !== undefined) updates.displayName = data.displayName;
  if (data.providerMode !== undefined) updates.providerMode = data.providerMode;
  if (data.model !== undefined) {
    updates.model =
      nextProviderMode === "managed"
        ? managedProvider.defaultModel || MANAGED_MODEL_PLACEHOLDER
        : data.model;
  } else if (
    nextProviderMode === "managed" &&
    managedProvider.defaultModel &&
    profile.model !== managedProvider.defaultModel
  ) {
    updates.model = managedProvider.defaultModel;
  }
  if (data.systemPrompt !== undefined) updates.systemPrompt = data.systemPrompt;
  if (data.userPromptTemplate !== undefined) updates.userPromptTemplate = data.userPromptTemplate;
  if (data.temperature !== undefined) updates.temperature = toNumberString(data.temperature, 2);
  if (data.maxTokens !== undefined) updates.maxTokens = data.maxTokens;
  if (data.analysisWindowMinutes !== undefined) {
    updates.analysisWindowMinutes = data.analysisWindowMinutes;
  }
  if (data.defaultSport !== undefined) updates.defaultSport = data.defaultSport;

  await db.update(userAgentProfiles).set(updates).where(eq(userAgentProfiles.id, profile.id));

  return getScoutAgentProfile(userId);
}

export async function saveScoutAgentByok(
  userId: string,
  input: unknown,
): Promise<AgentProfileView> {
  const data = userAgentByokInputSchema.parse(input);
  const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(data.baseUrl);
  const encrypted = encryptText(data.apiKey);
  const managedProvider = await getActiveManagedProviderStatus();

  await ensureProfile(userId, managedProvider);

  await db
    .insert(userAgentSecrets)
    .values({
      userId,
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyIv: encrypted.iv,
      apiKeyAuthTag: encrypted.authTag,
      keyLast4: data.apiKey.slice(-4),
      encryptionVersion: getEncryptionVersion(),
      rotatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userAgentSecrets.userId,
      set: {
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
        keyLast4: data.apiKey.slice(-4),
        encryptionVersion: getEncryptionVersion(),
        rotatedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  await db
    .update(userAgentProfiles)
    .set({
      providerMode: "byok",
      providerType: "openai_compatible",
      baseUrl: normalizedBaseUrl,
      model: data.model,
      updatedAt: new Date(),
    })
    .where(eq(userAgentProfiles.userId, userId));

  return getScoutAgentProfile(userId);
}

export async function clearScoutAgentByok(userId: string): Promise<AgentProfileView> {
  const managedProvider = await getActiveManagedProviderStatus();
  await ensureProfile(userId, managedProvider);

  await db.delete(userAgentSecrets).where(eq(userAgentSecrets.userId, userId));
  await db
    .update(userAgentProfiles)
    .set({
      providerMode: "managed",
      baseUrl: null,
      model: managedProvider.defaultModel || MANAGED_MODEL_PLACEHOLDER,
      updatedAt: new Date(),
    })
    .where(eq(userAgentProfiles.userId, userId));

  return getScoutAgentProfile(userId);
}

export async function analyzeScoutAgent(
  userId: string,
  input: unknown = {},
): Promise<AgentAnalysisResult> {
  const data = analyzeScoutAgentInputSchema.parse(input);
  await expireStalePendingRuns(userId);
  const [managedProvider, secret] = await Promise.all([
    getActiveManagedProviderStatus(),
    getSecret(userId),
  ]);
  const profile = await ensureProfile(userId, managedProvider);
  const requestMessage = data.message?.trim() || null;
  const semanticRouteHint = (data.semanticRouteHint as AgentSemanticRoute | undefined) || null;

  const [pendingRun, recentRuns] = await Promise.all([
    db
      .select({ id: userAgentRuns.id })
      .from(userAgentRuns)
      .where(and(eq(userAgentRuns.userId, userId), eq(userAgentRuns.status, "pending")))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userAgentRuns)
      .where(
        and(
          eq(userAgentRuns.userId, userId),
          gte(userAgentRuns.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
        ),
      )
      .limit(1),
  ]);

  if (pendingRun.length > 0) {
    throw new Error("An agent analysis is already running for this user");
  }

  if ((recentRuns[0]?.count || 0) >= MAX_AGENT_ANALYSES_PER_HOUR) {
    throw new Error("Agent analysis rate limit reached. Try again later.");
  }

  if (!profile.enabled) {
    throw new Error("Agent is disabled");
  }

  if (!buildCapabilities(profile, managedProvider, secret).canAnalyze) {
    throw new Error("Agent provider is not fully configured");
  }

  const executionModel =
    profile.providerMode === "managed"
      ? managedProvider.defaultModel || profile.model
      : profile.model;
  const directOperationPlan = requestMessage
    ? await planDirectAgentOperation({
        userId,
        message: requestMessage,
        profile,
      })
    : null;

  if (directOperationPlan) {
    const outcomeCategory = classifyAgentRunOutcome({
      actions: directOperationPlan.actions,
      pendingClarification: directOperationPlan.pendingClarification,
      citations: directOperationPlan.citations,
      summary: directOperationPlan.summary,
      replyText: directOperationPlan.replyText,
      errorMessage: directOperationPlan.errorMessage,
    });
    const [run] = await db
      .insert(userAgentRuns)
      .values({
        userId,
        threadId: data.threadId || null,
        triggerSource: "manual",
        status: "completed",
        providerMode: profile.providerMode,
        model: executionModel,
        contextSnapshot: directOperationPlan.contextSnapshot,
        promptSnapshot: {
          framework: "deterministic-agent-operations",
          requestMessage,
          semanticRouteHint,
          conversationHistory: data.conversationHistory || [],
        },
        rawResponse: {
          trace: attachOutcomeCategoryToTrace(directOperationPlan.trace, outcomeCategory),
          parsed: {
            domain: directOperationPlan.domain,
            replyText: directOperationPlan.replyText,
            summary: directOperationPlan.summary,
            observations: directOperationPlan.observations,
            warnings: directOperationPlan.warnings,
            actions: directOperationPlan.actions,
            citations: directOperationPlan.citations || [],
            pendingClarification: directOperationPlan.pendingClarification || null,
            outcomeCategory,
          },
        },
        parsedSummary: directOperationPlan.summary,
        completedAt: new Date(),
      })
      .returning();

    return {
      runId: run.id,
      status: "completed",
      domain: directOperationPlan.domain,
      requestMessage,
      replyText: directOperationPlan.replyText,
      summary: directOperationPlan.summary,
      observations: directOperationPlan.observations,
      warnings: directOperationPlan.warnings,
      actions: directOperationPlan.actions,
      citations: directOperationPlan.citations || [],
      pendingClarification: directOperationPlan.pendingClarification || null,
      errorMessage: null,
    };
  }

  const hostedResearchPlan = requestMessage
    ? await planHostedWebResearch({
        message: requestMessage,
        profile,
      })
    : null;

  if (hostedResearchPlan) {
    const outcomeCategory = classifyAgentRunOutcome({
      actions: hostedResearchPlan.actions,
      pendingClarification: hostedResearchPlan.pendingClarification,
      citations: hostedResearchPlan.citations,
      summary: hostedResearchPlan.summary,
      replyText: hostedResearchPlan.replyText,
      errorMessage: hostedResearchPlan.errorMessage,
    });
    const [run] = await db
      .insert(userAgentRuns)
      .values({
        userId,
        threadId: data.threadId || null,
        triggerSource: "manual",
        status: "completed",
        providerMode: profile.providerMode,
        model: executionModel,
        contextSnapshot: hostedResearchPlan.contextSnapshot,
        promptSnapshot: {
          framework: "hosted-brave-search",
          requestMessage,
          semanticRouteHint,
          conversationHistory: data.conversationHistory || [],
        },
        rawResponse: {
          trace: attachOutcomeCategoryToTrace(hostedResearchPlan.trace, outcomeCategory),
          parsed: {
            domain: hostedResearchPlan.domain,
            replyText: hostedResearchPlan.replyText,
            summary: hostedResearchPlan.summary,
            observations: hostedResearchPlan.observations,
            warnings: hostedResearchPlan.warnings,
            actions: hostedResearchPlan.actions,
            citations: hostedResearchPlan.citations || [],
            outcomeCategory,
          },
        },
        parsedSummary: hostedResearchPlan.summary,
        completedAt: new Date(),
      })
      .returning();

    return {
      runId: run.id,
      status: "completed",
      domain: hostedResearchPlan.domain,
      requestMessage,
      replyText: hostedResearchPlan.replyText,
      summary: hostedResearchPlan.summary,
      observations: hostedResearchPlan.observations,
      warnings: hostedResearchPlan.warnings,
      actions: hostedResearchPlan.actions,
      citations: hostedResearchPlan.citations || [],
      pendingClarification: hostedResearchPlan.pendingClarification || null,
      errorMessage: null,
    };
  }

  const context = await loadScoutAgentContext(userId, profile, {
    chatRequest: requestMessage,
  });

  const [run] = await db
    .insert(userAgentRuns)
    .values({
      userId,
      threadId: data.threadId || null,
      triggerSource: "manual",
      status: "pending",
      providerMode: profile.providerMode,
      model: executionModel,
      contextSnapshot: context,
      promptSnapshot: {
        framework: "pi-agent-core",
        requestedMode: data.mode || null,
        requestMessage,
        semanticRouteHint,
        conversationHistory: data.conversationHistory || [],
        operatorPlaybook: profile.systemPrompt,
        strategyTemplate: profile.userPromptTemplate,
      },
    })
    .returning();

  try {
    const hermesResult = await runHermesAgentTurn({
      userId,
      threadId: data.threadId || null,
      channel: "in_app",
      message: requestMessage || "",
      requestMode:
        data.mode === "commit" ? "plan" : data.mode === "discussion" ? "discussion" : "auto",
      profile,
      secret,
      context,
      capabilities: {
        domains: SUPPORTED_AGENT_DOMAINS,
        actionTypes: SUPPORTED_AGENT_ACTION_TYPES,
        canAnalyze: true,
        canAutoExecute: false,
        canUseWebResearch: isHostedWebResearchAvailable(),
        runtime: "hermes",
        hasDurableMemory: true,
        canScheduleAdvisories: true,
      },
      memoryContext: await buildHermesMemoryContext({
        userId,
        query: requestMessage || "",
      }),
      conversationHistory: data.conversationHistory || [],
      semanticRouteHint,
    });
    const normalizedStatus = hermesResult.outcome === "error" ? "failed" : "completed";
    const outcomeCategory = classifyAgentRunOutcome({
      actions: hermesResult.proposedActions,
      pendingClarification: hermesResult.pendingClarification,
      citations: hermesResult.citations,
      summary: hermesResult.summary,
      replyText: hermesResult.assistantText,
      errorMessage: hermesResult.outcome === "error" ? hermesResult.assistantText : null,
    });
    const scoutActions = hermesResult.proposedActions.filter(
      (action): action is ScoutProposalAction => action.actionType === "scout_set_count",
    );

    if (scoutActions.length > 0) {
      await db.insert(userAgentProposals).values(
        scoutActions.map((action) => ({
          runId: run.id,
          userId,
          actionType: action.actionType,
          status: "proposed",
          playerId: action.playerId,
          targetCount: action.targetCount,
          currentCount: action.currentCount,
          reasoning: action.reasoning,
          confidence: action.confidence.toFixed(3),
          evidence: action.evidence,
          riskFlags: action.riskFlags,
        })),
      );
    }

    if (hermesResult.proposedMemoryWrites.length > 0) {
      await persistProposedMemoryWrites({
        userId,
        threadId: data.threadId || null,
        writes: hermesResult.proposedMemoryWrites,
      });
    }

    await db
      .update(userAgentRuns)
      .set({
        promptSnapshot: {
          framework: "hermes-orchestrator",
          runtime: "hermes",
          requestedMode: data.mode || null,
          requestMessage,
          semanticRouteHint,
          conversationHistory: data.conversationHistory || [],
          operatorPlaybook: profile.systemPrompt,
          strategyTemplate: profile.userPromptTemplate,
        },
        status: normalizedStatus,
        rawResponse: {
          trace: attachOutcomeCategoryToTrace(
            {
              toolTrace: hermesResult.toolTrace,
            },
            outcomeCategory,
          ),
          parsed: {
            outcome: hermesResult.outcome,
            replyText: hermesResult.assistantText,
            summary: hermesResult.summary,
            warnings: hermesResult.warnings,
            actions: hermesResult.proposedActions,
            citations: hermesResult.citations,
            pendingClarification: hermesResult.pendingClarification,
            proposedMemoryWrites: hermesResult.proposedMemoryWrites,
            toolTrace: hermesResult.toolTrace,
            outcomeCategory,
          },
        },
        parsedSummary: hermesResult.summary,
        errorMessage: hermesResult.outcome === "error" ? hermesResult.assistantText : null,
        completedAt: new Date(),
      })
      .where(eq(userAgentRuns.id, run.id));

    return {
      runId: run.id,
      status: normalizedStatus,
      domain: "scouting",
      requestMessage,
      replyText: hermesResult.assistantText,
      summary: hermesResult.summary,
      observations: [],
      warnings: hermesResult.warnings,
      actions: hermesResult.proposedActions,
      citations: hermesResult.citations,
      pendingClarification: hermesResult.pendingClarification,
      proposedMemoryWrites: hermesResult.proposedMemoryWrites,
      toolTrace: hermesResult.toolTrace,
      errorMessage: hermesResult.outcome === "error" ? hermesResult.assistantText : null,
    };
  } catch (error: any) {
    const errorMessage = error?.message || "Agent analysis failed";
    const outcomeCategory = classifyAgentRunOutcome({
      errorMessage,
    });

    await db
      .update(userAgentRuns)
      .set({
        status: "failed",
        rawResponse: {
          trace: attachOutcomeCategoryToTrace(null, outcomeCategory),
        },
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(userAgentRuns.id, run.id));

    return {
      runId: run.id,
      status: "failed",
      domain: "scouting",
      requestMessage,
      replyText: null,
      summary: null,
      observations: [],
      warnings: [],
      actions: [],
      citations: [],
      pendingClarification: null,
      errorMessage,
    };
  }
}

export async function approveScoutAgentRun(userId: string, runId: string): Promise<void> {
  const run = await getRunById(userId, runId);
  if (!run) {
    throw new Error("Agent run not found");
  }

  if (run.status !== "completed") {
    throw new Error("Only completed runs can be approved");
  }

  const proposalRows = await getProposalRowsForRun(userId, runId);
  const actions = proposalRows
    .map(({ proposal, playerName }) =>
      mapProposalRowToAction({
        ...proposal,
        playerName,
      }),
    )
    .filter((action) => action.playerId);

  const proposedRows = proposalRows.filter(({ proposal }) => proposal.status === "proposed");
  if (proposedRows.length === 0) {
    throw new Error("No pending proposals remain on this run");
  }

  try {
    await executeScoutProposalActions(
      userId,
      actions.filter((action) =>
        proposedRows.some((row) => row.proposal.playerId === action.playerId),
      ),
    );

    await db
      .update(userAgentProposals)
      .set({
        status: "applied",
        approvedAt: new Date(),
        appliedAt: new Date(),
        errorMessage: null,
      })
      .where(
        and(
          eq(userAgentProposals.userId, userId),
          eq(userAgentProposals.runId, runId),
          eq(userAgentProposals.status, "proposed"),
        ),
      );
  } catch (error: any) {
    await db
      .update(userAgentProposals)
      .set({
        status: "failed",
        errorMessage: error?.message || "Failed to apply proposal",
      })
      .where(
        and(
          eq(userAgentProposals.userId, userId),
          eq(userAgentProposals.runId, runId),
          eq(userAgentProposals.status, "proposed"),
        ),
      );
    throw error;
  }
}

export async function rejectScoutAgentRun(userId: string, runId: string): Promise<void> {
  const run = await getRunById(userId, runId);
  if (!run) {
    throw new Error("Agent run not found");
  }

  const proposalRows = await getProposalRowsForRun(userId, runId);
  const hasPending = proposalRows.some(({ proposal }) => proposal.status === "proposed");

  if (!hasPending) {
    throw new Error("No pending proposals remain on this run");
  }

  await db
    .update(userAgentProposals)
    .set({
      status: "rejected",
      errorMessage: null,
    })
    .where(
      and(
        eq(userAgentProposals.userId, userId),
        eq(userAgentProposals.runId, runId),
        eq(userAgentProposals.status, "proposed"),
      ),
    );

  await db
    .update(userAgentRuns)
    .set({
      status: "rejected",
      completedAt: run.completedAt || new Date(),
    })
    .where(eq(userAgentRuns.id, runId));
}

export async function markAgentRunRejected(userId: string, runId: string): Promise<void> {
  const run = await getRunById(userId, runId);
  if (!run) {
    throw new Error("Agent run not found");
  }

  await db
    .update(userAgentRuns)
    .set({
      status: "rejected",
      completedAt: run.completedAt || new Date(),
    })
    .where(eq(userAgentRuns.id, runId));
}

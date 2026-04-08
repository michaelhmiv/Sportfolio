import {
  userAgentProfiles,
  userAgentSecrets,
  userAgentRuns,
  userAgentImprovementCandidates,
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
import { buildHermesConversationPrompts } from "./conversation-prompts";
import { buildAgentContinuityState } from "./continuity-state";
import { loadScoutAgentContext } from "./context-loader";
import { getAgentDataSourceSummary } from "./data-sources";
import { executeScoutProposalActions } from "./executor";
import { runHermesRuntimeTurn } from "./runtime-engine";
import { buildAgentImprovementCandidate } from "./improvement";
import { buildHermesMemoryContext, persistProposedMemoryWrites } from "./memory";
import { normalizeOpenAICompatibleBaseUrl, normalizeOpenAICompatibleModelId } from "./pi-provider";
import {
  DEFAULT_PORTFOLIO_AGENT_DISPLAY_NAME,
  DEFAULT_PORTFOLIO_AGENT_SYSTEM_PROMPT,
  DEFAULT_PORTFOLIO_AGENT_USER_PROMPT_TEMPLATE,
  LEGACY_SCOUT_AGENT_DISPLAY_NAME,
  LEGACY_PORTFOLIO_AGENT_SYSTEM_PROMPT_V1,
  LEGACY_PORTFOLIO_AGENT_USER_PROMPT_TEMPLATE_V1,
  isLegacyScoutAgentSystemPrompt,
  isLegacyScoutAgentUserPromptTemplate,
} from "./profile-defaults";
import { getInternalMlbMcpToolCatalog } from "./internal-mlb-mcp";
import { getManagedProviderStatus } from "./provider-registry";
import { isHostedWebResearchAvailable } from "./research";
import { getActiveManagedProviderSelection } from "./system-settings";
import { materializeAgentUiBlocks } from "./ui-blocks";
import { MANAGED_MODEL_PLACEHOLDER } from "./types";
import type {
  AgentAnalysisResult,
  AgentCapabilitiesView,
  AgentImprovementCandidate,
  AgentProfileView,
  AgentTurnProgressCallback,
  AgentSecretMetadata,
  AgentSemanticRoute,
  AgentToolTrace,
  HermesRespondResult,
  HermesTurnBudgetProfile,
  ManagedProviderStatus,
  ScoutProposalAction,
} from "./types";

export const analyzeScoutAgentInputSchema = z
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
    conversationMode: z
      .enum(["general_chat", "strategy_builder", "strategy_refinement", "strategy_review"])
      .optional(),
    strategyContext: z
      .object({
        strategyId: z.string().trim().min(1).max(120),
        sourceThreadId: z.string().trim().min(1).max(120).nullable(),
        status: z.enum(["draft", "live", "paused", "blocked", "archived"]).nullable(),
        mandate: z.string().trim().min(1).max(4000),
        normalizedRuleSheet: z.record(z.unknown()),
        guardrails: z.record(z.unknown()),
        reviewState: z
          .object({
            status: z.enum(["pending", "approved"]),
            reviewedAt: z.string().trim().min(1).nullable(),
            lastMaterialUpdateAt: z.string().trim().min(1).nullable(),
            summary: z.string().trim().min(1).max(4000).nullable(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    triggerContext: z
      .object({
        source: z.enum([
          "manual",
          "manual_retry",
          "schedule",
          "strategy_schedule",
          "strategy_event",
          "bot_cycle",
          "system",
        ]),
        label: z.string().trim().min(1).max(120).nullable().optional(),
        jobType: z
          .enum([
            "daily_setup_review",
            "pre_lock_nudge",
            "injury_watch",
            "idle_balance_nudge",
            "boost_window",
          ])
          .nullable()
          .optional(),
        eventType: z.string().trim().min(1).max(120).nullable().optional(),
        requestedAt: z.string().trim().min(1),
      })
      .nullable()
      .optional(),
    executionContext: z
      .object({
        kind: z.enum(["manual_thread", "scheduled_advisory", "strategy_run", "bot_runtime"]),
        allowAutoExecution: z.boolean(),
        requiresExplicitConfirmation: z.boolean(),
      })
      .nullable()
      .optional(),
  })
  .strict();

const STALE_PENDING_RUN_TIMEOUT_MS = 90_000;
const MAX_AGENT_ANALYSES_PER_HOUR = 60;
const SUPPORTED_AGENT_DOMAINS: AgentCapabilitiesView["domains"] = [
  "scouting",
  "player_pools",
  "daily_boosts",
  "watchlists",
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
  "holdings_stack_shares",
  "daily_boost_assign",
  "daily_boost_remove",
  "watchlist_add_player",
  "watchlist_remove_player",
];

type AgentRunOutcomeCategory =
  | "staged_plan"
  | "advisory_only"
  | "blocked_clarification"
  | "blocked_unavailable"
  | "research_only"
  | "failed";

interface AnalyzeScoutAgentRuntimeOptions {
  turnBudgetProfile?: HermesTurnBudgetProfile;
  onTurnEvent?: AgentTurnProgressCallback;
}

function toSecretMetadata(secret?: UserAgentSecret): AgentSecretMetadata {
  return {
    configured: Boolean(secret),
    keyLast4: secret?.keyLast4 || null,
    updatedAt: secret?.updatedAt || null,
  };
}

function normalizeLegacyPortfolioDefaults(profile: UserAgentProfile) {
  const updates: Partial<typeof userAgentProfiles.$inferInsert> = {};

  if (profile.displayName === LEGACY_SCOUT_AGENT_DISPLAY_NAME) {
    updates.displayName = DEFAULT_PORTFOLIO_AGENT_DISPLAY_NAME;
  }

  if (isLegacyScoutAgentSystemPrompt(profile.systemPrompt)) {
    updates.systemPrompt = DEFAULT_PORTFOLIO_AGENT_SYSTEM_PROMPT;
  }

  if (profile.systemPrompt === LEGACY_PORTFOLIO_AGENT_SYSTEM_PROMPT_V1) {
    updates.systemPrompt = DEFAULT_PORTFOLIO_AGENT_SYSTEM_PROMPT;
  }

  if (isLegacyScoutAgentUserPromptTemplate(profile.userPromptTemplate)) {
    updates.userPromptTemplate = DEFAULT_PORTFOLIO_AGENT_USER_PROMPT_TEMPLATE;
  }

  if (profile.userPromptTemplate === LEGACY_PORTFOLIO_AGENT_USER_PROMPT_TEMPLATE_V1) {
    updates.userPromptTemplate = DEFAULT_PORTFOLIO_AGENT_USER_PROMPT_TEMPLATE;
  }

  return updates;
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
      ? managedProvider.configured &&
        Boolean(managedProvider.defaultModel) &&
        managedProvider.supportsHermesToolLoop
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

async function buildCapabilityState(
  userId: string,
  profile: UserAgentProfile,
  managedProvider: ManagedProviderStatus,
  secret?: UserAgentSecret,
) {
  return {
    ...buildCapabilities(profile, managedProvider, secret),
    dataSources: await getAgentDataSourceSummary(userId, profile),
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
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!trace) {
    return {
      outcomeCategory,
      ...extras,
    };
  }

  return {
    ...trace,
    outcomeCategory,
    ...extras,
  };
}

async function recordImprovementCandidate(input: {
  userId: string;
  runId: string;
  requestMessage: string | null;
  outcome: HermesRespondResult["outcome"] | "error";
  assistantText: string;
  summary: string | null;
  warnings: string[];
  toolTrace: AgentToolTrace[];
  toolCallsUsed: string[];
  fallbackUsed?: boolean;
}): Promise<{
  id: string;
  failureClass: AgentImprovementCandidate["failureClass"];
} | null> {
  const candidate = buildAgentImprovementCandidate({
    requestMessage: input.requestMessage,
    outcome: input.outcome,
    assistantText: input.assistantText,
    summary: input.summary,
    warnings: input.warnings,
    toolTrace: input.toolTrace,
    toolCallsUsed: input.toolCallsUsed,
    fallbackUsed: input.fallbackUsed,
  });

  if (!candidate) {
    return null;
  }

  let row:
    | {
        id: string;
        failureClass: string;
      }
    | undefined;

  try {
    [row] = await db
      .insert(userAgentImprovementCandidates)
      .values({
        signature: candidate.signature,
        userId: input.userId,
        sourceRunId: input.runId,
        status: "new",
        failureClass: candidate.failureClass,
        recommendedChangeType: candidate.recommendedChangeType,
        recommendedChange: candidate.recommendedChange,
        affectedTools: candidate.affectedTools,
        evidence: candidate.evidence,
        confidence: toNumberString(candidate.confidence, 3),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userAgentImprovementCandidates.signature,
        set: {
          userId: input.userId,
          sourceRunId: input.runId,
          failureClass: candidate.failureClass,
          recommendedChangeType: candidate.recommendedChangeType,
          recommendedChange: candidate.recommendedChange,
          affectedTools: candidate.affectedTools,
          evidence: candidate.evidence,
          confidence: toNumberString(candidate.confidence, 3),
          occurrenceCount: sql`${userAgentImprovementCandidates.occurrenceCount} + 1`,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({
        id: userAgentImprovementCandidates.id,
        failureClass: userAgentImprovementCandidates.failureClass,
      });
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    failureClass: row.failureClass as AgentImprovementCandidate["failureClass"],
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

  const updates: Partial<typeof userAgentProfiles.$inferInsert> = {
    ...normalizeLegacyPortfolioDefaults(profile),
  };

  if (
    profile.providerMode === "managed" &&
    managedProvider.defaultModel &&
    profile.model !== managedProvider.defaultModel
  ) {
    updates.model = managedProvider.defaultModel || MANAGED_MODEL_PLACEHOLDER;
  }

  if ((profile.runtime || "pi") !== "hermes") {
    updates.runtime = "hermes";
  }

  if (Object.keys(updates).length > 0) {
    const nextUpdatedAt = new Date();
    await db
      .update(userAgentProfiles)
      .set({
        ...updates,
        updatedAt: nextUpdatedAt,
      })
      .where(eq(userAgentProfiles.id, profile.id));

    return {
      ...profile,
      ...updates,
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

export async function listAgentImprovementCandidates(input?: {
  userId?: string;
  status?: AgentImprovementCandidate["status"];
  limit?: number;
}): Promise<AgentImprovementCandidate[]> {
  const limit = Math.max(1, Math.min(input?.limit || 10, 100));
  const conditions = [];

  if (input?.userId) {
    conditions.push(eq(userAgentImprovementCandidates.userId, input.userId));
  }

  if (input?.status) {
    conditions.push(eq(userAgentImprovementCandidates.status, input.status));
  }

  const baseQuery = db.select().from(userAgentImprovementCandidates);
  const rows = await (conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery)
    .orderBy(
      desc(userAgentImprovementCandidates.occurrenceCount),
      desc(userAgentImprovementCandidates.lastSeenAt),
    )
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    signature: row.signature,
    userId: row.userId,
    sourceRunId: row.sourceRunId,
    status: row.status as AgentImprovementCandidate["status"],
    failureClass: row.failureClass as AgentImprovementCandidate["failureClass"],
    recommendedChangeType:
      row.recommendedChangeType as AgentImprovementCandidate["recommendedChangeType"],
    recommendedChange: row.recommendedChange,
    affectedTools: Array.isArray(row.affectedTools)
      ? row.affectedTools.filter((entry): entry is string => typeof entry === "string")
      : [],
    evidence:
      row.evidence && typeof row.evidence === "object"
        ? (row.evidence as Record<string, unknown>)
        : {},
    confidence: Number(row.confidence || "0"),
    occurrenceCount: row.occurrenceCount || 0,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
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
  const capabilities = await buildCapabilityState(userId, profile, managedProvider, secret);

  return {
    profile,
    secret: toSecretMetadata(secret),
    capabilities,
  };
}

export const getPortfolioAgentProfile = getScoutAgentProfile;

export async function getScoutAgentRuntimeProfile(userId: string): Promise<{
  profile: UserAgentProfile;
  secret?: UserAgentSecret;
  managedProvider: ManagedProviderStatus;
}> {
  const [managedProvider, secret] = await Promise.all([
    getActiveManagedProviderStatus(),
    getSecret(userId),
  ]);
  const profile = await ensureProfile(userId, managedProvider);

  return {
    profile,
    secret,
    managedProvider,
  };
}

export const getPortfolioAgentRuntimeProfile = getScoutAgentRuntimeProfile;

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
    dataSources: profileView.capabilities.dataSources,
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

export const updatePortfolioAgentProfile = updateScoutAgentProfile;

export async function saveScoutAgentByok(
  userId: string,
  input: unknown,
): Promise<AgentProfileView> {
  const data = userAgentByokInputSchema.parse(input);
  const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(data.baseUrl);
  const normalizedModel = normalizeOpenAICompatibleModelId(data.model, normalizedBaseUrl);
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
      model: normalizedModel,
      updatedAt: new Date(),
    })
    .where(eq(userAgentProfiles.userId, userId));

  return getScoutAgentProfile(userId);
}

export const savePortfolioAgentByok = saveScoutAgentByok;

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

export const clearPortfolioAgentByok = clearScoutAgentByok;

export async function analyzeScoutAgent(
  userId: string,
  input: unknown = {},
  runtimeOptions: AnalyzeScoutAgentRuntimeOptions = {},
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

  const runtimeCapabilities = await buildCapabilityState(userId, profile, managedProvider, secret);
  if (!runtimeCapabilities.canAnalyze) {
    throw new Error(
      profile.providerMode === "managed" && !managedProvider.supportsHermesToolLoop
        ? `${managedProvider.label} is configured but not approved for the Hermes tool loop. Switch the managed provider in settings.`
        : "Agent provider is not fully configured",
    );
  }

  const executionModel =
    profile.providerMode === "managed"
      ? managedProvider.defaultModel || profile.model
      : profile.model;
  const effectiveConversationMode = data.conversationMode || "general_chat";
  const effectiveTriggerContext = data.triggerContext || {
    source: "manual" as const,
    requestedAt: new Date().toISOString(),
  };
  const effectiveExecutionContext = data.executionContext || {
    kind: "manual_thread" as const,
    allowAutoExecution: false,
    requiresExplicitConfirmation: true,
  };
  const canAutoExecute = Boolean(effectiveExecutionContext.allowAutoExecution);

  const context = await loadScoutAgentContext(userId, profile, {
    chatRequest: requestMessage,
  });
  const continuityState = await buildAgentContinuityState({
    userId,
    threadId: data.threadId || null,
    strategyId: data.strategyContext?.strategyId || null,
  });
  const mlbMcpTools = await getInternalMlbMcpToolCatalog();
  const effectivePrompts = buildHermesConversationPrompts({
    baseSystemPrompt: profile.systemPrompt,
    baseUserPromptTemplate: profile.userPromptTemplate,
    conversationMode: effectiveConversationMode,
    strategyContext: data.strategyContext || null,
    mlbMcpAvailable: mlbMcpTools.length > 0,
  });
  const effectiveProfile = {
    ...profile,
    systemPrompt: effectivePrompts.systemPrompt,
    userPromptTemplate: effectivePrompts.userPromptTemplate,
  };

  const [run] = await db
    .insert(userAgentRuns)
    .values({
      userId,
      threadId: data.threadId || null,
      triggerSource: effectiveTriggerContext.source,
      status: "pending",
      providerMode: profile.providerMode,
      model: executionModel,
      contextSnapshot: context,
      promptSnapshot: {
        framework: "hermes-orchestrator-request",
        requestedMode: data.mode || null,
        requestMessage,
        semanticRouteHint,
        conversationMode: effectiveConversationMode,
        triggerContext: effectiveTriggerContext,
        executionContext: effectiveExecutionContext,
        strategyContext: data.strategyContext || null,
        continuityState,
        conversationHistory: data.conversationHistory || [],
        operatorPlaybook: effectiveProfile.systemPrompt,
        strategyTemplate: effectiveProfile.userPromptTemplate,
      },
    })
    .returning();

  try {
    const hermesResult = await runHermesRuntimeTurn({
      userId,
      threadId: data.threadId || null,
      channel: "in_app",
      message: requestMessage || "",
      requestMode:
        data.mode === "commit" ? "plan" : data.mode === "discussion" ? "discussion" : "auto",
      profile: effectiveProfile,
      secret,
      context,
      capabilities: {
        domains: SUPPORTED_AGENT_DOMAINS,
        actionTypes: SUPPORTED_AGENT_ACTION_TYPES,
        canAnalyze: runtimeCapabilities.canAnalyze,
        canAutoExecute,
        canUseWebResearch: isHostedWebResearchAvailable(),
        runtime: "hermes",
        hasDurableMemory: true,
        canScheduleAdvisories: true,
        dataSources: runtimeCapabilities.dataSources,
      },
      memoryContext: await buildHermesMemoryContext({
        userId,
        query: requestMessage || "",
      }),
      continuityState,
      autoExecutionPolicy: {
        allowAdvisoryJobs: true,
        allowRiskyActions: canAutoExecute,
      },
      confirmationPolicy: {
        requireExplicitConfirmation: effectiveExecutionContext.requiresExplicitConfirmation,
        preferredChannel: "in_app",
      },
      conversationHistory: data.conversationHistory || [],
      semanticRouteHint,
      conversationMode: effectiveConversationMode,
      strategyContext: data.strategyContext || null,
      triggerContext: effectiveTriggerContext,
      executionContext: effectiveExecutionContext,
      turnBudgetProfile: runtimeOptions.turnBudgetProfile,
      onTurnEvent: runtimeOptions.onTurnEvent,
    });
    const uiBlocks = materializeAgentUiBlocks({
      result: hermesResult,
      conversationMode: effectiveConversationMode,
      strategyContext: data.strategyContext || null,
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

    const improvementCandidateRecord = await recordImprovementCandidate({
      userId,
      runId: run.id,
      requestMessage,
      outcome: hermesResult.outcome,
      assistantText: hermesResult.assistantText,
      summary: hermesResult.summary,
      warnings: hermesResult.warnings,
      toolTrace: hermesResult.toolTrace,
      toolCallsUsed: hermesResult.toolCallsUsed,
      fallbackUsed: hermesResult.fallbackUsed,
    });

    await db
      .update(userAgentRuns)
      .set({
        promptSnapshot: {
          framework: "hermes-orchestrator",
          runtime: "hermes",
          requestedMode: data.mode || null,
          requestMessage,
          semanticRouteHint,
          conversationMode: effectiveConversationMode,
          triggerContext: effectiveTriggerContext,
          executionContext: effectiveExecutionContext,
          strategyContext: data.strategyContext || null,
          continuityState,
          conversationHistory: data.conversationHistory || [],
          operatorPlaybook: effectiveProfile.systemPrompt,
          strategyTemplate: effectiveProfile.userPromptTemplate,
        },
        status: normalizedStatus,
        rawResponse: {
          trace: attachOutcomeCategoryToTrace(
            {
              toolTrace: hermesResult.toolTrace,
            },
            outcomeCategory,
            {
              failureClass: improvementCandidateRecord?.failureClass || null,
              improvementCandidateId: improvementCandidateRecord?.id || null,
            },
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
            toolCallsUsed: hermesResult.toolCallsUsed,
            skillsUsed: hermesResult.skillsUsed,
            createdSkillCandidates: hermesResult.createdSkillCandidates,
            skillMatchRationale: hermesResult.skillMatchRationale,
            fallbackUsed: hermesResult.fallbackUsed,
            terminationReason: hermesResult.terminationReason ?? null,
            compressionApplied: Boolean(hermesResult.compressionApplied),
            repairAttempts: hermesResult.repairAttempts ?? 0,
            providerFailureClass: hermesResult.providerFailureClass ?? null,
            memoryInfluences: hermesResult.memoryInfluences || [],
            requiresConfirmation: hermesResult.requiresConfirmation,
            confirmationPreview: hermesResult.confirmationPreview,
            uiBlocks,
            runtimeMetadata: hermesResult.runtimeMetadata || null,
            usageMetrics: hermesResult.usageMetrics || null,
            outcomeCategory,
            failureClass: improvementCandidateRecord?.failureClass || null,
            improvementCandidateId: improvementCandidateRecord?.id || null,
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
      domain: "sportfolio",
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
      skillsUsed: hermesResult.skillsUsed,
      createdSkillCandidates: hermesResult.createdSkillCandidates,
      memoryInfluences: hermesResult.memoryInfluences || [],
      confirmationPreview: hermesResult.confirmationPreview,
      uiBlocks,
      runtimeMetadata: hermesResult.runtimeMetadata || null,
      usageMetrics: hermesResult.usageMetrics || null,
      errorMessage: hermesResult.outcome === "error" ? hermesResult.assistantText : null,
    };
  } catch (error: any) {
    const errorMessage = error?.message || "Agent analysis failed";
    const outcomeCategory = classifyAgentRunOutcome({
      errorMessage,
    });
    const improvementCandidateRecord = await recordImprovementCandidate({
      userId,
      runId: run.id,
      requestMessage,
      outcome: "error",
      assistantText: errorMessage,
      summary: null,
      warnings: [errorMessage],
      toolTrace: [],
      toolCallsUsed: [],
      fallbackUsed: false,
    });

    await db
      .update(userAgentRuns)
      .set({
        status: "failed",
        rawResponse: {
          trace: attachOutcomeCategoryToTrace(null, outcomeCategory, {
            failureClass: improvementCandidateRecord?.failureClass || null,
            improvementCandidateId: improvementCandidateRecord?.id || null,
          }),
        },
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(userAgentRuns.id, run.id));

    return {
      runId: run.id,
      status: "failed",
      domain: "sportfolio",
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

export const analyzePortfolioAgent = analyzeScoutAgent;

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

export const approvePortfolioAgentRun = approveScoutAgentRun;

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

export const rejectPortfolioAgentRun = rejectScoutAgentRun;

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

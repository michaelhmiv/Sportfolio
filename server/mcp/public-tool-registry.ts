import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getDocsArticle, listDocsArticles, searchDocsArticles } from "../docs-service";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { storage } from "../storage";
import {
  DEFAULT_ACTIVITY_FEED_CATEGORIES,
  USER_ACTIVITY_CATEGORIES,
  type UserActivityCategory,
} from "@shared/activity-feed";
import {
  holdings,
  newsFeed,
  players,
  userCollections,
  userMilestones,
  users,
} from "@shared/schema";
import {
  runHermesActionTool,
  runHermesPlanTool,
  runHermesReadTool,
  runHermesScanTool,
} from "../agent/hermes-tools";
import {
  getInternalMlbMcpToolCatalog,
  runInternalMlbMcpToolBounded,
} from "../agent/internal-mlb-mcp";
import { planDirectAgentOperation } from "../agent/operations-planner";
import {
  clearScoutAgentByok,
  getAgentCapabilities,
  getScoutAgentProfile,
  saveScoutAgentByok,
  updateScoutAgentProfile,
} from "../agent/service";
import { parsePendingClarification } from "../agent/clarification";
import {
  cancelAgentThread,
  confirmAgentThread,
  createAgentThread,
  getAgentThread,
  listAgentThreadMessages,
  listAgentThreadResearchSources,
  listAgentThreads,
  sendAgentThreadMessage,
  stageAgentThreadBundle,
} from "../agent/thread-service";
import {
  completeSmsPhoneLink,
  getSmsSettings,
  startSmsPhoneLink,
  updateSmsSettings,
} from "../sms-service";
import { redeemPremiumShare } from "../services/premium-redemption";
import { loadUserEntitlements } from "../services/user-entitlements";
import type {
  AgentAction,
  AgentDomain,
  AgentPendingClarification,
  AgentToolDefinition,
} from "../agent/types";

type RawSchema = Record<string, z.ZodTypeAny>;

type ToolStructuredContent = Record<string, unknown>;

type PublicToolExecutionModel = "read" | "immediate_write" | "staged_write" | "finalizer";
type PublicToolConfirmationModel = "immediate" | "staged_confirmation" | "finalizer";
type PublicToolRiskLevel = "low" | "medium" | "high";

export type PublicToolDefinition = {
  name: string;
  title?: string;
  description: string;
  domain: string;
  readOnly: boolean;
  riskLevel?: PublicToolRiskLevel;
  inputSchema?: RawSchema;
  fixtureArgs: Record<string, unknown>;
  routeRefs?: string[];
  execute: (
    context: PublicMcpServerContext,
    args: Record<string, unknown>,
  ) => Promise<ToolStructuredContent>;
};

export type PublicPromptDefinition = {
  name: string;
  description: string;
  argsSchema: RawSchema;
  fixtureArgs: Record<string, unknown>;
  render: (args: Record<string, unknown>) => Promise<{
    messages: Array<{
      role: "user";
      content: { type: "text"; text: string };
    }>;
  }>;
};

export type PublicIncludedCapability = {
  capabilityId: string;
  kind: "tool" | "prompt" | "resource";
  status: "included";
  domain: string;
  title?: string | null;
  toolName?: string;
  promptName?: string;
  resourceUri?: string;
  provider?: string | null;
  readOnly?: boolean;
  executionModel?: PublicToolExecutionModel;
  confirmationModel?: PublicToolConfirmationModel;
  requiresConfirmation?: boolean;
  riskLevel?: PublicToolRiskLevel | null;
  source: string;
  routeRefs?: string[];
};

export type PublicResourceDefinition = {
  id: string;
  uri: string;
  mimeType: string;
  description: string;
  read: (context: PublicMcpServerContext) => Promise<{
    contents: Array<{
      uri: string;
      text: string;
    }>;
  }>;
};

export type PublicDynamicSourceStatus = {
  id: string;
  name: string;
  provider: string;
  available: boolean;
  toolCount: number;
  error: string | null;
};

export type PublicToolCatalogEntry = {
  name: string;
  title: string | null;
  description: string;
  domain: string;
  provider: string | null;
  source: string;
  category: string | null;
  readOnly: boolean;
  executionModel: PublicToolExecutionModel;
  confirmationModel: PublicToolConfirmationModel;
  requiresConfirmation: boolean;
  riskLevel: PublicToolRiskLevel | null;
  whenToUse: string[];
  whenNotToUse: string[];
  examplePrompts: string[];
  resultShapeHint: string | null;
  presentationProfile: string | null;
  primaryEntityType: string | null;
  preferredColumns: string[];
  inputFieldNames: string[];
  fixtureArgs: Record<string, unknown>;
  routeRefs: string[];
};

type ResolvedDynamicMlbPublicTools = {
  tools: AgentToolDefinition[];
  sourceStatus: PublicDynamicSourceStatus;
};

export type PublicExcludedCapability = {
  capabilityId: string;
  kind: "excluded";
  status: "excluded";
  domain: string;
  source: string;
  notes: string;
  routeRefs?: string[];
};

export type PublicSiteRouteCoverageEntry = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  capabilityIds?: string[];
  excludedCapabilityId?: string;
  notes?: string;
};

type PublicMcpServerContext = {
  userId: string;
  deps: PublicMcpDependencies;
  dynamicMlb?: ResolvedDynamicMlbPublicTools | null;
};

type StorageSubset = Pick<
  typeof storage,
  | "getPlayers"
  | "getPlayer"
  | "getUser"
  | "getUserByUsername"
  | "getHolding"
  | "getWatchList"
  | "getUserHoldings"
  | "getUserHoldingsWithPlayers"
  | "getUserCommunityBoostShares"
  | "getCommunityBoostsAllSports"
  | "getDailyGames"
  | "getDailyGamesBySport"
  | "getFinancialMarketScanners"
  | "getScoutStatus"
  | "getTotalScoutsForUser"
  | "getUserScoutAssignments"
  | "getScoutRoster"
  | "getWatchlists"
  | "getUserActivityFeed"
  | "listUserApiTokens"
  | "createUserApiToken"
  | "revokeUserApiToken"
  | "markOnboardingComplete"
  | "updateUserPremiumStatus"
  | "getUserPremiumCheckoutSessions"
  | "getActiveRewardedScoutBoostForUser"
  | "updateUsername"
  | "updateProfileImage"
>;

export type PublicMcpDependencies = {
  storage: StorageSubset;
  runHermesReadTool: typeof runHermesReadTool;
  runHermesScanTool: typeof runHermesScanTool;
  runHermesPlanTool: typeof runHermesPlanTool;
  runHermesActionTool: typeof runHermesActionTool;
  planDirectAgentOperation: typeof planDirectAgentOperation;
  getScoutAgentProfile: typeof getScoutAgentProfile;
  getAgentCapabilities: typeof getAgentCapabilities;
  updateScoutAgentProfile: typeof updateScoutAgentProfile;
  saveScoutAgentByok: typeof saveScoutAgentByok;
  clearScoutAgentByok: typeof clearScoutAgentByok;
  createAgentThread: typeof createAgentThread;
  sendAgentThreadMessage: typeof sendAgentThreadMessage;
  stageAgentThreadBundle: typeof stageAgentThreadBundle;
  confirmAgentThread: typeof confirmAgentThread;
  cancelAgentThread: typeof cancelAgentThread;
  getAgentThread: typeof getAgentThread;
  listAgentThreadMessages: typeof listAgentThreadMessages;
  listAgentThreadResearchSources: typeof listAgentThreadResearchSources;
  listAgentThreads: typeof listAgentThreads;
  listDocsArticles: typeof listDocsArticles;
  searchDocsArticles: typeof searchDocsArticles;
  getDocsArticle: typeof getDocsArticle;
  getSmsSettings: typeof getSmsSettings;
  updateSmsSettings: typeof updateSmsSettings;
  startSmsPhoneLink: typeof startSmsPhoneLink;
  completeSmsPhoneLink: typeof completeSmsPhoneLink;
  redeemPremiumShare: typeof redeemPremiumShare;
  compileUserDigest: (userId: string) => Promise<unknown>;
  listCollections: (userId: string) => Promise<unknown[]>;
  getCollectionDetail: (
    userId: string,
    type: string,
    targetId: string,
  ) => Promise<{ collection: unknown; ownedPlayers: unknown[] } | null>;
  listMilestones: (userId: string) => Promise<unknown[]>;
  celebrateMilestone: (userId: string, milestoneId: string) => Promise<boolean>;
  markNewsRead: (userId: string) => Promise<void>;
  getNewsUnreadCount: (userId: string) => Promise<{
    count: number;
    digestCount: number;
    hasUnreadDigest: boolean;
    digestReleaseAt: Date;
  }>;
  getInternalMlbMcpToolCatalog: () => Promise<AgentToolDefinition[]>;
  runInternalMlbMcpToolBounded: typeof runInternalMlbMcpToolBounded;
};

const PUBLIC_DYNAMIC_MLB_SOURCE_ID = "internal_mlb_mcp";
const PUBLIC_DYNAMIC_MLB_SOURCE_NAME = "Internal MLB MCP";
const HIGH_RISK_IMMEDIATE_TOOL_NAMES = new Set([
  "revoke_api_token",
  "save_agent_byok",
  "clear_agent_byok",
  "redeem_premium",
]);

class PublicMcpToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PublicMcpToolError";
  }
}

function createTextSummary(result: unknown): string {
  if (result == null) {
    return "No result returned.";
  }
  if (typeof result === "string") {
    return result;
  }
  if (typeof result === "object") {
    const candidate = result as Record<string, unknown>;
    for (const key of ["summary", "replyText", "message", "status"]) {
      if (typeof candidate[key] === "string" && candidate[key].trim()) {
        return candidate[key] as string;
      }
    }
  }
  return "Tool completed.";
}

function toToolResult(structuredContent: ToolStructuredContent) {
  return {
    content: [
      {
        type: "text" as const,
        text: createTextSummary(structuredContent),
      },
    ],
    structuredContent,
  };
}

function toStructuredContent(value: unknown): ToolStructuredContent {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (Array.isArray(value)) {
    return {
      items: value,
    };
  }
  return {
    value,
  };
}

function toToolErrorResult(error: unknown) {
  const normalized =
    error instanceof PublicMcpToolError
      ? error
      : new PublicMcpToolError(
          error instanceof Error ? error.message : String(error),
          "tool_execution_failed",
        );

  return {
    content: [
      {
        type: "text" as const,
        text: normalized.message,
      },
    ],
    structuredContent: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
    isError: true,
  };
}

function getPublicToolExecutionModel(
  tool: Pick<PublicToolDefinition, "name" | "readOnly">,
): PublicToolExecutionModel {
  if (tool.readOnly) {
    return "read";
  }
  if (tool.name === "confirm_pending_action" || tool.name === "cancel_pending_action") {
    return "finalizer";
  }
  if (tool.name.startsWith("stage_")) {
    return "staged_write";
  }
  return "immediate_write";
}

function getPublicToolConfirmationModel(
  executionModel: PublicToolExecutionModel,
): PublicToolConfirmationModel {
  if (executionModel === "finalizer") {
    return "finalizer";
  }
  if (executionModel === "staged_write") {
    return "staged_confirmation";
  }
  return "immediate";
}

function getPublicToolRiskLevel(tool: PublicToolDefinition): PublicToolRiskLevel {
  if (tool.riskLevel) {
    return tool.riskLevel;
  }
  if (HIGH_RISK_IMMEDIATE_TOOL_NAMES.has(tool.name)) {
    return "high";
  }
  const executionModel = getPublicToolExecutionModel(tool);
  if (executionModel === "read") {
    return "low";
  }
  return "medium";
}

function getToolInputFieldNames(schema?: RawSchema) {
  if (!schema || typeof schema !== "object") {
    return [];
  }
  return Object.keys(schema);
}

function getAgentToolInputFieldNames(inputSchema?: Record<string, unknown> | null) {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return [];
  }

  const properties =
    "properties" in inputSchema &&
    inputSchema.properties &&
    typeof inputSchema.properties === "object" &&
    !Array.isArray(inputSchema.properties)
      ? (inputSchema.properties as Record<string, unknown>)
      : null;

  return properties ? Object.keys(properties) : [];
}

function toStaticPublicToolCatalogEntry(tool: PublicToolDefinition): PublicToolCatalogEntry {
  const executionModel = getPublicToolExecutionModel(tool);
  return {
    name: tool.name,
    title: tool.title || null,
    description: tool.description,
    domain: tool.domain,
    provider: "sportfolio",
    source: "public_registry:tool",
    category: tool.readOnly ? "read" : "action",
    readOnly: tool.readOnly,
    executionModel,
    confirmationModel: getPublicToolConfirmationModel(executionModel),
    requiresConfirmation: executionModel === "staged_write",
    riskLevel: getPublicToolRiskLevel(tool),
    whenToUse: [],
    whenNotToUse: [],
    examplePrompts: [],
    resultShapeHint: null,
    presentationProfile: null,
    primaryEntityType: null,
    preferredColumns: [],
    inputFieldNames: getToolInputFieldNames(tool.inputSchema),
    fixtureArgs: tool.fixtureArgs,
    routeRefs: tool.routeRefs || [],
  };
}

function toDynamicPublicToolCatalogEntry(tool: AgentToolDefinition): PublicToolCatalogEntry {
  const executionModel: PublicToolExecutionModel = tool.requiresConfirmation
    ? "staged_write"
    : "read";
  return {
    name: tool.toolName,
    title: tool.toolName,
    description: tool.description,
    domain: "mlb",
    provider: "internal_mlb_mcp",
    source: "dynamic:internal_mlb_mcp",
    category: tool.category,
    readOnly: !tool.requiresConfirmation,
    executionModel,
    confirmationModel: getPublicToolConfirmationModel(executionModel),
    requiresConfirmation: tool.requiresConfirmation,
    riskLevel: tool.riskLevel,
    whenToUse: [...tool.whenToUse],
    whenNotToUse: [...tool.whenNotToUse],
    examplePrompts: [...tool.examplePrompts],
    resultShapeHint: tool.resultShapeHint || null,
    presentationProfile: tool.presentationProfile || null,
    primaryEntityType: tool.primaryEntityType || null,
    preferredColumns: [...(tool.preferredColumns || [])],
    inputFieldNames: getAgentToolInputFieldNames(tool.inputSchema),
    fixtureArgs: {},
    routeRefs: [],
  };
}

export async function resolveDynamicMlbPublicTools(
  deps: Pick<PublicMcpDependencies, "getInternalMlbMcpToolCatalog">,
): Promise<ResolvedDynamicMlbPublicTools> {
  const staticToolNames = new Set(buildPublicToolRegistry().map((tool) => tool.name));

  try {
    const tools = (await deps.getInternalMlbMcpToolCatalog()).filter(
      (tool) => !tool.requiresConfirmation && !staticToolNames.has(tool.toolName),
    );

    return {
      tools,
      sourceStatus: {
        id: PUBLIC_DYNAMIC_MLB_SOURCE_ID,
        name: PUBLIC_DYNAMIC_MLB_SOURCE_NAME,
        provider: "internal_mlb_mcp",
        available: true,
        toolCount: tools.length,
        error: null,
      },
    };
  } catch (error) {
    return {
      tools: [],
      sourceStatus: {
        id: PUBLIC_DYNAMIC_MLB_SOURCE_ID,
        name: PUBLIC_DYNAMIC_MLB_SOURCE_NAME,
        provider: "internal_mlb_mcp",
        available: false,
        toolCount: 0,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function getResolvedDynamicMlbPublicToolsForContext(
  context: PublicMcpServerContext,
): Promise<ResolvedDynamicMlbPublicTools> {
  return context.dynamicMlb || resolveDynamicMlbPublicTools(context.deps);
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalString(value: unknown): string | null {
  const resolved = toStringValue(value);
  return resolved || null;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function toNumberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is Record<string, unknown> => Boolean(toRecord(entry)));
}

function buildPlayerName(
  player: { firstName?: string | null; lastName?: string | null } | null | undefined,
  fallback: string,
) {
  const fullName = `${toStringValue(player?.firstName)} ${toStringValue(player?.lastName)}`.trim();
  return fullName || fallback;
}

function toAgentDomainValue(value: unknown): AgentDomain {
  const domain = toStringValue(value);
  return domain === "scouting" ||
    domain === "player_pools" ||
    domain === "daily_boosts" ||
    domain === "community_boosts" ||
    domain === "watchlists" ||
    domain === "sportfolio"
    ? domain
    : "sportfolio";
}

const MAX_ACTIVE_API_TOKENS = 8;

function toTokenView(token: {
  id: string;
  tokenPrefix: string;
  tokenLast4: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}) {
  return {
    id: token.id,
    label: token.label,
    preview: `${token.tokenPrefix}...${token.tokenLast4}`,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
  };
}

function toSmsLinkView(link: Awaited<ReturnType<PublicMcpDependencies["getSmsSettings"]>>) {
  if (!link) {
    return null;
  }

  return {
    id: link.id,
    phoneE164: link.phoneE164,
    verifiedAt: link.verifiedAt,
    linkedAt: link.linkedAt,
    lastInboundAt: link.lastInboundAt,
    lastOutboundAt: link.lastOutboundAt,
    smsEnabled: link.smsEnabled,
    smsOptInStatus: link.smsOptInStatus,
    smsOptInSource: link.smsOptInSource,
  };
}

function assertRecord(value: unknown, code = "invalid_arguments"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicMcpToolError("Arguments must be an object.", code);
  }
  return value as Record<string, unknown>;
}

function parseSchemaArgs(
  schema: RawSchema | undefined,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema) {
    return assertRecord(args ?? {});
  }

  try {
    return z
      .object(schema)
      .strict()
      .parse(args ?? {});
  } catch (error) {
    throw new PublicMcpToolError(
      error instanceof Error ? error.message : "Invalid arguments.",
      "invalid_arguments",
    );
  }
}

function resolveTargetDateString(rawDate: unknown): string {
  const candidate = toStringValue(rawDate);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : getTodayET();
}

function resolveTargetDate(rawDate: unknown): Date {
  const { startOfDay } = getETDayBoundaries(resolveTargetDateString(rawDate));
  return new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
}

async function resolvePreferredSport(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
  fallback = "NBA",
): Promise<string> {
  const explicit = toStringValue(args.sport).toUpperCase();
  if (explicit) {
    return explicit;
  }

  const profileView = await context.deps.getScoutAgentProfile(context.userId);
  const preferred = toStringValue(profileView.profile.defaultSport).toUpperCase();
  return preferred || fallback;
}

async function executeReadTool(
  context: PublicMcpServerContext,
  toolName: string,
  args: Record<string, unknown> = {},
  threadId?: string | null,
) {
  return toStructuredContent(
    await context.deps.runHermesReadTool({
      toolName,
      userId: context.userId,
      threadId: threadId || null,
      args,
    }),
  );
}

async function executeScanTool(
  context: PublicMcpServerContext,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  return toStructuredContent(
    await context.deps.runHermesScanTool({
      toolName,
      userId: context.userId,
      args,
    }),
  );
}

async function executePlanTool(
  context: PublicMcpServerContext,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  return toStructuredContent(
    await context.deps.runHermesPlanTool({
      toolName,
      userId: context.userId,
      args,
    }),
  );
}

async function executeActionTool(
  context: PublicMcpServerContext,
  toolName: string,
  args: Record<string, unknown> = {},
  threadId?: string | null,
) {
  return toStructuredContent(
    await context.deps.runHermesActionTool({
      toolName,
      userId: context.userId,
      threadId: threadId || null,
      args,
    }),
  );
}

function extractPendingBundle(turnResult: unknown) {
  if (!turnResult || typeof turnResult !== "object") {
    return null;
  }

  const turn = turnResult as Record<string, unknown>;
  if (turn.pendingActionBundle && typeof turn.pendingActionBundle === "object") {
    return turn.pendingActionBundle as Record<string, unknown>;
  }

  const createdMessages = Array.isArray(turn.createdMessages) ? turn.createdMessages : [];
  for (const message of createdMessages) {
    if (
      message &&
      typeof message === "object" &&
      (message as Record<string, unknown>).actionBundle &&
      typeof (message as Record<string, unknown>).actionBundle === "object"
    ) {
      return (message as Record<string, unknown>).actionBundle as Record<string, unknown>;
    }
  }

  const thread = turn.thread && typeof turn.thread === "object" ? turn.thread : null;
  if (
    thread &&
    typeof thread === "object" &&
    (thread as Record<string, unknown>).pendingActionBundle &&
    typeof (thread as Record<string, unknown>).pendingActionBundle === "object"
  ) {
    return (thread as Record<string, unknown>).pendingActionBundle as Record<string, unknown>;
  }

  return null;
}

function buildStagedActionResponse(threadId: string, turn: unknown) {
  const pendingBundle = extractPendingBundle(turn);
  if (!pendingBundle) {
    throw new PublicMcpToolError(
      "The request did not create a pending action bundle.",
      "no_pending_action",
      { threadId },
    );
  }

  return {
    threadId,
    pendingBundleId: toStringValue(pendingBundle.id),
    summary: toStringValue(pendingBundle.summary) || "Pending plan staged.",
    warnings: Array.isArray(pendingBundle.warnings) ? pendingBundle.warnings : [],
    confirmationRequired: true,
    pendingBundle,
    turn,
  };
}

async function ensurePendingBundleMatch(
  context: PublicMcpServerContext,
  threadId: string,
  pendingBundleId: string,
) {
  const thread = await context.deps.getAgentThread(context.userId, threadId);
  const activeId = toStringValue(thread.pendingActionBundle?.id);

  if (!activeId) {
    throw new PublicMcpToolError("No pending action remains on this thread.", "no_pending_action", {
      threadId,
      pendingBundleId,
    });
  }

  if (activeId !== pendingBundleId) {
    throw new PublicMcpToolError(
      "The provided pending bundle id does not match the thread's active pending bundle.",
      "bundle_mismatch",
      {
        threadId,
        pendingBundleId,
        activePendingBundleId: activeId,
      },
    );
  }

  return thread;
}

function extractPreviewStageState(preview: Record<string, unknown>) {
  const contextSnapshot = toRecord(preview.contextSnapshot);
  const nestedPreview = toRecord(contextSnapshot?.preview);
  const stagePreview = nestedPreview || preview;
  const beforeState = toRecord(stagePreview.beforeState);
  const afterState = toRecord(stagePreview.afterState);
  const topLevelActions = toRecordArray(preview.actions) as unknown as AgentAction[];
  const pendingClarification = parsePendingClarification(preview.pendingClarification);
  const stageMessage =
    toOptionalString(stagePreview.stageMessage) ||
    toOptionalString(preview.requestMessage) ||
    toOptionalString(preview.summary);
  const explicitCanStage =
    typeof stagePreview.canStage === "boolean" ? stagePreview.canStage : null;

  return {
    contextSnapshot,
    stagePreview,
    beforeState,
    afterState,
    stageMessage,
    canStage:
      explicitCanStage ??
      (topLevelActions.length > 0 || Boolean(pendingClarification && stageMessage)),
    actions: topLevelActions,
    pendingClarification,
  };
}

async function synthesizeDeterministicStageActions(input: {
  context: PublicMcpServerContext;
  previewToolName: string;
  preview: Record<string, unknown>;
  previewArgs: Record<string, unknown>;
}): Promise<AgentAction[]> {
  const stageState = extractPreviewStageState(input.preview);
  if (!stageState.canStage) {
    return [];
  }

  const playerId =
    toStringValue(input.previewArgs.playerId) ||
    toStringValue(stageState.contextSnapshot?.playerId) ||
    toStringValue(stageState.stagePreview.playerId);
  const player = playerId ? await input.context.deps.storage.getPlayer(playerId) : undefined;
  const playerName = buildPlayerName(
    player,
    toStringValue(stageState.contextSnapshot?.playerName) || playerId,
  );

  switch (input.previewToolName) {
    case "preview_pool_buy": {
      const sbAmount = toNumberValue(input.previewArgs.sbAmount ?? input.previewArgs.amount);
      if (!playerId || sbAmount == null) {
        return [];
      }
      const quote = toRecord(stageState.contextSnapshot?.quote);
      return [
        {
          actionType: "pool_buy",
          playerId,
          playerName,
          sbAmount,
          availableBalanceBefore: toNumberValue(stageState.beforeState?.availableBalance),
          availableBalanceAfter: toNumberValue(stageState.afterState?.availableBalance),
          maxSlippage: 0.05,
          estimatedSharesOut:
            toNumberValue(stageState.afterState?.estimatedSharesOut) ||
            toNumberValue(quote?.sharesOut),
          estimatedPricePerShare:
            toNumberValue(quote?.effectivePrice) ||
            toNumberValue(stageState.stagePreview.estimatedPricePerShare),
          estimatedSlippagePercent:
            toNumberValue(quote?.slippagePercent) != null
              ? toNumberValue(quote?.slippagePercent)! * 100
              : toNumberValue(stageState.stagePreview.estimatedSlippagePercent),
          reasoning: "This stages the requested pool buy using the deterministic preview quote.",
          confidence: 0.94,
        } satisfies AgentAction,
      ];
    }
    case "preview_pool_sell": {
      const sharesAmount = toPositiveInteger(
        input.previewArgs.sharesAmount ?? input.previewArgs.shares,
      );
      if (!playerId || sharesAmount == null) {
        return [];
      }
      return [
        {
          actionType: "pool_sell",
          playerId,
          playerName,
          sharesAmount,
          availableBalanceBefore: toNumberValue(stageState.beforeState?.availableBalance),
          availableBalanceAfter: toNumberValue(stageState.afterState?.availableBalance),
          availableSharesBefore: toNumberValue(stageState.beforeState?.availableShares),
          availableSharesAfter: toNumberValue(stageState.afterState?.availableShares),
          maxSlippage: 0.05,
          estimatedSbOut: toNumberValue(stageState.afterState?.estimatedSbOut),
          estimatedPricePerShare: toNumberValue(stageState.stagePreview.estimatedPricePerShare),
          estimatedSlippagePercent: toNumberValue(stageState.stagePreview.estimatedSlippagePercent),
          reasoning: "This stages the requested pool sell using the deterministic preview quote.",
          confidence: 0.92,
        } satisfies AgentAction,
      ];
    }
    case "preview_lp_add": {
      const shares = toNumberValue(input.previewArgs.shares);
      const playMoney = toNumberValue(input.previewArgs.playMoney);
      if (!playerId || shares == null || playMoney == null) {
        return [];
      }
      return [
        {
          actionType: "pool_add_liquidity",
          playerId,
          playerName,
          shares,
          playMoney,
          availableBalanceBefore: toNumberValue(stageState.beforeState?.availableBalance),
          availableBalanceAfter: toNumberValue(stageState.afterState?.availableBalance),
          availableSharesBefore: toNumberValue(stageState.beforeState?.availableShares),
          availableSharesAfter: toNumberValue(stageState.afterState?.availableShares),
          estimatedOwnershipPercent: toNumberValue(
            stageState.afterState?.projectedOwnershipPercent,
          ),
          reasoning:
            "This stages the requested fixed-ratio liquidity add using the deterministic preview.",
          confidence: 0.9,
        } satisfies AgentAction,
      ];
    }
    case "preview_lp_add_optimal": {
      const maxShares = toNumberValue(input.previewArgs.maxShares ?? input.previewArgs.shares);
      const maxPlayMoney = toNumberValue(
        input.previewArgs.maxPlayMoney ?? input.previewArgs.playMoney,
      );
      if (!playerId || maxShares == null || maxPlayMoney == null) {
        return [];
      }
      return [
        {
          actionType: "pool_add_liquidity_optimal",
          playerId,
          playerName,
          maxShares,
          maxPlayMoney,
          availableBalanceBefore: toNumberValue(stageState.beforeState?.availableBalance),
          availableBalanceAfter: toNumberValue(stageState.afterState?.availableBalance),
          availableSharesBefore: toNumberValue(stageState.beforeState?.availableShares),
          availableSharesAfter: toNumberValue(stageState.afterState?.availableShares),
          estimatedOwnershipPercent: toNumberValue(
            stageState.afterState?.projectedOwnershipPercent,
          ),
          reasoning:
            "This stages the requested optimal-ratio liquidity add using the deterministic preview.",
          confidence: 0.9,
        } satisfies AgentAction,
      ];
    }
    case "preview_lp_zap": {
      const shares = toNumberValue(input.previewArgs.shares);
      const sb = toNumberValue(
        input.previewArgs.sb ?? input.previewArgs.amount ?? input.previewArgs.sbAmount,
      );
      if (!playerId || (shares == null && sb == null)) {
        return [];
      }
      if (shares != null) {
        return [
          {
            actionType: "pool_zap_add_shares",
            playerId,
            playerName,
            shares,
            availableSharesBefore: toNumberValue(stageState.beforeState?.availableShares),
            availableSharesAfter: toNumberValue(stageState.afterState?.availableShares),
            estimatedLpSharesMinted: toNumberValue(stageState.afterState?.estimatedLpSharesMinted),
            reasoning:
              "This stages the requested share-side LP zap using the deterministic preview.",
            confidence: 0.9,
          } satisfies AgentAction,
        ];
      }
      return [
        {
          actionType: "pool_zap_add_sb",
          playerId,
          playerName,
          sb: sb!,
          availableBalanceBefore: toNumberValue(stageState.beforeState?.availableBalance),
          availableBalanceAfter: toNumberValue(stageState.afterState?.availableBalance),
          estimatedLpSharesMinted: toNumberValue(stageState.afterState?.estimatedLpSharesMinted),
          reasoning: "This stages the requested cash-side LP zap using the deterministic preview.",
          confidence: 0.9,
        } satisfies AgentAction,
      ];
    }
    case "preview_lp_remove": {
      const lpShares = toNumberValue(input.previewArgs.lpShares ?? input.previewArgs.shares);
      if (!playerId || lpShares == null) {
        return [];
      }
      return [
        {
          actionType: "pool_remove_liquidity",
          playerId,
          playerName,
          lpShares,
          currentLpShares: toNumberValue(stageState.beforeState?.currentLpShares),
          remainingLpShares: toNumberValue(stageState.afterState?.remainingLpShares),
          estimatedSharesOut: toNumberValue(stageState.afterState?.estimatedSharesOut),
          estimatedPlayMoneyOut: toNumberValue(stageState.afterState?.estimatedPlayMoneyOut),
          reasoning:
            "This stages the requested LP removal using the deterministic preview calculation.",
          confidence: 0.9,
        } satisfies AgentAction,
      ];
    }
    case "preview_stack_shares": {
      const sharesToStack = toPositiveInteger(input.previewArgs.shares);
      if (!playerId || sharesToStack == null) {
        return [];
      }
      return [
        {
          actionType: "holdings_stack_shares",
          playerId,
          playerName,
          sharesToStack,
          availableSharesBefore: toNumberValue(stageState.contextSnapshot?.availableShares),
          availableSharesAfter: toNumberValue(stageState.contextSnapshot?.availableShares),
          expectedMultiplierGained: sharesToStack / 2,
          expectedStackedShareCount: 1,
          reasoning: "This stages the requested Stack Shares action directly from the tool input.",
          confidence: 0.92,
        } satisfies AgentAction,
      ];
    }
    case "preview_daily_boost_assign": {
      const sport =
        toStringValue(input.previewArgs.sport) || toStringValue(stageState.contextSnapshot?.sport);
      const slotTier = toPositiveInteger(input.previewArgs.slotTier);
      const boostDate =
        toStringValue(input.previewArgs.date) ||
        toStringValue(stageState.contextSnapshot?.boostDate);
      const gameId = toStringValue(stageState.contextSnapshot?.gameId);
      if (
        !playerId ||
        !sport ||
        !boostDate ||
        !gameId ||
        !slotTier ||
        ![2, 3, 4, 5].includes(slotTier)
      ) {
        return [];
      }
      return [
        {
          actionType: "daily_boost_assign",
          playerId,
          playerName,
          sport,
          slotTier: slotTier as 2 | 3 | 4 | 5,
          sharesEntered: 1,
          boostDate,
          gameId,
          gameStartTime: toOptionalString(stageState.contextSnapshot?.gameStartTime),
          opponent: toOptionalString(stageState.contextSnapshot?.opponent),
          availableShares: toNumberValue(stageState.contextSnapshot?.availableShares) ?? undefined,
          shareMultiplier:
            toNumberValue(stageState.contextSnapshot?.selectedMultiplier) ?? undefined,
          reasoning:
            "This stages the requested daily boost assignment directly from the preview context.",
          confidence: 0.93,
        } satisfies AgentAction,
      ];
    }
    case "preview_daily_boost_remove": {
      const sport =
        toStringValue(input.previewArgs.sport) || toStringValue(stageState.contextSnapshot?.sport);
      const slotTier =
        toPositiveInteger(input.previewArgs.slotTier) ||
        toPositiveInteger(stageState.contextSnapshot?.slotTier);
      const boostDate =
        toStringValue(input.previewArgs.date) ||
        toStringValue(stageState.contextSnapshot?.boostDate);
      const boostId = toStringValue(stageState.contextSnapshot?.boostId);
      if (
        !playerId ||
        !sport ||
        !boostDate ||
        !boostId ||
        !slotTier ||
        ![2, 3, 4, 5].includes(slotTier)
      ) {
        return [];
      }
      return [
        {
          actionType: "daily_boost_remove",
          boostId,
          playerId,
          playerName,
          sport,
          slotTier: slotTier as 2 | 3 | 4 | 5,
          boostDate,
          gameId: toOptionalString(stageState.contextSnapshot?.gameId),
          gameStartTime: toOptionalString(stageState.contextSnapshot?.gameStartTime),
          reasoning:
            "This stages the requested daily boost removal directly from the preview context.",
          confidence: 0.93,
        } satisfies AgentAction,
      ];
    }
    case "preview_community_boost_create": {
      const sport =
        toStringValue(input.previewArgs.sport) || toStringValue(stageState.contextSnapshot?.sport);
      const boostDate =
        toStringValue(input.previewArgs.date) ||
        toStringValue(stageState.contextSnapshot?.boostDate);
      const gameId = toStringValue(stageState.contextSnapshot?.gameId);
      if (!playerId || !sport || !boostDate || !gameId) {
        return [];
      }
      return [
        {
          actionType: "community_boost_create",
          playerId,
          playerName,
          sport,
          boostDate,
          gameId,
          gameStartTime: toOptionalString(stageState.contextSnapshot?.gameStartTime),
          opponent: toOptionalString(stageState.contextSnapshot?.opponent),
          communitySharesAvailable:
            toNumberValue(stageState.contextSnapshot?.communitySharesAvailable) ?? undefined,
          reasoning: "This stages the requested community boost directly from the preview context.",
          confidence: 0.94,
        } satisfies AgentAction,
      ];
    }
    case "preview_scout_adjustment": {
      const targetCount = toPositiveInteger(input.previewArgs.targetCount);
      if (!playerId || targetCount == null) {
        return [];
      }
      const assignments = await input.context.deps.storage.getUserScoutAssignments(
        input.context.userId,
      );
      const currentAssignment = assignments.find((entry) => entry.playerId === playerId);
      return [
        {
          actionType: "scout_set_count",
          playerId,
          playerName,
          targetCount,
          currentCount: toPositiveInteger(currentAssignment?.scoutCount) || 0,
          reasoning:
            "This stages the requested scout assignment count directly from the tool input.",
          confidence: 0.9,
          evidence: {
            trend: null,
            injury: null,
            upcomingGame: null,
            performanceNote: null,
          },
          riskFlags: [],
        } satisfies AgentAction,
      ];
    }
    default:
      return [];
  }
}

async function stagePreviewedAction(input: {
  context: PublicMcpServerContext;
  previewToolName: string;
  previewArgs: Record<string, unknown>;
  threadId?: string | null;
}) {
  const preview = assertRecord(
    await executePlanTool(input.context, input.previewToolName, input.previewArgs),
    "invalid_preview_result",
  );
  const stageState = extractPreviewStageState(preview);
  const stagedActions =
    stageState.actions.length > 0
      ? stageState.actions
      : await synthesizeDeterministicStageActions({
          context: input.context,
          previewToolName: input.previewToolName,
          preview,
          previewArgs: input.previewArgs,
        });
  const canStage =
    stagedActions.length > 0 ||
    Boolean(stageState.pendingClarification && stageState.stageMessage) ||
    (stageState.canStage && Boolean(stageState.stageMessage));

  if (!canStage) {
    throw new PublicMcpToolError(
      "The requested action could not be staged with the current inputs.",
      "cannot_stage",
      { preview },
    );
  }

  const pendingClarification =
    stageState.pendingClarification ||
    (parsePendingClarification(preview.pendingClarification) as AgentPendingClarification | null);

  if (stagedActions.length > 0 || pendingClarification) {
    const turn = await input.context.deps.stageAgentThreadBundle({
      userId: input.context.userId,
      threadId: toOptionalString(input.threadId),
      channel: "cli",
      domain: toAgentDomainValue(preview.domain),
      title: "MCP action thread",
      requestMessage: stageState.stageMessage,
      summary: toStringValue(preview.summary) || "Pending plan staged.",
      replyText:
        toStringValue(preview.replyText) ||
        toStringValue(preview.summary) ||
        "Pending plan staged.",
      warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
      actions: stagedActions,
      pendingClarification,
    });
    return buildStagedActionResponse(toStringValue(turn.thread.id), turn);
  }

  const existingThreadId = toOptionalString(input.threadId);
  const createdThread = existingThreadId
    ? null
    : assertRecord(
        await input.context.deps.createAgentThread(input.context.userId, {
          channel: "cli",
          domain: "sportfolio",
          title: "MCP action thread",
        }),
        "thread_creation_failed",
      );
  const threadId = existingThreadId || toStringValue(createdThread?.id);

  if (!threadId) {
    throw new PublicMcpToolError("Could not create an agent thread.", "thread_creation_failed");
  }

  const turn = await input.context.deps.sendAgentThreadMessage(input.context.userId, threadId, {
    message: stageState.stageMessage!,
  });

  return buildStagedActionResponse(threadId, turn);
}

async function buildSetupReview(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const profile = (await context.deps.getScoutAgentProfile(context.userId)).profile;
  const message = toStringValue(args.message) || "review my setup";
  const plan = await context.deps.planDirectAgentOperation({
    userId: context.userId,
    profile,
    message,
  });

  if (!plan) {
    return {
      intentFocus: "setup_review",
      summary: "No setup review plan was produced.",
      message: "No setup review was produced for that request.",
    };
  }

  return {
    intentFocus: "setup_review",
    ...plan,
  };
}

async function buildScoutStatus(context: PublicMcpServerContext) {
  const [userState, scoutStatus, totalAssigned] = await Promise.all([
    loadUserEntitlements(context.deps.storage, context.userId),
    context.deps.storage.getScoutStatus(context.userId),
    context.deps.storage.getTotalScoutsForUser(context.userId),
  ]);

  const maxScouts = userState?.entitlements.maxScouts ?? 5;
  return {
    summary: "Loaded scout status.",
    earnedMinutes: scoutStatus.earnedMinutes,
    nextDistribution: scoutStatus.nextDistribution,
    perPlayer: scoutStatus.perPlayer || {},
    assignedScouts: totalAssigned,
    maxScouts,
    remainingScouts: Math.max(0, maxScouts - totalAssigned),
    premiumActive: userState?.entitlements.premiumActive ?? false,
    rewardedScoutBoostActive: userState?.entitlements.rewardedScoutBoostActive ?? false,
    rewardedScoutBoostExpiresAt: userState?.entitlements.rewardedScoutBoostExpiresAt ?? null,
  };
}

async function buildDashboardOverview(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const [
    portfolioSummary,
    balanceState,
    scoutStatus,
    dailyBoosts,
    communityBoostState,
    watchlists,
  ] = await Promise.all([
    executeReadTool(context, "get_portfolio_summary", args),
    executeReadTool(context, "get_balance_state", args),
    buildScoutStatus(context),
    executeReadTool(context, "get_daily_boost_state", {
      date: args.date,
    }),
    executeReadTool(context, "get_community_boost_state", {
      date: args.date,
    }),
    executeReadTool(context, "get_watchlists"),
  ]);

  return {
    summary: "Loaded dashboard overview.",
    portfolioSummary,
    balanceState,
    scoutStatus,
    dailyBoosts,
    communityBoostState,
    watchlists,
  };
}

async function searchPlayers(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const query = toStringValue(args.query || args.q || args.search);
  const team = toOptionalString(args.team) || undefined;
  const position = toOptionalString(args.position) || undefined;
  const limit = toPositiveInteger(args.limit) || 25;
  const sport = toOptionalString(args.sport)?.toUpperCase() || null;
  const players = await context.deps.storage.getPlayers({
    search: query || undefined,
    team,
    position,
  });

  return {
    summary: `Found ${Math.min(players.length, limit)} player result(s).`,
    results: players
      .filter((player) => (sport ? (player.sport || "").toUpperCase() === sport : true))
      .slice(0, limit)
      .map((player) => ({
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        fullName: `${player.firstName} ${player.lastName}`,
        sport: player.sport,
        team: player.team,
        position: player.position,
        lastTradePrice: player.lastTradePrice,
        priceChange24h: player.priceChange24h,
      })),
  };
}

async function getMarketScanners(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const sport = toOptionalString(args.sport)?.toUpperCase() || "ALL";
  return {
    summary: `Loaded ${sport} market scanners.`,
    sport,
    scanners: await context.deps.storage.getFinancialMarketScanners(sport),
  };
}

async function getGamesToday(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const sport = toOptionalString(args.sport)?.toUpperCase() || null;
  const dateStr = resolveTargetDateString(args.date);
  const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
  const games = sport
    ? await context.deps.storage.getDailyGamesBySport(sport, startOfDay, endOfDay)
    : await context.deps.storage.getDailyGames(startOfDay, endOfDay);

  return {
    summary: `Loaded ${games.length} game(s) for ${dateStr}.`,
    date: dateStr,
    sport: sport || "ALL",
    games,
  };
}

async function getGameInsights(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const sport = toOptionalString(args.sport)?.toUpperCase() || "NBA";
  const dateStr = resolveTargetDateString(args.date);
  const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
  const [games, holdingsWithPlayers, boosts] = await Promise.all([
    context.deps.storage.getDailyGamesBySport(sport, startOfDay, endOfDay),
    context.deps.storage.getUserHoldingsWithPlayers(context.userId),
    executeReadTool(context, "get_daily_boost_state", { date: dateStr }),
  ]);

  const holdingsByTeam = new Map<string, Array<{ id: string; name: string }>>();
  for (const entry of holdingsWithPlayers) {
    const player = entry?.player;
    const holding = entry?.holding;
    if (!player?.team || !holding || Number(holding.quantity || 0) <= 0) {
      continue;
    }
    const collection = holdingsByTeam.get(player.team) || [];
    collection.push({
      id: player.id,
      name: `${player.firstName} ${player.lastName}`,
    });
    holdingsByTeam.set(player.team, collection);
  }

  const dailyBoostRows = Array.isArray((boosts as Record<string, unknown>)?.boosts)
    ? (((boosts as Record<string, unknown>).boosts || []) as Array<Record<string, unknown>>)
    : Array.isArray(boosts)
      ? (boosts as Array<Record<string, unknown>>)
      : [];

  const gameInsights = games.map((game) => {
    const homeOwned = holdingsByTeam.get(game.homeTeam) || [];
    const awayOwned = holdingsByTeam.get(game.awayTeam) || [];
    const boostCount = dailyBoostRows.filter((row) => row.gameId === game.gameId).length;
    return {
      gameId: game.gameId,
      sport: game.sport,
      status: game.status,
      startTime: game.startTime,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      userContext: {
        ownedPlayers: [...homeOwned, ...awayOwned],
        eligibleCount: homeOwned.length + awayOwned.length,
        boostCount,
      },
    };
  });

  return {
    summary: `Loaded ${gameInsights.length} basic game insight row(s) for ${sport}.`,
    date: dateStr,
    sport,
    games: gameInsights,
    insightQuality: "basic",
  };
}

async function getNewsDigest(context: PublicMcpServerContext) {
  const digest = await context.deps.compileUserDigest(context.userId);
  return {
    summary: "Loaded the user's daily news digest.",
    digest,
  };
}

async function listCommunityBoostEligiblePlayers(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const dateStr = resolveTargetDateString(args.date);
  const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
  const targetDate = resolveTargetDate(args.date);
  const [games, players, activeBoosts, userHoldings] = await Promise.all([
    context.deps.storage.getDailyGames(startOfDay, endOfDay),
    context.deps.storage.getPlayers(),
    context.deps.storage.getCommunityBoostsAllSports(targetDate),
    context.deps.storage.getUserHoldings(context.userId),
  ]);

  const gameByTeam = new Map<string, Record<string, unknown>>();
  for (const game of games) {
    const simplified = {
      gameId: game.gameId,
      sport: game.sport,
      startTime: game.startTime,
      status: game.status,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
    };
    gameByTeam.set(game.homeTeam, simplified);
    gameByTeam.set(game.awayTeam, simplified);
  }

  const boostCountByPlayer = new Map<string, number>();
  const userBoostedPlayerIds = new Set<string>();
  for (const boost of activeBoosts) {
    boostCountByPlayer.set(boost.playerId, (boostCountByPlayer.get(boost.playerId) || 0) + 1);
    if (boost.creatorId === context.userId) {
      userBoostedPlayerIds.add(boost.playerId);
    }
  }

  const userCommunityShares =
    userHoldings.find((holding) => holding.assetType === "community")?.quantity || 0;
  const eligiblePlayers = players
    .filter((player) => player.isActive && player.team && gameByTeam.has(player.team))
    .map((player) => ({
      playerId: player.id,
      player,
      game: gameByTeam.get(player.team) || null,
      communityBoostCount: boostCountByPlayer.get(player.id) || 0,
      alreadyBoostedByUser: userBoostedPlayerIds.has(player.id),
    }))
    .sort((left, right) => {
      if (right.communityBoostCount !== left.communityBoostCount) {
        return right.communityBoostCount - left.communityBoostCount;
      }

      const leftName = `${left.player.firstName} ${left.player.lastName}`;
      const rightName = `${right.player.firstName} ${right.player.lastName}`;
      return leftName.localeCompare(rightName);
    })
    .slice(0, toPositiveInteger(args.limit) || 150);

  return {
    summary: `Loaded ${eligiblePlayers.length} community boost candidate(s).`,
    date: dateStr,
    userCommunityShares,
    players: eligiblePlayers,
  };
}

async function getLpZapQuote(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const preview = assertRecord(
    await executePlanTool(context, "preview_lp_zap", {
      playerId: args.playerId,
      shares: args.shares,
      sb: args.sb,
      amount: args.amount,
      sbAmount: args.sbAmount,
    }),
    "invalid_preview_result",
  );

  return {
    summary: "Loaded LP zap quote preview.",
    quote: preview,
  };
}

async function listAgentThreadState(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const threadId = toStringValue(args.threadId);
  if (!threadId) {
    throw new PublicMcpToolError("threadId is required.", "invalid_arguments");
  }

  return executeReadTool(context, "get_thread_state", {}, threadId);
}

async function getPendingAction(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const threadId = toStringValue(args.threadId);
  if (!threadId) {
    throw new PublicMcpToolError("threadId is required.", "invalid_arguments");
  }

  return executeReadTool(context, "get_pending_bundle", {}, threadId);
}

async function sendAgentMessage(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const threadId = toStringValue(args.threadId);
  const message = toStringValue(args.message);
  if (!threadId || !message) {
    throw new PublicMcpToolError("threadId and message are required.", "invalid_arguments", {
      threadId,
    });
  }

  const turn = await context.deps.sendAgentThreadMessage(context.userId, threadId, { message });
  const pendingBundle = extractPendingBundle(turn);
  return {
    summary: pendingBundle
      ? "Sent message and staged a pending action bundle."
      : "Sent message to agent thread.",
    threadId,
    ...(pendingBundle
      ? {
          pendingBundleId: toStringValue(pendingBundle.id),
          warnings: Array.isArray(pendingBundle.warnings) ? pendingBundle.warnings : [],
          confirmationRequired: true,
          pendingBundle,
        }
      : {}),
    turn,
  };
}

async function confirmPendingAction(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const threadId = toStringValue(args.threadId);
  const pendingBundleId = toStringValue(args.pendingBundleId);
  if (!threadId || !pendingBundleId) {
    throw new PublicMcpToolError("threadId and pendingBundleId are required.", "invalid_arguments");
  }

  await ensurePendingBundleMatch(context, threadId, pendingBundleId);
  const result = await context.deps.confirmAgentThread(context.userId, threadId, pendingBundleId);
  return {
    summary: "Confirmed pending action bundle.",
    threadId,
    pendingBundleId,
    result,
  };
}

async function cancelPendingAction(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const threadId = toStringValue(args.threadId);
  const pendingBundleId = toStringValue(args.pendingBundleId);
  if (!threadId || !pendingBundleId) {
    throw new PublicMcpToolError("threadId and pendingBundleId are required.", "invalid_arguments");
  }

  await ensurePendingBundleMatch(context, threadId, pendingBundleId);
  const result = await context.deps.cancelAgentThread(context.userId, threadId, pendingBundleId);
  return {
    summary: "Cancelled pending action bundle.",
    threadId,
    pendingBundleId,
    result,
  };
}

function resolveActivityTypes(args: Record<string, unknown>): UserActivityCategory[] {
  const requested = Array.isArray(args.types) ? args.types : [];
  const parsed = requested.filter((value): value is UserActivityCategory =>
    USER_ACTIVITY_CATEGORIES.includes(String(value) as UserActivityCategory),
  );
  return parsed.length > 0 ? parsed : DEFAULT_ACTIVITY_FEED_CATEGORIES;
}

async function getActivityFeed(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const feed = await context.deps.storage.getUserActivityFeed(context.userId, {
    types: resolveActivityTypes(args),
    limit: toPositiveInteger(args.limit) || 50,
    offset: Math.max(0, Number(args.offset) || 0),
  });

  const normalizedFeed = assertRecord(feed, "invalid_activity_feed");
  const items = Array.isArray(normalizedFeed.items) ? normalizedFeed.items : [];

  return {
    summary: `Loaded ${items.length} activity feed row(s).`,
    ...normalizedFeed,
  };
}

async function listWatchlistPlayerIds(context: PublicMcpServerContext) {
  const playerIds = await context.deps.storage.getWatchList(context.userId);
  return {
    summary: `Loaded ${playerIds.length} watchlist player id(s).`,
    playerIds,
  };
}

async function completeOnboarding(context: PublicMcpServerContext) {
  await context.deps.storage.markOnboardingComplete(context.userId);
  return {
    summary: "Marked onboarding as complete.",
    success: true,
  };
}

async function listCollections(context: PublicMcpServerContext) {
  const collections = await context.deps.listCollections(context.userId);
  return {
    summary: `Loaded ${collections.length} collection row(s).`,
    collections,
  };
}

async function getCollectionDetail(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const type = toStringValue(args.type);
  const targetId = toStringValue(args.targetId);
  if (!type || !targetId) {
    throw new PublicMcpToolError("type and targetId are required.", "invalid_arguments");
  }

  const detail = await context.deps.getCollectionDetail(context.userId, type, targetId);
  if (!detail) {
    throw new PublicMcpToolError("Collection not found.", "not_found", { type, targetId });
  }

  return {
    summary: `Loaded collection detail for ${type}:${targetId}.`,
    collection: detail.collection,
    ownedPlayers: detail.ownedPlayers,
  };
}

async function listMilestones(context: PublicMcpServerContext) {
  const milestones = await context.deps.listMilestones(context.userId);
  return {
    summary: `Loaded ${milestones.length} milestone row(s).`,
    milestones,
  };
}

async function celebrateMilestone(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const milestoneId = toStringValue(args.milestoneId);
  if (!milestoneId) {
    throw new PublicMcpToolError("milestoneId is required.", "invalid_arguments");
  }

  const updated = await context.deps.celebrateMilestone(context.userId, milestoneId);
  if (!updated) {
    throw new PublicMcpToolError("Milestone not found.", "not_found", { milestoneId });
  }

  return {
    summary: "Celebrated milestone.",
    success: true,
    milestoneId,
  };
}

async function getAccountProfile(context: PublicMcpServerContext) {
  const userState = await loadUserEntitlements(context.deps.storage, context.userId);
  if (!userState) {
    throw new PublicMcpToolError("User not found.", "not_found");
  }
  const user = userState.user;

  return {
    summary: "Loaded authenticated account profile.",
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      balance: user.balance,
      isPremium: userState.entitlements.premiumActive,
      premiumActive: userState.entitlements.premiumActive,
      premiumExpiresAt: userState.entitlements.premiumExpiresAt,
      rewardedScoutBoostActive: userState.entitlements.rewardedScoutBoostActive,
      rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
      maxScouts: userState.entitlements.maxScouts,
      profileImageUrl: user.profileImageUrl,
      hasSeenOnboarding: user.hasSeenOnboarding,
      lastNewsViewedAt: user.lastNewsViewedAt,
    },
  };
}

async function listApiTokens(context: PublicMcpServerContext) {
  const tokens = await context.deps.storage.listUserApiTokens(context.userId);
  return {
    summary: "Loaded API tokens.",
    maxActiveTokens: MAX_ACTIVE_API_TOKENS,
    tokens: tokens.map(toTokenView),
  };
}

async function revokeApiToken(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const tokenId = toStringValue(args.tokenId);
  if (!tokenId) {
    throw new PublicMcpToolError("tokenId is required.", "invalid_arguments");
  }

  const revoked = await context.deps.storage.revokeUserApiToken(context.userId, tokenId);
  if (!revoked) {
    throw new PublicMcpToolError("Token not found.", "not_found", { tokenId });
  }

  return {
    summary: "Revoked API token.",
    success: true,
    tokenId,
  };
}

async function getSmsSettingsTool(context: PublicMcpServerContext) {
  return {
    summary: "Loaded SMS settings.",
    link: toSmsLinkView(await context.deps.getSmsSettings(context.userId)),
  };
}

async function updateSmsSettingsTool(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const smsEnabled = toBooleanValue(args.smsEnabled);
  if (smsEnabled === null) {
    throw new PublicMcpToolError("smsEnabled must be a boolean.", "invalid_arguments");
  }

  const link = await context.deps.updateSmsSettings(context.userId, smsEnabled);
  if (!link) {
    throw new PublicMcpToolError("No linked phone found for this account.", "not_found");
  }

  return {
    summary: "Updated SMS settings.",
    link: toSmsLinkView(link),
  };
}

async function startSmsLinkTool(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const phone = toStringValue(args.phone);
  if (!phone) {
    throw new PublicMcpToolError("Phone number is required.", "invalid_arguments");
  }

  const result = await context.deps.startSmsPhoneLink(context.userId, phone);
  return {
    summary: "Started SMS phone link.",
    phoneE164: result.phoneE164,
    expiresAt: result.expiresAt,
  };
}

async function completeSmsLinkTool(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const token = toStringValue(args.token);
  if (!token) {
    throw new PublicMcpToolError("Token is required.", "invalid_arguments");
  }

  const link = await context.deps.completeSmsPhoneLink(context.userId, token);
  return {
    summary: "Completed SMS phone link.",
    link: toSmsLinkView(link),
  };
}

async function getPremiumStatusTool(context: PublicMcpServerContext) {
  const userState = await loadUserEntitlements(context.deps.storage, context.userId);
  if (!userState) {
    throw new PublicMcpToolError("User not found.", "not_found");
  }
  const user = userState.user;

  const premiumHolding = await context.deps.storage.getHolding(
    context.userId,
    "premium",
    "premium",
  );
  const recentSessions = await context.deps.storage.getUserPremiumCheckoutSessions(context.userId);

  return {
    summary: "Loaded premium status.",
    isPremium: userState.entitlements.premiumActive,
    premiumActive: userState.entitlements.premiumActive,
    premiumExpiresAt: userState.entitlements.premiumExpiresAt,
    premiumShares: premiumHolding?.quantity || 0,
    rewardedScoutBoostActive: userState.entitlements.rewardedScoutBoostActive,
    rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
    maxScouts: userState.entitlements.maxScouts,
    recentPurchases: recentSessions.filter((session) => session.status === "completed").slice(0, 5),
  };
}

async function markNewsReadTool(context: PublicMcpServerContext) {
  await context.deps.markNewsRead(context.userId);

  return {
    summary: "Marked news as read.",
    success: true,
  };
}

async function getNewsUnreadCountTool(context: PublicMcpServerContext) {
  const { count, digestCount, hasUnreadDigest, digestReleaseAt } =
    await context.deps.getNewsUnreadCount(context.userId);
  return {
    summary: "Loaded unread news counts.",
    count,
    digestCount,
    hasUnreadDigest,
    digestReleaseAt,
  };
}

async function getAgentProfileTool(context: PublicMcpServerContext) {
  const profile = await context.deps.getScoutAgentProfile(context.userId);
  return {
    summary: "Loaded agent profile.",
    profile,
  };
}

async function getAgentCapabilitiesTool(context: PublicMcpServerContext) {
  const capabilities = await context.deps.getAgentCapabilities(context.userId);
  return {
    summary: "Loaded agent capabilities.",
    capabilities,
  };
}

async function updateAgentProfileTool(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  return {
    summary: "Updated agent profile.",
    profile: await context.deps.updateScoutAgentProfile(context.userId, args),
  };
}

async function saveAgentByokTool(context: PublicMcpServerContext, args: Record<string, unknown>) {
  return {
    summary: "Saved agent BYOK credentials.",
    profile: await context.deps.saveScoutAgentByok(context.userId, args),
  };
}

async function clearAgentByokTool(context: PublicMcpServerContext) {
  return {
    summary: "Cleared agent BYOK credentials.",
    profile: await context.deps.clearScoutAgentByok(context.userId),
  };
}

async function updateUsernameTool(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const username = toStringValue(args.username);
  if (!username) {
    throw new PublicMcpToolError("Username is required.", "invalid_arguments");
  }
  if (username.length < 3 || username.length > 20) {
    throw new PublicMcpToolError(
      "Username must be between 3 and 20 characters.",
      "invalid_arguments",
    );
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    throw new PublicMcpToolError(
      "Username can only contain letters, numbers, underscores, and hyphens.",
      "invalid_arguments",
    );
  }

  const existingUser = await context.deps.storage.getUserByUsername(username);
  if (existingUser && existingUser.id !== context.userId) {
    throw new PublicMcpToolError("Username is already taken.", "conflict");
  }

  const updatedUser = await context.deps.storage.updateUsername(context.userId, username);
  if (!updatedUser) {
    throw new PublicMcpToolError("Failed to update username.", "tool_execution_failed");
  }

  return {
    summary: "Updated username.",
    username: updatedUser.username,
  };
}

async function updateProfileImageTool(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const profileImageUrl = toStringValue(args.profileImageUrl);
  if (!profileImageUrl) {
    throw new PublicMcpToolError("Profile image URL is required.", "invalid_arguments");
  }

  try {
    new URL(profileImageUrl);
  } catch {
    throw new PublicMcpToolError("Invalid URL format.", "invalid_arguments");
  }

  const updatedUser = await context.deps.storage.updateProfileImage(
    context.userId,
    profileImageUrl,
  );
  if (!updatedUser) {
    throw new PublicMcpToolError("Failed to update profile image.", "tool_execution_failed");
  }

  return {
    summary: "Updated profile image.",
    profileImageUrl: updatedUser.profileImageUrl,
  };
}

async function redeemPremiumTool(context: PublicMcpServerContext) {
  return {
    summary: "Redeemed one premium share.",
    result: await context.deps.redeemPremiumShare(context.userId),
  };
}

async function listThreadMessagesTool(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const threadId = toStringValue(args.threadId);
  if (!threadId) {
    throw new PublicMcpToolError("threadId is required.", "invalid_arguments");
  }

  const messages = await context.deps.listAgentThreadMessages(context.userId, threadId);
  return {
    summary: `Loaded ${messages.length} thread message(s).`,
    threadId,
    messages,
  };
}

async function listThreadResearchSourcesTool(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const threadId = toStringValue(args.threadId);
  if (!threadId) {
    throw new PublicMcpToolError("threadId is required.", "invalid_arguments");
  }

  const citations = await context.deps.listAgentThreadResearchSources(context.userId, threadId);
  return {
    summary: `Loaded ${citations.length} research source(s).`,
    threadId,
    citations,
  };
}

const noArgsSchema: RawSchema = {};
const optionalMessageSchema: RawSchema = {
  message: z.string().min(1).max(1200).optional(),
};
const optionalSportDateSchema: RawSchema = {
  message: z.string().min(1).max(1200).optional(),
  sport: z.string().min(2).max(16).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
};
const threadIdSchema: RawSchema = {
  threadId: z.string().min(1),
};
const pendingActionSchema: RawSchema = {
  threadId: z.string().min(1),
  pendingBundleId: z.string().min(1),
};
const tokenIdSchema: RawSchema = {
  tokenId: z.string().min(1),
};
const smsSettingsSchema: RawSchema = {
  smsEnabled: z.boolean(),
};
const startSmsLinkSchema: RawSchema = {
  phone: z.string().min(1),
};
const completeSmsLinkSchema: RawSchema = {
  token: z.string().min(1),
};
const usernameSchema: RawSchema = {
  username: z.string().min(3).max(20),
};
const profileImageSchema: RawSchema = {
  profileImageUrl: z.string().url(),
};
const updateAgentProfileSchema: RawSchema = {
  enabled: z.boolean().optional(),
  displayName: z.string().min(1).max(80).optional(),
  providerMode: z.enum(["managed", "byok"]).optional(),
  model: z.string().min(1).max(120).optional(),
  systemPrompt: z.string().max(12000).optional(),
  userPromptTemplate: z.string().max(12000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(200000).optional(),
  analysisWindowMinutes: z.number().int().min(1).max(1440).optional(),
  defaultSport: z.string().min(2).max(16).optional(),
};
const saveAgentByokSchema: RawSchema = {
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).max(120),
};
const playerIdSchema: RawSchema = {
  playerId: z.string().min(1),
};
const playerIdLimitSchema: RawSchema = {
  playerId: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
};
const listSchema: RawSchema = {
  limit: z.number().int().positive().max(200).optional(),
  sport: z.string().min(2).max(16).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
};
const searchPlayersSchema: RawSchema = {
  query: z.string().min(1).max(120).optional(),
  q: z.string().min(1).max(120).optional(),
  search: z.string().min(1).max(120).optional(),
  team: z.string().min(1).max(16).optional(),
  position: z.string().min(1).max(16).optional(),
  sport: z.string().min(2).max(16).optional(),
  limit: z.number().int().positive().max(100).optional(),
};
const watchlistIdSchema: RawSchema = {
  watchlistId: z.string().min(1),
};
const getTradeQuoteSchema: RawSchema = {
  playerId: z.string().min(1),
  type: z.enum(["buy", "sell"]),
  amount: z.number().positive(),
};
const getLpZapQuoteSchema: RawSchema = {
  playerId: z.string().min(1),
  shares: z.number().positive().optional(),
  sb: z.number().positive().optional(),
  amount: z.number().positive().optional(),
  sbAmount: z.number().positive().optional(),
};
const timeRangeSchema: RawSchema = {
  timeRange: z.enum(["1D", "7D", "1M", "1Y", "ALL"]).optional(),
};
const stageMarketBuySchema: RawSchema = {
  playerId: z.string().min(1),
  amount: z.number().positive(),
  threadId: z.string().min(1).optional(),
};
const stageMarketSellSchema: RawSchema = {
  playerId: z.string().min(1),
  shares: z.number().positive(),
  threadId: z.string().min(1).optional(),
};
const stageLpAddSchema: RawSchema = {
  playerId: z.string().min(1),
  shares: z.number().positive(),
  playMoney: z.number().positive(),
  threadId: z.string().min(1).optional(),
};
const stageLpAddOptimalSchema: RawSchema = {
  playerId: z.string().min(1),
  maxShares: z.number().positive().optional(),
  maxPlayMoney: z.number().positive().optional(),
  shares: z.number().positive().optional(),
  playMoney: z.number().positive().optional(),
  threadId: z.string().min(1).optional(),
};
const stageLpZapSchema: RawSchema = {
  playerId: z.string().min(1),
  shares: z.number().positive().optional(),
  sbAmount: z.number().positive().optional(),
  threadId: z.string().min(1).optional(),
};
const stageLpRemoveSchema: RawSchema = {
  playerId: z.string().min(1),
  lpShares: z.number().positive(),
  threadId: z.string().min(1).optional(),
};
const stageScoutSchema: RawSchema = {
  playerId: z.string().min(1),
  targetCount: z.number().int().min(0).max(10),
  threadId: z.string().min(1).optional(),
};
const stageStackSharesSchema: RawSchema = {
  playerId: z.string().min(1),
  shares: z
    .number()
    .int()
    .min(4)
    .refine((value) => value % 2 === 0, {
      message: "Stack Shares requires an even share count.",
    }),
  threadId: z.string().min(1).optional(),
};
const stageBoostSchema: RawSchema = {
  playerId: z.string().min(1),
  slotTier: z.number().int().positive(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sport: z.string().min(2).max(16).optional(),
  threadId: z.string().min(1).optional(),
};
const stageCommunityBoostSchema: RawSchema = {
  playerId: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sport: z.string().min(2).max(16).optional(),
  threadId: z.string().min(1).optional(),
};
const createWatchlistSchema: RawSchema = {
  name: z.string().min(1).max(80),
  color: z.string().min(1).max(32).optional(),
};
const updateWatchlistSchema: RawSchema = {
  watchlistId: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  color: z.string().min(1).max(32).optional(),
};
const deleteWatchlistSchema: RawSchema = {
  watchlistId: z.string().min(1),
};
const watchlistPlayerSchema: RawSchema = {
  playerId: z.string().min(1),
  watchlistId: z.string().min(1).optional(),
};
const upsertScheduleSchema: RawSchema = {
  jobType: z.string().min(1),
  enabled: z.boolean().optional(),
  scheduleCron: z.string().min(1).optional(),
  channelTargets: z.array(z.string().min(1)).optional(),
  policy: z.record(z.unknown()).optional(),
};
const deleteScheduleSchema: RawSchema = {
  jobType: z.string().min(1),
};
const createAgentThreadSchema: RawSchema = {
  title: z.string().min(1).max(120).optional(),
  channel: z.enum(["in_app", "sms", "cli"]).optional(),
};
const sendAgentMessageSchema: RawSchema = {
  threadId: z.string().min(1),
  message: z.string().min(1).max(2000),
};
const activityFeedSchema: RawSchema = {
  types: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).max(500).optional(),
};
const collectionDetailSchema: RawSchema = {
  type: z.string().min(1),
  targetId: z.string().min(1),
};
const milestoneIdSchema: RawSchema = {
  milestoneId: z.string().min(1),
};

function defineTool(definition: PublicToolDefinition): PublicToolDefinition {
  return definition;
}

const READ_ALIAS_TOOLS: PublicToolDefinition[] = [
  defineTool({
    name: "review_idle_cash",
    description: "Review the user's idle balance with cash-specific deployment context.",
    domain: "advisory",
    readOnly: true,
    inputSchema: optionalSportDateSchema,
    fixtureArgs: {},
    execute: (context, args) => executeScanTool(context, "scan_idle_balance_options", args),
  }),
  defineTool({
    name: "review_portfolio_cleanup",
    description: "Review stale, fragmented, or overexposed portfolio cleanup levers.",
    domain: "advisory",
    readOnly: true,
    inputSchema: optionalSportDateSchema,
    fixtureArgs: {},
    execute: (context, args) => executeScanTool(context, "scan_portfolio_cleanup_levers", args),
  }),
  defineTool({
    name: "list_boost_candidates",
    description: "Rank the best daily boost candidates for the requested window.",
    domain: "boosts",
    readOnly: true,
    inputSchema: listSchema,
    fixtureArgs: { sport: "NBA" },
    execute: async (context, args) =>
      executeScanTool(context, "scan_daily_boost_candidates", {
        ...args,
        sport: args.sport || (await resolvePreferredSport(context, args)),
      }),
  }),
  defineTool({
    name: "list_scout_opportunities",
    description: "Rank the strongest current scout targets and reallocation opportunities.",
    domain: "scouting",
    readOnly: true,
    inputSchema: optionalMessageSchema,
    fixtureArgs: {},
    execute: (context, args) => executeScanTool(context, "scan_scout_opportunities", args),
  }),
  defineTool({
    name: "list_market_opportunities",
    description: "List the strongest current market-facing opportunities.",
    domain: "market",
    readOnly: true,
    inputSchema: optionalMessageSchema,
    fixtureArgs: {},
    execute: (context, args) => executeScanTool(context, "scan_top_market_opportunities", args),
  }),
  defineTool({
    name: "review_news_impact",
    description: "Review current hosted research and explain account-specific impact.",
    domain: "research",
    readOnly: true,
    inputSchema: optionalMessageSchema,
    fixtureArgs: { message: "What changed today that affects my setup?" },
    execute: (context, args) => executeScanTool(context, "scan_news_impact", args),
  }),
  defineTool({
    name: "get_balance_state",
    description: "Read available balance, open boost slots, and community share availability.",
    domain: "account",
    readOnly: true,
    inputSchema: optionalSportDateSchema,
    fixtureArgs: {},
    execute: (context, args) => executeReadTool(context, "get_balance_state", args),
  }),
  defineTool({
    name: "get_portfolio_summary",
    description: "Read the user's portfolio summary and operator overview.",
    domain: "portfolio",
    readOnly: true,
    inputSchema: optionalSportDateSchema,
    fixtureArgs: {},
    execute: (context, args) => executeReadTool(context, "get_portfolio_summary", args),
  }),
  defineTool({
    name: "get_holdings",
    description: "List current player holdings, multiplier state, and available shares.",
    domain: "portfolio",
    readOnly: true,
    inputSchema: {
      limit: z.number().int().positive().max(100).optional(),
      sport: z.string().min(2).max(16).optional(),
    },
    fixtureArgs: { limit: 10 },
    execute: (context, args) => executeReadTool(context, "get_holdings", args),
  }),
  defineTool({
    name: "get_trade_history",
    description: "Read recent market activity for the user.",
    domain: "market",
    readOnly: true,
    inputSchema: {
      limit: z.number().int().positive().max(200).optional(),
      sport: z.string().min(2).max(16).optional(),
    },
    fixtureArgs: { limit: 10 },
    execute: (context, args) => executeReadTool(context, "get_trade_history", args),
  }),
  defineTool({
    name: "get_portfolio_history",
    description: "Read portfolio history snapshots for a standard time range.",
    domain: "portfolio",
    readOnly: true,
    inputSchema: timeRangeSchema,
    fixtureArgs: { timeRange: "1M" },
    execute: (context, args) => executeReadTool(context, "get_portfolio_history", args),
  }),
  defineTool({
    name: "get_player_detail",
    description:
      "Load a player's detail, stats, recent games, market context, and user holding state.",
    domain: "players",
    readOnly: true,
    inputSchema: playerIdLimitSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: (context, args) => executeReadTool(context, "get_player_detail", args),
  }),
  defineTool({
    name: "get_player_stats",
    description: "Load season stats for a player.",
    domain: "players",
    readOnly: true,
    inputSchema: playerIdSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: (context, args) => executeReadTool(context, "get_player_stats", args),
  }),
  defineTool({
    name: "get_player_recent_games",
    description: "Load recent game logs for a player.",
    domain: "players",
    readOnly: true,
    inputSchema: playerIdLimitSchema,
    fixtureArgs: { playerId: "player_1", limit: 5 },
    execute: (context, args) => executeReadTool(context, "get_player_recent_games", args),
  }),
  defineTool({
    name: "get_player_financial_metrics",
    description: "Load player market and financial metrics.",
    domain: "players",
    readOnly: true,
    inputSchema: playerIdSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: (context, args) => executeReadTool(context, "get_player_financial_metrics", args),
  }),
  defineTool({
    name: "get_player_shares_info",
    description: "Load share structure info for a player.",
    domain: "players",
    readOnly: true,
    inputSchema: playerIdSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: (context, args) => executeReadTool(context, "get_player_shares_info", args),
  }),
  defineTool({
    name: "list_watchlist_player_ids",
    description: "List every player id across the user's watchlists.",
    domain: "watchlists",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: listWatchlistPlayerIds,
  }),
  defineTool({
    name: "list_watchlists",
    description: "List the user's watchlists.",
    domain: "watchlists",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: (context) => executeReadTool(context, "get_watchlists"),
  }),
  defineTool({
    name: "get_watchlist_items",
    description: "List player ids in a watchlist.",
    domain: "watchlists",
    readOnly: true,
    inputSchema: watchlistIdSchema,
    fixtureArgs: { watchlistId: "watch_1" },
    execute: (context, args) => executeReadTool(context, "get_watchlist_items", args),
  }),
  defineTool({
    name: "list_player_watchlists",
    description: "List the watchlists containing a player.",
    domain: "watchlists",
    readOnly: true,
    inputSchema: playerIdSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: (context, args) => executeReadTool(context, "get_player_watchlists", args),
  }),
  defineTool({
    name: "get_holding_multiplier_state",
    description: "Read holding multiplier and available share state for a player.",
    domain: "portfolio",
    readOnly: true,
    inputSchema: playerIdSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: (context, args) => executeReadTool(context, "get_holding_multiplier_state", args),
  }),
  defineTool({
    name: "list_daily_boosts",
    description: "List the user's daily boosts for a requested date.",
    domain: "boosts",
    readOnly: true,
    inputSchema: {
      sport: z.string().min(2).max(16).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    },
    fixtureArgs: {},
    execute: (context, args) => executeReadTool(context, "get_daily_boost_state", args),
  }),
  defineTool({
    name: "list_daily_boost_history",
    description: "List recent daily boost history and payouts.",
    domain: "boosts",
    readOnly: true,
    inputSchema: {
      limit: z.number().int().positive().max(100).optional(),
    },
    fixtureArgs: { limit: 10 },
    execute: (context, args) => executeReadTool(context, "get_daily_boost_history", args),
  }),
  defineTool({
    name: "get_community_boost_state",
    description: "Load community share availability and current community boosts.",
    domain: "community_boosts",
    readOnly: true,
    inputSchema: {
      sport: z.string().min(2).max(16).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    },
    fixtureArgs: {},
    execute: (context, args) => executeReadTool(context, "get_community_boost_state", args),
  }),
  defineTool({
    name: "list_lp_positions",
    description: "List the user's LP positions.",
    domain: "liquidity",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: (context) => executeReadTool(context, "get_lp_positions"),
  }),
  defineTool({
    name: "get_lp_position",
    description: "Load a single LP position by player id.",
    domain: "liquidity",
    readOnly: true,
    inputSchema: playerIdSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: (context, args) => executeReadTool(context, "get_lp_position", args),
  }),
  defineTool({
    name: "list_lp_history",
    description: "List recent LP transaction history.",
    domain: "liquidity",
    readOnly: true,
    inputSchema: {
      playerId: z.string().min(1).optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    fixtureArgs: { limit: 10 },
    execute: (context, args) => executeReadTool(context, "get_lp_history", args),
  }),
  defineTool({
    name: "get_amm_pool_state",
    description: "Load the AMM pool state for a player.",
    domain: "market",
    readOnly: true,
    inputSchema: playerIdSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: (context, args) => executeReadTool(context, "get_amm_pool_state", args),
  }),
  defineTool({
    name: "get_trade_quote",
    description: "Load a buy or sell quote from the AMM.",
    domain: "market",
    readOnly: true,
    inputSchema: getTradeQuoteSchema,
    fixtureArgs: { playerId: "player_1", type: "buy", amount: 25 },
    execute: (context, args) => executeReadTool(context, "get_amm_trade_quote", args),
  }),
  defineTool({
    name: "list_schedules",
    description: "List the user's advisory schedules.",
    domain: "schedules",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: (context) => executeReadTool(context, "get_user_schedules"),
  }),
  defineTool({
    name: "list_schedule_templates",
    description: "List supported schedule templates.",
    domain: "schedules",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: (context) => executeReadTool(context, "get_schedule_templates"),
  }),
];

const CUSTOM_TOOLS: PublicToolDefinition[] = [
  defineTool({
    name: "review_setup",
    description: "Review the user's overall setup with a broad gameplay read.",
    domain: "advisory",
    readOnly: true,
    inputSchema: optionalSportDateSchema,
    fixtureArgs: {},
    execute: buildSetupReview,
  }),
  defineTool({
    name: "get_dashboard_overview",
    description:
      "Load a composed dashboard overview spanning balance, portfolio, boosts, scouts, and watchlists.",
    domain: "dashboard",
    readOnly: true,
    inputSchema: optionalSportDateSchema,
    fixtureArgs: {},
    execute: buildDashboardOverview,
  }),
  defineTool({
    name: "get_account_profile",
    description: "Load the authenticated user's core account profile.",
    domain: "account",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: getAccountProfile,
  }),
  defineTool({
    name: "get_activity_feed",
    description: "Load the authenticated user's activity feed.",
    domain: "account",
    readOnly: true,
    inputSchema: activityFeedSchema,
    fixtureArgs: { limit: 20 },
    execute: getActivityFeed,
  }),
  defineTool({
    name: "complete_onboarding",
    description: "Mark onboarding as complete for the authenticated user.",
    domain: "account",
    readOnly: false,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: completeOnboarding,
  }),
  defineTool({
    name: "list_api_tokens",
    description: "List API tokens for the authenticated account.",
    domain: "account",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: listApiTokens,
  }),
  defineTool({
    name: "get_sms_settings",
    description: "Load current SMS link and opt-in settings.",
    domain: "sms",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: getSmsSettingsTool,
  }),
  defineTool({
    name: "get_premium_status",
    description: "Load the authenticated user's premium status and redeemable share count.",
    domain: "premium",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: getPremiumStatusTool,
  }),
  defineTool({
    name: "get_agent_profile",
    description: "Load the current agent profile configuration.",
    domain: "agent_settings",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: getAgentProfileTool,
  }),
  defineTool({
    name: "get_agent_capabilities",
    description: "Load the current agent capability summary.",
    domain: "agent_settings",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: getAgentCapabilitiesTool,
  }),
  defineTool({
    name: "search_players",
    description: "Search active players by name, team, or position.",
    domain: "players",
    readOnly: true,
    inputSchema: searchPlayersSchema,
    fixtureArgs: { query: "Jalen" },
    execute: searchPlayers,
  }),
  defineTool({
    name: "get_market_scanners",
    description: "Load current market scanner buckets.",
    domain: "market",
    readOnly: true,
    inputSchema: {
      sport: z.string().min(2).max(16).optional(),
    },
    fixtureArgs: { sport: "NBA" },
    execute: getMarketScanners,
  }),
  defineTool({
    name: "get_games_today",
    description: "Load games for today or a requested date.",
    domain: "games",
    readOnly: true,
    inputSchema: listSchema,
    fixtureArgs: { sport: "NBA" },
    execute: getGamesToday,
  }),
  defineTool({
    name: "get_game_insights",
    description: "Load a game-centric view with user-context basics for the requested slate.",
    domain: "games",
    readOnly: true,
    inputSchema: {
      sport: z.string().min(2).max(16).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    },
    fixtureArgs: { sport: "NBA" },
    execute: getGameInsights,
  }),
  defineTool({
    name: "get_news_digest",
    description: "Load the user's compiled daily digest.",
    domain: "news",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: getNewsDigest,
  }),
  defineTool({
    name: "get_news_unread_count",
    description: "Load unread news and digest badge counts for the authenticated user.",
    domain: "news",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: getNewsUnreadCountTool,
  }),
  defineTool({
    name: "mark_news_read",
    description: "Mark the authenticated user's news digest as read.",
    domain: "news",
    readOnly: false,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: markNewsReadTool,
  }),
  defineTool({
    name: "list_collections",
    description: "Load the authenticated user's tracked collections.",
    domain: "collections",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: listCollections,
  }),
  defineTool({
    name: "get_collection_detail",
    description: "Load a specific collection and any matching owned players.",
    domain: "collections",
    readOnly: true,
    inputSchema: collectionDetailSchema,
    fixtureArgs: { type: "team", targetId: "NYK" },
    execute: getCollectionDetail,
  }),
  defineTool({
    name: "list_milestones",
    description: "Load the authenticated user's milestone history.",
    domain: "milestones",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: listMilestones,
  }),
  defineTool({
    name: "celebrate_milestone",
    description: "Mark a milestone as celebrated.",
    domain: "milestones",
    readOnly: false,
    inputSchema: milestoneIdSchema,
    fixtureArgs: { milestoneId: "milestone_1" },
    execute: celebrateMilestone,
  }),
  defineTool({
    name: "search_docs",
    description: "Search Sportfolio documentation articles.",
    domain: "docs",
    readOnly: true,
    inputSchema: {
      query: z.string().min(1),
    },
    fixtureArgs: { query: "daily boosts" },
    execute: async (context, args) => ({
      summary: `Found documentation results for "${toStringValue(args.query)}".`,
      results: context.deps.searchDocsArticles(toStringValue(args.query), true),
    }),
  }),
  defineTool({
    name: "get_doc_article",
    description: "Load a documentation article by section and slug.",
    domain: "docs",
    readOnly: true,
    inputSchema: {
      section: z.string().min(1),
      slug: z.string().min(1),
    },
    fixtureArgs: { section: "gameplay", slug: "stacking-shares-and-boosts" },
    execute: async (context, args) => {
      const section = toStringValue(args.section);
      const slug = toStringValue(args.slug);
      const article = context.deps.getDocsArticle(section, slug, true);
      if (!article) {
        throw new PublicMcpToolError("Docs article not found.", "not_found", { section, slug });
      }
      return {
        summary: `Loaded docs article ${article.title}.`,
        article,
      };
    },
  }),
  defineTool({
    name: "run_hosted_research",
    description: "Run hosted web research through the existing Hermes research path.",
    domain: "research",
    readOnly: true,
    inputSchema: {
      message: z.string().min(1).max(1200),
    },
    fixtureArgs: { message: "latest Nikola Jokic news" },
    execute: (context, args) => executeReadTool(context, "get_hosted_research", args),
  }),
  defineTool({
    name: "get_scout_status",
    description: "Load current scout status, assignment totals, and next distribution timing.",
    domain: "scouting",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: buildScoutStatus,
  }),
  defineTool({
    name: "list_scout_assignments",
    description: "List the user's current scout assignments.",
    domain: "scouting",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: async (context) => ({
      summary: "Loaded scout assignments.",
      assignments: await context.deps.storage.getUserScoutAssignments(context.userId),
    }),
  }),
  defineTool({
    name: "get_scout_roster",
    description: "Load the scout roster for a player.",
    domain: "scouting",
    readOnly: true,
    inputSchema: playerIdSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: async (context, args) => ({
      summary: "Loaded scout roster.",
      playerId: toStringValue(args.playerId),
      roster: await context.deps.storage.getScoutRoster(toStringValue(args.playerId)),
    }),
  }),
  defineTool({
    name: "list_daily_boost_eligible_players",
    description: "List holdings eligible for a daily boost.",
    domain: "boosts",
    readOnly: true,
    inputSchema: listSchema,
    fixtureArgs: { sport: "NBA" },
    execute: async (context, args) =>
      executeReadTool(context, "get_daily_boost_eligibility", {
        ...args,
        sport: args.sport || (await resolvePreferredSport(context, args)),
      }),
  }),
  defineTool({
    name: "list_community_boost_history",
    description: "Return the current site-equivalent community boost history surface.",
    domain: "community_boosts",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: async () => ({
      summary: "Community boost history currently has no dedicated persisted history surface.",
      history: [],
    }),
  }),
  defineTool({
    name: "list_community_boost_eligible_players",
    description: "List players eligible for a community boost on the requested date.",
    domain: "community_boosts",
    readOnly: true,
    inputSchema: {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    fixtureArgs: {},
    execute: listCommunityBoostEligiblePlayers,
  }),
  defineTool({
    name: "get_lp_zap_quote",
    description: "Load a preview quote for a single-sided LP zap.",
    domain: "liquidity",
    readOnly: true,
    inputSchema: getLpZapQuoteSchema,
    fixtureArgs: { playerId: "player_1", sbAmount: 25 },
    execute: getLpZapQuote,
  }),
  defineTool({
    name: "list_agent_threads",
    description: "List recent agent threads.",
    domain: "threads",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: async (context) => ({
      summary: "Loaded agent threads.",
      threads: await context.deps.listAgentThreads(context.userId),
    }),
  }),
  defineTool({
    name: "get_thread_state",
    description: "Load thread state and messages.",
    domain: "threads",
    readOnly: true,
    inputSchema: threadIdSchema,
    fixtureArgs: { threadId: "thread_1" },
    execute: listAgentThreadState,
  }),
  defineTool({
    name: "list_thread_messages",
    description: "List messages for a thread.",
    domain: "threads",
    readOnly: true,
    inputSchema: threadIdSchema,
    fixtureArgs: { threadId: "thread_1" },
    execute: listThreadMessagesTool,
  }),
  defineTool({
    name: "list_thread_research_sources",
    description: "List research sources attached to a thread.",
    domain: "threads",
    readOnly: true,
    inputSchema: threadIdSchema,
    fixtureArgs: { threadId: "thread_1" },
    execute: listThreadResearchSourcesTool,
  }),
  defineTool({
    name: "get_pending_action",
    description: "Load the active pending action bundle for a thread.",
    domain: "threads",
    readOnly: true,
    inputSchema: threadIdSchema,
    fixtureArgs: { threadId: "thread_1" },
    execute: getPendingAction,
  }),
  defineTool({
    name: "stage_market_buy",
    description: "Stage a market buy for confirmation.",
    domain: "market",
    readOnly: false,
    inputSchema: stageMarketBuySchema,
    fixtureArgs: { playerId: "player_1", amount: 25 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_pool_buy",
        previewArgs: {
          playerId: args.playerId,
          sbAmount: args.amount,
        },
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "stage_market_sell",
    description: "Stage a market sell for confirmation.",
    domain: "market",
    readOnly: false,
    inputSchema: stageMarketSellSchema,
    fixtureArgs: { playerId: "player_1", shares: 4 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_pool_sell",
        previewArgs: {
          playerId: args.playerId,
          shares: args.shares,
        },
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "stage_lp_add",
    description: "Stage a fixed-ratio LP add for confirmation.",
    domain: "liquidity",
    readOnly: false,
    inputSchema: stageLpAddSchema,
    fixtureArgs: { playerId: "player_1", shares: 2, playMoney: 10 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_lp_add",
        previewArgs: {
          playerId: args.playerId,
          shares: args.shares,
          playMoney: args.playMoney,
        },
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "stage_lp_add_optimal",
    description: "Stage an optimal-ratio LP add for confirmation.",
    domain: "liquidity",
    readOnly: false,
    inputSchema: stageLpAddOptimalSchema,
    fixtureArgs: { playerId: "player_1", maxShares: 4, maxPlayMoney: 25 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_lp_add_optimal",
        previewArgs: {
          playerId: args.playerId,
          maxShares: args.maxShares ?? args.shares,
          maxPlayMoney: args.maxPlayMoney ?? args.playMoney,
        },
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "stage_lp_zap_add",
    description: "Stage a single-sided LP zap for confirmation.",
    domain: "liquidity",
    readOnly: false,
    inputSchema: stageLpZapSchema,
    fixtureArgs: { playerId: "player_1", sbAmount: 25 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_lp_zap",
        previewArgs: {
          playerId: args.playerId,
          shares: args.shares,
          sbAmount: args.sbAmount,
          amount: args.sbAmount,
          sb: args.sbAmount,
        },
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "stage_lp_remove",
    description: "Stage an LP removal for confirmation.",
    domain: "liquidity",
    readOnly: false,
    inputSchema: stageLpRemoveSchema,
    fixtureArgs: { playerId: "player_1", lpShares: 1 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_lp_remove",
        previewArgs: {
          playerId: args.playerId,
          lpShares: args.lpShares,
        },
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "stage_scout_assignment",
    description: "Stage a scout assignment change for confirmation.",
    domain: "scouting",
    readOnly: false,
    inputSchema: stageScoutSchema,
    fixtureArgs: { playerId: "player_1", targetCount: 2 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_scout_adjustment",
        previewArgs: args,
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "stage_stack_shares",
    description: "Stage a Stack Shares action for confirmation.",
    domain: "portfolio",
    readOnly: false,
    inputSchema: stageStackSharesSchema,
    fixtureArgs: { playerId: "player_1", shares: 4 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_stack_shares",
        previewArgs: {
          playerId: args.playerId,
          shares: args.shares,
        },
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "stage_daily_boost_assign",
    description: "Stage a daily boost assignment for confirmation.",
    domain: "boosts",
    readOnly: false,
    inputSchema: stageBoostSchema,
    fixtureArgs: { playerId: "player_1", slotTier: 4, sport: "NBA" },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_daily_boost_assign",
        previewArgs: args,
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "stage_daily_boost_remove",
    description: "Stage a daily boost removal for confirmation.",
    domain: "boosts",
    readOnly: false,
    inputSchema: stageBoostSchema,
    fixtureArgs: { playerId: "player_1", slotTier: 4, sport: "NBA" },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_daily_boost_remove",
        previewArgs: args,
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "create_watchlist",
    description: "Create a watchlist immediately.",
    domain: "watchlists",
    readOnly: false,
    inputSchema: createWatchlistSchema,
    fixtureArgs: { name: "MCP Watchlist" },
    execute: (context, args) => executeActionTool(context, "create_watchlist", args),
  }),
  defineTool({
    name: "update_watchlist",
    description: "Update a watchlist immediately.",
    domain: "watchlists",
    readOnly: false,
    inputSchema: updateWatchlistSchema,
    fixtureArgs: { watchlistId: "watch_1", name: "Updated Watchlist" },
    execute: (context, args) => executeActionTool(context, "update_watchlist", args),
  }),
  defineTool({
    name: "delete_watchlist",
    description: "Delete a watchlist immediately.",
    domain: "watchlists",
    readOnly: false,
    inputSchema: deleteWatchlistSchema,
    fixtureArgs: { watchlistId: "watch_1" },
    execute: (context, args) => executeActionTool(context, "delete_watchlist", args),
  }),
  defineTool({
    name: "add_watchlist_player",
    description: "Add a player to a watchlist immediately.",
    domain: "watchlists",
    readOnly: false,
    inputSchema: watchlistPlayerSchema,
    fixtureArgs: { playerId: "player_1", watchlistId: "watch_1" },
    execute: (context, args) => executeActionTool(context, "add_watchlist_player", args),
  }),
  defineTool({
    name: "remove_watchlist_player",
    description: "Remove a player from a watchlist immediately.",
    domain: "watchlists",
    readOnly: false,
    inputSchema: watchlistPlayerSchema,
    fixtureArgs: { playerId: "player_1", watchlistId: "watch_1" },
    execute: (context, args) => executeActionTool(context, "remove_watchlist_player", args),
  }),
  defineTool({
    name: "stage_community_boost_create",
    description: "Stage a community boost creation for confirmation.",
    domain: "community_boosts",
    readOnly: false,
    inputSchema: stageCommunityBoostSchema,
    fixtureArgs: { playerId: "player_1", sport: "NBA" },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_community_boost_create",
        previewArgs: args,
        threadId: toOptionalString(args.threadId),
      }),
  }),
  defineTool({
    name: "upsert_schedule",
    description: "Create or update an advisory schedule immediately.",
    domain: "schedules",
    readOnly: false,
    inputSchema: upsertScheduleSchema,
    fixtureArgs: {
      jobType: "daily_setup_review",
      enabled: true,
      scheduleCron: "0 8 * * *",
      channelTargets: ["in_app"],
    },
    execute: (context, args) => executeActionTool(context, "upsert_user_schedule", args),
  }),
  defineTool({
    name: "delete_schedule",
    description: "Delete an advisory schedule immediately.",
    domain: "schedules",
    readOnly: false,
    inputSchema: deleteScheduleSchema,
    fixtureArgs: { jobType: "daily_setup_review" },
    execute: (context, args) => executeActionTool(context, "delete_user_schedule", args),
  }),
  defineTool({
    name: "revoke_api_token",
    description: "Revoke an API token immediately.",
    domain: "account",
    readOnly: false,
    inputSchema: tokenIdSchema,
    fixtureArgs: { tokenId: "token_1" },
    execute: revokeApiToken,
  }),
  defineTool({
    name: "update_username",
    description: "Update the authenticated user's username immediately.",
    domain: "account",
    readOnly: false,
    inputSchema: usernameSchema,
    fixtureArgs: { username: "cli_user_demo" },
    execute: updateUsernameTool,
  }),
  defineTool({
    name: "update_profile_image",
    description: "Update the authenticated user's profile image immediately.",
    domain: "account",
    readOnly: false,
    inputSchema: profileImageSchema,
    fixtureArgs: { profileImageUrl: "https://example.com/avatar.png" },
    execute: updateProfileImageTool,
  }),
  defineTool({
    name: "update_sms_settings",
    description: "Update SMS opt-in settings immediately.",
    domain: "sms",
    readOnly: false,
    inputSchema: smsSettingsSchema,
    fixtureArgs: { smsEnabled: true },
    execute: updateSmsSettingsTool,
  }),
  defineTool({
    name: "start_sms_link",
    description: "Start an SMS phone-link flow immediately.",
    domain: "sms",
    readOnly: false,
    inputSchema: startSmsLinkSchema,
    fixtureArgs: { phone: "+15555550123" },
    execute: startSmsLinkTool,
  }),
  defineTool({
    name: "complete_sms_link",
    description: "Complete an SMS phone-link flow immediately.",
    domain: "sms",
    readOnly: false,
    inputSchema: completeSmsLinkSchema,
    fixtureArgs: { token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    execute: completeSmsLinkTool,
  }),
  defineTool({
    name: "update_agent_profile",
    description: "Update the user's agent profile immediately.",
    domain: "agent_settings",
    readOnly: false,
    inputSchema: updateAgentProfileSchema,
    fixtureArgs: { enabled: true, defaultSport: "NBA" },
    execute: updateAgentProfileTool,
  }),
  defineTool({
    name: "save_agent_byok",
    description: "Save BYOK credentials for the user's agent immediately.",
    domain: "agent_settings",
    readOnly: false,
    inputSchema: saveAgentByokSchema,
    fixtureArgs: {
      apiKey: "sk-demo-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
    },
    execute: saveAgentByokTool,
  }),
  defineTool({
    name: "clear_agent_byok",
    description: "Clear the user's saved BYOK credentials immediately.",
    domain: "agent_settings",
    readOnly: false,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: clearAgentByokTool,
  }),
  defineTool({
    name: "redeem_premium",
    description: "Redeem one premium share immediately for premium access.",
    domain: "premium",
    readOnly: false,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: redeemPremiumTool,
  }),
  defineTool({
    name: "create_agent_thread",
    description: "Create an agent thread.",
    domain: "threads",
    readOnly: false,
    inputSchema: createAgentThreadSchema,
    fixtureArgs: { title: "MCP Thread", channel: "cli" },
    execute: async (context, args) => ({
      summary: "Created agent thread.",
      thread: await context.deps.createAgentThread(context.userId, {
        title: toOptionalString(args.title) || undefined,
        channel: toOptionalString(args.channel) || "cli",
        domain: "sportfolio",
      }),
    }),
  }),
  defineTool({
    name: "send_agent_message",
    description: "Send a message into an agent thread.",
    domain: "threads",
    readOnly: false,
    inputSchema: sendAgentMessageSchema,
    fixtureArgs: { threadId: "thread_1", message: "review my setup" },
    execute: sendAgentMessage,
  }),
  defineTool({
    name: "confirm_pending_action",
    description: "Confirm a staged pending action bundle.",
    domain: "threads",
    readOnly: false,
    inputSchema: pendingActionSchema,
    fixtureArgs: { threadId: "thread_1", pendingBundleId: "bundle_1" },
    execute: confirmPendingAction,
  }),
  defineTool({
    name: "cancel_pending_action",
    description: "Cancel a staged pending action bundle.",
    domain: "threads",
    readOnly: false,
    inputSchema: pendingActionSchema,
    fixtureArgs: { threadId: "thread_1", pendingBundleId: "bundle_1" },
    execute: cancelPendingAction,
  }),
];

async function defaultListCollections(userId: string): Promise<unknown[]> {
  try {
    return await db
      .select()
      .from(userCollections)
      .where(eq(userCollections.userId, userId))
      .orderBy(desc(userCollections.completed), desc(userCollections.updatedAt));
  } catch (error: any) {
    if (error?.code === "42P01") {
      return [];
    }
    throw error;
  }
}

async function defaultGetCollectionDetail(
  userId: string,
  type: string,
  targetId: string,
): Promise<{ collection: unknown; ownedPlayers: unknown[] } | null> {
  try {
    const collection = await db
      .select()
      .from(userCollections)
      .where(
        and(
          eq(userCollections.userId, userId),
          eq(userCollections.collectionType, type),
          eq(userCollections.targetId, targetId),
        ),
      )
      .limit(1);

    if (collection.length === 0) {
      return null;
    }

    let ownedPlayers: unknown[] = [];
    if (type === "team") {
      ownedPlayers = await db
        .select({
          playerId: players.id,
          firstName: players.firstName,
          lastName: players.lastName,
          position: players.position,
          team: players.team,
          quantity: holdings.quantity,
        })
        .from(players)
        .leftJoin(
          holdings,
          and(
            eq(holdings.assetId, players.id),
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
          ),
        )
        .where(and(eq(players.team, targetId), eq(players.isActive, true)))
        .then((rows) =>
          rows.filter((row) => {
            const quantity = Number(row.quantity || 0);
            return Number.isFinite(quantity) && quantity > 0;
          }),
        );
    }

    return {
      collection: collection[0],
      ownedPlayers,
    };
  } catch (error: any) {
    if (error?.code === "42P01") {
      return null;
    }
    throw error;
  }
}

async function defaultListMilestones(userId: string): Promise<unknown[]> {
  try {
    return await db
      .select()
      .from(userMilestones)
      .where(eq(userMilestones.userId, userId))
      .orderBy(desc(userMilestones.achievedAt));
  } catch (error: any) {
    if (error?.code === "42P01") {
      return [];
    }
    throw error;
  }
}

async function defaultCelebrateMilestone(userId: string, milestoneId: string): Promise<boolean> {
  try {
    const milestone = await db
      .select({ id: userMilestones.id })
      .from(userMilestones)
      .where(and(eq(userMilestones.id, milestoneId), eq(userMilestones.userId, userId)))
      .limit(1);

    if (milestone.length === 0) {
      return false;
    }

    await db
      .update(userMilestones)
      .set({ celebrated: true })
      .where(eq(userMilestones.id, milestoneId));

    return true;
  } catch (error: any) {
    if (error?.code === "42P01") {
      return false;
    }
    throw error;
  }
}

async function defaultMarkNewsRead(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      lastNewsViewedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

async function defaultGetNewsUnreadCount(userId: string) {
  const user = await storage.getUser(userId);
  const lastViewed = user?.lastNewsViewedAt || new Date(0);
  const countResult = await db
    .select({
      count: sql<number>`COUNT(*)`,
    })
    .from(newsFeed)
    .where(gte(newsFeed.createdAt, lastViewed));

  const count = countResult[0]?.count || 0;
  const now = new Date();
  const todayET = getTodayET();
  const { startOfDay: todayStartET } = getETDayBoundaries(todayET);
  let digestReleaseAt = new Date(todayStartET.getTime() + 6 * 60 * 60 * 1000);

  if (now < digestReleaseAt) {
    digestReleaseAt = new Date(digestReleaseAt.getTime() - 24 * 60 * 60 * 1000);
  }

  const hasUnreadDigest = lastViewed < digestReleaseAt;
  return {
    count,
    digestCount: hasUnreadDigest ? 1 : 0,
    hasUnreadDigest,
    digestReleaseAt,
  };
}

export function createDefaultPublicMcpDependencies(): PublicMcpDependencies {
  return {
    storage,
    runHermesReadTool,
    runHermesScanTool,
    runHermesPlanTool,
    runHermesActionTool,
    planDirectAgentOperation,
    getScoutAgentProfile,
    getAgentCapabilities,
    updateScoutAgentProfile,
    saveScoutAgentByok,
    clearScoutAgentByok,
    createAgentThread,
    sendAgentThreadMessage,
    stageAgentThreadBundle,
    confirmAgentThread,
    cancelAgentThread,
    getAgentThread,
    listAgentThreadMessages,
    listAgentThreadResearchSources,
    listAgentThreads,
    listDocsArticles,
    searchDocsArticles,
    getDocsArticle,
    getSmsSettings,
    updateSmsSettings,
    startSmsPhoneLink,
    completeSmsPhoneLink,
    redeemPremiumShare,
    compileUserDigest: async (userId: string) => {
      const module = await import("../jobs/compile-digest");
      return module.compileUserDigest(userId);
    },
    listCollections: defaultListCollections,
    getCollectionDetail: defaultGetCollectionDetail,
    listMilestones: defaultListMilestones,
    celebrateMilestone: defaultCelebrateMilestone,
    markNewsRead: defaultMarkNewsRead,
    getNewsUnreadCount: defaultGetNewsUnreadCount,
    getInternalMlbMcpToolCatalog,
    runInternalMlbMcpToolBounded,
  };
}

const PUBLIC_EXCLUDED_CAPABILITIES: PublicExcludedCapability[] = [
  {
    capabilityId: "premium_checkout_session",
    kind: "excluded",
    status: "excluded",
    domain: "billing",
    source: "/api/premium/checkout-session",
    notes: "External purchase flow remains excluded from the shared public capability surface.",
  },
  {
    capabilityId: "community_checkout_session",
    kind: "excluded",
    status: "excluded",
    domain: "billing",
    source: "/api/community/checkout-session",
    notes: "External purchase flow remains excluded from the shared public capability surface.",
  },
  {
    capabilityId: "checkout_finalize",
    kind: "excluded",
    status: "excluded",
    domain: "billing",
    source: "/api/checkout/finalize",
    notes:
      "External purchase settlement remains excluded from the shared public capability surface.",
  },
  {
    capabilityId: "user_add_cash",
    kind: "excluded",
    status: "excluded",
    domain: "billing",
    source: "/api/user/add-cash",
    notes: "Funding flows remain excluded from the shared public capability surface.",
  },
  {
    capabilityId: "account_token_creation",
    kind: "excluded",
    status: "excluded",
    domain: "account",
    source: "/api/account/tokens",
    notes:
      "API token creation remains web-session-only and must not be exposed through bearer-token CLI or MCP surfaces.",
  },
  {
    capabilityId: "whop_provider_sync",
    kind: "excluded",
    status: "excluded",
    domain: "billing",
    source: "/api/whop/sync",
    notes:
      "External Whop payment-provider synchronization remains outside the shared public capability surface.",
  },
  {
    capabilityId: "mobile_rewarded_scout_boost_session",
    kind: "excluded",
    status: "excluded",
    domain: "mobile",
    source: "/api/mobile/rewarded-scout-boost/session",
    notes:
      "Native mobile rewarded ad session bootstrap stays outside the shared CLI and MCP capability surface.",
  },
  {
    capabilityId: "mobile_rewarded_scout_boost_session_status",
    kind: "excluded",
    status: "excluded",
    domain: "mobile",
    source: "/api/mobile/rewarded-scout-boost/session/:rewardSessionId/status",
    notes:
      "Native mobile rewarded ad verification polling stays outside the shared CLI and MCP capability surface.",
  },
  {
    capabilityId: "mobile_rewarded_scout_boost_client_complete",
    kind: "excluded",
    status: "excluded",
    domain: "mobile",
    source: "/api/mobile/rewarded-scout-boost/session/:rewardSessionId/client-complete",
    notes:
      "Native mobile rewarded ad client completion stays outside the shared CLI and MCP capability surface.",
  },
  {
    capabilityId: "admin_rewarded_scout_boost_session_debug",
    kind: "excluded",
    status: "excluded",
    domain: "admin",
    source: "/api/admin/rewarded-scout-boost/session/:rewardSessionId",
    notes:
      "Admin-only rewarded ad session diagnostics stay outside the shared CLI and MCP capability surface.",
  },
  {
    capabilityId: "mobile_google_play_verify_purchase",
    kind: "excluded",
    status: "excluded",
    domain: "billing",
    source: "/api/mobile/google-play/verify-purchase",
    notes:
      "Android-native Google Play purchase verification is intentionally excluded from the shared CLI and MCP capability surface.",
  },
  {
    capabilityId: "daily_boost_debug",
    kind: "excluded",
    status: "excluded",
    domain: "internal",
    source: "/api/daily-boosts/debug",
    notes:
      "Debug-only diagnostics must not be exposed through the shared public capability surface.",
  },
  {
    capabilityId: "agent_thread_runtime_details",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/threads/:threadId/runtime-details",
    notes:
      "The cockpit runtime-details route is a web-only aggregation view and must not expand the shared CLI or MCP capability surface.",
  },
  {
    capabilityId: "agent_thread_turn_events",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/threads/:threadId/turns/:turnId/events",
    notes:
      "The cockpit live turn event stream is UI telemetry and remains excluded from the shared CLI and MCP capability surface.",
  },
  {
    capabilityId: "agent_strategy_templates",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/strategies",
    notes:
      "Strategy template lifecycle remains a web-only Hermes cockpit surface until the public capability model includes first-class strategy management.",
  },
  {
    capabilityId: "agent_strategy_template_update",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/strategies/:strategyId",
    notes:
      "Strategy template mutation remains web-only until the shared public capability surface includes a stable strategy contract.",
  },
  {
    capabilityId: "agent_strategy_live_state",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/strategies/:strategyId/(activate|review|pause|archive)",
    notes:
      "Live strategy slot management remains web-only until Hermes-native strategy execution is exposed consistently across product surfaces.",
  },
  {
    capabilityId: "agent_strategy_run_history",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/strategies/:strategyId/runs",
    notes:
      "Strategy run history remains a web-only cockpit audit surface until the public capability model includes first-class strategy execution telemetry.",
  },
  {
    capabilityId: "agent_strategy_event_history",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/strategies/:strategyId/events",
    notes:
      "Strategy event history remains a web-only Hermes cockpit surface until the public capability model includes first-class strategy lifecycle telemetry.",
  },
  {
    capabilityId: "agent_strategy_manual_run",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/strategies/:strategyId/run",
    notes:
      "Manual live-strategy execution remains web-only until Hermes-native strategy execution is exposed consistently across product surfaces.",
  },
  {
    capabilityId: "agent_strategy_detail",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/strategies/:strategyId",
    notes:
      "Strategy detail, performance, and guardrail editing remain web-only until the public capability model includes a stable Hermes-native strategy contract.",
  },
  {
    capabilityId: "admin_internal_routes",
    kind: "excluded",
    status: "excluded",
    domain: "admin",
    source: "admin/internal-only routes",
    notes: "Admin and internal-only routes must not be exposed through CLI or MCP.",
  },
  {
    capabilityId: "agent_mcp_source_list",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/mcp-sources",
    notes:
      "MCP source management remains web-only until the public capability model includes first-class external data source configuration.",
  },
  {
    capabilityId: "agent_mcp_source_detail",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/mcp-sources/:sourceId",
    notes:
      "MCP source detail remains web-only until the public capability model includes first-class external data source configuration.",
  },
  {
    capabilityId: "agent_mcp_source_create",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/mcp-sources",
    notes:
      "MCP source creation remains web-only until the public capability model includes first-class external data source configuration.",
  },
  {
    capabilityId: "agent_mcp_source_update",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/mcp-sources/:sourceId",
    notes:
      "MCP source mutation remains web-only until the public capability model includes first-class external data source configuration.",
  },
  {
    capabilityId: "agent_mcp_source_delete",
    kind: "excluded",
    status: "excluded",
    domain: "agent",
    source: "/api/agent/mcp-sources/:sourceId",
    notes:
      "MCP source deletion remains web-only until the public capability model includes first-class external data source configuration.",
  },
];

const PUBLIC_SITE_ROUTE_COVERAGE: PublicSiteRouteCoverageEntry[] = [
  { method: "GET", path: "/api/scouts/status", capabilityIds: ["get_scout_status"] },
  {
    method: "GET",
    path: "/api/auth/user",
    capabilityIds: ["get_account_profile"],
    notes: "The optional `sync=true` Whop side effect remains intentionally excluded.",
  },
  { method: "POST", path: "/api/whop/sync", excludedCapabilityId: "whop_provider_sync" },
  { method: "POST", path: "/api/user/add-cash", excludedCapabilityId: "user_add_cash" },
  {
    method: "POST",
    path: "/api/account/tokens",
    excludedCapabilityId: "account_token_creation",
  },
  { method: "POST", path: "/api/user/update-username", capabilityIds: ["update_username"] },
  {
    method: "POST",
    path: "/api/user/update-profile-image",
    capabilityIds: ["update_profile_image"],
  },
  { method: "POST", path: "/api/user/onboarding/complete", capabilityIds: ["complete_onboarding"] },
  { method: "GET", path: "/api/collections", capabilityIds: ["list_collections"] },
  {
    method: "GET",
    path: "/api/collections/:type/:targetId",
    capabilityIds: ["get_collection_detail"],
  },
  { method: "GET", path: "/api/milestones", capabilityIds: ["list_milestones"] },
  {
    method: "POST",
    path: "/api/milestones/:id/celebrate",
    capabilityIds: ["celebrate_milestone"],
  },
  { method: "GET", path: "/api/trades/history", capabilityIds: ["get_trade_history"] },
  { method: "GET", path: "/api/watchlist", capabilityIds: ["list_watchlist_player_ids"] },
  { method: "GET", path: "/api/watchlists", capabilityIds: ["list_watchlists"] },
  { method: "POST", path: "/api/watchlists", capabilityIds: ["create_watchlist"] },
  { method: "PUT", path: "/api/watchlists/:id", capabilityIds: ["update_watchlist"] },
  { method: "DELETE", path: "/api/watchlists/:id", capabilityIds: ["delete_watchlist"] },
  { method: "GET", path: "/api/watchlists/:id/items", capabilityIds: ["get_watchlist_items"] },
  { method: "POST", path: "/api/watchlist/:playerId", capabilityIds: ["add_watchlist_player"] },
  {
    method: "DELETE",
    path: "/api/watchlist/:playerId",
    capabilityIds: ["remove_watchlist_player"],
  },
  {
    method: "GET",
    path: "/api/player/:playerId/watchlists",
    capabilityIds: ["list_player_watchlists"],
  },
  { method: "GET", path: "/api/player/:id", capabilityIds: ["get_player_detail"] },
  {
    method: "GET",
    path: "/api/portfolio",
    capabilityIds: ["get_portfolio_summary", "get_holdings"],
  },
  { method: "GET", path: "/api/activity", capabilityIds: ["get_activity_feed"] },
  {
    method: "GET",
    path: "/api/scouts",
    capabilityIds: ["get_scout_status", "list_scout_assignments"],
  },
  { method: "POST", path: "/api/scouts/assign", capabilityIds: ["stage_scout_assignment"] },
  { method: "GET", path: "/api/scouts/roster/:playerId", capabilityIds: ["get_scout_roster"] },
  { method: "GET", path: "/api/agent/profile", capabilityIds: ["get_agent_profile"] },
  { method: "GET", path: "/api/agent/capabilities", capabilityIds: ["get_agent_capabilities"] },
  { method: "PUT", path: "/api/agent/profile", capabilityIds: ["update_agent_profile"] },
  { method: "PUT", path: "/api/agent/byok-key", capabilityIds: ["save_agent_byok"] },
  { method: "DELETE", path: "/api/agent/byok-key", capabilityIds: ["clear_agent_byok"] },
  { method: "GET", path: "/api/agent/threads", capabilityIds: ["list_agent_threads"] },
  { method: "POST", path: "/api/agent/threads", capabilityIds: ["create_agent_thread"] },
  { method: "GET", path: "/api/agent/threads/:threadId", capabilityIds: ["get_thread_state"] },
  {
    method: "GET",
    path: "/api/agent/threads/:threadId/messages",
    capabilityIds: ["list_thread_messages"],
  },
  {
    method: "GET",
    path: "/api/agent/threads/:threadId/research-sources",
    capabilityIds: ["list_thread_research_sources"],
  },
  {
    method: "GET",
    path: "/api/agent/threads/:threadId/runtime-details",
    excludedCapabilityId: "agent_thread_runtime_details",
  },
  {
    method: "GET",
    path: "/api/agent/threads/:threadId/turns/:turnId/events",
    excludedCapabilityId: "agent_thread_turn_events",
  },
  {
    method: "POST",
    path: "/api/agent/threads/:threadId/messages",
    capabilityIds: ["send_agent_message"],
  },
  {
    method: "POST",
    path: "/api/agent/threads/:threadId/confirm",
    capabilityIds: ["confirm_pending_action"],
  },
  {
    method: "POST",
    path: "/api/agent/threads/:threadId/cancel",
    capabilityIds: ["cancel_pending_action"],
  },
  {
    method: "GET",
    path: "/api/agent/strategies",
    excludedCapabilityId: "agent_strategy_templates",
  },
  {
    method: "POST",
    path: "/api/agent/strategies",
    excludedCapabilityId: "agent_strategy_templates",
  },
  {
    method: "GET",
    path: "/api/agent/strategies/:strategyId",
    excludedCapabilityId: "agent_strategy_detail",
  },
  {
    method: "PATCH",
    path: "/api/agent/strategies/:strategyId",
    excludedCapabilityId: "agent_strategy_template_update",
  },
  {
    method: "POST",
    path: "/api/agent/strategies/:strategyId/activate",
    excludedCapabilityId: "agent_strategy_live_state",
  },
  {
    method: "POST",
    path: "/api/agent/strategies/:strategyId/review",
    excludedCapabilityId: "agent_strategy_live_state",
  },
  {
    method: "POST",
    path: "/api/agent/strategies/:strategyId/pause",
    excludedCapabilityId: "agent_strategy_live_state",
  },
  {
    method: "POST",
    path: "/api/agent/strategies/:strategyId/archive",
    excludedCapabilityId: "agent_strategy_live_state",
  },
  {
    method: "GET",
    path: "/api/agent/strategies/:strategyId/runs",
    excludedCapabilityId: "agent_strategy_run_history",
  },
  {
    method: "GET",
    path: "/api/agent/strategies/:strategyId/events",
    excludedCapabilityId: "agent_strategy_event_history",
  },
  {
    method: "POST",
    path: "/api/agent/strategies/:strategyId/run",
    excludedCapabilityId: "agent_strategy_manual_run",
  },
  {
    method: "GET",
    path: "/api/agent/mcp-sources",
    excludedCapabilityId: "agent_mcp_source_list",
  },
  {
    method: "GET",
    path: "/api/agent/mcp-sources/:sourceId",
    excludedCapabilityId: "agent_mcp_source_detail",
  },
  {
    method: "POST",
    path: "/api/agent/mcp-sources",
    excludedCapabilityId: "agent_mcp_source_create",
  },
  {
    method: "PATCH",
    path: "/api/agent/mcp-sources/:sourceId",
    excludedCapabilityId: "agent_mcp_source_update",
  },
  {
    method: "DELETE",
    path: "/api/agent/mcp-sources/:sourceId",
    excludedCapabilityId: "agent_mcp_source_delete",
  },
  { method: "GET", path: "/api/user/portfolio-history", capabilityIds: ["get_portfolio_history"] },
  { method: "POST", path: "/api/premium/redeem", capabilityIds: ["redeem_premium"] },
  {
    method: "POST",
    path: "/api/premium/checkout-session",
    excludedCapabilityId: "premium_checkout_session",
  },
  {
    method: "POST",
    path: "/api/community/checkout-session",
    excludedCapabilityId: "community_checkout_session",
  },
  {
    method: "POST",
    path: "/api/mobile/rewarded-scout-boost/session",
    excludedCapabilityId: "mobile_rewarded_scout_boost_session",
  },
  {
    method: "GET",
    path: "/api/mobile/rewarded-scout-boost/session/:rewardSessionId/status",
    excludedCapabilityId: "mobile_rewarded_scout_boost_session_status",
  },
  {
    method: "POST",
    path: "/api/mobile/rewarded-scout-boost/session/:rewardSessionId/client-complete",
    excludedCapabilityId: "mobile_rewarded_scout_boost_client_complete",
  },
  {
    method: "GET",
    path: "/api/admin/rewarded-scout-boost/session/:rewardSessionId",
    excludedCapabilityId: "admin_rewarded_scout_boost_session_debug",
  },
  {
    method: "POST",
    path: "/api/mobile/google-play/verify-purchase",
    excludedCapabilityId: "mobile_google_play_verify_purchase",
  },
  { method: "POST", path: "/api/checkout/finalize", excludedCapabilityId: "checkout_finalize" },
  { method: "GET", path: "/api/premium/status", capabilityIds: ["get_premium_status"] },
  { method: "GET", path: "/api/news/digest", capabilityIds: ["get_news_digest"] },
  { method: "POST", path: "/api/news/mark-read", capabilityIds: ["mark_news_read"] },
  { method: "GET", path: "/api/news/unread-count", capabilityIds: ["get_news_unread_count"] },
  { method: "POST", path: "/api/holdings/stack-shares", capabilityIds: ["stage_stack_shares"] },
  {
    method: "GET",
    path: "/api/holdings/:playerId/multiplier-state",
    capabilityIds: ["get_holding_multiplier_state"],
  },
  { method: "GET", path: "/api/daily-boosts/all", capabilityIds: ["list_daily_boosts"] },
  {
    method: "GET",
    path: "/api/community-boosts/all",
    capabilityIds: ["get_community_boost_state"],
  },
  {
    method: "GET",
    path: "/api/daily-boosts/eligible-all",
    capabilityIds: ["list_daily_boost_eligible_players"],
  },
  {
    method: "GET",
    path: "/api/daily-boosts/eligible/:sport",
    capabilityIds: ["list_daily_boost_eligible_players"],
  },
  { method: "POST", path: "/api/daily-boosts/assign", capabilityIds: ["stage_daily_boost_assign"] },
  {
    method: "DELETE",
    path: "/api/daily-boosts/:boostId",
    capabilityIds: ["stage_daily_boost_remove"],
  },
  { method: "GET", path: "/api/daily-boosts/live/:sport", capabilityIds: ["list_daily_boosts"] },
  { method: "GET", path: "/api/daily-boosts/history", capabilityIds: ["list_daily_boost_history"] },
  { method: "GET", path: "/api/daily-boosts/:sport", capabilityIds: ["list_daily_boosts"] },
  {
    method: "GET",
    path: "/api/community-boosts/:sport",
    capabilityIds: ["get_community_boost_state"],
  },
  {
    method: "POST",
    path: "/api/community-boosts/create",
    capabilityIds: ["stage_community_boost_create"],
  },
  {
    method: "GET",
    path: "/api/community-boosts/history",
    capabilityIds: ["list_community_boost_history"],
  },
  {
    method: "GET",
    path: "/api/community-boosts/eligible-players",
    capabilityIds: ["list_community_boost_eligible_players"],
  },
  { method: "POST", path: "/api/amm/:playerId/buy", capabilityIds: ["stage_market_buy"] },
  { method: "POST", path: "/api/amm/:playerId/sell", capabilityIds: ["stage_market_sell"] },
  { method: "GET", path: "/api/lp/positions", capabilityIds: ["list_lp_positions"] },
  { method: "GET", path: "/api/lp/:playerId/position", capabilityIds: ["get_lp_position"] },
  { method: "POST", path: "/api/lp/:playerId/add", capabilityIds: ["stage_lp_add"] },
  {
    method: "POST",
    path: "/api/lp/:playerId/add-optimal",
    capabilityIds: ["stage_lp_add_optimal"],
  },
  { method: "GET", path: "/api/lp/:playerId/zap-quote", capabilityIds: ["get_lp_zap_quote"] },
  { method: "POST", path: "/api/lp/:playerId/zap-add", capabilityIds: ["stage_lp_zap_add"] },
  { method: "POST", path: "/api/lp/:playerId/remove", capabilityIds: ["stage_lp_remove"] },
  { method: "GET", path: "/api/lp/:playerId/history", capabilityIds: ["list_lp_history"] },
  { method: "GET", path: "/api/lp/history", capabilityIds: ["list_lp_history"] },
  { method: "GET", path: "/api/account/sms", capabilityIds: ["get_sms_settings"] },
  { method: "PUT", path: "/api/account/sms", capabilityIds: ["update_sms_settings"] },
  { method: "POST", path: "/api/sms/link/start", capabilityIds: ["start_sms_link"] },
  { method: "POST", path: "/api/sms/link/complete", capabilityIds: ["complete_sms_link"] },
  { method: "GET", path: "/api/account/tokens", capabilityIds: ["list_api_tokens"] },
  { method: "DELETE", path: "/api/account/tokens/:id", capabilityIds: ["revoke_api_token"] },
];

const PUBLIC_TOOL_ONLY_CAPABILITY_IDS = [
  "review_setup",
  "review_idle_cash",
  "review_portfolio_cleanup",
  "list_boost_candidates",
  "list_scout_opportunities",
  "list_market_opportunities",
  "review_news_impact",
  "get_balance_state",
  "get_player_stats",
  "get_player_recent_games",
  "get_player_financial_metrics",
  "get_player_shares_info",
  "get_amm_pool_state",
  "get_trade_quote",
  "list_schedules",
  "list_schedule_templates",
  "get_dashboard_overview",
  "search_players",
  "get_market_scanners",
  "get_games_today",
  "get_game_insights",
  "search_docs",
  "get_doc_article",
  "run_hosted_research",
  "get_pending_action",
  "upsert_schedule",
  "delete_schedule",
] as const;

const PUBLIC_PROMPT_NAMES = [
  "review_setup",
  "review_idle_cash",
  "find_boost_candidates",
  "stage_trade",
] as const;

const PUBLIC_STATIC_RESOURCE_URIS = [
  "sportfolio://docs/index",
  "sportfolio://capabilities",
  "sportfolio://action-surface",
  "sportfolio://tool-catalog",
] as const;

const PUBLIC_PROMPTS: PublicPromptDefinition[] = [
  {
    name: "review_setup",
    description: "Prompt starter for a broad gameplay setup review.",
    argsSchema: {
      sport: z.string().min(2).max(16).optional(),
    },
    fixtureArgs: {},
    render: async (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: args.sport ? `Review my ${toStringValue(args.sport)} setup.` : "Review my setup.",
          },
        },
      ],
    }),
  },
  {
    name: "review_idle_cash",
    description: "Prompt starter for an idle-cash deployment review.",
    argsSchema: {},
    fixtureArgs: {},
    render: async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "What should I do with my idle balance?",
          },
        },
      ],
    }),
  },
  {
    name: "find_boost_candidates",
    description: "Prompt starter for daily boost candidate discovery.",
    argsSchema: {
      sport: z.string().min(2).max(16).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    },
    fixtureArgs: { sport: "NBA" },
    render: async (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Who are my best daily boost candidates${args.sport ? ` in ${toStringValue(args.sport)}` : ""}${args.date ? ` for ${toStringValue(args.date)}` : ""}?`,
          },
        },
      ],
    }),
  },
  {
    name: "stage_trade",
    description: "Prompt starter for staging a market trade.",
    argsSchema: {
      side: z.enum(["buy", "sell"]).optional(),
      player: z.string().min(1),
      amount: z.string().min(1),
    },
    fixtureArgs: { player: "Jalen Brunson", amount: "$25" },
    render: async (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${toStringValue(args.side) || "buy"} ${toStringValue(args.amount)} of ${toStringValue(args.player)}`,
          },
        },
      ],
    }),
  },
];

const PUBLIC_STATIC_RESOURCES: PublicResourceDefinition[] = [
  {
    id: "docs-index",
    uri: "sportfolio://docs/index",
    mimeType: "application/json",
    description: "Published Sportfolio documentation article index.",
    read: async (context) => ({
      contents: [
        {
          uri: "sportfolio://docs/index",
          text: JSON.stringify(context.deps.listDocsArticles(true), null, 2),
        },
      ],
    }),
  },
  {
    id: "capabilities",
    uri: "sportfolio://capabilities",
    mimeType: "application/json",
    description: "Shared public capability inventory for CLI and MCP.",
    read: async (context) => {
      const inventory = await buildResolvedPublicCapabilityInventory(context);
      return {
        contents: [
          {
            uri: "sportfolio://capabilities",
            text: JSON.stringify(
              {
                generatedAt: new Date().toISOString(),
                ...inventory,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    id: "action-surface",
    uri: "sportfolio://action-surface",
    mimeType: "application/json",
    description: "Shared public action surface grouped by domain.",
    read: async (context) => {
      const catalog = await buildResolvedPublicToolCatalog(context);
      return {
        contents: [
          {
            uri: "sportfolio://action-surface",
            text: JSON.stringify(
              {
                generatedAt: new Date().toISOString(),
                dynamicSources: catalog.dynamicSources,
                tools: catalog.tools.map((tool) => ({
                  name: tool.name,
                  title: tool.title,
                  domain: tool.domain,
                  provider: tool.provider,
                  readOnly: tool.readOnly,
                  executionModel: tool.executionModel,
                  confirmationModel: tool.confirmationModel,
                  requiresConfirmation: tool.requiresConfirmation,
                  riskLevel: tool.riskLevel,
                  presentationProfile: tool.presentationProfile,
                  primaryEntityType: tool.primaryEntityType,
                  preferredColumns: tool.preferredColumns,
                  inputFieldNames: tool.inputFieldNames,
                  fixtureArgs: tool.fixtureArgs,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    id: "tool-catalog",
    uri: "sportfolio://tool-catalog",
    mimeType: "application/json",
    description: "Full public MCP tool catalog with live dynamic-provider discovery metadata.",
    read: async (context) => {
      const catalog = await buildResolvedPublicToolCatalog(context);
      return {
        contents: [
          {
            uri: "sportfolio://tool-catalog",
            text: JSON.stringify(
              {
                generatedAt: new Date().toISOString(),
                dynamicSources: catalog.dynamicSources,
                tools: catalog.tools,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
];

function buildDocsArticleResources(context: PublicMcpServerContext): PublicResourceDefinition[] {
  const resources: PublicResourceDefinition[] = [];

  for (const articleSummary of context.deps.listDocsArticles(true)) {
    const article = context.deps.getDocsArticle(articleSummary.section, articleSummary.slug, true);
    if (!article) {
      continue;
    }

    const uri = `sportfolio://docs/${article.section}/${article.slug}`;
    resources.push({
      id: article.id,
      uri,
      mimeType: "text/markdown",
      description: article.summary,
      read: async () => ({
        contents: [
          {
            uri,
            text: article.bodyMarkdown,
          },
        ],
      }),
    });
  }

  return resources;
}

export function buildPublicToolRegistry(): PublicToolDefinition[] {
  return [...READ_ALIAS_TOOLS, ...CUSTOM_TOOLS];
}

export function buildPublicPromptRegistry(): PublicPromptDefinition[] {
  return [...PUBLIC_PROMPTS];
}

export async function buildResolvedPublicToolCatalog(context: PublicMcpServerContext): Promise<{
  tools: PublicToolCatalogEntry[];
  dynamicSources: PublicDynamicSourceStatus[];
}> {
  const staticTools = buildPublicToolRegistry().map(toStaticPublicToolCatalogEntry);
  const dynamicMlb = await getResolvedDynamicMlbPublicToolsForContext(context);

  return {
    tools: [...staticTools, ...dynamicMlb.tools.map(toDynamicPublicToolCatalogEntry)],
    dynamicSources: [dynamicMlb.sourceStatus],
  };
}

export async function buildResolvedPublicCapabilityInventory(
  context: PublicMcpServerContext,
): Promise<{
  included: PublicIncludedCapability[];
  excluded: PublicExcludedCapability[];
  dynamicSources: PublicDynamicSourceStatus[];
}> {
  const baseInventory = buildPublicCapabilityInventory();
  const dynamicMlb = await getResolvedDynamicMlbPublicToolsForContext(context);

  return {
    included: [
      ...baseInventory.included,
      ...dynamicMlb.tools.map(
        (tool) =>
          ({
            capabilityId: tool.toolName,
            kind: "tool",
            status: "included",
            domain: "mlb",
            title: tool.toolName,
            toolName: tool.toolName,
            provider: "internal_mlb_mcp",
            readOnly: !tool.requiresConfirmation,
            executionModel: tool.requiresConfirmation ? "staged_write" : "read",
            confirmationModel: tool.requiresConfirmation ? "staged_confirmation" : "immediate",
            requiresConfirmation: tool.requiresConfirmation,
            riskLevel: tool.riskLevel,
            source: "dynamic:internal_mlb_mcp",
          }) satisfies PublicIncludedCapability,
      ),
    ],
    excluded: [...baseInventory.excluded],
    dynamicSources: [dynamicMlb.sourceStatus],
  };
}

export function buildPublicResourceRegistry(
  context: PublicMcpServerContext,
): PublicResourceDefinition[] {
  return [...PUBLIC_STATIC_RESOURCES, ...buildDocsArticleResources(context)];
}

export function getPublicToolFixtures() {
  return Object.fromEntries(
    buildPublicToolRegistry().map((entry) => [entry.name, entry.fixtureArgs]),
  );
}

export function getPublicPromptFixtures() {
  return Object.fromEntries(
    buildPublicPromptRegistry().map((entry) => [entry.name, entry.fixtureArgs]),
  );
}

export function buildPublicCapabilityInventory(): {
  included: PublicIncludedCapability[];
  excluded: PublicExcludedCapability[];
} {
  return {
    included: [
      ...buildPublicToolRegistry().map((tool) => {
        const executionModel = getPublicToolExecutionModel(tool);
        return {
          capabilityId: tool.name,
          kind: "tool",
          status: "included",
          domain: tool.domain,
          toolName: tool.name,
          readOnly: tool.readOnly,
          executionModel,
          confirmationModel: getPublicToolConfirmationModel(executionModel),
          requiresConfirmation: executionModel === "staged_write",
          riskLevel: getPublicToolRiskLevel(tool),
          source: "public_registry:tool",
        } satisfies PublicIncludedCapability;
      }),
      ...buildPublicPromptRegistry().map(
        (prompt) =>
          ({
            capabilityId: `${prompt.name}_prompt`,
            kind: "prompt",
            status: "included",
            domain: "prompts",
            promptName: prompt.name,
            source: "public_registry:prompt",
          }) satisfies PublicIncludedCapability,
      ),
      ...PUBLIC_STATIC_RESOURCES.map(
        (resource) =>
          ({
            capabilityId: resource.uri,
            kind: "resource",
            status: "included",
            domain: "docs",
            resourceUri: resource.uri,
            source: "public_registry:resource",
          }) satisfies PublicIncludedCapability,
      ),
    ],
    excluded: [...PUBLIC_EXCLUDED_CAPABILITIES],
  };
}

export function buildPublicSiteRouteCoverage(): PublicSiteRouteCoverageEntry[] {
  return PUBLIC_SITE_ROUTE_COVERAGE.map((entry) => ({ ...entry }));
}

export function evaluateAuthenticatedSiteRouteCoverage(
  actualRoutes: Array<{ method: string; path: string }>,
) {
  const inventory = buildPublicCapabilityInventory();
  const knownCapabilityIds = new Set(inventory.included.map((entry) => entry.capabilityId));
  const knownExcludedIds = new Set(inventory.excluded.map((entry) => entry.capabilityId));
  const auditedRoutes = buildPublicSiteRouteCoverage();
  const auditedKeySet = new Set(auditedRoutes.map((entry) => `${entry.method} ${entry.path}`));
  const actualKeySet = new Set(
    actualRoutes.map((entry) => `${entry.method.toUpperCase()} ${entry.path}`),
  );

  const missingFromAudit = [...actualKeySet].filter((key) => !auditedKeySet.has(key)).sort();
  const extraInAudit = [...auditedKeySet].filter((key) => !actualKeySet.has(key)).sort();
  const invalidCapabilityRefs = auditedRoutes
    .flatMap((entry) =>
      (entry.capabilityIds || []).filter((capabilityId) => !knownCapabilityIds.has(capabilityId)),
    )
    .sort();
  const invalidExcludedRefs = auditedRoutes
    .flatMap((entry) =>
      entry.excludedCapabilityId && !knownExcludedIds.has(entry.excludedCapabilityId)
        ? [entry.excludedCapabilityId]
        : [],
    )
    .sort();

  return {
    ok:
      missingFromAudit.length === 0 &&
      extraInAudit.length === 0 &&
      invalidCapabilityRefs.length === 0 &&
      invalidExcludedRefs.length === 0,
    auditedCount: auditedRoutes.length,
    actualCount: actualRoutes.length,
    missingFromAudit,
    extraInAudit,
    invalidCapabilityRefs,
    invalidExcludedRefs,
  };
}

export function buildPublicMcpToolRegistry(): PublicToolDefinition[] {
  return buildPublicToolRegistry();
}

export function getPublicMcpToolFixtures() {
  return getPublicToolFixtures();
}

export function evaluateGameplayCapabilityParity() {
  const registryToolNames = new Set(buildPublicToolRegistry().map((tool) => tool.name));
  const routeBackedToolNames = new Set(
    buildPublicSiteRouteCoverage().flatMap((entry) => entry.capabilityIds || []),
  );
  const expectedToolNames = new Set<string>([
    ...routeBackedToolNames,
    ...PUBLIC_TOOL_ONLY_CAPABILITY_IDS,
  ]);
  const registryPromptNames = new Set(buildPublicPromptRegistry().map((prompt) => prompt.name));
  const expectedPromptNames = new Set<string>(PUBLIC_PROMPT_NAMES);
  const registryResourceUris = new Set(PUBLIC_STATIC_RESOURCES.map((resource) => resource.uri));
  const expectedResourceUris = new Set<string>(PUBLIC_STATIC_RESOURCE_URIS);
  const missingFromRegistry = [...expectedToolNames].filter((name) => !registryToolNames.has(name));
  const extraInRegistry = [...registryToolNames].filter((name) => !expectedToolNames.has(name));
  const missingPromptNames = [...expectedPromptNames].filter(
    (name) => !registryPromptNames.has(name),
  );
  const extraPromptNames = [...registryPromptNames].filter(
    (name) => !expectedPromptNames.has(name),
  );
  const missingResourceUris = [...expectedResourceUris].filter(
    (uri) => !registryResourceUris.has(uri),
  );
  const extraResourceUris = [...registryResourceUris].filter(
    (uri) => !expectedResourceUris.has(uri),
  );
  const inventory = buildPublicCapabilityInventory();

  return {
    ok:
      missingFromRegistry.length === 0 &&
      extraInRegistry.length === 0 &&
      missingPromptNames.length === 0 &&
      extraPromptNames.length === 0 &&
      missingResourceUris.length === 0 &&
      extraResourceUris.length === 0 &&
      inventory.excluded.length > 0,
    missingFromRegistry,
    extraInRegistry,
    missingPromptNames,
    extraPromptNames,
    missingResourceUris,
    extraResourceUris,
    includedCount: inventory.included.length,
    excludedCount: inventory.excluded.length,
    toolCount: registryToolNames.size,
    promptCount: registryPromptNames.size,
    resourceCount: registryResourceUris.size,
  };
}

export function assertPublicMcpSurfaceIntegrity() {
  const parity = evaluateGameplayCapabilityParity();
  if (!parity.ok) {
    throw new Error(
      `Public capability surface integrity failed. Missing tools: ${parity.missingFromRegistry.join(", ") || "none"}; extra tools: ${parity.extraInRegistry.join(", ") || "none"}; missing prompts: ${parity.missingPromptNames.join(", ") || "none"}; extra prompts: ${parity.extraPromptNames.join(", ") || "none"}; missing resources: ${parity.missingResourceUris.join(", ") || "none"}; extra resources: ${parity.extraResourceUris.join(", ") || "none"}`,
    );
  }
}

export function getPublicToolDefinition(name: string) {
  return buildPublicToolRegistry().find((tool) => tool.name === name) || null;
}

export function getPublicPromptDefinition(name: string) {
  return buildPublicPromptRegistry().find((prompt) => prompt.name === name) || null;
}

export async function executePublicTool(
  context: PublicMcpServerContext,
  name: string,
  args: Record<string, unknown> = {},
) {
  const tool = getPublicToolDefinition(name);
  if (!tool) {
    throw new PublicMcpToolError("Unknown public tool.", "not_found", { name });
  }
  return tool.execute(context, parseSchemaArgs(tool.inputSchema, args));
}

export async function executeResolvedPublicTool(
  context: PublicMcpServerContext,
  name: string,
  args: Record<string, unknown> = {},
) {
  const staticTool = getPublicToolDefinition(name);
  if (staticTool) {
    return staticTool.execute(context, parseSchemaArgs(staticTool.inputSchema, args));
  }

  const dynamicMlb = await getResolvedDynamicMlbPublicToolsForContext(context);
  const dynamicTool = dynamicMlb.tools.find((tool) => tool.toolName === name);
  if (!dynamicTool) {
    throw new PublicMcpToolError("Unknown public tool.", "not_found", { name });
  }

  const result = await context.deps.runInternalMlbMcpToolBounded({
    toolName: dynamicTool.toolName,
    args,
  });

  return {
    summary: result.replyText || `Loaded MLB data via ${result.remoteToolName}.`,
    remoteToolName: result.remoteToolName,
    content: Array.isArray(result.content) ? result.content : [],
    structuredContent: result.structuredContent ?? null,
    payloadTruncated: result.payloadTruncated ?? false,
    truncation: result.truncation ?? null,
  };
}

export async function resolvePublicCapabilityCatalog(context: PublicMcpServerContext) {
  const dynamicMlb = await getResolvedDynamicMlbPublicToolsForContext(context);
  const resolvedContext = {
    ...context,
    dynamicMlb,
  };
  const resources = buildPublicResourceRegistry(resolvedContext);
  const inventory = await buildResolvedPublicCapabilityInventory(resolvedContext);

  return {
    tools: [
      ...buildPublicToolRegistry().map(toStaticPublicToolCatalogEntry),
      ...dynamicMlb.tools.map(toDynamicPublicToolCatalogEntry),
    ],
    prompts: buildPublicPromptRegistry().map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      inputKeys: Object.keys(prompt.argsSchema || {}),
      fixtureArgs: prompt.fixtureArgs,
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      uri: resource.uri,
      title: resource.id,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
    included: inventory.included,
    excluded: inventory.excluded,
    dynamicSources: [dynamicMlb.sourceStatus],
  };
}

export async function renderPublicPrompt(name: string, args: Record<string, unknown> = {}) {
  const prompt = getPublicPromptDefinition(name);
  if (!prompt) {
    throw new PublicMcpToolError("Unknown public prompt.", "not_found", { name });
  }
  return prompt.render(parseSchemaArgs(prompt.argsSchema, args));
}

export async function readPublicResource(context: PublicMcpServerContext, uri: string) {
  const resource = buildPublicResourceRegistry(context).find((entry) => entry.uri === uri);
  if (!resource) {
    throw new PublicMcpToolError("Unknown public resource.", "not_found", { uri });
  }
  return resource.read(context);
}

export async function registerPublicMcpSurface(server: McpServer, context: PublicMcpServerContext) {
  for (const tool of buildPublicToolRegistry()) {
    const catalogEntry = toStaticPublicToolCatalogEntry(tool);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: tool.title || tool.name,
          readOnlyHint: tool.readOnly,
          openWorldHint: false,
        },
        _meta: {
          domain: tool.domain,
          provider: "sportfolio",
          source: "public_registry:tool",
          confirmationModel: catalogEntry.confirmationModel,
          presentationProfile: catalogEntry.presentationProfile,
          primaryEntityType: catalogEntry.primaryEntityType,
          preferredColumns: catalogEntry.preferredColumns,
          inputFieldNames: catalogEntry.inputFieldNames,
          routeRefs: tool.routeRefs || [],
          fixtureArgs: tool.fixtureArgs,
        },
      },
      async (args) => {
        try {
          return toToolResult(await tool.execute(context, parseSchemaArgs(tool.inputSchema, args)));
        } catch (error) {
          return toToolErrorResult(error);
        }
      },
    );
  }

  for (const prompt of buildPublicPromptRegistry()) {
    server.registerPrompt(
      prompt.name,
      {
        description: prompt.description,
        argsSchema: prompt.argsSchema,
      },
      async (args) => prompt.render(parseSchemaArgs(prompt.argsSchema, args)),
    );
  }

  for (const resource of buildPublicResourceRegistry(context)) {
    server.registerResource(
      resource.id,
      resource.uri,
      {
        mimeType: resource.mimeType,
        description: resource.description,
      },
      async () => resource.read(context),
    );
  }
}

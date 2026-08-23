import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { SportsAdapterRegistry, type SportsAdapter } from "../sports/adapter-registry";
import { createDefaultSportsAdapterRegistry } from "../sports/default-registry";
import { sportSchema, type Sport } from "../sports/contracts";
import { assembleSportsContext } from "../sports/context-service";
import type { ProviderIdentityLookup } from "../sports/provider-identity";
import {
  getDeniedPublicToolNames,
  isApprovedPublicPromptName,
  isApprovedPublicToolName,
} from "./public-tool-policy";
import { db } from "../db";
import { getDocsArticle, listDocsArticles, searchDocsArticles } from "../docs-service";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { storage } from "../storage";
import {
  DEFAULT_ACTIVITY_FEED_CATEGORIES,
  USER_ACTIVITY_CATEGORIES,
  type UserActivityCategory,
} from "@shared/activity-feed";
import { holdings, players, userCollections, userMilestones, users } from "@shared/schema";
import {
  runNativeActionTool,
  runNativePlanTool,
  runNativeReadTool,
  runNativeScanTool,
} from "./native-operations";
import {
  cancelGameplayTransaction,
  confirmGameplayTransaction,
  getGameplayTransaction,
  stageGameplayTransaction,
  type GameplayAction,
} from "./gameplay-transactions";
import {
  callMlbPublicTool,
  getMlbProviderHealth,
  type CuratedMlbToolName,
} from "./providers/mlb/provider";
import { CURATED_MLB_TOOLS } from "./providers/mlb/tool-definitions";
import { redeemPremiumShare } from "../services/premium-redemption";
import { loadUserEntitlements } from "../services/user-entitlements";
import { getLeaderboardReadResponse } from "../leaderboards-read-service";
import { getCanonicalPlayerMarkets } from "../valuation/canonical-valuation";
import { normalizePublicError } from "./public-errors";

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

export type PublicMcpServerContext = {
  userId: string;
  deps: PublicMcpDependencies;
};

type StorageSubset = Pick<
  typeof storage,
  | "getPlayers"
  | "getPlayersBySport"
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
  | "getDailyBoostsAllSports"
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
  runNativeReadTool: typeof runNativeReadTool;
  runNativeScanTool: typeof runNativeScanTool;
  runNativePlanTool: typeof runNativePlanTool;
  runNativeActionTool: typeof runNativeActionTool;
  stageGameplayTransaction: typeof stageGameplayTransaction;
  getGameplayTransaction: typeof getGameplayTransaction;
  confirmGameplayTransaction: typeof confirmGameplayTransaction;
  cancelGameplayTransaction: typeof cancelGameplayTransaction;
  callMlbPublicTool: typeof callMlbPublicTool;
  getMlbProviderHealth: typeof getMlbProviderHealth;
  listDocsArticles: typeof listDocsArticles;
  searchDocsArticles: typeof searchDocsArticles;
  getDocsArticle: typeof getDocsArticle;
  redeemPremiumShare: typeof redeemPremiumShare;
  getLeaderboardReadResponse: typeof getLeaderboardReadResponse;
  getCanonicalPlayerMarkets?: typeof getCanonicalPlayerMarkets;
  listCollections: (userId: string) => Promise<unknown[]>;
  getCollectionDetail: (
    userId: string,
    type: string,
    targetId: string,
  ) => Promise<{ collection: unknown; ownedPlayers: unknown[] } | null>;
  listMilestones: (userId: string) => Promise<unknown[]>;
  celebrateMilestone: (userId: string, milestoneId: string) => Promise<boolean>;
  sportsRegistry?: SportsAdapterRegistry;
  sportsIdentityLookup?: ProviderIdentityLookup;
};

const PUBLIC_MLB_SOURCE_ID = "mlb_provider";
const PUBLIC_MLB_SOURCE_NAME = "Sportfolio MLB provider";

const DEFAULT_PUBLIC_SPORTS_REGISTRY = createDefaultSportsAdapterRegistry();
const HIGH_RISK_IMMEDIATE_TOOL_NAMES = new Set(["revoke_api_token", "redeem_premium"]);

export class PublicMcpToolError extends Error {
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
  const normalized = normalizePublicError(error);

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
      retryable: normalized.retryable,
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

function toStaticPublicToolCatalogEntry(tool: PublicToolDefinition): PublicToolCatalogEntry {
  const executionModel = getPublicToolExecutionModel(tool);
  const isMlb = CURATED_MLB_TOOLS.some((entry) => entry.name === tool.name);
  return {
    name: tool.name,
    title: tool.title || null,
    description: tool.description,
    domain: tool.domain,
    provider: isMlb ? "mlb" : "sportfolio",
    source: isMlb ? "public_registry:mlb" : "public_registry:tool",
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

async function getMlbSourceStatus(
  context: PublicMcpServerContext,
): Promise<PublicDynamicSourceStatus> {
  const health = await context.deps.getMlbProviderHealth();
  return {
    id: PUBLIC_MLB_SOURCE_ID,
    name: PUBLIC_MLB_SOURCE_NAME,
    provider: "mlb",
    available: health.reachable,
    toolCount: CURATED_MLB_TOOLS.length,
    error: health.lastErrorCode,
  };
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
  _context: PublicMcpServerContext,
  args: Record<string, unknown>,
  fallback = "MLB",
): Promise<string> {
  return toStringValue(args.sport).toUpperCase() || fallback;
}

async function executeReadTool(
  context: PublicMcpServerContext,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  return toStructuredContent(
    await context.deps.runNativeReadTool({ toolName, userId: context.userId, args }),
  );
}

async function executeScanTool(
  context: PublicMcpServerContext,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  return toStructuredContent(
    await context.deps.runNativeScanTool({ toolName, userId: context.userId, args }),
  );
}

async function executePlanTool(
  context: PublicMcpServerContext,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  return toStructuredContent(
    await context.deps.runNativePlanTool({ toolName, userId: context.userId, args }),
  );
}

async function executeActionTool(
  context: PublicMcpServerContext,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  return toStructuredContent(
    await context.deps.runNativeActionTool({ toolName, userId: context.userId, args }),
  );
}

function actionFromPreviewRequest(
  previewToolName: string,
  args: Record<string, unknown>,
): GameplayAction {
  const playerId = toStringValue(args.playerId);
  const sport = toStringValue(args.sport).toUpperCase() || "MLB";
  const boostDate = resolveTargetDateString(args.date);
  switch (previewToolName) {
    case "preview_pool_buy":
      return {
        actionType: "pool_buy",
        playerId,
        sbAmount: Number(args.sbAmount ?? args.amount),
        maxSlippage: Number(args.maxSlippage ?? 0.05),
      };
    case "preview_pool_sell":
      return {
        actionType: "pool_sell",
        playerId,
        sharesAmount: Number(args.sharesAmount ?? args.shares),
        maxSlippage: Number(args.maxSlippage ?? 0.05),
      };
    case "preview_lp_add":
      return {
        actionType: "pool_add_liquidity",
        playerId,
        shares: Number(args.shares),
        playMoney: Number(args.playMoney),
      };
    case "preview_lp_add_optimal":
      return {
        actionType: "pool_add_liquidity_optimal",
        playerId,
        maxShares: Number(args.maxShares ?? args.shares),
        maxPlayMoney: Number(args.maxPlayMoney ?? args.playMoney),
      };
    case "preview_lp_zap":
      return args.shares != null
        ? { actionType: "pool_zap_add_shares", playerId, shares: Number(args.shares) }
        : {
            actionType: "pool_zap_add_sb",
            playerId,
            sb: Number(args.sbAmount ?? args.sb ?? args.amount),
          };
    case "preview_lp_remove":
      return { actionType: "pool_remove_liquidity", playerId, lpShares: Number(args.lpShares) };
    case "preview_scout_adjustment":
      return { actionType: "scout_set_count", playerId, targetCount: Number(args.targetCount) };
    case "preview_daily_boost_assign":
      return {
        actionType: "daily_boost_assign",
        playerId,
        sport,
        slotTier: Number(args.slotTier) as 2 | 3 | 5 | 7 | 10,
        shares: Number(args.shares),
        boostDate,
      };
    case "preview_community_boost_create":
      return { actionType: "community_boost_create", playerId, sport, boostDate };
    default:
      throw new PublicMcpToolError("Unsupported staged gameplay action.", "invalid_arguments", {
        previewToolName,
      });
  }
}

async function stagePreviewedAction(input: {
  context: PublicMcpServerContext;
  previewToolName: string;
  previewArgs: Record<string, unknown>;
  threadId?: string | null;
}) {
  let action: GameplayAction;
  if (input.previewToolName === "preview_daily_boost_remove") {
    const playerId = toStringValue(input.previewArgs.playerId);
    const boostDate = resolveTargetDateString(input.previewArgs.date);
    const slotTier = Number(input.previewArgs.slotTier);
    const boosts = await input.context.deps.storage.getDailyBoostsAllSports(
      input.context.userId,
      resolveTargetDate(boostDate),
    );
    const boost = boosts.find(
      (entry) =>
        entry.playerId === playerId &&
        (!Number.isFinite(slotTier) || Number(entry.slotTier) === slotTier) &&
        entry.status === "active",
    );
    if (!boost) {
      throw new PublicMcpToolError("No matching active daily boost was found.", "not_found");
    }
    action = { actionType: "daily_boost_remove", boostId: boost.id, boostDate };
  } else {
    action = actionFromPreviewRequest(input.previewToolName, input.previewArgs);
  }
  const transaction = await input.context.deps.stageGameplayTransaction({
    userId: input.context.userId,
    action,
  });
  return {
    transactionId: transaction.transactionId,
    summary: transaction.summary,
    warnings: transaction.warnings,
    confirmationRequired: true,
    transaction,
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
  const recentLotsLimit = Math.min(20, Math.max(1, toPositiveInteger(args.recentLotsLimit) || 6));
  const sharedArgs = {
    ...(toOptionalString(args.sport) ? { sport: toOptionalString(args.sport) } : {}),
    ...(toOptionalString(args.date) ? { date: toOptionalString(args.date) } : {}),
  };
  const [
    portfolioSummary,
    balanceState,
    recentLots,
    scoutStatus,
    dailyBoosts,
    communityBoostState,
    watchlists,
  ] = await Promise.all([
    executeReadTool(context, "get_portfolio_summary", sharedArgs),
    executeReadTool(context, "get_balance_state", sharedArgs),
    executeReadTool(context, "get_holdings", {
      limit: recentLotsLimit,
      ...(sharedArgs.sport ? { sport: sharedArgs.sport } : {}),
    }),
    buildScoutStatus(context),
    executeReadTool(context, "get_daily_boost_state", {
      date: sharedArgs.date,
    }),
    executeReadTool(context, "get_community_boost_state", {
      date: sharedArgs.date,
    }),
    executeReadTool(context, "get_watchlists"),
  ]);

  return {
    summary: "Loaded dashboard overview.",
    recentLotsLimit,
    portfolioSummary,
    balanceState,
    recentLots,
    scoutStatus,
    dailyBoosts,
    communityBoostState,
    watchlists,
  };
}

async function searchPlayers(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const query = toStringValue(args.query);
  const team = toOptionalString(args.team) || undefined;
  const position = toOptionalString(args.position) || undefined;
  const limit = toPositiveInteger(args.limit) || 25;
  const sport = toOptionalString(args.sport)?.toUpperCase() || null;
  const players = await context.deps.storage.getPlayers({
    search: query || undefined,
    team,
    position,
  });

  const matches = players
    .filter((player) => (sport ? (player.sport || "").toUpperCase() === sport : true))
    .slice(0, limit);
  const canonicalMarkets = context.deps.getCanonicalPlayerMarkets
    ? await context.deps.getCanonicalPlayerMarkets(matches.map((player) => player.id))
    : new Map();

  return {
    summary: `Found ${matches.length} player result(s).`,
    results: matches.map((player) => {
      const market = canonicalMarkets.get(player.id);
      return {
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        fullName: `${player.firstName} ${player.lastName}`,
        sport: player.sport,
        team: player.team,
        position: player.position,
        marketStatus: market?.marketStatus || "unpriced",
        marketPrice: market?.marketPrice ?? null,
        priceSource: market?.priceSource ?? null,
        lastTradePrice: player.lastTradePrice,
        priceChange24h: player.priceChange24h,
      };
    }),
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

type PublicSportsCapability = Exclude<keyof SportsAdapter, "sport">;

function getPublicSportsRegistry(context: PublicMcpServerContext): SportsAdapterRegistry {
  return context.deps.sportsRegistry || DEFAULT_PUBLIC_SPORTS_REGISTRY;
}

function parsePublicSport(value: unknown): Sport {
  const parsed = sportSchema.safeParse(toStringValue(value).toLowerCase());
  if (!parsed.success) {
    throw new PublicMcpToolError("sport must be one of mlb, nhl, or nascar.", "unsupported_sport");
  }
  return parsed.data;
}

function requireSportsCapability(
  context: PublicMcpServerContext,
  sport: Sport,
  capability: PublicSportsCapability,
) {
  const registry = getPublicSportsRegistry(context);
  if (!registry.supports(sport, capability)) {
    throw new PublicMcpToolError(
      `${capability} is not supported for ${sport}.`,
      "unsupported_capability",
      { sport, capability },
    );
  }
  return registry.get(sport);
}

function getSportsCapabilityView(context: PublicMcpServerContext, sport: Sport) {
  const registry = getPublicSportsRegistry(context);
  const capabilities: PublicSportsCapability[] = [
    "searchAthletes",
    "getAthlete",
    "getTeams",
    "getSchedule",
    "getStats",
    "getLiveState",
  ];
  return Object.fromEntries(
    capabilities.map((capability) => [capability, registry.supports(sport, capability)]),
  );
}

function resolveSportsDateRange(args: Record<string, unknown>) {
  const date = toOptionalString(args.date);
  const startDate = toOptionalString(args.startDate) || date || getTodayET();
  const endDate = toOptionalString(args.endDate) || date || startDate;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
    throw new PublicMcpToolError("Invalid event date range.", "invalid_arguments");
  }
  const days = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
  if (days > 14) {
    throw new PublicMcpToolError(
      "Event slate ranges are limited to 14 days.",
      "request_too_broad",
      { maxDays: 14 },
    );
  }
  return { startDate, endDate, start, end };
}

async function getSupportedSportsCapabilities(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const sport = parsePublicSport(args.sport);
  return {
    summary: `Loaded supported unified sports capabilities for ${sport}.`,
    sport,
    capabilities: getSportsCapabilityView(context, sport),
    supportedSports: getPublicSportsRegistry(context).list(),
    source: "unified_adapter_registry",
  };
}

async function searchSportsEntities(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const sport = parsePublicSport(args.sport);
  const entityType = toStringValue(args.entityType);
  const query = toStringValue(args.query).toLowerCase();
  const limit = toPositiveInteger(args.limit) || 20;
  const offset = Math.max(0, Number(args.offset) || 0);
  if (entityType === "athlete") {
    const adapter = requireSportsCapability(context, sport, "searchAthletes");
    const items = await adapter.searchAthletes!(query);
    return {
      summary: `Found ${items.length} ${sport} athlete match(es).`,
      sport,
      entityType,
      items: items.slice(offset, offset + limit),
      pagination: { offset, limit, total: items.length, hasMore: offset + limit < items.length },
      capabilities: getSportsCapabilityView(context, sport),
    };
  }
  const adapter = requireSportsCapability(context, sport, "getTeams");
  const teams = (await adapter.getTeams!()).filter((team) =>
    `${team.name} ${team.abbreviation || ""}`.toLowerCase().includes(query),
  );
  return {
    summary: `Found ${teams.length} ${sport} team match(es).`,
    sport,
    entityType: "team",
    items: teams.slice(offset, offset + limit),
    pagination: { offset, limit, total: teams.length, hasMore: offset + limit < teams.length },
    capabilities: getSportsCapabilityView(context, sport),
  };
}

async function getSportsEntity(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const sport = parsePublicSport(args.sport);
  const entityType = toStringValue(args.entityType);
  const entityId = toStringValue(args.entityId);
  if (entityType === "athlete") {
    const adapter = requireSportsCapability(context, sport, "getAthlete");
    const entity = await adapter.getAthlete!(entityId);
    if (!entity) {
      throw new PublicMcpToolError("Sports entity not found.", "not_found", {
        sport,
        entityType,
        entityId,
      });
    }
    return { summary: `Loaded ${entity.name}.`, sport, entityType, entity };
  }
  const adapter = requireSportsCapability(context, sport, "getTeams");
  const entity = (await adapter.getTeams!()).find((team) => team.id === entityId) || null;
  if (!entity) {
    throw new PublicMcpToolError("Sports entity not found.", "not_found", {
      sport,
      entityType,
      entityId,
    });
  }
  return { summary: `Loaded ${entity.name}.`, sport, entityType: "team", entity };
}

async function getUnifiedEventSlate(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const sport = parsePublicSport(args.sport);
  const range = resolveSportsDateRange(args);
  const limit = toPositiveInteger(args.limit) || 50;
  const offset = Math.max(0, Number(args.offset) || 0);
  const adapter = requireSportsCapability(context, sport, "getSchedule");
  const events = (await adapter.getSchedule!(range.start, range.end)).sort(
    (left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id),
  );
  return {
    summary: `Loaded ${events.length} ${sport} event(s) from ${range.startDate} through ${range.endDate}.`,
    sport,
    range: { startDate: range.startDate, endDate: range.endDate },
    events: events.slice(offset, offset + limit),
    pagination: { offset, limit, total: events.length, hasMore: offset + limit < events.length },
    capabilities: getSportsCapabilityView(context, sport),
  };
}

async function getUnifiedEventLiveState(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const sport = parsePublicSport(args.sport);
  const eventId = toStringValue(args.eventId);
  const adapter = requireSportsCapability(context, sport, "getLiveState");
  const liveState = await adapter.getLiveState!(eventId);
  if (!liveState) {
    throw new PublicMcpToolError("Live event state is not available.", "not_found", {
      sport,
      eventId,
    });
  }
  return {
    summary: `Loaded live state for ${eventId}.`,
    sport,
    eventId,
    liveState,
  };
}

async function getBatchedSportsContext(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const registry = getPublicSportsRegistry(context);
  const identityLookup: ProviderIdentityLookup =
    context.deps.sportsIdentityLookup ||
    (async (references) =>
      references
        .filter((reference) => reference.provider === "sportfolio")
        .map((reference) => ({ ...reference, sportfolioId: reference.providerId })));
  const result = await assembleSportsContext(
    args as any,
    { mode: "authenticated", userId: context.userId },
    {
      registry,
      identityLookup,
      storage: context.deps.storage,
    },
  );
  return {
    summary: `Loaded ${result.requests.length} batched sports context request(s).`,
    ...result,
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
    if (!collection.some((ownedPlayer) => ownedPlayer.id === player.id)) {
      collection.push({
        id: player.id,
        name: `${player.firstName} ${player.lastName}`,
      });
    }
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

async function getPendingAction(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const transactionId = toStringValue(args.transactionId);
  if (!transactionId) {
    throw new PublicMcpToolError("transactionId is required.", "invalid_arguments");
  }
  const transaction = await context.deps.getGameplayTransaction(context.userId, transactionId);
  return { summary: transaction.summary, transaction };
}

async function confirmPendingAction(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const transactionId = toStringValue(args.transactionId);
  if (!transactionId) {
    throw new PublicMcpToolError("transactionId is required.", "invalid_arguments");
  }
  const transaction = await context.deps.confirmGameplayTransaction(context.userId, transactionId);
  return { summary: "Confirmed gameplay transaction.", transactionId, transaction };
}

async function cancelPendingAction(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const transactionId = toStringValue(args.transactionId);
  if (!transactionId) {
    throw new PublicMcpToolError("transactionId is required.", "invalid_arguments");
  }
  const transaction = await context.deps.cancelGameplayTransaction(context.userId, transactionId);
  return { summary: "Cancelled gameplay transaction.", transactionId, transaction };
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

async function completeOnboarding(context: PublicMcpServerContext) {
  await context.deps.storage.markOnboardingComplete(context.userId);
  return {
    summary: "Marked onboarding as complete.",
    success: true,
  };
}

async function getLeaderboard(context: PublicMcpServerContext, args: Record<string, unknown>) {
  const category = toStringValue(args.category) || "netWorth";
  const limit = Math.min(50, Math.max(3, toPositiveInteger(args.limit) || 10));
  const result = await context.deps.getLeaderboardReadResponse(category, context.userId);
  return {
    summary: `Loaded ${result.categoryLabel} rankings.`,
    ...result,
    leaderboard: result.leaderboard.slice(0, limit),
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

const noArgsSchema: RawSchema = {};
const optionalSportDateSchema: RawSchema = {
  sport: z.string().min(2).max(16).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
};
const dashboardOverviewSchema: RawSchema = {
  recentLotsLimit: z.number().int().min(1).max(20).optional().default(6),
  sport: z.string().min(2).max(16).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
};
const scoutOpportunitySchema: RawSchema = {
  sport: z.string().min(2).max(16).optional(),
  limit: z.number().int().positive().max(20).optional(),
};
const pendingActionSchema: RawSchema = {
  transactionId: z.string().uuid(),
};
const tokenIdSchema: RawSchema = {
  tokenId: z.string().min(1),
};
const usernameSchema: RawSchema = {
  username: z.string().min(3).max(20),
};
const profileImageSchema: RawSchema = {
  profileImageUrl: z.string().url(),
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
  query: z.string().min(1).max(120),
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
};
const stageMarketSellSchema: RawSchema = {
  playerId: z.string().min(1),
  shares: z.number().positive(),
};
const stageLpAddSchema: RawSchema = {
  playerId: z.string().min(1),
  shares: z.number().positive(),
  playMoney: z.number().positive(),
};
const stageLpAddOptimalSchema: RawSchema = {
  playerId: z.string().min(1),
  maxShares: z.number().positive().optional(),
  maxPlayMoney: z.number().positive().optional(),
  shares: z.number().positive().optional(),
  playMoney: z.number().positive().optional(),
};
const stageLpZapSchema: RawSchema = {
  playerId: z.string().min(1),
  shares: z.number().positive().optional(),
  sbAmount: z.number().positive().optional(),
};
const stageLpRemoveSchema: RawSchema = {
  playerId: z.string().min(1),
  lpShares: z.number().positive(),
};
const stageScoutSchema: RawSchema = {
  playerId: z.string().min(1),
  targetCount: z.number().int().min(0).max(10),
};
const stageBoostAssignSchema: RawSchema = {
  playerId: z.string().min(1),
  slotTier: z.union([z.literal(2), z.literal(3), z.literal(5), z.literal(7), z.literal(10)]),
  shares: z.number().positive(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sport: z.string().min(2).max(16).optional(),
};
const stageBoostRemoveSchema: RawSchema = {
  playerId: z.string().min(1),
  slotTier: z.union([z.literal(2), z.literal(3), z.literal(5), z.literal(7), z.literal(10)]),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sport: z.string().min(2).max(16).optional(),
};
const stageCommunityBoostSchema: RawSchema = {
  playerId: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sport: z.string().min(2).max(16).optional(),
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
const activityFeedSchema: RawSchema = {
  types: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).max(500).optional(),
};
const collectionDetailSchema: RawSchema = {
  type: z.string().min(1),
  targetId: z.string().min(1),
};
const leaderboardSchema: RawSchema = {
  category: z
    .enum(["netWorth", "cashBalance", "portfolioValue", "tradingVolume24h", "marketOrders"])
    .optional(),
  limit: z.number().int().min(3).max(50).optional(),
};
const publicSportSchema: RawSchema = {
  sport: sportSchema,
};
const sportsEntitySearchSchema: RawSchema = {
  sport: sportSchema,
  entityType: z.enum(["athlete", "team"]),
  query: z.string().min(1).max(120),
  limit: z.number().int().positive().max(50).optional(),
  offset: z.number().int().min(0).max(500).optional(),
};
const sportsEntityDetailSchema: RawSchema = {
  sport: sportSchema,
  entityType: z.enum(["athlete", "team"]),
  entityId: z.string().min(1).max(160),
};
const eventSlateSchema: RawSchema = {
  sport: sportSchema,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).max(500).optional(),
};
const eventLiveStateSchema: RawSchema = {
  sport: sportSchema,
  eventId: z.string().min(1).max(160),
};
const sportsContextToolSchema: RawSchema = {
  requests: z
    .array(
      z
        .object({
          sport: sportSchema,
          sections: z
            .array(
              z.enum([
                "entities",
                "teams",
                "schedule",
                "recent_performance",
                "live_state",
                "standings",
                "leaders",
                "user_exposure",
              ]),
            )
            .min(1)
            .max(8),
          athleteIds: z.array(z.string().min(1).max(160)).max(20).optional(),
          teamIds: z.array(z.string().min(1).max(160)).max(20).optional(),
          eventIds: z.array(z.string().min(1).max(160)).max(10).optional(),
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          startDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          endDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          season: z.string().min(4).max(16).optional(),
        })
        .strict(),
    )
    .min(1)
    .max(6),
  providerReferences: z
    .array(
      z
        .object({
          sport: sportSchema,
          provider: z.string().min(1).max(80),
          entityType: z.enum(["athlete", "team", "event"]),
          providerId: z.string().min(1).max(160),
        })
        .strict(),
    )
    .max(30)
    .optional(),
  deadlineMs: z.number().int().min(250).max(8000).optional(),
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
    description:
      "Use this when the user asks who to boost or wants ranked Daily Boost recommendations. Do not use it to assign a boost; use list_daily_boost_eligible_players, then stage_daily_boost_assign.",
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
    description:
      "Use this when the user asks who to scout or wants ranked scout recommendations. Do not use it to change assignments; use stage_scout_assignment after the user selects a target.",
    domain: "scouting",
    readOnly: true,
    inputSchema: scoutOpportunitySchema,
    fixtureArgs: { sport: "mlb", limit: 6 },
    execute: (context, args) => executeScanTool(context, "scan_scout_opportunities", args),
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
    description: "List current player holdings and available shares.",
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
      "Use this for one player's bounded Sportfolio snapshot: identity, market context, recent performance, and the user's holding state. Do not use it for a multi-player search or to mutate holdings.",
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
    description:
      "Use this to quote a proposed buy or sell before staging it. Do not use it to execute a trade; use stage_market_buy or stage_market_sell and review the server-issued transaction.",
    domain: "market",
    readOnly: true,
    inputSchema: getTradeQuoteSchema,
    fixtureArgs: { playerId: "player_1", type: "buy", amount: 25 },
    execute: (context, args) => executeReadTool(context, "get_amm_trade_quote", args),
  }),
];

const MLB_TOOLS: PublicToolDefinition[] = CURATED_MLB_TOOLS.map((tool) =>
  defineTool({
    name: tool.name,
    title: tool.name
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    description: tool.description,
    domain: "mlb",
    readOnly: true,
    inputSchema: tool.inputSchema,
    fixtureArgs: tool.fixtureArgs,
    execute: async (context, args) =>
      toStructuredContent(
        await context.deps.callMlbPublicTool(tool.name as CuratedMlbToolName, args),
      ),
  }),
);

const CUSTOM_TOOLS: PublicToolDefinition[] = [
  defineTool({
    name: "get_sports_context",
    title: "Get batched sports context",
    description:
      "Use this to assemble only the requested MLB, NHL, or NASCAR entity, schedule, performance, live-state, or sanitized connected-user sections in one bounded call.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: sportsContextToolSchema,
    fixtureArgs: {
      requests: [{ sport: "mlb", sections: ["schedule"], date: "2026-08-04" }],
      deadlineMs: 4000,
    },
    execute: getBatchedSportsContext,
  }),
  defineTool({
    name: "get_supported_sports_capabilities",
    title: "Get supported sports capabilities",
    description:
      "Use this to discover which unified read capabilities are available for MLB, NHL, or NASCAR before selecting another sports-data tool.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: publicSportSchema,
    fixtureArgs: { sport: "mlb" },
    execute: getSupportedSportsCapabilities,
  }),
  defineTool({
    name: "search_sports_entities",
    title: "Search sports entities",
    description:
      "Use this to search canonical athletes, drivers, or teams within one supported sport. Do not use provider-native identifiers as Sportfolio IDs.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: sportsEntitySearchSchema,
    fixtureArgs: { sport: "mlb", entityType: "athlete", query: "Ohtani", limit: 10 },
    execute: searchSportsEntities,
  }),
  defineTool({
    name: "get_sports_entity",
    title: "Get sports entity",
    description:
      "Use this to load one canonical athlete, driver, or team after resolving its stable unified ID.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: sportsEntityDetailSchema,
    fixtureArgs: { sport: "mlb", entityType: "athlete", entityId: "mlb_660271" },
    execute: getSportsEntity,
  }),
  defineTool({
    name: "get_event_slate",
    title: "Get event slate",
    description:
      "Use this to list a compact, chronologically ordered MLB, NHL, or NASCAR schedule for one date or a bounded date range.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: eventSlateSchema,
    fixtureArgs: { sport: "mlb", date: "2026-08-04", limit: 25 },
    execute: getUnifiedEventSlate,
  }),
  defineTool({
    name: "get_event_live_state",
    title: "Get event live state",
    description:
      "Use this to retrieve the current inning, period, lap, stage, clock, and normalized status for one canonical event ID.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: eventLiveStateSchema,
    fixtureArgs: { sport: "mlb", eventId: "mlb_game_1" },
    execute: getUnifiedEventLiveState,
  }),
  defineTool({
    name: "get_dashboard_overview",
    description:
      "Use this when the user asks for a compact dashboard summary across balance, portfolio, boosts, scouts, and watchlists. Do not use it for a complete holdings table; use render_portfolio for that.",
    domain: "dashboard",
    readOnly: true,
    inputSchema: dashboardOverviewSchema,
    fixtureArgs: { recentLotsLimit: 6 },
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
    name: "get_premium_status",
    description: "Load the authenticated user's premium status and redeemable share count.",
    domain: "premium",
    readOnly: true,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: getPremiumStatusTool,
  }),
  defineTool({
    name: "search_players",
    description:
      "Use this first when a user names a Sportfolio player and the canonical player ID is unknown; return a small set of active matches by name, team, or position. Do not pass provider-native IDs or use q/search aliases.",
    domain: "players",
    readOnly: true,
    inputSchema: searchPlayersSchema,
    fixtureArgs: { query: "Jalen" },
    execute: searchPlayers,
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
    name: "get_leaderboard",
    description:
      "Load the live Sportfolio trader leaderboard using the same ranking metrics as the website.",
    domain: "rankings",
    readOnly: true,
    inputSchema: leaderboardSchema,
    fixtureArgs: { category: "netWorth", limit: 10 },
    routeRefs: ["GET /api/leaderboards"],
    execute: getLeaderboard,
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
    fixtureArgs: { section: "gameplay", slug: "sports-and-slates" },
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
    description:
      "Use this before assigning a Daily Boost to verify eligible current holdings and available direct-share quantities. Do not use it to assign a boost; use stage_daily_boost_assign with playerId, slotTier, and shares.",
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
    name: "get_pending_action",
    description: "Load one staged gameplay transaction.",
    domain: "transactions",
    readOnly: true,
    inputSchema: pendingActionSchema,
    fixtureArgs: { transactionId: "00000000-0000-4000-8000-000000000001" },
    execute: getPendingAction,
  }),
  defineTool({
    name: "stage_market_buy",
    description:
      "Use this to stage a proposed Singles buy for explicit review and confirmation. Do not call confirm_pending_action until the user approves the exact server-issued transaction.",
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
      }),
  }),
  defineTool({
    name: "stage_market_sell",
    description:
      "Use this to stage a proposed share sale for explicit review and confirmation. Do not call confirm_pending_action until the user approves the exact server-issued transaction.",
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
      }),
  }),
  defineTool({
    name: "stage_scout_assignment",
    description:
      "Use this to stage one scout assignment change after the user selects a player and target count. Do not execute or silently confirm the change; render/review the server-issued transaction first.",
    domain: "scouting",
    readOnly: false,
    inputSchema: stageScoutSchema,
    fixtureArgs: { playerId: "player_1", targetCount: 2 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_scout_adjustment",
        previewArgs: args,
      }),
  }),
  defineTool({
    name: "stage_daily_boost_assign",
    description:
      "Use this to stage a Daily Boost assignment after eligibility is checked. The current economy uses direct Singles quantity: provide playerId, one of slotTier 2/3/5/7/10, and shares; date and sport are optional. Do not use retired Stack Shares concepts and do not confirm without explicit user approval.",
    domain: "boosts",
    readOnly: false,
    inputSchema: stageBoostAssignSchema,
    fixtureArgs: { playerId: "player_1", slotTier: 5, shares: 1, sport: "MLB" },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_daily_boost_assign",
        previewArgs: args,
      }),
  }),
  defineTool({
    name: "stage_daily_boost_remove",
    description: "Stage removal of an active Daily Boost for confirmation.",
    domain: "boosts",
    readOnly: false,
    inputSchema: stageBoostRemoveSchema,
    fixtureArgs: { playerId: "player_1", slotTier: 2, sport: "MLB" },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_daily_boost_remove",
        previewArgs: args,
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
      }),
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
    name: "redeem_premium",
    description: "Redeem one premium share immediately for premium access.",
    domain: "premium",
    readOnly: false,
    inputSchema: noArgsSchema,
    fixtureArgs: {},
    execute: redeemPremiumTool,
  }),
  defineTool({
    name: "confirm_pending_action",
    description:
      "Use this only after the user explicitly approves the exact server-issued staged transaction shown by render_action_review. Do not create or alter a transaction with this tool; it executes exactly one pending transactionId.",
    domain: "transactions",
    readOnly: false,
    inputSchema: pendingActionSchema,
    fixtureArgs: { transactionId: "00000000-0000-4000-8000-000000000001" },
    execute: confirmPendingAction,
  }),
  defineTool({
    name: "cancel_pending_action",
    description: "Cancel a staged gameplay transaction.",
    domain: "transactions",
    readOnly: false,
    inputSchema: pendingActionSchema,
    fixtureArgs: { transactionId: "00000000-0000-4000-8000-000000000001" },
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

export function createDefaultPublicMcpDependencies(): PublicMcpDependencies {
  return {
    storage,
    runNativeReadTool,
    runNativeScanTool,
    runNativePlanTool,
    runNativeActionTool,
    stageGameplayTransaction,
    getGameplayTransaction,
    confirmGameplayTransaction,
    cancelGameplayTransaction,
    callMlbPublicTool,
    getMlbProviderHealth,
    listDocsArticles,
    searchDocsArticles,
    getDocsArticle,
    redeemPremiumShare,
    getLeaderboardReadResponse,
    getCanonicalPlayerMarkets,
    listCollections: defaultListCollections,
    getCollectionDetail: defaultGetCollectionDetail,
    listMilestones: defaultListMilestones,
    celebrateMilestone: defaultCelebrateMilestone,
  };
}

const PUBLIC_EXCLUDED_CAPABILITIES: PublicExcludedCapability[] = [
  {
    capabilityId: "list_watchlist_player_ids_site_only",
    kind: "excluded",
    status: "excluded",
    domain: "watchlists",
    source: "/api/watchlist",
    notes:
      "The website's flattened player-id helper is redundant with list_watchlists and get_watchlist_items and is not model-visible.",
  },
  {
    capabilityId: "list_community_boost_history_site_only",
    kind: "excluded",
    status: "excluded",
    domain: "community_boosts",
    source: "/api/community-boosts/history",
    notes:
      "The route has no dedicated persisted history source; the empty model-visible compatibility tool was removed.",
  },
  {
    capabilityId: "news_digest_site_only",
    kind: "excluded",
    status: "excluded",
    domain: "news",
    source: "/api/news/digest",
    notes: "The website news digest remains outside the shared CLI and MCP capability surface.",
  },
  {
    capabilityId: "news_mark_read_site_only",
    kind: "excluded",
    status: "excluded",
    domain: "news",
    source: "/api/news/mark-read",
    notes: "Website news-read state remains outside the shared CLI and MCP capability surface.",
  },
  {
    capabilityId: "news_unread_count_site_only",
    kind: "excluded",
    status: "excluded",
    domain: "news",
    source: "/api/news/unread-count",
    notes: "Website news badge counts remain outside the shared CLI and MCP capability surface.",
  },
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
    capabilityId: "admin_internal_routes",
    kind: "excluded",
    status: "excluded",
    domain: "admin",
    source: "admin/internal-only routes",
    notes: "Admin and internal-only routes must not be exposed through CLI or MCP.",
  },
  {
    capabilityId: "collection_allocation_set_web_only",
    kind: "excluded",
    status: "excluded",
    domain: "collections",
    source: "/api/me/collections/:slug/slots/:slotId/allocation",
    notes:
      "Collection allocation mutation remains web-only until a stable staged public-tool workflow ships.",
  },
  {
    capabilityId: "collection_allocation_release_web_only",
    kind: "excluded",
    status: "excluded",
    domain: "collections",
    source: "/api/me/collections/:slug/slots/:slotId/allocation",
    notes:
      "Collection allocation release remains web-only until a stable staged public-tool workflow ships.",
  },
  {
    capabilityId: "collection_completion_web_only",
    kind: "excluded",
    status: "excluded",
    domain: "collections",
    source: "/api/me/collections/:slug/complete",
    notes:
      "Collection completion remains web-only until a stable staged public-tool workflow ships.",
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
  { method: "GET", path: "/api/me/collections", capabilityIds: ["list_collections"] },
  {
    method: "GET",
    path: "/api/collections/:type/:targetId",
    capabilityIds: ["get_collection_detail"],
  },
  {
    method: "GET",
    path: "/api/me/collections/:slug",
    capabilityIds: ["get_collection_detail"],
  },
  {
    method: "PUT",
    path: "/api/me/collections/:slug/slots/:slotId/allocation",
    excludedCapabilityId: "collection_allocation_set_web_only",
  },
  {
    method: "DELETE",
    path: "/api/me/collections/:slug/slots/:slotId/allocation",
    excludedCapabilityId: "collection_allocation_release_web_only",
  },
  {
    method: "POST",
    path: "/api/me/collections/:slug/complete",
    excludedCapabilityId: "collection_completion_web_only",
  },
  { method: "GET", path: "/api/milestones", capabilityIds: ["list_milestones"] },
  {
    method: "POST",
    path: "/api/milestones/:id/celebrate",
    capabilityIds: ["celebrate_milestone"],
  },
  { method: "GET", path: "/api/trades/history", capabilityIds: ["get_trade_history"] },
  {
    method: "GET",
    path: "/api/watchlist",
    excludedCapabilityId: "list_watchlist_player_ids_site_only",
  },
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
  { method: "GET", path: "/api/news/digest", excludedCapabilityId: "news_digest_site_only" },
  { method: "POST", path: "/api/news/mark-read", excludedCapabilityId: "news_mark_read_site_only" },
  {
    method: "GET",
    path: "/api/news/unread-count",
    excludedCapabilityId: "news_unread_count_site_only",
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
    excludedCapabilityId: "list_community_boost_history_site_only",
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
  { method: "GET", path: "/api/account/tokens", capabilityIds: ["list_api_tokens"] },
  { method: "DELETE", path: "/api/account/tokens/:id", capabilityIds: ["revoke_api_token"] },
];

const PUBLIC_TOOL_ONLY_CAPABILITY_IDS = [
  "list_boost_candidates",
  "list_scout_opportunities",
  "get_balance_state",
  "get_player_stats",
  "get_player_recent_games",
  "get_player_financial_metrics",
  "get_player_shares_info",
  "get_amm_pool_state",
  "get_trade_quote",
  "get_dashboard_overview",
  "get_leaderboard",
  "search_players",
  "get_games_today",
  "get_game_insights",
  "search_docs",
  "get_doc_article",
  "get_pending_action",
  "confirm_pending_action",
  "cancel_pending_action",
  "get_supported_sports_capabilities",
  "search_sports_entities",
  "get_sports_entity",
  "get_event_slate",
  "get_event_live_state",
  "get_sports_context",
  ...CURATED_MLB_TOOLS.map((tool) => tool.name),
] as const;

const PUBLIC_PROMPT_NAMES = ["find_boost_candidates", "stage_trade"] as const;

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
  return [...READ_ALIAS_TOOLS, ...CUSTOM_TOOLS, ...MLB_TOOLS].filter((tool) =>
    isApprovedPublicToolName(tool.name),
  );
}

export function buildPublicPromptRegistry(): PublicPromptDefinition[] {
  return PUBLIC_PROMPTS.filter((prompt) => isApprovedPublicPromptName(prompt.name));
}

export async function buildResolvedPublicToolCatalog(context: PublicMcpServerContext): Promise<{
  tools: PublicToolCatalogEntry[];
  dynamicSources: PublicDynamicSourceStatus[];
}> {
  return {
    tools: buildPublicToolRegistry().map(toStaticPublicToolCatalogEntry),
    dynamicSources: [await getMlbSourceStatus(context)],
  };
}

export async function buildResolvedPublicCapabilityInventory(
  context: PublicMcpServerContext,
): Promise<{
  included: PublicIncludedCapability[];
  excluded: PublicExcludedCapability[];
  dynamicSources: PublicDynamicSourceStatus[];
}> {
  const inventory = buildPublicCapabilityInventory();
  return { ...inventory, dynamicSources: [await getMlbSourceStatus(context)] };
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
    excluded: [
      ...PUBLIC_EXCLUDED_CAPABILITIES,
      ...getDeniedPublicToolNames().map(
        (capabilityId) =>
          ({
            capabilityId,
            kind: "excluded",
            status: "excluded",
            domain: "legacy",
            source: "public_tool_policy",
            notes:
              "Removed from the public MCP and ChatGPT app surface during unified sports-data Release A.",
          }) satisfies PublicExcludedCapability,
      ),
    ],
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
      (entry.capabilityIds || []).filter(
        (capabilityId) =>
          isApprovedPublicToolName(capabilityId) && !knownCapabilityIds.has(capabilityId),
      ),
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
  const expectedToolNames = new Set<string>(
    [...routeBackedToolNames, ...PUBLIC_TOOL_ONLY_CAPABILITY_IDS].filter(isApprovedPublicToolName),
  );
  const registryPromptNames = new Set(buildPublicPromptRegistry().map((prompt) => prompt.name));
  const expectedPromptNames = new Set<string>(
    PUBLIC_PROMPT_NAMES.filter(isApprovedPublicPromptName),
  );
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

/** Canonical input validation used by every public dispatch path and contract test. */
export function validatePublicToolArguments(name: string, args: Record<string, unknown> = {}) {
  const tool = getPublicToolDefinition(name);
  if (!tool) {
    throw new PublicMcpToolError("Unknown public tool.", "not_found", { name });
  }
  return parseSchemaArgs(tool.inputSchema, args);
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
  return tool.execute(context, validatePublicToolArguments(name, args));
}

export async function executeResolvedPublicTool(
  context: PublicMcpServerContext,
  name: string,
  args: Record<string, unknown> = {},
) {
  return executePublicTool(context, name, args);
}

export async function resolvePublicCapabilityCatalog(context: PublicMcpServerContext) {
  const resources = buildPublicResourceRegistry(context);
  const inventory = await buildResolvedPublicCapabilityInventory(context);
  return {
    tools: buildPublicToolRegistry().map(toStaticPublicToolCatalogEntry),
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
    dynamicSources: inventory.dynamicSources,
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

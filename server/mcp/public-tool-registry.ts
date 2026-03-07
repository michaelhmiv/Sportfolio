import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDocsArticle, listDocsArticles, searchDocsArticles } from "../docs-service";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { storage } from "../storage";
import {
  runHermesActionTool,
  runHermesPlanTool,
  runHermesReadTool,
  runHermesScanTool,
} from "../agent/hermes-tools";
import { planDirectAgentOperation } from "../agent/operations-planner";
import { getScoutAgentProfile } from "../agent/service";
import {
  cancelAgentThread,
  confirmAgentThread,
  createAgentThread,
  getAgentThread,
  listAgentThreadMessages,
  listAgentThreads,
  sendAgentThreadMessage,
} from "../agent/thread-service";
import {
  EXCLUDED_GAMEPLAY_CAPABILITIES,
  INCLUDED_GAMEPLAY_CAPABILITIES,
  INCLUDED_GAMEPLAY_PROMPT_NAMES,
  INCLUDED_GAMEPLAY_RESOURCE_URIS,
  INCLUDED_GAMEPLAY_TOOL_NAMES,
} from "./gameplay-capability-matrix";

type RawSchema = Record<string, z.ZodTypeAny>;

type ToolStructuredContent = Record<string, unknown>;

type PublicMcpToolDefinition = {
  name: string;
  title?: string;
  description: string;
  domain: string;
  readOnly: boolean;
  inputSchema?: RawSchema;
  fixtureArgs: Record<string, unknown>;
  execute: (
    context: PublicMcpServerContext,
    args: Record<string, unknown>,
  ) => Promise<ToolStructuredContent>;
};

type PublicMcpServerContext = {
  userId: string;
  deps: PublicMcpDependencies;
};

type StorageSubset = Pick<
  typeof storage,
  | "getPlayers"
  | "getUser"
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
>;

export type PublicMcpDependencies = {
  storage: StorageSubset;
  runHermesReadTool: typeof runHermesReadTool;
  runHermesScanTool: typeof runHermesScanTool;
  runHermesPlanTool: typeof runHermesPlanTool;
  runHermesActionTool: typeof runHermesActionTool;
  planDirectAgentOperation: typeof planDirectAgentOperation;
  getScoutAgentProfile: typeof getScoutAgentProfile;
  createAgentThread: typeof createAgentThread;
  sendAgentThreadMessage: typeof sendAgentThreadMessage;
  confirmAgentThread: typeof confirmAgentThread;
  cancelAgentThread: typeof cancelAgentThread;
  getAgentThread: typeof getAgentThread;
  listAgentThreadMessages: typeof listAgentThreadMessages;
  listAgentThreads: typeof listAgentThreads;
  listDocsArticles: typeof listDocsArticles;
  searchDocsArticles: typeof searchDocsArticles;
  getDocsArticle: typeof getDocsArticle;
  compileUserDigest: (userId: string) => Promise<unknown>;
};

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

function assertRecord(value: unknown, code = "invalid_arguments"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicMcpToolError("Arguments must be an object.", code);
  }
  return value as Record<string, unknown>;
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
  const stageMessage = toStringValue(preview.stageMessage);
  const canStage = preview.canStage !== false && Boolean(stageMessage);

  if (!canStage) {
    throw new PublicMcpToolError(
      "The requested action could not be staged with the current inputs.",
      "cannot_stage",
      { preview },
    );
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
    message: stageMessage,
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
  const [user, scoutStatus, totalAssigned] = await Promise.all([
    context.deps.storage.getUser(context.userId),
    context.deps.storage.getScoutStatus(context.userId),
    context.deps.storage.getTotalScoutsForUser(context.userId),
  ]);

  const maxScouts = user?.isPremium ? 10 : 5;
  return {
    summary: "Loaded scout status.",
    earnedMinutes: scoutStatus.earnedMinutes,
    nextDistribution: scoutStatus.nextDistribution,
    perPlayer: scoutStatus.perPlayer || {},
    assignedScouts: totalAssigned,
    maxScouts,
    remainingScouts: Math.max(0, maxScouts - totalAssigned),
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
    .slice(0, toPositiveInteger(args.limit) || 150)
    .map((player) => ({
      playerId: player.id,
      player,
      game: gameByTeam.get(player.team) || null,
      communityBoostCount: boostCountByPlayer.get(player.id) || 0,
      alreadyBoostedByUser: userBoostedPlayerIds.has(player.id),
    }));

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
  const result = await context.deps.confirmAgentThread(context.userId, threadId);
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
  const result = await context.deps.cancelAgentThread(context.userId, threadId);
  return {
    summary: "Cancelled pending action bundle.",
    threadId,
    pendingBundleId,
    result,
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
const stageCondenseSchema: RawSchema = {
  playerId: z.string().min(1),
  shares: z.number().int().positive(),
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

function defineTool(definition: PublicMcpToolDefinition): PublicMcpToolDefinition {
  return definition;
}

const READ_ALIAS_TOOLS: PublicMcpToolDefinition[] = [
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
    description: "List current player holdings, power, and available shares.",
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
    name: "get_holdings_power_level",
    description: "Read holding power and available share state for a player.",
    domain: "power",
    readOnly: true,
    inputSchema: playerIdSchema,
    fixtureArgs: { playerId: "player_1" },
    execute: (context, args) => executeReadTool(context, "get_holdings_power_level", args),
  }),
  defineTool({
    name: "list_daily_boosts",
    description: "List the user's daily boosts for a requested date.",
    domain: "boosts",
    readOnly: true,
    inputSchema: {
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

const CUSTOM_TOOLS: PublicMcpToolDefinition[] = [
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
    fixtureArgs: { section: "gameplay", slug: "daily-boosts" },
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
    fixtureArgs: { playerId: "player_1", shares: 2 },
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
    fixtureArgs: { playerId: "player_1", shares: 4, playMoney: 25 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_lp_add_optimal",
        previewArgs: {
          playerId: args.playerId,
          shares: args.shares,
          playMoney: args.playMoney,
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
    name: "stage_condense",
    description: "Stage a condense action for confirmation.",
    domain: "power",
    readOnly: false,
    inputSchema: stageCondenseSchema,
    fixtureArgs: { playerId: "player_1", shares: 2 },
    execute: (context, args) =>
      stagePreviewedAction({
        context,
        previewToolName: "preview_condense",
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
      jobType: "daily_digest",
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
    fixtureArgs: { jobType: "daily_digest" },
    execute: (context, args) => executeActionTool(context, "delete_user_schedule", args),
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

export function createDefaultPublicMcpDependencies(): PublicMcpDependencies {
  return {
    storage,
    runHermesReadTool,
    runHermesScanTool,
    runHermesPlanTool,
    runHermesActionTool,
    planDirectAgentOperation,
    getScoutAgentProfile,
    createAgentThread,
    sendAgentThreadMessage,
    confirmAgentThread,
    cancelAgentThread,
    getAgentThread,
    listAgentThreadMessages,
    listAgentThreads,
    listDocsArticles,
    searchDocsArticles,
    getDocsArticle,
    compileUserDigest: async (userId: string) => {
      const module = await import("../jobs/compile-digest");
      return module.compileUserDigest(userId);
    },
  };
}

const PUBLIC_MCP_PROMPT_NAMES = [
  "review_setup",
  "review_idle_cash",
  "find_boost_candidates",
  "stage_trade",
] as const;

const PUBLIC_MCP_STATIC_RESOURCE_URIS = [
  "sportfolio://docs/index",
  "sportfolio://capabilities",
  "sportfolio://action-surface",
] as const;

export function buildPublicMcpToolRegistry(): PublicMcpToolDefinition[] {
  return [...READ_ALIAS_TOOLS, ...CUSTOM_TOOLS];
}

export function getPublicMcpToolFixtures() {
  return Object.fromEntries(
    buildPublicMcpToolRegistry().map((entry) => [entry.name, entry.fixtureArgs]),
  );
}

export function evaluateGameplayCapabilityParity() {
  const registryToolNames = new Set(buildPublicMcpToolRegistry().map((entry) => entry.name));
  const matrixToolNames = new Set(INCLUDED_GAMEPLAY_TOOL_NAMES);
  const registryPromptNames = new Set<string>(PUBLIC_MCP_PROMPT_NAMES);
  const matrixPromptNames = new Set(INCLUDED_GAMEPLAY_PROMPT_NAMES);
  const registryResourceUris = new Set<string>(PUBLIC_MCP_STATIC_RESOURCE_URIS);
  const matrixResourceUris = new Set(INCLUDED_GAMEPLAY_RESOURCE_URIS);
  const missingFromRegistry = INCLUDED_GAMEPLAY_TOOL_NAMES.filter(
    (name) => !registryToolNames.has(name),
  );
  const extraInRegistry = [...registryToolNames].filter((name) => !matrixToolNames.has(name));
  const missingPromptNames = INCLUDED_GAMEPLAY_PROMPT_NAMES.filter(
    (name) => !registryPromptNames.has(name),
  );
  const extraPromptNames = [...registryPromptNames].filter((name) => !matrixPromptNames.has(name));
  const missingResourceUris = INCLUDED_GAMEPLAY_RESOURCE_URIS.filter(
    (uri) => !registryResourceUris.has(uri),
  );
  const extraResourceUris = [...registryResourceUris].filter((uri) => !matrixResourceUris.has(uri));

  return {
    ok:
      missingFromRegistry.length === 0 &&
      extraInRegistry.length === 0 &&
      missingPromptNames.length === 0 &&
      extraPromptNames.length === 0 &&
      missingResourceUris.length === 0 &&
      extraResourceUris.length === 0 &&
      EXCLUDED_GAMEPLAY_CAPABILITIES.length > 0,
    missingFromRegistry,
    extraInRegistry,
    missingPromptNames,
    extraPromptNames,
    missingResourceUris,
    extraResourceUris,
    includedCount: INCLUDED_GAMEPLAY_CAPABILITIES.length,
    excludedCount: EXCLUDED_GAMEPLAY_CAPABILITIES.length,
    toolCount: registryToolNames.size,
    promptCount: registryPromptNames.size,
    resourceCount: registryResourceUris.size,
  };
}

export function assertPublicMcpSurfaceIntegrity() {
  const parity = evaluateGameplayCapabilityParity();
  if (!parity.ok) {
    throw new Error(
      `Public MCP surface parity failed. Missing tools: ${parity.missingFromRegistry.join(", ") || "none"}; extra tools: ${parity.extraInRegistry.join(", ") || "none"}; missing prompts: ${parity.missingPromptNames.join(", ") || "none"}; extra prompts: ${parity.extraPromptNames.join(", ") || "none"}; missing resources: ${parity.missingResourceUris.join(", ") || "none"}; extra resources: ${parity.extraResourceUris.join(", ") || "none"}`,
    );
  }
}

export async function registerPublicMcpSurface(server: McpServer, context: PublicMcpServerContext) {
  for (const tool of buildPublicMcpToolRegistry()) {
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
          fixtureArgs: tool.fixtureArgs,
        },
      },
      async (args) => {
        try {
          return toToolResult(await tool.execute(context, assertRecord(args ?? {})));
        } catch (error) {
          return toToolErrorResult(error);
        }
      },
    );
  }

  server.registerPrompt(
    PUBLIC_MCP_PROMPT_NAMES[0],
    {
      description: "Prompt starter for a broad gameplay setup review.",
      argsSchema: {
        sport: z.string().min(2).max(16).optional(),
      },
    },
    async ({ sport }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: sport ? `Review my ${sport} setup.` : "Review my setup.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    PUBLIC_MCP_PROMPT_NAMES[1],
    {
      description: "Prompt starter for an idle-cash deployment review.",
      argsSchema: {},
    },
    async () => ({
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
  );

  server.registerPrompt(
    PUBLIC_MCP_PROMPT_NAMES[2],
    {
      description: "Prompt starter for daily boost candidate discovery.",
      argsSchema: {
        sport: z.string().min(2).max(16).optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      },
    },
    async ({ sport, date }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Who are my best daily boost candidates${sport ? ` in ${sport}` : ""}${date ? ` for ${date}` : ""}?`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    PUBLIC_MCP_PROMPT_NAMES[3],
    {
      description: "Prompt starter for staging a market trade.",
      argsSchema: {
        side: z.enum(["buy", "sell"]).optional(),
        player: z.string().min(1),
        amount: z.string().min(1),
      },
    },
    async ({ side, player, amount }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${side || "buy"} ${amount} of ${player}`,
          },
        },
      ],
    }),
  );

  const docsIndex = context.deps.listDocsArticles(true);
  server.registerResource(
    "docs-index",
    PUBLIC_MCP_STATIC_RESOURCE_URIS[0],
    {
      mimeType: "application/json",
      description: "Published Sportfolio documentation article index.",
    },
    async () => ({
      contents: [
        {
          uri: PUBLIC_MCP_STATIC_RESOURCE_URIS[0],
          text: JSON.stringify(docsIndex, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "capabilities",
    PUBLIC_MCP_STATIC_RESOURCE_URIS[1],
    {
      mimeType: "application/json",
      description: "MCP capability inventory for Sportfolio gameplay parity.",
    },
    async () => ({
      contents: [
        {
          uri: PUBLIC_MCP_STATIC_RESOURCE_URIS[1],
          text: JSON.stringify(
            {
              included: INCLUDED_GAMEPLAY_CAPABILITIES,
              excluded: EXCLUDED_GAMEPLAY_CAPABILITIES,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "action-surface",
    PUBLIC_MCP_STATIC_RESOURCE_URIS[2],
    {
      mimeType: "application/json",
      description: "Public MCP action surface grouped by domain.",
    },
    async () => ({
      contents: [
        {
          uri: PUBLIC_MCP_STATIC_RESOURCE_URIS[2],
          text: JSON.stringify(
            buildPublicMcpToolRegistry().map((tool) => ({
              name: tool.name,
              domain: tool.domain,
              readOnly: tool.readOnly,
              fixtureArgs: tool.fixtureArgs,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  for (const articleSummary of docsIndex) {
    const article = context.deps.getDocsArticle(articleSummary.section, articleSummary.slug, true);
    if (!article) {
      continue;
    }

    const uri = `sportfolio://docs/${article.section}/${article.slug}`;
    server.registerResource(
      article.id,
      uri,
      {
        mimeType: "text/markdown",
        description: article.summary,
      },
      async () => ({
        contents: [
          {
            uri,
            text: article.bodyMarkdown,
          },
        ],
      }),
    );
  }
}

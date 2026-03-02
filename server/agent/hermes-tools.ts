import { getAgentCapabilities, getScoutAgentProfile } from "./service";
import { loadScoutAgentContext } from "./context-loader";
import { listAgentKnowledgeArticles } from "../docs-service";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { z } from "zod";
import {
  getBuyQuote,
  getLpPosition,
  getOrCreatePool,
  getSellQuote,
  getUserLpPositions,
  getZapAddQuoteSbOnly,
  getZapAddQuoteSharesOnly,
} from "../amm/pool";
import {
  buildHermesMemoryContext,
  persistProposedMemoryWrites,
  archiveUserAgentMemory,
} from "./memory";
import {
  cancelAgentThread,
  confirmAgentThread,
  createAgentThread,
  getAgentThread,
  listAgentThreadMessages,
  sendAgentThreadMessage,
} from "./thread-service";
import { planDirectAgentOperation } from "./operations-planner";
import { planHostedWebResearch } from "./research";
import { storage } from "../storage";
import {
  listAgentScheduleTemplates,
  listUserAgentSchedules,
  removeUserAgentSchedule,
  upsertUserAgentSchedule,
} from "./schedules";
import type { AgentChannel, AgentScheduleJobType, ProposedMemoryWrite } from "./types";

type StructuredPlanPreview = {
  toolName: string;
  supported: boolean;
  canStage: boolean;
  requiresConfirmation: boolean;
  actionSummary: string;
  stageMessage: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  estimatedImpact: string | null;
  warnings: string[];
  quoteTimestamp: string;
};

const proposedMemoryWritesSchema = z.array(
  z.object({
    scope: z.enum(["profile", "episodic", "semantic"]),
    kind: z.enum([
      "preference",
      "goal",
      "risk_tolerance",
      "favorite_entities",
      "habit",
      "interaction_style",
    ]),
    summary: z.string().trim().min(1),
    content: z.record(z.unknown()),
    confidence: z.number().finite().min(0).max(1),
    reason: z.string().trim().min(1),
  }),
);

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalString(value: unknown): string | null {
  const normalized = toStringValue(value);
  return normalized || null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toNumberValue(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = toPositiveNumber(value);
  return parsed != null ? Math.floor(parsed) : null;
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return null;
}

function toChannelValue(value: unknown): AgentChannel | null {
  return value === "in_app" || value === "sms" || value === "cli" ? value : null;
}

function toScheduleJobType(value: unknown): AgentScheduleJobType | null {
  return value === "daily_setup_review" ||
    value === "pre_lock_nudge" ||
    value === "injury_watch" ||
    value === "idle_balance_nudge" ||
    value === "boost_window"
    ? value
    : null;
}

function buildDisabledWorkflowResult(feature: string) {
  return {
    supported: false,
    reason: `${feature} is not part of the active Sportfolio agent surface right now.`,
  };
}

function buildStructuredPreview(
  input: Omit<StructuredPlanPreview, "supported" | "quoteTimestamp">,
): StructuredPlanPreview {
  return {
    supported: true,
    quoteTimestamp: new Date().toISOString(),
    ...input,
  };
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function parseProposedMemoryWrites(value: unknown): ProposedMemoryWrite[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return proposedMemoryWritesSchema.parse(value);
}

async function loadOperatorToolContext(userId: string, message: string) {
  const profile = (await getScoutAgentProfile(userId)).profile;
  const context = await loadScoutAgentContext(userId, profile, {
    chatRequest: message,
  });

  return {
    profile,
    context,
  };
}

async function requirePlayer(playerId: string) {
  const player = await storage.getPlayer(playerId);
  if (!player) {
    throw new Error("Player not found");
  }

  return player;
}

function buildPlayerLabel(
  player: { firstName?: string | null; lastName?: string | null },
  fallback: string,
) {
  const fullName = `${toStringValue(player.firstName)} ${toStringValue(player.lastName)}`.trim();
  return fullName || fallback;
}

function resolveTargetDate(rawDate: unknown): Date {
  const requestedDate = toStringValue(rawDate);
  const normalizedDate =
    requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : getTodayET();
  const { startOfDay } = getETDayBoundaries(normalizedDate);
  return new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
}

async function getHoldingAvailability(userId: string, playerId: string) {
  const holding = await storage.getHoldingWithPowerLevel(userId, playerId);
  if (!holding) {
    return {
      hasHolding: false,
      quantity: 0,
      powerLevel: "0.00",
      availableShares: 0,
      canCondense: false,
      maxCondensable: 0,
    };
  }

  return {
    hasHolding: true,
    quantity: holding.quantity,
    powerLevel: holding.powerLevel,
    availableShares: holding.availableShares,
    canCondense: holding.availableShares >= 2,
    maxCondensable: Math.floor(holding.availableShares / 2) * 2,
  };
}

function resolvePreviewMessage(input: {
  toolName: string;
  args?: Record<string, unknown>;
}): string {
  const rawMessage = toStringValue(input.args?.message);
  if (rawMessage) {
    return rawMessage;
  }

  const playerLabel =
    toStringValue(input.args?.playerName) || toStringValue(input.args?.playerId) || "that player";
  const dollarAmount =
    typeof input.args?.amount === "number"
      ? input.args.amount
      : typeof input.args?.sbAmount === "number"
        ? input.args.sbAmount
        : null;
  const shares =
    typeof input.args?.shares === "number"
      ? input.args.shares
      : typeof input.args?.sharesAmount === "number"
        ? input.args.sharesAmount
        : null;
  const slotTier =
    typeof input.args?.slotTier === "number" ? Math.max(2, Math.min(5, input.args.slotTier)) : 2;

  switch (input.toolName) {
    case "preview_pool_buy":
      if (shares != null) {
        return `buy ${shares} ${playerLabel} shares`;
      }
      if (dollarAmount != null) {
        return `buy $${dollarAmount} of ${playerLabel}`;
      }
      break;
    case "preview_pool_sell":
      if (shares != null) {
        return `sell ${shares} ${playerLabel} shares`;
      }
      break;
    case "preview_lp_add":
      if (shares != null && dollarAmount != null) {
        return `add ${shares} ${playerLabel} shares and $${dollarAmount} to liquidity`;
      }
      if (shares != null || dollarAmount != null) {
        return `add optimal liquidity on ${playerLabel}`;
      }
      break;
    case "preview_lp_add_optimal": {
      const maxShares = toPositiveNumber(input.args?.maxShares);
      const maxPlayMoney = toPositiveNumber(input.args?.maxPlayMoney);
      if (maxShares != null && maxPlayMoney != null) {
        return `add optimal liquidity on ${playerLabel} using up to ${maxShares} shares and $${maxPlayMoney}`;
      }
      break;
    }
    case "preview_lp_remove":
      if (shares != null) {
        return `remove ${shares} lp shares from ${playerLabel}`;
      }
      break;
    case "preview_lp_zap":
      if (shares != null) {
        return `zap ${shares} ${playerLabel} shares into liquidity`;
      }
      if (dollarAmount != null) {
        return `zap $${dollarAmount} into ${playerLabel} liquidity`;
      }
      break;
    case "preview_condense":
      if (shares != null) {
        return `condense ${shares} ${playerLabel} shares`;
      }
      break;
    case "preview_daily_boost_assign":
      return `put ${playerLabel} in my ${slotTier}x boost slot today`;
    case "preview_daily_boost_remove":
      return `remove ${playerLabel} from my ${slotTier}x boost slot today`;
    case "preview_watchlist_add":
      return `add ${playerLabel} to my watchlist`;
    case "preview_watchlist_remove":
      return `remove ${playerLabel} from my watchlist`;
    case "preview_community_boost_create":
      return `create a community boost for ${playerLabel} today`;
    case "preview_scout_adjustment":
      if (typeof input.args?.targetCount === "number") {
        return `set ${playerLabel} scouts to ${input.args.targetCount}`;
      }
      break;
    case "preview_multi_action_bundle":
      return "";
    default:
      break;
  }

  throw new Error(`message is required for ${input.toolName}`);
}

async function getOrCreateThreadIdForAction(input: {
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}) {
  if (input.threadId) {
    return input.threadId;
  }

  const thread = await createAgentThread(input.userId, {
    channel: toChannelValue(input.args?.channel) || "in_app",
    domain: "sportfolio",
    title: toOptionalString(input.args?.title) || undefined,
  });

  return thread.id;
}

async function runParserBackedPreview(input: {
  toolName: string;
  userId: string;
  args?: Record<string, unknown>;
}) {
  const profile = (await getScoutAgentProfile(input.userId)).profile;
  const message = resolvePreviewMessage({
    toolName: input.toolName,
    args: input.args,
  });
  if (!message) {
    throw new Error("message is required for preview_direct_operation");
  }

  return planDirectAgentOperation({
    userId: input.userId,
    message,
    profile,
  });
}

async function buildPoolBuyPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const playerId = toStringValue(input.args?.playerId);
  const sbAmount = toPositiveNumber(input.args?.sbAmount ?? input.args?.amount);
  if (!playerId || sbAmount == null) {
    throw new Error("playerId and sbAmount are required for preview_pool_buy");
  }

  const [player, availableBalance, pool, quote] = await Promise.all([
    requirePlayer(playerId),
    storage.getAvailableBalance(input.userId),
    getOrCreatePool(playerId),
    getBuyQuote(playerId, sbAmount),
  ]);

  if (!quote) {
    throw new Error("Could not calculate a buy quote");
  }

  const warnings: string[] = [];
  const canStage = availableBalance >= sbAmount;
  if (!canStage) {
    warnings.push(
      `Available balance is ${formatMoney(availableBalance)}, which is below the requested ${formatMoney(sbAmount)}.`,
    );
  }

  const playerLabel = buildPlayerLabel(player, playerId);

  return buildStructuredPreview({
    toolName: "preview_pool_buy",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Buy ${formatMoney(sbAmount)} of ${playerLabel}`,
    stageMessage: `buy $${sbAmount} of ${playerLabel}`,
    beforeState: {
      availableBalance,
      currentPrice: pool.currentPrice,
    },
    afterState: {
      availableBalance: Math.max(0, availableBalance - sbAmount),
      estimatedSharesOut: quote.sharesOut,
      projectedPoolPrice: quote.newPoolPrice,
    },
    estimatedImpact: `Estimated fill at ${formatMoney(quote.effectivePrice)} per share with ${(quote.slippagePercent * 100).toFixed(2)}% slippage.`,
    warnings,
  });
}

async function buildPoolSellPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const playerId = toStringValue(input.args?.playerId);
  const sharesAmount = toPositiveInteger(input.args?.sharesAmount ?? input.args?.shares);
  if (!playerId || sharesAmount == null) {
    throw new Error("playerId and sharesAmount are required for preview_pool_sell");
  }

  const [player, availableBalance, holdingInfo, quote] = await Promise.all([
    requirePlayer(playerId),
    storage.getAvailableBalance(input.userId),
    storage.getHoldingWithPowerLevel(input.userId, playerId),
    getSellQuote(playerId, sharesAmount),
  ]);

  if (!quote) {
    throw new Error("Could not calculate a sell quote");
  }

  const availableShares = Number(holdingInfo?.availableShares || 0);
  const warnings: string[] = [];
  const canStage = availableShares >= sharesAmount;
  if (!canStage) {
    warnings.push(
      `Available shares are ${availableShares}, which is below the requested ${sharesAmount}.`,
    );
  }

  const playerLabel = buildPlayerLabel(player, playerId);

  return buildStructuredPreview({
    toolName: "preview_pool_sell",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Sell ${sharesAmount} ${playerLabel} share${sharesAmount === 1 ? "" : "s"}`,
    stageMessage: `sell ${sharesAmount} ${playerLabel} shares`,
    beforeState: {
      availableBalance,
      availableShares,
      currentPowerLevel: holdingInfo?.powerLevel || "0.00",
    },
    afterState: {
      availableBalance: availableBalance + quote.sellerReceives,
      availableShares: Math.max(0, availableShares - sharesAmount),
      estimatedSbOut: quote.sellerReceives,
      projectedPoolPrice: quote.newPoolPrice,
    },
    estimatedImpact: `Estimated proceeds ${formatMoney(quote.sellerReceives)} at ${formatMoney(quote.effectivePrice)} per share.`,
    warnings,
  });
}

async function buildLpAddPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const playerId = toStringValue(input.args?.playerId);
  const shares = toPositiveNumber(input.args?.shares);
  const playMoney = toPositiveNumber(input.args?.playMoney);
  if (!playerId || shares == null || playMoney == null) {
    throw new Error("playerId, shares, and playMoney are required for preview_lp_add");
  }

  const [player, pool, availableBalance, holdingInfo, existingPosition] = await Promise.all([
    requirePlayer(playerId),
    getOrCreatePool(playerId),
    storage.getAvailableBalance(input.userId),
    storage.getHoldingWithPowerLevel(input.userId, playerId),
    getLpPosition(playerId, input.userId),
  ]);

  const expectedPlayMoney = shares * pool.currentPrice;
  const ratioDiff =
    expectedPlayMoney > 0 ? Math.abs(playMoney - expectedPlayMoney) / expectedPlayMoney : 0;
  const lpSharesMinted =
    pool.lpSharesTotal <= 0 || pool.shares <= 0
      ? shares
      : (shares / pool.shares) * pool.lpSharesTotal;
  const ownershipPercentage =
    lpSharesMinted / Math.max(pool.lpSharesTotal + lpSharesMinted, Number.EPSILON);
  const availableShares = Number(holdingInfo?.availableShares || 0);
  const warnings: string[] = [];
  let canStage = true;

  if (availableShares < shares) {
    canStage = false;
    warnings.push(`Available shares are ${availableShares}, below the requested ${shares}.`);
  }
  if (availableBalance < playMoney) {
    canStage = false;
    warnings.push(
      `Available balance is ${formatMoney(availableBalance)}, below the requested ${formatMoney(playMoney)}.`,
    );
  }
  if (ratioDiff > 0.01) {
    canStage = false;
    warnings.push(
      `Current pool ratio implies ${formatMoney(expectedPlayMoney)} for ${shares} shares, so the request is off-ratio.`,
    );
  }

  const playerLabel = buildPlayerLabel(player, playerId);

  return buildStructuredPreview({
    toolName: "preview_lp_add",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Add liquidity on ${playerLabel}`,
    stageMessage: `add ${shares} ${playerLabel} shares and $${playMoney} to liquidity`,
    beforeState: {
      availableBalance,
      availableShares,
      currentLpShares: existingPosition?.lpShares ?? 0,
      currentPrice: pool.currentPrice,
    },
    afterState: {
      availableBalance: Math.max(0, availableBalance - playMoney),
      availableShares: Math.max(0, availableShares - shares),
      estimatedLpSharesMinted: lpSharesMinted,
      projectedOwnershipPercent: ownershipPercentage * 100,
    },
    estimatedImpact: `At the current ratio, ${shares} shares should pair with ${formatMoney(expectedPlayMoney)} and mint about ${lpSharesMinted.toFixed(2)} LP shares.`,
    warnings,
  });
}

async function buildLpAddOptimalPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const playerId = toStringValue(input.args?.playerId);
  const maxShares = toPositiveNumber(input.args?.maxShares);
  const maxPlayMoney = toPositiveNumber(input.args?.maxPlayMoney);
  if (!playerId || maxShares == null || maxPlayMoney == null) {
    throw new Error(
      "playerId, maxShares, and maxPlayMoney are required for preview_lp_add_optimal",
    );
  }

  const [player, pool, availableBalance, holdingInfo, existingPosition] = await Promise.all([
    requirePlayer(playerId),
    getOrCreatePool(playerId),
    storage.getAvailableBalance(input.userId),
    storage.getHoldingWithPowerLevel(input.userId, playerId),
    getLpPosition(playerId, input.userId),
  ]);

  const sharesToDeposit = Math.min(maxShares, maxPlayMoney / pool.currentPrice);
  const playMoneyToDeposit = sharesToDeposit * pool.currentPrice;
  const lpSharesMinted =
    pool.lpSharesTotal <= 0 || pool.shares <= 0
      ? sharesToDeposit
      : (sharesToDeposit / pool.shares) * pool.lpSharesTotal;
  const ownershipPercentage =
    lpSharesMinted / Math.max(pool.lpSharesTotal + lpSharesMinted, Number.EPSILON);
  const availableShares = Number(holdingInfo?.availableShares || 0);
  const warnings: string[] = [];
  let canStage = sharesToDeposit > 0;

  if (availableShares < sharesToDeposit) {
    canStage = false;
    warnings.push(
      `Available shares are ${availableShares}, below the computed ${sharesToDeposit.toFixed(2)} share deposit.`,
    );
  }
  if (availableBalance < playMoneyToDeposit) {
    canStage = false;
    warnings.push(
      `Available balance is ${formatMoney(availableBalance)}, below the computed ${formatMoney(playMoneyToDeposit)} deposit.`,
    );
  }

  const playerLabel = buildPlayerLabel(player, playerId);

  return buildStructuredPreview({
    toolName: "preview_lp_add_optimal",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Add optimal liquidity on ${playerLabel}`,
    stageMessage: `add optimal liquidity on ${playerLabel} using up to ${maxShares} shares and $${maxPlayMoney}`,
    beforeState: {
      availableBalance,
      availableShares,
      currentLpShares: existingPosition?.lpShares ?? 0,
      currentPrice: pool.currentPrice,
    },
    afterState: {
      availableBalance: Math.max(0, availableBalance - playMoneyToDeposit),
      availableShares: Math.max(0, availableShares - sharesToDeposit),
      estimatedLpSharesMinted: lpSharesMinted,
      projectedOwnershipPercent: ownershipPercentage * 100,
      sharesUnused: Math.max(0, maxShares - sharesToDeposit),
      playMoneyUnused: Math.max(0, maxPlayMoney - playMoneyToDeposit),
    },
    estimatedImpact: `At the current ratio this should use ${sharesToDeposit.toFixed(2)} shares and ${formatMoney(playMoneyToDeposit)}.`,
    warnings,
  });
}

async function buildLpRemovePreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const playerId = toStringValue(input.args?.playerId);
  const lpShares = toPositiveNumber(input.args?.lpShares ?? input.args?.shares);
  if (!playerId || lpShares == null) {
    throw new Error("playerId and lpShares are required for preview_lp_remove");
  }

  const [player, pool, position, availableBalance] = await Promise.all([
    requirePlayer(playerId),
    getOrCreatePool(playerId),
    getLpPosition(playerId, input.userId),
    storage.getAvailableBalance(input.userId),
  ]);

  const currentLpShares = position?.lpShares ?? 0;
  const warnings: string[] = [];
  const canStage = Boolean(position) && currentLpShares >= lpShares;
  if (!position) {
    warnings.push("There is no active LP position for this player right now.");
  } else if (currentLpShares < lpShares) {
    warnings.push(
      `Current LP shares are ${currentLpShares.toFixed(2)}, below the requested ${lpShares.toFixed(2)}.`,
    );
  }

  const ownershipPercentage = lpShares / Math.max(pool.lpSharesTotal, Number.EPSILON);
  const sharesOut = pool.shares * ownershipPercentage;
  const playMoneyOut = pool.playMoney * ownershipPercentage;
  const playerLabel = buildPlayerLabel(player, playerId);

  return buildStructuredPreview({
    toolName: "preview_lp_remove",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Remove ${lpShares.toFixed(2)} LP shares from ${playerLabel}`,
    stageMessage: `remove ${lpShares} lp shares from ${playerLabel}`,
    beforeState: {
      availableBalance,
      currentLpShares,
      positionValue: position?.positionValue ?? 0,
    },
    afterState: {
      availableBalance: availableBalance + playMoneyOut,
      remainingLpShares: Math.max(0, currentLpShares - lpShares),
      estimatedSharesOut: sharesOut,
      estimatedPlayMoneyOut: playMoneyOut,
    },
    estimatedImpact: `This should return about ${sharesOut.toFixed(2)} shares and ${formatMoney(playMoneyOut)}.`,
    warnings,
  });
}

async function buildLpZapPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const playerId = toStringValue(input.args?.playerId);
  if (!playerId) {
    throw new Error("playerId is required for preview_lp_zap");
  }

  const shares = toPositiveNumber(input.args?.shares);
  const sb = toPositiveNumber(input.args?.sb ?? input.args?.amount ?? input.args?.sbAmount);
  if (shares == null && sb == null) {
    throw new Error("shares or sb is required for preview_lp_zap");
  }

  const [player, availableBalance, holdingInfo] = await Promise.all([
    requirePlayer(playerId),
    storage.getAvailableBalance(input.userId),
    storage.getHoldingWithPowerLevel(input.userId, playerId),
  ]);

  const playerLabel = buildPlayerLabel(player, playerId);

  if (shares != null) {
    const availableShares = Number(holdingInfo?.availableShares || 0);
    if (availableShares < shares) {
      return buildStructuredPreview({
        toolName: "preview_lp_zap",
        canStage: false,
        requiresConfirmation: true,
        actionSummary: `Zap ${shares} ${playerLabel} shares into liquidity`,
        stageMessage: `zap ${shares} ${playerLabel} shares into liquidity`,
        beforeState: {
          availableShares,
        },
        afterState: {
          availableShares,
        },
        estimatedImpact: null,
        warnings: [`Available shares are ${availableShares}, below the requested ${shares}.`],
      });
    }

    const quote = await getZapAddQuoteSharesOnly(playerId, input.userId, shares);

    return buildStructuredPreview({
      toolName: "preview_lp_zap",
      canStage: true,
      requiresConfirmation: true,
      actionSummary: `Zap ${shares} ${playerLabel} shares into liquidity`,
      stageMessage: `zap ${shares} ${playerLabel} shares into liquidity`,
      beforeState: {
        availableShares,
      },
      afterState: {
        availableShares: Math.max(0, availableShares - shares),
        estimatedLpSharesMinted: quote.estimatedLpSharesMinted,
        sharesSoldInternally: quote.sharesSold,
        projectedOwnershipPercent: quote.estimatedOwnershipPercentage * 100,
      },
      estimatedImpact: `The zap internally sells ${quote.sharesSold.toFixed(2)} share(s) before depositing.`,
      warnings: [],
    });
  }

  if (availableBalance < sb!) {
    return buildStructuredPreview({
      toolName: "preview_lp_zap",
      canStage: false,
      requiresConfirmation: true,
      actionSummary: `Zap ${formatMoney(sb!)} into ${playerLabel} liquidity`,
      stageMessage: `zap $${sb} into ${playerLabel} liquidity`,
      beforeState: {
        availableBalance,
      },
      afterState: {
        availableBalance,
      },
      estimatedImpact: null,
      warnings: [
        `Available balance is ${formatMoney(availableBalance)}, below the requested ${formatMoney(sb!)}.`,
      ],
    });
  }

  const quote = await getZapAddQuoteSbOnly(playerId, input.userId, sb!);

  return buildStructuredPreview({
    toolName: "preview_lp_zap",
    canStage: true,
    requiresConfirmation: true,
    actionSummary: `Zap ${formatMoney(sb!)} into ${playerLabel} liquidity`,
    stageMessage: `zap $${sb} into ${playerLabel} liquidity`,
    beforeState: {
      availableBalance,
    },
    afterState: {
      availableBalance: Math.max(0, availableBalance - sb!),
      estimatedLpSharesMinted: quote.estimatedLpSharesMinted,
      sharesBoughtInternally: quote.sharesBought,
      projectedOwnershipPercent: quote.estimatedOwnershipPercentage * 100,
    },
    estimatedImpact: `The zap internally buys ${quote.sharesBought.toFixed(2)} share(s) before depositing.`,
    warnings: [],
  });
}

export async function runHermesReadTool(input: {
  toolName: string;
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "get_agent_capabilities":
      return getAgentCapabilities(input.userId);
    case "get_thread_state":
      if (!input.threadId) {
        throw new Error("threadId is required for get_thread_state");
      }

      return {
        thread: await getAgentThread(input.userId, input.threadId),
        messages: await listAgentThreadMessages(input.userId, input.threadId),
      };
    case "get_portfolio_summary": {
      const { context } = await loadOperatorToolContext(
        input.userId,
        toStringValue(input.args?.message),
      );

      return {
        operatorOverview: context.operatorOverview,
        selectionWindow: context.selectionWindow,
        recommendedTargets: context.recommendedTargets,
      };
    }
    case "get_user_profile_summary": {
      const { profile } = await getScoutAgentProfile(input.userId);

      return {
        displayName: profile.displayName,
        providerMode: profile.providerMode,
        model: profile.model,
        defaultSport: profile.defaultSport,
        analysisWindowMinutes: profile.analysisWindowMinutes,
      };
    }
    case "get_operator_overview": {
      const { context } = await loadOperatorToolContext(
        input.userId,
        toStringValue(input.args?.message),
      );
      return context.operatorOverview;
    }
    case "get_balance_state": {
      const { context } = await loadOperatorToolContext(
        input.userId,
        toStringValue(input.args?.message),
      );
      return {
        availableBalance: context.operatorOverview.availableBalance,
        openDailyBoostSlots: context.operatorOverview.openDailyBoostSlots,
        communitySharesAvailable: context.operatorOverview.communitySharesAvailable,
      };
    }
    case "get_holdings": {
      const limit = toPositiveInteger(input.args?.limit) || 25;
      const holdings = await storage.getUserHoldingsWithPlayers(input.userId);
      return holdings
        .filter((entry) => entry?.holding?.assetType === "player" && entry?.player?.id)
        .slice(0, limit)
        .map((entry) => ({
          playerId: entry.player.id,
          name: `${entry.player.firstName} ${entry.player.lastName}`,
          sport: entry.player.sport,
          team: entry.player.team,
          quantity: Number(entry.holding.quantity || 0),
          power: Number(entry.holding.power || 1),
          powerLevel: entry.holding.powerLevel,
          availableShares:
            Number(entry.holding.quantity || 0) - Math.max(0, Number(entry.totalLocked || 0)),
          avgCostBasis: entry.holding.avgCostBasis,
        }));
    }
    case "get_watchlists":
      return storage.getWatchlists(input.userId);
    case "get_watchlist_items": {
      const watchlistId = toStringValue(input.args?.watchlistId);
      if (!watchlistId) {
        throw new Error("watchlistId is required for get_watchlist_items");
      }
      const watchlists = await storage.getWatchlists(input.userId);
      if (!watchlists.some((entry) => entry.id === watchlistId)) {
        throw new Error("Watchlist not found");
      }
      return {
        watchlistId,
        playerIds: await storage.getWatchlistItems(watchlistId),
      };
    }
    case "get_player_watchlists": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_watchlists");
      }
      return {
        playerId,
        watchlistIds: await storage.getPlayerWatchlists(input.userId, playerId),
      };
    }
    case "get_player_detail":
    case "get_player_market_context": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_detail");
      }
      const player = await requirePlayer(playerId);
      const [financialMetrics, stats, recentGames, holdingAvailability] = await Promise.all([
        storage.getPlayerFinancialMetrics(playerId),
        storage.getPlayerSeasonStatsFromLogs(playerId),
        storage.getPlayerRecentGamesFromLogs(playerId, toPositiveInteger(input.args?.limit) || 5),
        getHoldingAvailability(input.userId, playerId),
      ]);
      const lastTradePrice = player.lastTradePrice ? Number(player.lastTradePrice) : null;
      const marketCap = player.marketCap ? Number(player.marketCap) : null;
      const totalSharesOutstanding =
        lastTradePrice && marketCap ? Math.round((marketCap / lastTradePrice) * 100) / 100 : null;

      return {
        player: {
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          team: player.team,
          sport: player.sport,
          position: player.position,
          lastTradePrice: player.lastTradePrice,
          volume24h: player.volume24h,
          priceChange24h: player.priceChange24h,
          injuryStatus: player.injuryStatus,
          marketCap: player.marketCap,
        },
        financialMetrics,
        stats,
        recentGames,
        sharesInfo: {
          totalSharesOutstanding,
          marketCap,
          holderCount: null,
        },
        userHolding: holdingAvailability,
      };
    }
    case "get_player_stats": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_stats");
      }
      return storage.getPlayerSeasonStatsFromLogs(playerId);
    }
    case "get_player_recent_games": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_recent_games");
      }
      return storage.getPlayerRecentGamesFromLogs(
        playerId,
        toPositiveInteger(input.args?.limit) || 10,
      );
    }
    case "get_player_financial_metrics": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_financial_metrics");
      }
      return storage.getPlayerFinancialMetrics(playerId);
    }
    case "get_player_shares_info": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_shares_info");
      }
      const player = await requirePlayer(playerId);
      const lastTradePrice = player.lastTradePrice ? Number(player.lastTradePrice) : null;
      const marketCap = player.marketCap ? Number(player.marketCap) : null;
      return {
        playerId,
        lastTradePrice,
        marketCap,
        totalSharesOutstanding:
          lastTradePrice && marketCap ? Math.round((marketCap / lastTradePrice) * 100) / 100 : null,
      };
    }
    case "get_holdings_power_level": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_holdings_power_level");
      }
      return getHoldingAvailability(input.userId, playerId);
    }
    case "get_daily_boost_state":
      return storage.getDailyBoostsAllSports(input.userId, resolveTargetDate(input.args?.date));
    case "get_daily_boost_history":
      return storage.getBoostPayoutHistory(
        input.userId,
        toPositiveInteger(input.args?.limit) || 50,
      );
    case "get_daily_boost_eligibility": {
      const sport = toStringValue(input.args?.sport).toUpperCase();
      if (!sport) {
        throw new Error("sport is required for get_daily_boost_eligibility");
      }
      const targetDate = resolveTargetDate(input.args?.date);
      return {
        sport,
        date: targetDate.toISOString(),
        eligiblePlayers: await storage.getEligiblePlayersForBoost(input.userId, sport, targetDate),
      };
    }
    case "get_community_boost_state": {
      const [communityShares, communityBoosts] = await Promise.all([
        storage.getUserCommunityBoostShares(input.userId),
        storage.getCommunityBoostsAllSports(resolveTargetDate(input.args?.date)),
      ]);
      return {
        communitySharesAvailable: communityShares,
        communityBoosts,
      };
    }
    case "get_community_boosts_all":
      return storage.getCommunityBoostsAllSports(resolveTargetDate(input.args?.date));
    case "get_canonical_knowledge":
      return listAgentKnowledgeArticles(true);
    case "get_hosted_research": {
      const profile = (await getScoutAgentProfile(input.userId)).profile;
      const message = toStringValue(input.args?.message);
      if (!message) {
        throw new Error("message is required for get_hosted_research");
      }

      return planHostedWebResearch({
        message,
        profile,
      });
    }
    case "list_user_memories":
    case "search_user_memories":
    case "get_user_memory_context":
      return buildHermesMemoryContext({
        userId: input.userId,
        query: toStringValue(input.args?.query),
      });
    case "get_trade_history":
      return storage.getMarketActivity({
        userId: input.userId,
        limit: toPositiveInteger(input.args?.limit) || 100,
        sport: toOptionalString(input.args?.sport) || undefined,
      });
    case "get_portfolio_history": {
      const timeRange = toStringValue(input.args?.timeRange) || "1M";
      const now = new Date();
      const startDate = new Date(now);
      switch (timeRange) {
        case "1D":
          startDate.setDate(now.getDate() - 1);
          break;
        case "7D":
          startDate.setDate(now.getDate() - 7);
          break;
        case "1M":
          startDate.setMonth(now.getMonth() - 1);
          break;
        case "1Y":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        case "ALL":
          startDate.setTime(new Date(2020, 0, 1).getTime());
          break;
        default:
          throw new Error("Invalid timeRange. Use 1D, 7D, 1M, 1Y, or ALL");
      }

      const snapshots = await storage.getPortfolioSnapshotsInRange(input.userId, startDate, now);
      return {
        timeRange,
        history: snapshots.map((snapshot) => ({
          date: snapshot.snapshotDate.toISOString(),
          cashBalance: Number(snapshot.cashBalance),
          portfolioValue: Number(snapshot.portfolioValue),
          netWorth: Number(snapshot.totalNetWorth),
          cashRank: snapshot.cashRank,
          portfolioRank: snapshot.portfolioRank,
        })),
      };
    }
    case "get_amm_pool_state": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_amm_pool_state");
      }
      await requirePlayer(playerId);
      return getOrCreatePool(playerId);
    }
    case "get_amm_trade_quote": {
      const playerId = toStringValue(input.args?.playerId);
      const quoteType = toStringValue(input.args?.type).toLowerCase();
      const amount = toPositiveNumber(input.args?.amount);
      if (!playerId || amount == null || (quoteType !== "buy" && quoteType !== "sell")) {
        throw new Error("playerId, type=buy|sell, and amount are required for get_amm_trade_quote");
      }
      await requirePlayer(playerId);
      return quoteType === "buy"
        ? { type: "buy", quote: await getBuyQuote(playerId, amount) }
        : { type: "sell", quote: await getSellQuote(playerId, amount) };
    }
    case "get_lp_positions":
      return getUserLpPositions(input.userId);
    case "get_lp_position": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_lp_position");
      }
      return getLpPosition(playerId, input.userId);
    }
    case "get_lp_history":
      return storage.getLpTransactionHistory(
        input.userId,
        toOptionalString(input.args?.playerId) || undefined,
        toPositiveInteger(input.args?.limit) || 50,
      );
    case "get_user_schedules":
      return listUserAgentSchedules(input.userId);
    case "get_schedule_templates":
      return listAgentScheduleTemplates();
    case "get_pending_bundle":
      if (!input.threadId) {
        throw new Error("threadId is required for get_pending_bundle");
      }

      return {
        pendingActionBundle: (await getAgentThread(input.userId, input.threadId))
          .pendingActionBundle,
      };
    case "get_contests":
    case "get_contest_state":
    case "get_contest_entry_state":
      return buildDisabledWorkflowResult("Contests");
    default:
      throw new Error(`Unsupported Hermes read tool: ${input.toolName}`);
  }
}

export async function runHermesPlanTool(input: {
  toolName: string;
  userId: string;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "preview_pool_buy":
      return buildPoolBuyPreview(input);
    case "preview_pool_sell":
      return buildPoolSellPreview(input);
    case "preview_lp_add":
      return buildLpAddPreview(input);
    case "preview_lp_add_optimal":
      return buildLpAddOptimalPreview(input);
    case "preview_lp_remove":
      return buildLpRemovePreview(input);
    case "preview_lp_zap":
      return buildLpZapPreview(input);
    case "preview_contest_action":
      return buildDisabledWorkflowResult("Contests");
    case "preview_direct_operation":
    case "preview_condense":
    case "preview_daily_boost_assign":
    case "preview_daily_boost_remove":
    case "preview_watchlist_add":
    case "preview_watchlist_remove":
    case "preview_community_boost_create":
    case "preview_scout_adjustment":
    case "preview_multi_action_bundle":
      return runParserBackedPreview(input);
    default:
      throw new Error(`Unsupported Hermes plan tool: ${input.toolName}`);
  }
}

export async function runHermesActionTool(input: {
  toolName: string;
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "create_agent_thread":
      return createAgentThread(input.userId, {
        channel: toChannelValue(input.args?.channel) || "in_app",
        domain: "sportfolio",
        title: toOptionalString(input.args?.title) || undefined,
      });
    case "stage_action_bundle": {
      const message = toStringValue(input.args?.message);
      if (!message) {
        throw new Error("message is required for stage_action_bundle");
      }
      const threadId = await getOrCreateThreadIdForAction(input);
      return {
        threadId,
        turn: await sendAgentThreadMessage(input.userId, threadId, { message }),
      };
    }
    case "confirm_pending_bundle":
      if (!input.threadId) {
        throw new Error("threadId is required for confirm_pending_bundle");
      }
      return confirmAgentThread(input.userId, input.threadId);
    case "cancel_pending_bundle":
      if (!input.threadId) {
        throw new Error("threadId is required for cancel_pending_bundle");
      }
      return cancelAgentThread(input.userId, input.threadId);
    case "create_watchlist": {
      const name = toStringValue(input.args?.name);
      if (!name) {
        throw new Error("name is required for create_watchlist");
      }
      return storage.createWatchlist(
        input.userId,
        name,
        false,
        toOptionalString(input.args?.color) || undefined,
      );
    }
    case "update_watchlist": {
      const watchlistId = toStringValue(input.args?.watchlistId);
      const name = toOptionalString(input.args?.name) || undefined;
      const color = toOptionalString(input.args?.color) || undefined;
      if (!watchlistId || (!name && !color)) {
        throw new Error(
          "watchlistId and at least one update field are required for update_watchlist",
        );
      }
      const watchlists = await storage.getWatchlists(input.userId);
      if (!watchlists.some((entry) => entry.id === watchlistId)) {
        throw new Error("Watchlist not found");
      }
      await storage.updateWatchlist(watchlistId, {
        name,
        color,
      });
      return {
        success: true,
        watchlistId,
      };
    }
    case "delete_watchlist": {
      const watchlistId = toStringValue(input.args?.watchlistId);
      if (!watchlistId) {
        throw new Error("watchlistId is required for delete_watchlist");
      }
      const watchlists = await storage.getWatchlists(input.userId);
      if (!watchlists.some((entry) => entry.id === watchlistId)) {
        throw new Error("Watchlist not found");
      }
      await storage.deleteWatchlist(watchlistId);
      return {
        success: true,
        watchlistId,
      };
    }
    case "add_watchlist_player": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for add_watchlist_player");
      }
      await storage.addToWatchList(
        input.userId,
        playerId,
        toOptionalString(input.args?.watchlistId) || undefined,
      );
      return {
        success: true,
        playerId,
      };
    }
    case "remove_watchlist_player": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for remove_watchlist_player");
      }
      await storage.removeFromWatchList(
        input.userId,
        playerId,
        toOptionalString(input.args?.watchlistId) || undefined,
      );
      return {
        success: true,
        playerId,
      };
    }
    case "upsert_user_schedule": {
      const jobType = toScheduleJobType(input.args?.jobType);
      const rawChannelTargets = Array.isArray(input.args?.channelTargets)
        ? input.args.channelTargets
        : null;
      if (!jobType) {
        throw new Error("A supported jobType is required for upsert_user_schedule");
      }
      return upsertUserAgentSchedule({
        userId: input.userId,
        jobType,
        enabled: toBooleanValue(input.args?.enabled) ?? true,
        scheduleCron: toOptionalString(input.args?.scheduleCron) || undefined,
        channelTargets: rawChannelTargets
          ? rawChannelTargets
              .map((entry) => toChannelValue(entry))
              .filter((entry): entry is AgentChannel => Boolean(entry))
          : undefined,
        policy:
          input.args?.policy && typeof input.args.policy === "object"
            ? (input.args.policy as Record<string, unknown>)
            : {},
      });
    }
    case "delete_user_schedule": {
      const jobType = toScheduleJobType(input.args?.jobType);
      if (!jobType) {
        throw new Error("A supported jobType is required for delete_user_schedule");
      }
      return removeUserAgentSchedule(input.userId, jobType);
    }
    case "run_contest_action":
      return buildDisabledWorkflowResult("Contests");
    default:
      throw new Error(`Unsupported Hermes action tool: ${input.toolName}`);
  }
}

export async function runHermesMemoryTool(input: {
  toolName: string;
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "write_user_memory":
    case "supersede_user_memory": {
      const writes = parseProposedMemoryWrites(input.args?.writes);

      return persistProposedMemoryWrites({
        userId: input.userId,
        threadId: input.threadId || null,
        writes,
      });
    }
    case "archive_user_memory": {
      const memoryId = toStringValue(input.args?.memoryId);
      if (!memoryId) {
        throw new Error("memoryId is required for archive_user_memory");
      }

      return archiveUserAgentMemory(input.userId, memoryId);
    }
    default:
      throw new Error(`Unsupported Hermes memory tool: ${input.toolName}`);
  }
}

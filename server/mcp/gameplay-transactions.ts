import { randomUUID } from "node:crypto";
import {
  addLiquidity,
  addLiquidityOptimal,
  executeBuy,
  executeSell,
  removeLiquidity,
  zapAddLiquiditySbOnly,
  zapAddLiquiditySharesOnly,
} from "../amm/pool";
import { assignDailyBoostWithValidation } from "../boosts/assign-daily-boost";
import { getETDayBoundaries } from "../lib/time";
import { storage } from "../storage";

export type GameplayAction =
  | { actionType: "scout_set_count"; playerId: string; targetCount: number }
  | {
      actionType: "scout_set_counts";
      assignments: Array<{ playerId: string; targetCount: number }>;
    }
  | { actionType: "pool_buy"; playerId: string; sbAmount: number; maxSlippage: number }
  | { actionType: "pool_sell"; playerId: string; sharesAmount: number; maxSlippage: number }
  | { actionType: "pool_add_liquidity"; playerId: string; shares: number; playMoney: number }
  | {
      actionType: "pool_add_liquidity_optimal";
      playerId: string;
      maxShares: number;
      maxPlayMoney: number;
    }
  | { actionType: "pool_zap_add_shares"; playerId: string; shares: number }
  | { actionType: "pool_zap_add_sb"; playerId: string; sb: number }
  | { actionType: "pool_remove_liquidity"; playerId: string; lpShares: number }
  | {
      actionType: "daily_boost_assign";
      playerId: string;
      sport: string;
      slotTier: 2 | 3 | 5 | 7 | 10;
      shares: number;
      boostDate: string;
    }
  | { actionType: "daily_boost_remove"; boostId: string; boostDate: string }
  | { actionType: "community_boost_create"; playerId: string; sport: string; boostDate: string }
  | { actionType: "watchlist_add_player"; playerId: string; watchlistId?: string | null }
  | {
      actionType: "watchlist_remove_player";
      playerId: string;
      watchlistId?: string | null;
      removeFromAll?: boolean;
    };

export type GameplayTransactionStatus =
  | "pending_confirmation"
  | "confirmed"
  | "cancelled"
  | "failed"
  | "expired";

export type GameplayTransaction = {
  transactionId: string;
  userId: string;
  action: GameplayAction;
  summary: string;
  warnings: string[];
  status: GameplayTransactionStatus;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  result: unknown | null;
  error: string | null;
};

export type GameplayTransactionExecutor = (
  userId: string,
  action: GameplayAction,
) => Promise<unknown>;

const DEFAULT_TRANSACTION_TTL_MS = 15 * 60 * 1000;
const CANONICAL_PLAYER_ID = /^(?:mlb|nascar|nhl|nfl|nba|wnba)_/i;
const transactions = new Map<string, GameplayTransaction>();
let executorOverride: GameplayTransactionExecutor | null = null;

function getTransactionTtlMs() {
  const parsed = Number.parseInt(process.env.GAMEPLAY_TRANSACTION_TTL_MS || "", 10);
  return Number.isFinite(parsed)
    ? Math.max(60_000, Math.min(60 * 60 * 1000, parsed))
    : DEFAULT_TRANSACTION_TTL_MS;
}

function assertPositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero`);
}

function assertScoutTargetCount(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error("targetCount must be an integer between 0 and 10");
  }
}

function assertAction(action: GameplayAction) {
  if ("playerId" in action && !action.playerId) {
    throw new Error("playerId is required");
  }
  switch (action.actionType) {
    case "pool_buy":
      assertPositive(action.sbAmount, "sbAmount");
      break;
    case "pool_sell":
      assertPositive(action.sharesAmount, "sharesAmount");
      break;
    case "pool_add_liquidity":
      assertPositive(action.shares, "shares");
      assertPositive(action.playMoney, "playMoney");
      break;
    case "pool_add_liquidity_optimal":
      assertPositive(action.maxShares, "maxShares");
      assertPositive(action.maxPlayMoney, "maxPlayMoney");
      break;
    case "pool_zap_add_shares":
      assertPositive(action.shares, "shares");
      break;
    case "pool_zap_add_sb":
      assertPositive(action.sb, "sb");
      break;
    case "pool_remove_liquidity":
      assertPositive(action.lpShares, "lpShares");
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "daily_boost_assign":
      assertPositive(action.shares, "shares");
      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {
        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");
      }
      break;
    case "scout_set_count":
      assertScoutTargetCount(action.targetCount);
      break;
    case "scout_set_counts": {
      if (!Array.isArray(action.assignments) || action.assignments.length < 1) {
        throw new Error("assignments must contain at least one scout assignment");
      }
      if (action.assignments.length > 10) {
        throw new Error("assignments cannot contain more than 10 scout assignments");
      }
      const seen = new Set<string>();
      for (const assignment of action.assignments) {
        if (!assignment.playerId) throw new Error("playerId is required for every assignment");
        if (seen.has(assignment.playerId)) {
          throw new Error(`Duplicate scout assignment for ${assignment.playerId}`);
        }
        seen.add(assignment.playerId);
        assertScoutTargetCount(assignment.targetCount);
      }
      break;
    }
    default:
      break;
  }
}

function playerDisplayName(player: any): string {
  return [player?.firstName, player?.lastName]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim())
    .join(" ");
}

async function loadPlayer(playerId: string) {
  if (!CANONICAL_PLAYER_ID.test(playerId)) return null;
  try {
    return (await storage.getPlayer(playerId)) || null;
  } catch {
    return null;
  }
}

async function playerLabel(playerId: string): Promise<string> {
  const player = await loadPlayer(playerId);
  return playerDisplayName(player) || "selected player";
}

async function actionSummary(action: GameplayAction): Promise<string> {
  switch (action.actionType) {
    case "pool_buy":
      return `Buy shares of ${await playerLabel(action.playerId)} using ${action.sbAmount} SB.`;
    case "pool_sell":
      return `Sell ${action.sharesAmount} shares of ${await playerLabel(action.playerId)}.`;
    case "pool_add_liquidity":
      return `Add ${action.shares} shares and ${action.playMoney} SB to ${await playerLabel(action.playerId)}'s pool.`;
    case "pool_add_liquidity_optimal":
      return `Add up to ${action.maxShares} shares and ${action.maxPlayMoney} SB optimally to ${await playerLabel(action.playerId)}'s pool.`;
    case "pool_zap_add_shares":
      return `Zap ${action.shares} shares into ${await playerLabel(action.playerId)}'s liquidity pool.`;
    case "pool_zap_add_sb":
      return `Zap ${action.sb} SB into ${await playerLabel(action.playerId)}'s liquidity pool.`;
    case "pool_remove_liquidity":
      return `Remove ${action.lpShares} LP shares from ${await playerLabel(action.playerId)}'s pool.`;
    case "scout_set_count":
      return `Set ${await playerLabel(action.playerId)}'s scout count to ${action.targetCount}.`;
    case "scout_set_counts": {
      const labels = await Promise.all(
        action.assignments.map(async (assignment) => ({
          label: await playerLabel(assignment.playerId),
          targetCount: assignment.targetCount,
        })),
      );
      return `Set scout counts for ${labels.length} players: ${labels
        .map((entry) => `${entry.label}=${entry.targetCount}`)
        .join(", ")}.`;
    }
    case "daily_boost_assign":
      return `Commit ${action.shares} Singles of ${await playerLabel(action.playerId)} to the ${action.slotTier}x daily boost slot for ${action.boostDate}; the shares burn when the game begins.`;
    case "daily_boost_remove":
      return `Remove daily boost ${action.boostId}.`;
    case "community_boost_create":
      return `Create a community boost for ${await playerLabel(action.playerId)} on ${action.boostDate}.`;
    case "watchlist_add_player":
      return `Add ${await playerLabel(action.playerId)} to a watchlist.`;
    case "watchlist_remove_player":
      return `Remove ${await playerLabel(action.playerId)} from ${action.removeFromAll ? "all watchlists" : "a watchlist"}.`;
  }
}

async function withPlayer(result: unknown, playerId: string) {
  const player = await loadPlayer(playerId);
  if (!player) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), player };
  }
  return { result, playerId, player };
}

async function executeDefault(userId: string, action: GameplayAction): Promise<unknown> {
  switch (action.actionType) {
    case "scout_set_count":
      await storage.applyScoutAssignments(userId, [
        { playerId: action.playerId, count: action.targetCount },
      ]);
      return withPlayer(
        { playerId: action.playerId, targetCount: action.targetCount },
        action.playerId,
      );
    case "scout_set_counts": {
      await storage.applyScoutAssignments(
        userId,
        action.assignments.map((assignment) => ({
          playerId: assignment.playerId,
          count: assignment.targetCount,
        })),
      );
      const assignments = await Promise.all(
        action.assignments.map(async (assignment) => ({
          ...assignment,
          player: await loadPlayer(assignment.playerId),
        })),
      );
      return { assignments };
    }
    case "pool_buy": {
      const result = await executeBuy(action.playerId, userId, action.sbAmount, action.maxSlippage);
      if (!result.success) throw new Error(result.error || "Failed to execute pool buy");
      return withPlayer(result, action.playerId);
    }
    case "pool_sell": {
      const result = await executeSell(
        action.playerId,
        userId,
        action.sharesAmount,
        action.maxSlippage,
      );
      if (!result.success) throw new Error(result.error || "Failed to execute pool sell");
      return withPlayer(result, action.playerId);
    }
    case "pool_add_liquidity": {
      const result = await addLiquidity(action.playerId, userId, action.shares, action.playMoney);
      if (!result.success) throw new Error(result.error || "Failed to add liquidity");
      return withPlayer(result, action.playerId);
    }
    case "pool_add_liquidity_optimal": {
      const result = await addLiquidityOptimal(
        action.playerId,
        userId,
        action.maxShares,
        action.maxPlayMoney,
      );
      if (!result.success) throw new Error(result.error || "Failed to add optimal liquidity");
      return withPlayer(result, action.playerId);
    }
    case "pool_zap_add_shares": {
      const result = await zapAddLiquiditySharesOnly(action.playerId, userId, action.shares);
      if (!result.success) throw new Error(result.error || "Failed to execute share-side zap");
      return withPlayer(result, action.playerId);
    }
    case "pool_zap_add_sb": {
      const result = await zapAddLiquiditySbOnly(action.playerId, userId, action.sb);
      if (!result.success) throw new Error(result.error || "Failed to execute cash-side zap");
      return withPlayer(result, action.playerId);
    }
    case "pool_remove_liquidity": {
      const result = await removeLiquidity(action.playerId, userId, action.lpShares);
      if (!result.success) throw new Error(result.error || "Failed to remove liquidity");
      return withPlayer(result, action.playerId);
    }
    case "daily_boost_assign": {
      const result = await assignDailyBoostWithValidation({
        userId,
        playerId: action.playerId,
        sport: action.sport,
        slotTier: action.slotTier,
        shares: action.shares,
        etDate: action.boostDate,
      });
      return withPlayer(result, action.playerId);
    }
    case "daily_boost_remove": {
      const { startOfDay } = getETDayBoundaries(action.boostDate);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
      const boosts = await storage.getDailyBoostsAllSports(userId, targetDate);
      const boost = boosts.find((entry) => entry.id === action.boostId);
      if (!boost) throw new Error("Boost not found or not owned by you");
      if (boost.status !== "active")
        throw new Error(`Cannot remove boost - status is ${boost.status}`);
      if (boost.gameId) {
        const game = await storage.getDailyGameByGameId(boost.gameId);
        if (game && new Date(game.startTime) <= new Date()) {
          throw new Error("Cannot remove boost - game has already started");
        }
      }
      await storage.deleteDailyBoost(boost.id);
      return withPlayer({ boostId: boost.id, playerId: boost.playerId }, boost.playerId);
    }
    case "community_boost_create": {
      const { startOfDay } = getETDayBoundaries(action.boostDate);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
      const game = await storage.getPlayerGameForDate(action.playerId, action.sport, targetDate);
      if (!game) throw new Error("This player does not have a game in that community-boost window");
      if (new Date(game.startTime) <= new Date())
        throw new Error("Cannot create community boost - game has already started");
      const available = await storage.getUserCommunityBoostShares(userId);
      if (available < 1) throw new Error("Insufficient community shares to create community boost");
      const existing = await storage.getCommunityBoostsForDate(action.sport, targetDate);
      if (existing.some((entry) => entry.playerId === action.playerId)) {
        throw new Error("This player already has a Community Boost");
      }
      const result = await storage.createCommunityBoost({
        creatorId: userId,
        playerId: action.playerId,
        sport: action.sport,
        boostDate: startOfDay,
        gameId: game.gameId,
      });
      return withPlayer(result, action.playerId);
    }
    case "watchlist_add_player":
      await storage.addToWatchList(userId, action.playerId, action.watchlistId || undefined);
      return withPlayer(
        { playerId: action.playerId, watchlistId: action.watchlistId || null },
        action.playerId,
      );
    case "watchlist_remove_player":
      await storage.removeFromWatchList(
        userId,
        action.playerId,
        action.removeFromAll ? undefined : action.watchlistId || undefined,
      );
      return withPlayer(
        { playerId: action.playerId, removeFromAll: Boolean(action.removeFromAll) },
        action.playerId,
      );
  }
}

function resolveOwnedTransaction(userId: string, transactionId: string) {
  const transaction = transactions.get(transactionId);
  if (!transaction || transaction.userId !== userId)
    throw new Error("Gameplay transaction not found");
  if (
    transaction.status === "pending_confirmation" &&
    Date.parse(transaction.expiresAt) <= Date.now()
  ) {
    transaction.status = "expired";
    transaction.completedAt = new Date().toISOString();
  }
  return transaction;
}

export async function stageGameplayTransaction(input: {
  userId: string;
  action: GameplayAction;
  summary?: string;
  warnings?: string[];
}) {
  assertAction(input.action);
  const now = new Date();
  const transaction: GameplayTransaction = {
    transactionId: randomUUID(),
    userId: input.userId,
    action: structuredClone(input.action),
    summary: input.summary?.trim() || (await actionSummary(input.action)),
    warnings: [...(input.warnings || [])],
    status: "pending_confirmation",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + getTransactionTtlMs()).toISOString(),
    completedAt: null,
    result: null,
    error: null,
  };
  transactions.set(transaction.transactionId, transaction);
  return structuredClone(transaction);
}

export async function getGameplayTransaction(userId: string, transactionId: string) {
  return structuredClone(resolveOwnedTransaction(userId, transactionId));
}

export async function confirmGameplayTransaction(userId: string, transactionId: string) {
  const transaction = resolveOwnedTransaction(userId, transactionId);
  if (transaction.status !== "pending_confirmation") {
    throw new Error(`Gameplay transaction is ${transaction.status}`);
  }
  try {
    const result = await (executorOverride || executeDefault)(
      userId,
      structuredClone(transaction.action),
    );
    transaction.status = "confirmed";
    transaction.completedAt = new Date().toISOString();
    transaction.result = result ?? null;
    return structuredClone(transaction);
  } catch (error) {
    transaction.status = "failed";
    transaction.completedAt = new Date().toISOString();
    transaction.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export async function cancelGameplayTransaction(userId: string, transactionId: string) {
  const transaction = resolveOwnedTransaction(userId, transactionId);
  if (transaction.status !== "pending_confirmation") {
    throw new Error(`Gameplay transaction is ${transaction.status}`);
  }
  transaction.status = "cancelled";
  transaction.completedAt = new Date().toISOString();
  return structuredClone(transaction);
}

export function configureGameplayTransactionExecutorForTests(
  executor: GameplayTransactionExecutor | null,
) {
  executorOverride = executor;
}

export function resetGameplayTransactionsForTests() {
  transactions.clear();
  executorOverride = null;
}

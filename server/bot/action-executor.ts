/**
 * Action Executor — Thin wrapper around existing AMM/scout functions.
 *
 * Each action type maps to the corresponding internal function.
 * All actions are logged to bot_actions_log for transparency + tracking.
 */

import { db } from "../db";
import { botActionsLog, botProfiles, holdings, players, users } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { executeBuy, executeSell, addLiquidity, addLiquidityOptimal } from "../amm/pool";
import { storage } from "../storage";
import type { ActionType } from "./bot-profiles-v2";
import type { PlayerCandidate } from "./player-selector";
import { assignDailyBoostWithValidation } from "../boosts/assign-daily-boost";

export interface ActionParams {
  /** SB amount for buys / LP adds */
  sbAmount?: number;
  /** Share amount for sells / LP adds */
  shares?: number;
  /** Target scout count */
  scoutCount?: number;
  /** Boost slot tier */
  slotTier?: number;
  /** Estimated fair value (for pool pricing) */
  fairValue?: number;
}

export interface ActionResult {
  success: boolean;
  actionType: ActionType;
  playerId: string;
  playerName: string;
  details: Record<string, unknown>;
  errorMessage?: string;
}

/**
 * Execute a bot action and log it.
 */
export async function executeBotAction(
  botUserId: string,
  profileId: string,
  actionType: ActionType,
  player: PlayerCandidate,
  params: ActionParams,
): Promise<ActionResult> {
  const result = await executeRaw(botUserId, actionType, player, params);

  // Log to bot_actions_log
  await db.insert(botActionsLog).values({
    botUserId,
    actionType,
    actionDetails: {
      playerId: player.playerId,
      playerName: player.playerName,
      sport: player.sport,
      params,
      ...result.details,
    },
    triggerReason: `deterministic_v2:${actionType}`,
    success: result.success,
    errorMessage: result.errorMessage || null,
  });

  // Update bot profile counters on success
  if (result.success) {
    const volumeEstimate = params.sbAmount || params.shares || 0;
    await db
      .update(botProfiles)
      .set({
        ordersToday: sql`${botProfiles.ordersToday} + 1`,
        volumeToday: sql`${botProfiles.volumeToday} + ${Math.round(volumeEstimate)}`,
        lastActionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(botProfiles.id, profileId));
  }

  return result;
}

async function executeRaw(
  botUserId: string,
  actionType: ActionType,
  player: PlayerCandidate,
  params: ActionParams,
): Promise<ActionResult> {
  const base = {
    actionType,
    playerId: player.playerId,
    playerName: player.playerName,
  };

  try {
    switch (actionType) {
      case "scout_assign":
        return await executeScoutAssign(botUserId, player, params);
      case "scout_rebalance":
        return await executeScoutRebalance(botUserId, player, params);
      case "pool_create":
        return await executePoolCreate(botUserId, player, params);
      case "pool_add_liquidity":
        return await executePoolAddLiquidity(botUserId, player, params);
      case "buy":
        return await executePoolBuy(botUserId, player, params);
      case "sell":
        return await executePoolSell(botUserId, player, params);
      case "boost_assign":
        return await executeBoostAssign(botUserId, player, params);
      default:
        return {
          ...base,
          success: false,
          details: {},
          errorMessage: `Unknown action type: ${actionType}`,
        };
    }
  } catch (error: any) {
    return {
      ...base,
      success: false,
      details: { error: error?.message },
      errorMessage: error?.message || "Execution failed",
    };
  }
}

async function executeScoutAssign(
  botUserId: string,
  player: PlayerCandidate,
  params: ActionParams,
): Promise<ActionResult> {
  const targetCount = params.scoutCount || 1;
  await storage.assignScouts(botUserId, player.playerId, targetCount);

  return {
    actionType: "scout_assign",
    playerId: player.playerId,
    playerName: player.playerName,
    success: true,
    details: { scoutCount: targetCount },
  };
}

async function executeScoutRebalance(
  botUserId: string,
  player: PlayerCandidate,
  params: ActionParams,
): Promise<ActionResult> {
  // Assign 1 scout to new target (assumes caller already checked capacity)
  const targetCount = params.scoutCount || 1;
  await storage.assignScouts(botUserId, player.playerId, targetCount);

  return {
    actionType: "scout_rebalance",
    playerId: player.playerId,
    playerName: player.playerName,
    success: true,
    details: { newTarget: player.playerId, scoutCount: targetCount },
  };
}

async function executePoolCreate(
  botUserId: string,
  player: PlayerCandidate,
  params: ActionParams,
): Promise<ActionResult> {
  // To create a pool: deposit shares + SB
  // Calculate from fair value or fallback
  const pricePerShare = params.fairValue || 10.0;

  // Get available shares for this player
  const [holding] = await db
    .select({ quantity: holdings.quantity })
    .from(holdings)
    .where(
      and(
        eq(holdings.userId, botUserId),
        eq(holdings.assetType, "player"),
        eq(holdings.assetId, player.playerId),
      ),
    );

  const availableShares = holding ? parseFloat(holding.quantity) : 0;
  if (availableShares < 1) {
    return {
      actionType: "pool_create",
      playerId: player.playerId,
      playerName: player.playerName,
      success: false,
      details: { availableShares },
      errorMessage: "Insufficient shares to create pool (need at least 1)",
    };
  }

  // Deposit up to 5 shares (or available), with proportional SB
  const sharesToDeposit = Math.min(Math.floor(availableShares), 5);
  const sbToDeposit = sharesToDeposit * pricePerShare;

  // Check balance
  const [user] = await db
    .select({ balance: users.balance })
    .from(users)
    .where(eq(users.id, botUserId));

  if (!user || parseFloat(user.balance) < sbToDeposit) {
    return {
      actionType: "pool_create",
      playerId: player.playerId,
      playerName: player.playerName,
      success: false,
      details: { needed: sbToDeposit, available: user?.balance },
      errorMessage: "Insufficient balance to create pool",
    };
  }

  const result = await addLiquidity(player.playerId, botUserId, sharesToDeposit, sbToDeposit);

  return {
    actionType: "pool_create",
    playerId: player.playerId,
    playerName: player.playerName,
    success: result.success,
    details: {
      sharesDeposited: sharesToDeposit,
      sbDeposited: sbToDeposit,
      initialPrice: pricePerShare,
    },
    errorMessage: result.success ? undefined : (result as any).error,
  };
}

async function executePoolAddLiquidity(
  botUserId: string,
  player: PlayerCandidate,
  params: ActionParams,
): Promise<ActionResult> {
  const maxShares = params.shares || 3;
  const maxPlayMoney = params.sbAmount || 50;

  const result = await addLiquidityOptimal(player.playerId, botUserId, maxShares, maxPlayMoney);

  return {
    actionType: "pool_add_liquidity",
    playerId: player.playerId,
    playerName: player.playerName,
    success: result.success,
    details: { maxShares, maxPlayMoney },
    errorMessage: result.success ? undefined : (result as any).error,
  };
}

async function executePoolBuy(
  botUserId: string,
  player: PlayerCandidate,
  params: ActionParams,
): Promise<ActionResult> {
  const sbAmount = params.sbAmount || 20;

  const result = await executeBuy(player.playerId, botUserId, sbAmount);

  return {
    actionType: "buy",
    playerId: player.playerId,
    playerName: player.playerName,
    success: result.success,
    details: { sbAmount, ...(result.success ? { trade: (result as any).trade } : {}) },
    errorMessage: result.success ? undefined : (result as any).error,
  };
}

async function executePoolSell(
  botUserId: string,
  player: PlayerCandidate,
  params: ActionParams,
): Promise<ActionResult> {
  const shares = params.shares || 1;

  const result = await executeSell(player.playerId, botUserId, shares);

  return {
    actionType: "sell",
    playerId: player.playerId,
    playerName: player.playerName,
    success: result.success,
    details: { shares },
    errorMessage: result.success ? undefined : (result as any).error,
  };
}

async function executeBoostAssign(
  botUserId: string,
  player: PlayerCandidate,
  params: ActionParams,
): Promise<ActionResult> {
  const slotTier = params.slotTier || 4;

  try {
    const { shareMultiplier, shareSourceType } = await assignDailyBoostWithValidation({
      userId: botUserId,
      playerId: player.playerId,
      slotTier,
      sport: player.sport,
      etDate: new Date(),
    });

    return {
      actionType: "boost_assign",
      playerId: player.playerId,
      playerName: player.playerName,
      success: true,
      details: {
        slotTier,
        shareMultiplier,
        shareSourceType,
      },
    };
  } catch (error: any) {
    return {
      actionType: "boost_assign",
      playerId: player.playerId,
      playerName: player.playerName,
      success: false,
      details: { slotTier },
      errorMessage: error?.message || "Boost assignment failed",
    };
  }
}

/**
 * Calculate action parameters based on bot profile and market state.
 */
export function calculateActionParams(
  actionType: ActionType,
  player: PlayerCandidate,
  botConfig: { minOrderSb: number; maxOrderSb: number },
): ActionParams {
  // Jittered order size: base × random(0.7, 1.3)
  const baseSize = botConfig.minOrderSb + (botConfig.maxOrderSb - botConfig.minOrderSb) * 0.4;
  const jitter = 0.7 + Math.random() * 0.6;
  const sbAmount = Math.max(
    botConfig.minOrderSb,
    Math.min(botConfig.maxOrderSb, Math.round(baseSize * jitter)),
  );

  switch (actionType) {
    case "scout_assign":
      return { scoutCount: 1 };
    case "scout_rebalance":
      return { scoutCount: 1 };
    case "pool_create":
      return {
        fairValue: player.currentPrice || player.lastTradePrice || 10.0,
        sbAmount,
      };
    case "pool_add_liquidity":
      return {
        shares: Math.max(1, Math.floor(sbAmount / (player.currentPrice || 10))),
        sbAmount,
      };
    case "buy":
      return { sbAmount };
    case "sell":
      return { shares: Math.max(1, Math.floor(Math.random() * 3) + 1) };
    case "boost_assign":
      return { slotTier: Math.floor(Math.random() * 4) + 2 }; // 2-5
    default:
      return {};
  }
}

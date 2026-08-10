/**
 * TradingStrategy - Provide liquidity across ALL players
 *
 * Bots execute trades to ensure market depth across all players,
 * not just popular ones. This keeps the market liquid even for
 * lesser-known players.
 */

import { db } from "../db";
import { players, holdings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logBotAction, updateBotVolume, type BotProfile } from "./bot-engine";
import { executeBuy, executeSell, addLiquidityOptimal, getPool } from "../amm/pool";

interface TradeConfig {
  userId: string;
  maxOrderSize: number;
  minOrderSize: number;
  maxDailyVolume: number;
  volumeToday: number;
  spreadPercent: number;
  aggressiveness: number; // 0-1, higher = more likely to trade
  profileId: string;
}

/**
 * Get all active players with their current prices and liquidity info
 */
async function getAllActivePlayers(): Promise<
  {
    id: string;
    firstName: string;
    lastName: string;
    currentPrice: string | null;
    lastTradePrice: string | null;
    totalShares: string;
  }[]
> {
  const allPlayers = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      currentPrice: players.currentPrice,
      lastTradePrice: players.lastTradePrice,
      totalShares: players.totalShares,
    })
    .from(players)
    .where(eq(players.isActive, true));

  return allPlayers;
}

/**
 * Get bot's current holdings for all players
 */
async function getBotHoldings(userId: string): Promise<Map<string, number>> {
  const allHoldings = await db.select().from(holdings).where(eq(holdings.userId, userId));

  const holdingsMap = new Map<string, number>();
  for (const holding of allHoldings) {
    if (holding.assetType === "player") {
      holdingsMap.set(holding.assetId, parseFloat(holding.quantity));
    }
  }

  return holdingsMap;
}

/**
 * Calculate a fair price for a player
 */
function getFairPrice(player: {
  currentPrice: string | null;
  lastTradePrice: string | null;
}): number {
  const price = player.currentPrice || "0.00";
  return parseFloat(price);
}

/**
 * Execute a trade (buy or sell) for a specific player
 */
async function executeTrade(
  userId: string,
  playerId: string,
  playerName: string,
  isBuy: boolean,
  amount: number,
): Promise<boolean> {
  try {
    const pool = await getPool(playerId);
    if (!pool) {
      return false;
    }

    if (isBuy) {
      const result = await executeBuy(playerId, userId, amount);
      return result.success;
    } else {
      const result = await executeSell(playerId, userId, amount);
      return result.success;
    }
  } catch (error: any) {
    console.error(`[BotTrade] Trade failed for ${playerName}:`, error.message);
    return false;
  }
}

/**
 * Determine trade size based on bot configuration and player price
 */
function calculateTradeSize(
  config: TradeConfig,
  fairPrice: number,
  hasExistingPosition: boolean,
): number {
  if (!Number.isFinite(fairPrice) || fairPrice <= 0) {
    return 0;
  }

  // Base trade size as a percentage of max order size
  const baseSize = config.maxOrderSize * (0.1 + Math.random() * 0.3); // 10-40% of max

  // If we have a position, we might sell (take profits or reduce exposure)
  // If we don't have a position, we might buy (establish position)
  const size = Math.max(config.minOrderSize, Math.floor(baseSize));

  // Ensure we don't exceed daily volume limit
  const remainingDailyVolume = config.maxDailyVolume - config.volumeToday;
  return Math.min(size, remainingDailyVolume, Math.floor(1000 / fairPrice)); // Cap at $1000 worth
}

/**
 * Execute liquidity addition to a player's pool
 */
async function executeAddLiquidity(
  userId: string,
  playerId: string,
  playerName: string,
  maxShares: number,
  maxPlayMoney: number,
): Promise<boolean> {
  try {
    const pool = await getPool(playerId);
    if (!pool) {
      return false;
    }

    const result = await addLiquidityOptimal(playerId, userId, maxShares, maxPlayMoney);
    return result.success;
  } catch (error: any) {
    console.error(`[BotTrade] Liquidity add failed for ${playerName}:`, error.message);
    return false;
  }
}

/**
 * Main trading strategy execution
 */
export async function executeTradingStrategy(
  profile: BotProfile & { user: { id: string; balance: string } },
): Promise<void> {
  const config: TradeConfig = {
    userId: profile.userId,
    maxOrderSize: profile.maxOrderSize,
    minOrderSize: profile.minOrderSize,
    maxDailyVolume: profile.maxDailyVolume,
    volumeToday: profile.volumeToday,
    spreadPercent: parseFloat(profile.spreadPercent),
    aggressiveness: parseFloat(profile.aggressiveness),
    profileId: profile.id,
  };

  // Check daily volume limit
  if (config.volumeToday >= config.maxDailyVolume) {
    console.log(`[BotTrade] ${profile.botName} hit daily volume limit`);
    return;
  }

  // Random chance to trade based on aggressiveness
  if (Math.random() > config.aggressiveness) {
    return; // Skip this tick
  }

  try {
    // Get all active players
    const allPlayers = await getAllActivePlayers();

    if (allPlayers.length === 0) {
      console.log(`[BotTrade] ${profile.botName} no active players found`);
      return;
    }

    // Get bot's current holdings
    const holdingsMap = await getBotHoldings(config.userId);

    // Decide: BUY, SELL, or ADD LIQUIDITY?
    // 35% chance: buy from pool (provide buy liquidity)
    // 35% chance: sell to pool (provide sell liquidity)
    // 30% chance: add liquidity to pool (become LP)
    const actionRoll = Math.random();
    const isBuy = actionRoll < 0.35;
    const isAddLiquidity = actionRoll >= 0.65;

    // Select a player - prioritize players with less liquidity or random
    // We want to ensure ALL players get coverage, not just popular ones
    let targetPlayer: (typeof allPlayers)[0];
    let actionType: string;
    let success = false;
    let tradeValue = 0;

    if (isAddLiquidity) {
      // For adding liquidity: only pick players where this bot actually has shares.
      // Randomly selecting from all active players causes near-certain LP failures.
      const playersWithPosition = allPlayers.filter((p) => (holdingsMap.get(p.id) || 0) > 0);
      if (playersWithPosition.length === 0) {
        return;
      }
      targetPlayer = playersWithPosition[Math.floor(Math.random() * playersWithPosition.length)];
      const fairPrice = getFairPrice(targetPlayer);

      // Calculate liquidity amounts (equal value of shares + play money)
      const maxShares = Math.floor(config.maxOrderSize * 0.2); // 20% of max order
      const maxPlayMoney = maxShares * fairPrice;

      success = await executeAddLiquidity(
        config.userId,
        targetPlayer.id,
        `${targetPlayer.firstName} ${targetPlayer.lastName}`,
        maxShares,
        maxPlayMoney,
      );

      if (success) {
        tradeValue = maxShares * fairPrice * 2; // Count both sides of liquidity
        actionType = "add_liquidity";

        await logBotAction(config.userId, {
          actionType,
          actionDetails: {
            playerId: targetPlayer.id,
            playerName: `${targetPlayer.firstName} ${targetPlayer.lastName}`,
            shares: maxShares,
            playMoney: maxPlayMoney,
            tradeValue: tradeValue.toFixed(2),
          },
          triggerReason: "Adding pool liquidity for market depth",
          success: true,
        });

        console.log(
          `[BotTrade] ${profile.botName} ADDED LIQUIDITY to ${targetPlayer.firstName} ${targetPlayer.lastName}: ${maxShares} shares + $${maxPlayMoney.toFixed(2)}`,
        );
      }
    } else if (isBuy) {
      // For buying: prioritize players with no position OR low liquidity
      const playersWithoutPosition = allPlayers.filter((p) => !holdingsMap.has(p.id));
      const playersWithLowLiquidity = allPlayers
        .filter((p) => (holdingsMap.get(p.id) || 0) < 50)
        .filter((p) => holdingsMap.has(p.id));

      if (playersWithoutPosition.length > 0 && Math.random() < 0.5) {
        targetPlayer =
          playersWithoutPosition[Math.floor(Math.random() * playersWithoutPosition.length)];
      } else if (playersWithLowLiquidity.length > 0) {
        targetPlayer =
          playersWithLowLiquidity[Math.floor(Math.random() * playersWithLowLiquidity.length)];
      } else {
        targetPlayer = allPlayers[Math.floor(Math.random() * allPlayers.length)];
      }

      const fairPrice = getFairPrice(targetPlayer);
      const currentHoldings = holdingsMap.get(targetPlayer.id) || 0;
      const tradeSize = calculateTradeSize(config, fairPrice, currentHoldings > 0);

      if (tradeSize < config.minOrderSize) {
        return;
      }

      success = await executeTrade(
        config.userId,
        targetPlayer.id,
        `${targetPlayer.firstName} ${targetPlayer.lastName}`,
        true, // isBuy
        tradeSize,
      );

      if (success) {
        tradeValue = tradeSize * fairPrice;
        actionType = "trade_buy";

        await logBotAction(config.userId, {
          actionType,
          actionDetails: {
            playerId: targetPlayer.id,
            playerName: `${targetPlayer.firstName} ${targetPlayer.lastName}`,
            shares: tradeSize,
            price: fairPrice,
            tradeValue: tradeValue.toFixed(2),
          },
          triggerReason: "Providing buy liquidity",
          success: true,
        });

        console.log(
          `[BotTrade] ${profile.botName} BOUGHT ${tradeSize} shares of ${targetPlayer.firstName} ${targetPlayer.lastName} at $${fairPrice.toFixed(2)}`,
        );
      }
    } else {
      // For selling: prioritize players we have positions in
      const playersWithPosition = allPlayers.filter((p) => (holdingsMap.get(p.id) || 0) > 0);

      if (playersWithPosition.length === 0) {
        console.log(`[BotTrade] ${profile.botName} has no holdings to sell`);
        return;
      }

      targetPlayer = playersWithPosition[Math.floor(Math.random() * playersWithPosition.length)];
      const fairPrice = getFairPrice(targetPlayer);
      const currentHoldings = holdingsMap.get(targetPlayer.id) || 0;
      const tradeSize = calculateTradeSize(config, fairPrice, true);

      if (tradeSize < config.minOrderSize) {
        return;
      }

      success = await executeTrade(
        config.userId,
        targetPlayer.id,
        `${targetPlayer.firstName} ${targetPlayer.lastName}`,
        false, // isSell
        tradeSize,
      );

      if (success) {
        tradeValue = tradeSize * fairPrice;
        actionType = "trade_sell";

        await logBotAction(config.userId, {
          actionType,
          actionDetails: {
            playerId: targetPlayer.id,
            playerName: `${targetPlayer.firstName} ${targetPlayer.lastName}`,
            shares: tradeSize,
            price: fairPrice,
            tradeValue: tradeValue.toFixed(2),
          },
          triggerReason: "Providing sell liquidity",
          success: true,
        });

        console.log(
          `[BotTrade] ${profile.botName} SOLD ${tradeSize} shares of ${targetPlayer.firstName} ${targetPlayer.lastName} at $${fairPrice.toFixed(2)}`,
        );
      }
    }

    // Update daily volume if any action succeeded
    if (success && tradeValue > 0) {
      await updateBotVolume(config.profileId, tradeValue);
    }
  } catch (error: any) {
    console.error(`[BotTrade] Error in trading strategy for ${profile.botName}:`, error.message);
    // Don't throw - we don't want one bot's error to stop others
  }
}

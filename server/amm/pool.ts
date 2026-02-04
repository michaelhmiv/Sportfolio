/**
 * AMM Pool Module - Constant Product Automated Market Maker with LP Support
 * 
 * Formula: x * y = k
 * where:
 *   x = shares in pool
 *   y = play money (Sportfolio Bucks) in pool
 *   k = constant product
 * 
 * Price = y / x (play money per share)
 * 
 * Fee Structure:
 *   - 1% stays in pool (benefits LPs)
 *   - 1% burned (removed from circulation)
 *   - Total: 2% per trade
 * 
 * LP System:
 *   - Users deposit shares + play money at current ratio
 *   - Receive LP tokens representing % ownership
 *   - Earn fees through pool value growth
 *   - Can remove liquidity anytime at current ratio
 */

import { eq, sql, and } from "drizzle-orm";
import { db } from "../db";
import { playerPools, players, trades, holdings, users, lpPositions, lpTransactions } from "@shared/schema";
import { broadcast } from "../websocket";

// Fee structure - easily adjustable
const POOL_FEE_PERCENT = 0.01; // 1% to pool (benefits LPs)
const BURN_FEE_PERCENT = 0.01; // 1% burned
const TOTAL_FEE_PERCENT = POOL_FEE_PERCENT + BURN_FEE_PERCENT; // 2% total
const MAX_SLIPPAGE_PERCENT = 0.05; // 5% max slippage

// Whale alert thresholds
const WHALE_ALERT_MIN_VALUE = 5000; // $5,000 minimum
const WHALE_ALERT_POOL_IMPACT_PERCENT = 5; // 5% of pool

// LP Boost threshold (1% ownership required for boost bonus)
const LP_BOOST_THRESHOLD = 0.01;

export interface Pool {
  playerId: string;
  shares: number;
  playMoney: number;
  k: number;
  lpSharesTotal: number;
  feesAccumulated: number;
  totalVolume: number;
  totalTrades: number;
  currentPrice: number;
}

export interface BuyQuote {
  sharesOut: number;
  effectivePrice: number;
  slippagePercent: number;
  newPoolPrice: number;
  totalCost: number;
  poolFee: number;
  burnFee: number;
}

export interface SellQuote {
  sbOut: number;
  effectivePrice: number;
  slippagePercent: number;
  newPoolPrice: number;
  poolFee: number;
  burnFee: number;
  sellerReceives: number;
}

export interface TradeResult {
  success: boolean;
  error?: string;
  tradeId?: string;
  sharesTraded?: number;
  pricePerShare?: number;
  totalValue?: number;
  slippagePercent?: number;
  poolFee?: number;
  burnFee?: number;
}

export interface LpPositionData {
  userId: string;
  playerId: string;
  lpShares: number;
  totalLpShares: number;
  ownershipPercentage: number;
  equivalentShares: number;
  equivalentPlayMoney: number;
  positionValue: number;
}

export interface AddLiquidityResult {
  success: boolean;
  error?: string;
  lpSharesMinted?: number;
  sharesDeposited?: number;
  playMoneyDeposited?: number;
  ownershipPercentage?: number;
}

export interface RemoveLiquidityResult {
  success: boolean;
  error?: string;
  lpSharesBurned?: number;
  sharesReceived?: number;
  playMoneyReceived?: number;
}

/**
 * Get pool state for a player
 */
export async function getPool(playerId: string): Promise<Pool | null> {
  const [pool] = await db
    .select()
    .from(playerPools)
    .where(eq(playerPools.playerId, playerId));

  if (!pool) {
    return null;
  }

  const shares = parseFloat(pool.shares);
  const playMoney = parseFloat(pool.playMoney);

  return {
    playerId: pool.playerId,
    shares,
    playMoney,
    k: parseFloat(pool.k),
    lpSharesTotal: parseFloat(pool.lpSharesTotal),
    feesAccumulated: parseFloat(pool.feesAccumulated),
    totalVolume: parseFloat(pool.totalVolume),
    totalTrades: pool.totalTrades,
    currentPrice: playMoney / shares,
  };
}

/**
 * Initialize a new pool for a player with default liquidity
 * Creates pool with 1000 shares and 10000 play money ($10/share initial price)
 */
export async function initializePool(playerId: string): Promise<Pool> {
  console.log(`[AMM] Initializing pool for player ${playerId}`);

  try {
    const [newPool] = await db
      .insert(playerPools)
      .values({
        playerId,
        shares: "1000",
        playMoney: "10000",
        lpSharesTotal: "1000",
        feesAccumulated: "0",
        totalVolume: "0",
        totalTrades: 0,
      })
      .onConflictDoNothing()
      .returning();

    if (newPool) {
      console.log(`[AMM] Pool created for player ${playerId}`);
      return {
        playerId: newPool.playerId,
        shares: parseFloat(newPool.shares),
        playMoney: parseFloat(newPool.playMoney),
        k: parseFloat(newPool.k),
        lpSharesTotal: parseFloat(newPool.lpSharesTotal),
        feesAccumulated: parseFloat(newPool.feesAccumulated),
        totalVolume: parseFloat(newPool.totalVolume),
        totalTrades: newPool.totalTrades,
        currentPrice: parseFloat(newPool.playMoney) / parseFloat(newPool.shares),
      };
    }

    // If onConflictDoNothing triggered, try to fetch the existing pool
    const existingPool = await getPool(playerId);
    if (existingPool) {
      return existingPool;
    }

    throw new Error(`Pool creation returned no data and pool does not exist for player ${playerId}`);
  } catch (error: any) {
    console.error(`[AMM] Failed to initialize pool for player ${playerId}:`, error.message);
    // Check if it's a foreign key violation
    if (error.message?.includes("foreign key") || error.message?.includes("violates foreign key")) {
      throw new Error(`Player ${playerId} does not exist in database`);
    }
    throw error;
  }
}

/**
 * Get or create pool for a player
 */
export async function getOrCreatePool(playerId: string): Promise<Pool> {
  const pool = await getPool(playerId);
  if (pool) {
    return pool;
  }
  return initializePool(playerId);
}

/**
 * Calculate buy shares for a given SB amount with new fee structure
 * Formula: 
 *   total_cost = sb_amount * (1 + total_fee)
 *   pool_receives = sb_amount * (1 + pool_fee)
 *   burn_amount = sb_amount * burn_fee
 *   new_play_money = current_play_money + pool_receives
 *   new_shares = k / new_play_money
 *   shares_out = current_shares - new_shares
 */
export function calculateBuyShares(pool: Pool, sbAmount: number): BuyQuote {
  const { shares: currentShares, playMoney: currentPlayMoney, k } = pool;

  // Validate inputs
  if (!currentShares || currentShares <= 0 || !currentPlayMoney || currentPlayMoney <= 0 || !k || k <= 0) {
    throw new Error("Invalid pool state: pool has zero or negative reserves");
  }
  if (!sbAmount || sbAmount <= 0) {
    throw new Error("Invalid trade amount: must be greater than zero");
  }
  if (!isFinite(sbAmount) || isNaN(sbAmount)) {
    throw new Error("Invalid trade amount: must be a valid number");
  }

  // Calculate fees
  const poolFee = sbAmount * POOL_FEE_PERCENT;
  const burnFee = sbAmount * BURN_FEE_PERCENT;
  const totalCost = sbAmount + poolFee + burnFee;
  const poolReceives = sbAmount + poolFee; // User's SB + pool fee stays in pool

  // Calculate new pool state after buy
  const newPlayMoney = currentPlayMoney + poolReceives;
  const newShares = k / newPlayMoney;
  const sharesOut = currentShares - newShares;

  // Validate output
  if (sharesOut <= 0 || !isFinite(sharesOut)) {
    throw new Error("Trade too large: would deplete pool shares");
  }

  // Calculate effective price and slippage
  const effectivePrice = totalCost / sharesOut;
  const currentPrice = currentPlayMoney / currentShares;
  const slippagePercent = (effectivePrice - currentPrice) / currentPrice;

  return {
    sharesOut,
    effectivePrice,
    slippagePercent,
    newPoolPrice: newPlayMoney / newShares,
    totalCost,
    poolFee,
    burnFee,
  };
}

/**
 * Calculate SB out for a given shares amount with new fee structure
 * Formula:
 *   new_shares = current_shares + shares_in
 *   new_play_money = k / new_shares
 *   sb_out_before_fees = current_play_money - new_play_money
 *   pool_fee = sb_out_before_fees * pool_fee_percent
 *   burn_fee = sb_out_before_fees * burn_fee_percent
 *   seller_receives = sb_out_before_fees - pool_fee - burn_fee
 *   pool_loses = sb_out_before_fees - pool_fee (pool fee stays in pool)
 */
export function calculateSellShares(pool: Pool, sharesAmount: number): SellQuote {
  const { shares: currentShares, playMoney: currentPlayMoney, k } = pool;

  // Validate inputs
  if (!currentShares || currentShares <= 0 || !currentPlayMoney || currentPlayMoney <= 0 || !k || k <= 0) {
    throw new Error("Invalid pool state: pool has zero or negative reserves");
  }
  if (!sharesAmount || sharesAmount <= 0) {
    throw new Error("Invalid trade amount: must be greater than zero");
  }
  if (!isFinite(sharesAmount) || isNaN(sharesAmount)) {
    throw new Error("Invalid trade amount: must be a valid number");
  }

  // Calculate new pool state after sell
  const newShares = currentShares + sharesAmount;
  const newPlayMoney = k / newShares;
  const sbOutBeforeFees = currentPlayMoney - newPlayMoney;

  // Validate output
  if (sbOutBeforeFees <= 0 || !isFinite(sbOutBeforeFees)) {
    throw new Error("Trade too large: would deplete pool liquidity");
  }

  // Calculate fees
  const poolFee = sbOutBeforeFees * POOL_FEE_PERCENT;
  const burnFee = sbOutBeforeFees * BURN_FEE_PERCENT;
  const sellerReceives = sbOutBeforeFees - poolFee - burnFee;

  // Validate seller receives positive amount
  if (sellerReceives <= 0) {
    throw new Error("Trade too small: fees exceed proceeds");
  }

  // Calculate effective price and slippage
  const effectivePrice = sellerReceives / sharesAmount;
  const currentPrice = currentPlayMoney / currentShares;
  const slippagePercent = (currentPrice - effectivePrice) / currentPrice;

  return {
    sbOut: sbOutBeforeFees,
    effectivePrice,
    slippagePercent,
    newPoolPrice: newPlayMoney / newShares,
    poolFee,
    burnFee,
    sellerReceives,
  };
}

/**
 * Execute a buy trade against the AMM pool with LP support
 * Uses database transaction with SELECT FOR UPDATE for safety
 */
export async function executeBuy(
  playerId: string,
  userId: string,
  sbAmount: number,
  maxSlippage: number = MAX_SLIPPAGE_PERCENT
): Promise<TradeResult> {
  return await db.transaction(async (tx) => {
    try {
      // 1. Lock the pool row to prevent race conditions
      const [pool] = await tx
        .select()
        .from(playerPools)
        .where(eq(playerPools.playerId, playerId))
        .for("update");

      if (!pool) {
        return { success: false, error: "Pool not found" };
      }

      const poolData: Pool = {
        playerId: pool.playerId,
        shares: parseFloat(pool.shares),
        playMoney: parseFloat(pool.playMoney),
        k: parseFloat(pool.k),
        lpSharesTotal: parseFloat(pool.lpSharesTotal),
        feesAccumulated: parseFloat(pool.feesAccumulated),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      // 2. Calculate trade details
      const quote = calculateBuyShares(poolData, sbAmount);

      // 3. Check slippage
      if (quote.slippagePercent > maxSlippage) {
        return {
          success: false,
          error: `Slippage too high: ${(quote.slippagePercent * 100).toFixed(2)}% (max: ${(maxSlippage * 100).toFixed(2)}%)`,
        };
      }

      // 4. Verify user has enough balance (total cost including fees)
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!user) {
        return { success: false, error: "User not found" };
      }

      const userBalance = parseFloat(user.balance);
      if (userBalance < quote.totalCost) {
        return {
          success: false,
          error: `Insufficient balance. Need $${quote.totalCost.toFixed(2)} (includes ${(TOTAL_FEE_PERCENT * 100).toFixed(0)}% fees)`
        };
      }

      // 5. Update pool state (pool receives SB + pool fee, burn fee is just not added)
      const newShares = poolData.shares - quote.sharesOut;
      const newPlayMoney = poolData.playMoney + sbAmount + quote.poolFee; // User SB + pool fee
      const newTotalVolume = poolData.totalVolume + sbAmount;
      const newFeesAccumulated = poolData.feesAccumulated + quote.poolFee;
      const newK = newShares * newPlayMoney; // Recalculate K to maintain invariant

      // Validate pool state
      if (newShares <= 0 || newPlayMoney <= 0) {
        return { success: false, error: "Trade would deplete pool reserves" };
      }

      await tx
        .update(playerPools)
        .set({
          shares: newShares.toFixed(2),
          playMoney: newPlayMoney.toFixed(2),
          k: newK.toFixed(2),
          feesAccumulated: newFeesAccumulated.toFixed(2),
          totalVolume: newTotalVolume.toFixed(2),
          totalTrades: poolData.totalTrades + 1,
          updatedAt: new Date(),
        })
        .where(eq(playerPools.playerId, playerId));

      // 6. Deduct total cost from user (SB + both fees)
      const newBalance = userBalance - quote.totalCost;
      await tx
        .update(users)
        .set({ balance: newBalance.toFixed(2) })
        .where(eq(users.id, userId));

      // 7. Add shares to user holdings
      const [existingHolding] = await tx
        .select()
        .from(holdings)
        .where(and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, playerId)
        ));

      if (existingHolding) {
        const currentQuantity = parseFloat(existingHolding.quantity);
        const newQuantity = currentQuantity + quote.sharesOut;
        const currentTotalCost = parseFloat(existingHolding.totalCostBasis);
        const newTotalCost = currentTotalCost + quote.totalCost;
        const newAvgCost = newTotalCost / newQuantity;

        await tx
          .update(holdings)
          .set({
            quantity: newQuantity.toFixed(4),
            avgCostBasis: newAvgCost.toFixed(4),
            totalCostBasis: newTotalCost.toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existingHolding.id));
      } else {
        await tx.insert(holdings).values({
          userId,
          assetType: "player",
          assetId: playerId,
          quantity: quote.sharesOut.toFixed(4),
          avgCostBasis: quote.effectivePrice.toFixed(4),
          totalCostBasis: quote.totalCost.toFixed(2),
          lastUpdated: new Date(),
        });
      }

      // 8. Record trade
      console.log("[AMM] Inserting trade with sellerId='pool', playerId:", playerId, "buyerId:", userId);
      const [trade] = await tx
        .insert(trades)
        .values({
          playerId,
          buyerId: userId,
          sellerId: "pool",
          buyOrderId: null,
          sellOrderId: null,
          quantity: quote.sharesOut.toFixed(4),
          price: quote.effectivePrice.toFixed(2),
          executedAt: new Date(),
        })
        .returning();

      // 9. Update player's last trade price
      await tx
        .update(players)
        .set({
          lastTradePrice: quote.newPoolPrice.toFixed(2),
          currentPrice: quote.newPoolPrice.toFixed(2),
          volume24h: sql`${players.volume24h} + ${quote.sharesOut}`,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, playerId));

      // 10. Broadcast updates
      broadcast({
        type: "trade",
        playerId,
        price: quote.newPoolPrice.toFixed(2),
        quantity: quote.sharesOut,
        buyerId: userId,
        sellerId: "pool",
      });

      broadcast({
        type: "portfolio",
        userId,
        balance: newBalance.toFixed(2),
      });

      broadcast({
        type: "marketActivity",
      });

      // Check for whale alert
      const poolImpact = (quote.totalCost / poolData.playMoney) * 100;
      if (quote.totalCost >= WHALE_ALERT_MIN_VALUE || poolImpact >= WHALE_ALERT_POOL_IMPACT_PERCENT) {
        const [player] = await tx
          .select({ firstName: players.firstName, lastName: players.lastName })
          .from(players)
          .where(eq(players.id, playerId));

        const [trader] = await tx
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, userId));

        broadcast({
          type: "whale_alert",
          playerId,
          playerName: player ? `${player.firstName} ${player.lastName}` : "Unknown",
          traderUsername: trader?.username || "Unknown",
          tradeValue: quote.totalCost,
          tradeType: "buy",
        });
      }

      return {
        success: true,
        tradeId: trade.id,
        sharesTraded: quote.sharesOut,
        pricePerShare: quote.effectivePrice,
        totalValue: quote.totalCost,
        slippagePercent: quote.slippagePercent,
        poolFee: quote.poolFee,
        burnFee: quote.burnFee,
      };
    } catch (error: any) {
      console.error("[AMM] Buy execution failed:", error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * Execute a sell trade against the AMM pool with LP support
 * Uses database transaction with SELECT FOR UPDATE for safety
 */
export async function executeSell(
  playerId: string,
  userId: string,
  sharesAmount: number,
  maxSlippage: number = MAX_SLIPPAGE_PERCENT
): Promise<TradeResult> {
  return await db.transaction(async (tx) => {
    try {
      // 1. Lock the pool row to prevent race conditions
      const [pool] = await tx
        .select()
        .from(playerPools)
        .where(eq(playerPools.playerId, playerId))
        .for("update");

      if (!pool) {
        return { success: false, error: "Pool not found" };
      }

      const poolData: Pool = {
        playerId: pool.playerId,
        shares: parseFloat(pool.shares),
        playMoney: parseFloat(pool.playMoney),
        k: parseFloat(pool.k),
        lpSharesTotal: parseFloat(pool.lpSharesTotal),
        feesAccumulated: parseFloat(pool.feesAccumulated),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      // 2. Calculate trade details
      const quote = calculateSellShares(poolData, sharesAmount);

      // 3. Check slippage
      if (quote.slippagePercent > maxSlippage) {
        return {
          success: false,
          error: `Slippage too high: ${(quote.slippagePercent * 100).toFixed(2)}% (max: ${(maxSlippage * 100).toFixed(2)}%)`,
        };
      }

      // 4. Verify user has enough shares
      const [holding] = await tx
        .select()
        .from(holdings)
        .where(and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, playerId)
        ));

      const holdingQuantity = parseFloat(holding.quantity);
      if (!holding || holdingQuantity < sharesAmount) {
        return { success: false, error: "Insufficient shares" };
      }

      // 5. Update pool state
      // Pool loses: sbOut - poolFee (pool fee stays in pool, burn fee is removed)
      const newShares = poolData.shares + sharesAmount;
      const newPlayMoney = poolData.playMoney - quote.sbOut + quote.poolFee;
      const newTotalVolume = poolData.totalVolume + quote.sbOut;
      const newFeesAccumulated = poolData.feesAccumulated + quote.poolFee;
      const newK = newShares * newPlayMoney; // Recalculate K to maintain invariant

      // Validate pool state
      if (newShares <= 0 || newPlayMoney <= 0) {
        return { success: false, error: "Trade would deplete pool reserves" };
      }

      await tx
        .update(playerPools)
        .set({
          shares: newShares.toFixed(2),
          playMoney: newPlayMoney.toFixed(2),
          k: newK.toFixed(2),
          feesAccumulated: newFeesAccumulated.toFixed(2),
          totalVolume: newTotalVolume.toFixed(2),
          totalTrades: poolData.totalTrades + 1,
          updatedAt: new Date(),
        })
        .where(eq(playerPools.playerId, playerId));

      // 6. Deduct shares from user holdings
      const newQuantity = holdingQuantity - sharesAmount;
      if (newQuantity > 0.0001) {
        await tx
          .update(holdings)
          .set({
            quantity: newQuantity.toFixed(4),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, holding.id));
      } else {
        await tx.delete(holdings).where(eq(holdings.id, holding.id));
      }

      // 7. Add SB to user balance (seller receives after fees)
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!user) {
        return { success: false, error: "User not found" };
      }

      const newBalance = parseFloat(user.balance) + quote.sellerReceives;
      await tx
        .update(users)
        .set({ balance: newBalance.toFixed(2) })
        .where(eq(users.id, userId));

      // 8. Record trade
      const [trade] = await tx
        .insert(trades)
        .values({
          playerId,
          buyerId: "pool",
          sellerId: userId,
          buyOrderId: null,
          sellOrderId: null,
          quantity: sharesAmount,
          price: quote.effectivePrice.toFixed(2),
          executedAt: new Date(),
        })
        .returning();

      // 9. Update player's last trade price
      await tx
        .update(players)
        .set({
          lastTradePrice: quote.newPoolPrice.toFixed(2),
          currentPrice: quote.newPoolPrice.toFixed(2),
          volume24h: sql`${players.volume24h} + ${sharesAmount}`,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, playerId));

      // 10. Broadcast updates
      broadcast({
        type: "trade",
        playerId,
        price: quote.newPoolPrice.toFixed(2),
        quantity: sharesAmount,
        buyerId: "pool",
        sellerId: userId,
      });

      broadcast({
        type: "portfolio",
        userId,
        balance: newBalance.toFixed(2),
      });

      broadcast({
        type: "marketActivity",
      });

      // Check for whale alert
      const poolImpact = (quote.sbOut / poolData.playMoney) * 100;
      if (quote.sbOut >= WHALE_ALERT_MIN_VALUE || poolImpact >= WHALE_ALERT_POOL_IMPACT_PERCENT) {
        const [player] = await tx
          .select({ firstName: players.firstName, lastName: players.lastName })
          .from(players)
          .where(eq(players.id, playerId));

        const [trader] = await tx
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, userId));

        broadcast({
          type: "whale_alert",
          playerId,
          playerName: player ? `${player.firstName} ${player.lastName}` : "Unknown",
          traderUsername: trader?.username || "Unknown",
          tradeValue: quote.sbOut,
          tradeType: "sell",
        });
      }

      return {
        success: true,
        tradeId: trade.id,
        sharesTraded: sharesAmount,
        pricePerShare: quote.effectivePrice,
        totalValue: quote.sbOut,
        slippagePercent: quote.slippagePercent,
        poolFee: quote.poolFee,
        burnFee: quote.burnFee,
      };
    } catch (error: any) {
      console.error("[AMM] Sell execution failed:", error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * Add liquidity to a pool
 * User must deposit shares + play money at current ratio
 */
export async function addLiquidity(
  playerId: string,
  userId: string,
  sharesToDeposit: number,
  playMoneyToDeposit: number
): Promise<AddLiquidityResult> {
  return await db.transaction(async (tx) => {
    try {
      // 1. Lock the pool row
      const [pool] = await tx
        .select()
        .from(playerPools)
        .where(eq(playerPools.playerId, playerId))
        .for("update");

      if (!pool) {
        return { success: false, error: "Pool not found" };
      }

      const poolData: Pool = {
        playerId: pool.playerId,
        shares: parseFloat(pool.shares),
        playMoney: parseFloat(pool.playMoney),
        k: parseFloat(pool.k),
        lpSharesTotal: parseFloat(pool.lpSharesTotal),
        feesAccumulated: parseFloat(pool.feesAccumulated),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      // 2. Validate ratio matches current price
      const expectedPlayMoney = sharesToDeposit * poolData.currentPrice;
      const ratioDiff = Math.abs(playMoneyToDeposit - expectedPlayMoney) / expectedPlayMoney;

      if (ratioDiff > 0.01) { // 1% tolerance
        return {
          success: false,
          error: `Deposit ratio must match current price. Expected $${expectedPlayMoney.toFixed(2)} play money for ${sharesToDeposit} shares`,
        };
      }

      // 3. Verify user has sufficient holdings
      const [userHolding] = await tx
        .select()
        .from(holdings)
        .where(and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, playerId)
        ));

      const userHoldingQuantity = parseFloat(userHolding?.quantity || "0");
      if (!userHolding || userHoldingQuantity < sharesToDeposit) {
        return { success: false, error: `Insufficient shares. Have ${userHoldingQuantity}, need ${sharesToDeposit}` };
      }

      // 4. Verify user has sufficient balance
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId));

      if (!user || parseFloat(user.balance) < playMoneyToDeposit) {
        return { success: false, error: `Insufficient balance. Need $${playMoneyToDeposit.toFixed(2)}` };
      }

      // 5. Calculate LP shares to mint
      // Formula: lp_shares = (shares_deposited / pool_shares) * lp_shares_total
      let lpSharesToMint: number;
      if (poolData.lpSharesTotal === 0) {
        // First liquidity provider gets 1:1 with shares deposited
        lpSharesToMint = sharesToDeposit;
      } else {
        lpSharesToMint = (sharesToDeposit / poolData.shares) * poolData.lpSharesTotal;
      }

      // 6. Update pool
      const newPoolShares = poolData.shares + sharesToDeposit;
      const newPoolPlayMoney = poolData.playMoney + playMoneyToDeposit;
      const newK = newPoolShares * newPoolPlayMoney; // Recalculate K to maintain invariant

      await tx
        .update(playerPools)
        .set({
          shares: newPoolShares.toFixed(2),
          playMoney: newPoolPlayMoney.toFixed(2),
          k: newK.toFixed(2),
          lpSharesTotal: (poolData.lpSharesTotal + lpSharesToMint).toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(playerPools.playerId, playerId));

      // 7. Deduct shares from user holdings
      const newQuantity = userHoldingQuantity - sharesToDeposit;
      if (newQuantity > 0.0001) {
        await tx
          .update(holdings)
          .set({
            quantity: newQuantity.toFixed(4),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, userHolding.id));
      } else {
        await tx.delete(holdings).where(eq(holdings.id, userHolding.id));
      }

      // 8. Deduct play money from user balance
      const newBalance = parseFloat(user.balance) - playMoneyToDeposit;
      await tx
        .update(users)
        .set({ balance: newBalance.toFixed(2) })
        .where(eq(users.id, userId));

      // 9. Create or update LP position
      const [existingPosition] = await tx
        .select()
        .from(lpPositions)
        .where(and(
          eq(lpPositions.userId, userId),
          eq(lpPositions.playerId, playerId)
        ));

      if (existingPosition) {
        await tx
          .update(lpPositions)
          .set({
            lpShares: (parseFloat(existingPosition.lpShares) + lpSharesToMint).toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(lpPositions.id, existingPosition.id));
      } else {
        await tx.insert(lpPositions).values({
          userId,
          playerId,
          lpShares: lpSharesToMint.toFixed(2),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // 10. Record transaction
      await tx.insert(lpTransactions).values({
        userId,
        playerId,
        transactionType: "add",
        lpShares: lpSharesToMint.toFixed(2),
        sharesAmount: sharesToDeposit.toFixed(2),
        playMoneyAmount: playMoneyToDeposit.toFixed(2),
        poolSharesBefore: poolData.shares.toFixed(2),
        poolPlayMoneyBefore: poolData.playMoney.toFixed(2),
        poolLpSharesTotalBefore: poolData.lpSharesTotal.toFixed(2),
        timestamp: new Date(),
      });

      // 11. Calculate ownership percentage
      const ownershipPercentage = lpSharesToMint / (poolData.lpSharesTotal + lpSharesToMint);

      return {
        success: true,
        lpSharesMinted: lpSharesToMint,
        sharesDeposited: sharesToDeposit,
        playMoneyDeposited: playMoneyToDeposit,
        ownershipPercentage,
      };
    } catch (error: any) {
      console.error("[AMM] Add liquidity failed:", error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * Remove liquidity from a pool
 * User receives shares + play money at current ratio
 */
export async function removeLiquidity(
  playerId: string,
  userId: string,
  lpSharesToRemove: number
): Promise<RemoveLiquidityResult> {
  return await db.transaction(async (tx) => {
    try {
      // 1. Lock pool and get LP position
      const [pool] = await tx
        .select()
        .from(playerPools)
        .where(eq(playerPools.playerId, playerId))
        .for("update");

      const [position] = await tx
        .select()
        .from(lpPositions)
        .where(and(
          eq(lpPositions.userId, userId),
          eq(lpPositions.playerId, playerId)
        ));

      if (!pool) {
        return { success: false, error: "Pool not found" };
      }

      if (!position || parseFloat(position.lpShares) < lpSharesToRemove) {
        return { success: false, error: "Insufficient LP shares" };
      }

      const poolData: Pool = {
        playerId: pool.playerId,
        shares: parseFloat(pool.shares),
        playMoney: parseFloat(pool.playMoney),
        k: parseFloat(pool.k),
        lpSharesTotal: parseFloat(pool.lpSharesTotal),
        feesAccumulated: parseFloat(pool.feesAccumulated),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      // 2. Calculate assets to return
      const ownershipPercentage = lpSharesToRemove / poolData.lpSharesTotal;
      const sharesToReturn = poolData.shares * ownershipPercentage;
      const playMoneyToReturn = poolData.playMoney * ownershipPercentage;

      // 3. Update pool
      const newPoolShares = poolData.shares - sharesToReturn;
      const newPoolPlayMoney = poolData.playMoney - playMoneyToReturn;
      const newLpSharesTotal = poolData.lpSharesTotal - lpSharesToRemove;
      const newK = newPoolShares * newPoolPlayMoney; // Recalculate K to maintain invariant

      // Validate pool state after removal
      if (newPoolShares <= 0 || newPoolPlayMoney <= 0) {
        return { success: false, error: "Cannot remove liquidity: would deplete pool" };
      }

      await tx
        .update(playerPools)
        .set({
          shares: newPoolShares.toFixed(2),
          playMoney: newPoolPlayMoney.toFixed(2),
          k: newK.toFixed(2),
          lpSharesTotal: newLpSharesTotal.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(playerPools.playerId, playerId));

      // 4. Burn LP shares
      const currentLpShares = parseFloat(position.lpShares);
      if (currentLpShares <= lpSharesToRemove) {
        await tx.delete(lpPositions).where(eq(lpPositions.id, position.id));
      } else {
        await tx
          .update(lpPositions)
          .set({
            lpShares: (currentLpShares - lpSharesToRemove).toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(lpPositions.id, position.id));
      }

      // 5. Add shares back to user holdings
      const [existingHolding] = await tx
        .select()
        .from(holdings)
        .where(and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, playerId)
        ));

      if (existingHolding) {
        const existingQuantity = parseFloat(existingHolding.quantity);
        await tx
          .update(holdings)
          .set({
            quantity: (existingQuantity + sharesToReturn).toFixed(4),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existingHolding.id));
      } else {
        await tx.insert(holdings).values({
          userId,
          assetType: "player",
          assetId: playerId,
          quantity: sharesToReturn.toFixed(4),
          avgCostBasis: poolData.currentPrice.toFixed(4),
          totalCostBasis: playMoneyToReturn.toFixed(2),
          lastUpdated: new Date(),
        });
      }

      // 6. Add play money to user balance
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId));

      if (user) {
        const newBalance = parseFloat(user.balance) + playMoneyToReturn;
        await tx
          .update(users)
          .set({ balance: newBalance.toFixed(2) })
          .where(eq(users.id, userId));
      }

      // 7. Record transaction
      await tx.insert(lpTransactions).values({
        userId,
        playerId,
        transactionType: "remove",
        lpShares: lpSharesToRemove.toFixed(2),
        sharesAmount: sharesToReturn.toFixed(2),
        playMoneyAmount: playMoneyToReturn.toFixed(2),
        poolSharesBefore: poolData.shares.toFixed(2),
        poolPlayMoneyBefore: poolData.playMoney.toFixed(2),
        poolLpSharesTotalBefore: poolData.lpSharesTotal.toFixed(2),
        timestamp: new Date(),
      });

      return {
        success: true,
        lpSharesBurned: lpSharesToRemove,
        sharesReceived: sharesToReturn,
        playMoneyReceived: playMoneyToReturn,
      };
    } catch (error: any) {
      console.error("[AMM] Remove liquidity failed:", error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * Get LP position for a user and player
 */
export async function getLpPosition(playerId: string, userId: string): Promise<LpPositionData | null> {
  const [position] = await db
    .select()
    .from(lpPositions)
    .where(and(
      eq(lpPositions.userId, userId),
      eq(lpPositions.playerId, playerId)
    ));

  if (!position) {
    return null;
  }

  const pool = await getPool(playerId);
  if (!pool) {
    return null;
  }

  const lpShares = parseFloat(position.lpShares);
  const ownershipPercentage = lpShares / pool.lpSharesTotal;

  return {
    userId: position.userId,
    playerId: position.playerId,
    lpShares,
    totalLpShares: pool.lpSharesTotal,
    ownershipPercentage,
    equivalentShares: pool.shares * ownershipPercentage,
    equivalentPlayMoney: pool.playMoney * ownershipPercentage,
    positionValue: (pool.shares * ownershipPercentage) * pool.currentPrice,
  };
}

/**
 * Get all LP positions for a user
 */
export async function getUserLpPositions(userId: string): Promise<LpPositionData[]> {
  const positions = await db
    .select()
    .from(lpPositions)
    .where(eq(lpPositions.userId, userId));

  const results: LpPositionData[] = [];

  for (const position of positions) {
    const pool = await getPool(position.playerId);
    if (!pool) continue;

    const lpShares = parseFloat(position.lpShares);
    const ownershipPercentage = lpShares / pool.lpSharesTotal;

    results.push({
      userId: position.userId,
      playerId: position.playerId,
      lpShares,
      totalLpShares: pool.lpSharesTotal,
      ownershipPercentage,
      equivalentShares: pool.shares * ownershipPercentage,
      equivalentPlayMoney: pool.playMoney * ownershipPercentage,
      positionValue: (pool.shares * ownershipPercentage) * pool.currentPrice,
    });
  }

  return results;
}

/**
 * Calculate LP boost bonus for a user
 * Returns 1 if user has >=1% ownership, 0 otherwise
 */
export async function calculateLpBoost(userId: string, playerId: string): Promise<number> {
  const position = await getLpPosition(playerId, userId);
  if (!position) return 0;

  return position.ownershipPercentage >= LP_BOOST_THRESHOLD ? 1 : 0;
}

/**
 * Get quote for buying shares with a specific SB amount
 */
export async function getBuyQuote(
  playerId: string,
  sbAmount: number
): Promise<BuyQuote | null> {
  const pool = await getPool(playerId);
  if (!pool) return null;
  return calculateBuyShares(pool, sbAmount);
}

/**
 * Get quote for selling a specific number of shares
 */
export async function getSellQuote(
  playerId: string,
  sharesAmount: number
): Promise<SellQuote | null> {
  const pool = await getPool(playerId);
  if (!pool) return null;
  return calculateSellShares(pool, sharesAmount);
}

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
import {
  playerPools,
  players,
  trades,
  holdings,
  users,
  lpPositions,
  lpTransactions,
} from "@shared/schema";
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

// Minimum holding threshold before deleting a position (prevents dust)
const MIN_HOLDING_THRESHOLD = 0.0001;

// Pool initialization constants - scaled for better liquidity
const INITIAL_POOL_SHARES = 50000; // 50,000 shares
const INITIAL_POOL_PLAY_MONEY = 500000; // $500,000
const INITIAL_POOL_PRICE = INITIAL_POOL_PLAY_MONEY / INITIAL_POOL_SHARES; // $10/share

// Market Maker configuration
const MARKET_MAKER_ID = "market_maker";
const MARKET_MAKER_USERNAME = "Sportfolio Market Maker";
const MARKET_MAKER_EMAIL = "marketmaker@system.sportfolio.internal";

export interface Pool {
  playerId: string;
  shares: number;
  playMoney: number;
  k: number;
  lpSharesTotal: number;
  feesAccumulated: number;
  feeGrowthPerLpShare: number;
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
  feesEarnedToDate: number;
}

export interface AddLiquidityResult {
  success: boolean;
  error?: string;
  lpSharesMinted?: number;
  sharesDeposited?: number;
  playMoneyDeposited?: number;
  ownershipPercentage?: number;
  sharesUnused?: number;
  playMoneyUnused?: number;
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
  const [pool] = await db.select().from(playerPools).where(eq(playerPools.playerId, playerId));

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
    feeGrowthPerLpShare: parseFloat((pool as any).feeGrowthPerLpShare || "0"),
    totalVolume: parseFloat(pool.totalVolume),
    totalTrades: pool.totalTrades,
    currentPrice: playMoney / shares,
  };
}

/**
 * Initialize a new pool for a player with default liquidity
 * Creates pool with market maker as initial LP (50,000 shares / $500,000)
 */
export async function initializePool(playerId: string): Promise<Pool> {
  console.log(`[AMM] Initializing pool for player ${playerId}`);

  try {
    // First ensure market maker exists
    await ensureMarketMakerExists();

    return await db.transaction(async (tx) => {
      // Create the pool
      const [newPool] = await tx
        .insert(playerPools)
        .values({
          playerId,
          shares: INITIAL_POOL_SHARES.toString(),
          playMoney: INITIAL_POOL_PLAY_MONEY.toString(),
          lpSharesTotal: INITIAL_POOL_SHARES.toString(),
          feesAccumulated: "0",
          feeGrowthPerLpShare: "0",
          totalVolume: "0",
          totalTrades: 0,
        })
        .onConflictDoNothing()
        .returning();

      if (!newPool) {
        // Pool already exists, fetch and return
        const existingPool = await getPool(playerId);
        if (existingPool) {
          return existingPool;
        }
        throw new Error(
          `Pool creation returned no data and pool does not exist for player ${playerId}`,
        );
      }

      console.log(
        `[AMM] Pool created for player ${playerId} with ${INITIAL_POOL_SHARES} shares / $${INITIAL_POOL_PLAY_MONEY}`,
      );

      // Create holding for market maker
      await tx.insert(holdings).values({
        userId: MARKET_MAKER_ID,
        assetType: "player",
        assetId: playerId,
        quantity: INITIAL_POOL_SHARES.toString(),
        power: 1,
        powerLevel: INITIAL_POOL_SHARES.toString(),
        avgCostBasis: INITIAL_POOL_PRICE.toString(),
        totalCostBasis: INITIAL_POOL_PLAY_MONEY.toString(),
      });

      // Deduct play money from market maker
      await tx
        .update(users)
        .set({
          balance: sql`${users.balance} - ${INITIAL_POOL_PLAY_MONEY.toString()}`,
        })
        .where(eq(users.id, MARKET_MAKER_ID));

      // Create LP position for market maker (100% ownership)
      await tx.insert(lpPositions).values({
        userId: MARKET_MAKER_ID,
        playerId,
        lpShares: INITIAL_POOL_SHARES.toString(),
      });

      // Record LP transaction
      await tx.insert(lpTransactions).values({
        userId: MARKET_MAKER_ID,
        playerId,
        transactionType: "add",
        sharesAmount: INITIAL_POOL_SHARES.toString(),
        playMoneyAmount: INITIAL_POOL_PLAY_MONEY.toString(),
        lpShares: INITIAL_POOL_SHARES.toString(),
        poolSharesBefore: "0",
        poolPlayMoneyBefore: "0",
        poolLpSharesTotalBefore: "0",
      });

      console.log(`[AMM] Market maker LP position created for ${playerId}`);

      return {
        playerId: newPool.playerId,
        shares: parseFloat(newPool.shares),
        playMoney: parseFloat(newPool.playMoney),
        k: parseFloat(newPool.k),
        lpSharesTotal: parseFloat(newPool.lpSharesTotal),
        feesAccumulated: parseFloat(newPool.feesAccumulated),
        feeGrowthPerLpShare: parseFloat((newPool as any).feeGrowthPerLpShare || "0"),
        totalVolume: parseFloat(newPool.totalVolume),
        totalTrades: newPool.totalTrades,
        currentPrice: parseFloat(newPool.playMoney) / parseFloat(newPool.shares),
      };
    });
  } catch (error: any) {
    console.error(`[AMM] Failed to initialize pool for player ${playerId}:`, error.message);
    if (error.message?.includes("foreign key") || error.message?.includes("violates foreign key")) {
      throw new Error(`Player ${playerId} does not exist in database`);
    }
    throw error;
  }
}

/**
 * Ensure market maker user exists in database
 * Creates if not exists with $500M starting balance
 */
export async function ensureMarketMakerExists(): Promise<void> {
  const existing = await db.select().from(users).where(eq(users.id, MARKET_MAKER_ID));

  if (existing.length === 0) {
    console.log(`[AMM] Creating market maker user: ${MARKET_MAKER_ID}`);
    await db.insert(users).values({
      id: MARKET_MAKER_ID,
      email: MARKET_MAKER_EMAIL,
      username: MARKET_MAKER_USERNAME,
      balance: "500000000", // $500M starting balance
      isBot: true,
      isAdmin: false,
    });
    console.log(`[AMM] Market maker created with $500M balance`);
  }
}

/**
 * Check if user is the market maker
 */
export function isMarketMaker(userId: string): boolean {
  return userId === MARKET_MAKER_ID;
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
  if (
    !currentShares ||
    currentShares <= 0 ||
    !currentPlayMoney ||
    currentPlayMoney <= 0 ||
    !k ||
    k <= 0
  ) {
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
  if (
    !currentShares ||
    currentShares <= 0 ||
    !currentPlayMoney ||
    currentPlayMoney <= 0 ||
    !k ||
    k <= 0
  ) {
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
  maxSlippage: number = MAX_SLIPPAGE_PERCENT,
): Promise<TradeResult> {
  console.log("[AMM] Executing buy for player:", playerId, "userId:", userId, "amount:", sbAmount);
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
        feeGrowthPerLpShare: parseFloat((pool as any).feeGrowthPerLpShare || "0"),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      // 2. Calculate trade details
      const rawQuote = calculateBuyShares(poolData, sbAmount);
      const sharesOutRounded = Math.floor(rawQuote.sharesOut);

      if (sharesOutRounded < 1) {
        return { success: false, error: "Trade too small: must buy at least 1 share" };
      }

      const targetNewShares = poolData.shares - sharesOutRounded;
      if (targetNewShares <= 0) {
        return { success: false, error: "Trade would deplete pool reserves" };
      }

      const targetNewPlayMoney = poolData.k / targetNewShares;
      const poolReceives = targetNewPlayMoney - poolData.playMoney;
      if (!isFinite(poolReceives) || poolReceives <= 0) {
        return { success: false, error: "Trade too large: invalid pool state" };
      }

      const adjustedSbAmount = poolReceives / (1 + POOL_FEE_PERCENT);
      if (adjustedSbAmount - sbAmount > 1e-6) {
        return { success: false, error: "Trade rounding requires more SB than requested" };
      }
      const poolFee = adjustedSbAmount * POOL_FEE_PERCENT;
      const burnFee = adjustedSbAmount * BURN_FEE_PERCENT;
      const totalCost = adjustedSbAmount + poolFee + burnFee;
      const effectivePrice = totalCost / sharesOutRounded;
      const currentPrice = poolData.playMoney / poolData.shares;
      const slippagePercent = (effectivePrice - currentPrice) / currentPrice;

      const quote: BuyQuote = {
        sharesOut: sharesOutRounded,
        effectivePrice,
        slippagePercent,
        newPoolPrice: targetNewPlayMoney / targetNewShares,
        totalCost,
        poolFee,
        burnFee,
      };

      // 3. Check slippage
      if (quote.slippagePercent > maxSlippage) {
        return {
          success: false,
          error: `Slippage too high: ${(quote.slippagePercent * 100).toFixed(2)}% (max: ${(maxSlippage * 100).toFixed(2)}%)`,
        };
      }

      // 4. Verify user has enough balance (total cost including fees)
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");

      if (!user) {
        return { success: false, error: "User not found" };
      }

      const userBalance = parseFloat(user.balance);
      if (userBalance < quote.totalCost) {
        return {
          success: false,
          error: `Insufficient balance. Need $${quote.totalCost.toFixed(2)} (includes ${(TOTAL_FEE_PERCENT * 100).toFixed(0)}% fees)`,
        };
      }

      // 5. Update pool state (pool receives SB + pool fee, burn fee is just not added)
      const newShares = poolData.shares - quote.sharesOut;
      const newPlayMoney = poolData.playMoney + adjustedSbAmount + quote.poolFee; // User SB + pool fee
      const newTotalVolume = poolData.totalVolume + adjustedSbAmount;
      const newFeesAccumulated = poolData.feesAccumulated + quote.poolFee;
      const feeGrowthDelta =
        poolData.lpSharesTotal > 0 ? quote.poolFee / poolData.lpSharesTotal : 0;
      const newFeeGrowthPerLpShare = poolData.feeGrowthPerLpShare + feeGrowthDelta;
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
          feeGrowthPerLpShare: newFeeGrowthPerLpShare.toFixed(12),
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

      // 7. Add shares to user holdings (rounded to whole numbers)
      const [existingHolding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, playerId),
          ),
        );

      if (existingHolding) {
        const currentQuantity = parseFloat(existingHolding.quantity);
        const newQuantity = currentQuantity + quote.sharesOut;
        const currentTotalCost = parseFloat(existingHolding.totalCostBasis);
        const newTotalCost = currentTotalCost + quote.totalCost;
        const newAvgCost = newTotalCost / newQuantity;
        const holdingPower = existingHolding.power || 1;

        await tx
          .update(holdings)
          .set({
            quantity: Math.round(newQuantity).toString(),
            powerLevel: (newQuantity * holdingPower).toFixed(2),
            avgCostBasis: newAvgCost.toFixed(4),
            totalCostBasis: newTotalCost.toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existingHolding.id));
      } else {
        const newQuantity = quote.sharesOut;
        await tx.insert(holdings).values({
          userId,
          assetType: "player",
          assetId: playerId,
          quantity: Math.round(newQuantity).toString(),
          power: 1,
          powerLevel: newQuantity.toFixed(2),
          avgCostBasis: quote.effectivePrice.toFixed(4),
          totalCostBasis: quote.totalCost.toFixed(2),
          lastUpdated: new Date(),
        });
      }

      // 8. Record trade
      const [trade] = await tx
        .insert(trades)
        .values({
          playerId,
          buyerId: userId,
          sellerId: "pool",
          buyOrderId: null,
          sellOrderId: null,
          quantity: quote.sharesOut.toString(),
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
          // volume24h is updated asynchronously as a true rolling 24h metric.
          // Keep a lightweight counter here for immediate UI feedback between refreshes.
          volume24h: sql`${players.volume24h} + ${quote.sharesOut}`,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, playerId));

      // 10. Broadcast updates
      broadcast({
        type: "trade",
        playerId,
        price: quote.newPoolPrice.toFixed(2),
        quantity: sharesOutRounded,
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
      if (
        quote.totalCost >= WHALE_ALERT_MIN_VALUE ||
        poolImpact >= WHALE_ALERT_POOL_IMPACT_PERCENT
      ) {
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
        sharesTraded: sharesOutRounded,
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
  maxSlippage: number = MAX_SLIPPAGE_PERCENT,
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
        feeGrowthPerLpShare: parseFloat((pool as any).feeGrowthPerLpShare || "0"),
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
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, playerId),
          ),
        );

      if (!holding) {
        return { success: false, error: "Insufficient shares" };
      }

      const holdingQuantity = parseFloat(holding.quantity);
      if (holdingQuantity < sharesAmount) {
        return { success: false, error: "Insufficient shares" };
      }

      // 5. Update pool state
      // Pool loses: sbOut - poolFee (pool fee stays in pool, burn fee is removed)
      const newShares = poolData.shares + sharesAmount;
      const newPlayMoney = poolData.playMoney - quote.sbOut + quote.poolFee;
      const newTotalVolume = poolData.totalVolume + quote.sbOut;
      const newFeesAccumulated = poolData.feesAccumulated + quote.poolFee;
      const feeGrowthDelta =
        poolData.lpSharesTotal > 0 ? quote.poolFee / poolData.lpSharesTotal : 0;
      const newFeeGrowthPerLpShare = poolData.feeGrowthPerLpShare + feeGrowthDelta;
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
          feeGrowthPerLpShare: newFeeGrowthPerLpShare.toFixed(12),
          totalVolume: newTotalVolume.toFixed(2),
          totalTrades: poolData.totalTrades + 1,
          updatedAt: new Date(),
        })
        .where(eq(playerPools.playerId, playerId));

      // 6. Deduct shares from user holdings
      const newQuantity = holdingQuantity - sharesAmount;
      if (newQuantity > MIN_HOLDING_THRESHOLD) {
        const holdingPower = holding.power || 1;
        await tx
          .update(holdings)
          .set({
            quantity: Math.round(newQuantity).toString(),
            powerLevel: (newQuantity * holdingPower).toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, holding.id));
      } else {
        await tx.delete(holdings).where(eq(holdings.id, holding.id));
      }

      // 7. Add SB to user balance (seller receives after fees)
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");

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
          quantity: Math.round(sharesAmount).toString(),
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
          // volume24h is updated asynchronously as a true rolling 24h metric.
          // Keep a lightweight counter here for immediate UI feedback between refreshes.
          volume24h: sql`${players.volume24h} + ${Math.round(sharesAmount)}`,
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

export interface ZapAddQuote {
  sharesIn: number;
  sharesSold: number;
  sbReceived: number;
  sharesDeposited: number;
  playMoneyDeposited: number;
  priceAfterSwap: number;
  estimatedLpSharesMinted: number;
  estimatedOwnershipPercentage: number;
}

export interface ZapAddQuoteSb {
  sbIn: number;
  sbSwapped: number;
  totalSwapCost: number;
  sharesBought: number;
  sharesDeposited: number;
  playMoneyDeposited: number;
  priceAfterSwap: number;
  estimatedLpSharesMinted: number;
  estimatedOwnershipPercentage: number;
}

export interface ZapAddLiquidityResult {
  success: boolean;
  error?: string;
  sharesIn?: number;
  sharesSold?: number;
  sbReceived?: number;
  sharesDeposited?: number;
  playMoneyDeposited?: number;
  lpSharesMinted?: number;
  ownershipPercentage?: number;
  priceAfterSwap?: number;
}

export interface ZapAddLiquidityResultSb {
  success: boolean;
  error?: string;
  sbIn?: number;
  sbSwapped?: number;
  totalSwapCost?: number;
  sharesBought?: number;
  sharesDeposited?: number;
  playMoneyDeposited?: number;
  lpSharesMinted?: number;
  ownershipPercentage?: number;
  priceAfterSwap?: number;
}

function findZapSellSharesForAllInDeposit(pool: Pool, totalSharesIn: number) {
  // Solve for s where:
  // sellerReceives(s) ~= (totalSharesIn - s) * priceAfterSell(s)
  // so the remaining shares can be paired with SB from the internal sell.
  if (!isFinite(totalSharesIn) || isNaN(totalSharesIn) || totalSharesIn <= 0) {
    throw new Error("Invalid sharesIn");
  }

  let low = 0;
  let high = totalSharesIn;

  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (mid <= 0) {
      low = mid;
      continue;
    }

    const quote = calculateSellShares(pool, mid);
    const priceAfter = quote.newPoolPrice;
    const expectedPlayMoney = (totalSharesIn - mid) * priceAfter;
    const f = quote.sellerReceives - expectedPlayMoney;

    if (f >= 0) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const sharesSold = high;
  const quote = calculateSellShares(pool, sharesSold);
  const priceAfterSwap = quote.newPoolPrice;
  const sharesDeposited = totalSharesIn - sharesSold;
  const playMoneyDeposited = sharesDeposited * priceAfterSwap;

  return {
    sharesSold,
    quote,
    priceAfterSwap,
    sharesDeposited,
    playMoneyDeposited,
  };
}

function findZapBuySbForAllInDeposit(pool: Pool, totalSbIn: number) {
  // Solve for sb such that:
  // remainingSb(sb) ~= sharesBought(sb) * priceAfterBuy(sb)
  // where remainingSb = totalSbIn - totalCost(sb)
  if (!isFinite(totalSbIn) || isNaN(totalSbIn) || totalSbIn <= 0) {
    throw new Error("Invalid sbIn");
  }

  const totalFeePercent = POOL_FEE_PERCENT + BURN_FEE_PERCENT;
  const maxSwapSb = totalSbIn / (1 + totalFeePercent);

  let low = 0;
  let high = maxSwapSb;

  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (mid <= 0) {
      low = mid;
      continue;
    }

    const quote = calculateBuyShares(pool, mid);
    const remainingSb = totalSbIn - quote.totalCost;
    const expectedRemainingSb = quote.sharesOut * quote.newPoolPrice;
    const f = remainingSb - expectedRemainingSb;

    // If we have too much SB left over, we swapped too little -> increase swap amount
    if (f >= 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const sbSwapped = low;
  const quote = calculateBuyShares(pool, sbSwapped);
  const priceAfterSwap = quote.newPoolPrice;
  const sharesDeposited = quote.sharesOut;
  const playMoneyDeposited = totalSbIn - quote.totalCost;

  return {
    sbSwapped,
    quote,
    priceAfterSwap,
    sharesDeposited,
    playMoneyDeposited,
  };
}

export async function getZapAddQuoteSharesOnly(
  playerId: string,
  userId: string,
  sharesIn: number,
): Promise<ZapAddQuote> {
  const pool = await getOrCreatePool(playerId);

  const holding = await db
    .select()
    .from(holdings)
    .where(
      and(
        eq(holdings.userId, userId),
        eq(holdings.assetType, "player"),
        eq(holdings.assetId, playerId),
      ),
    );

  const userShares = parseFloat(holding[0]?.quantity || "0");
  if (userShares < sharesIn) {
    throw new Error(`Insufficient shares. Have ${userShares}, need ${sharesIn}`);
  }

  const { sharesSold, quote, priceAfterSwap, sharesDeposited, playMoneyDeposited } =
    findZapSellSharesForAllInDeposit(pool, sharesIn);

  // Simulate pool after the internal sell (same math as executeSell)
  const postSellPoolShares = pool.shares + sharesSold;
  const postSellPoolPlayMoney = pool.playMoney - quote.sbOut + quote.poolFee;
  const postSellLpTotal = pool.lpSharesTotal;

  let estimatedLpSharesMinted: number;
  if (postSellLpTotal <= 0 || postSellPoolShares <= 0) {
    estimatedLpSharesMinted = sharesDeposited;
  } else {
    estimatedLpSharesMinted = (sharesDeposited / postSellPoolShares) * postSellLpTotal;
  }

  const estimatedOwnershipPercentage =
    estimatedLpSharesMinted / (postSellLpTotal + estimatedLpSharesMinted);

  return {
    sharesIn,
    sharesSold,
    sbReceived: quote.sellerReceives,
    sharesDeposited,
    playMoneyDeposited,
    priceAfterSwap,
    estimatedLpSharesMinted,
    estimatedOwnershipPercentage,
  };
}

export async function getZapAddQuoteSbOnly(
  playerId: string,
  userId: string,
  sbIn: number,
): Promise<ZapAddQuoteSb> {
  const pool = await getOrCreatePool(playerId);

  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (!user) {
    throw new Error("User not found");
  }

  const balance = parseFloat(user.balance);
  if (balance < sbIn) {
    throw new Error(`Insufficient balance. Have ${balance.toFixed(2)}, need ${sbIn.toFixed(2)}`);
  }

  const { sbSwapped, quote, priceAfterSwap, sharesDeposited, playMoneyDeposited } =
    findZapBuySbForAllInDeposit(pool, sbIn);

  // Simulate pool after the internal buy (same math as executeBuy)
  const postBuyPoolShares = pool.shares - quote.sharesOut;
  const postBuyPoolPlayMoney = pool.playMoney + sbSwapped + quote.poolFee;
  const postBuyLpTotal = pool.lpSharesTotal;

  let estimatedLpSharesMinted: number;
  if (postBuyLpTotal <= 0 || postBuyPoolShares <= 0) {
    estimatedLpSharesMinted = sharesDeposited;
  } else {
    estimatedLpSharesMinted = (sharesDeposited / postBuyPoolShares) * postBuyLpTotal;
  }

  const estimatedOwnershipPercentage =
    estimatedLpSharesMinted / (postBuyLpTotal + estimatedLpSharesMinted);

  return {
    sbIn,
    sbSwapped,
    totalSwapCost: quote.totalCost,
    sharesBought: quote.sharesOut,
    sharesDeposited,
    playMoneyDeposited,
    priceAfterSwap,
    estimatedLpSharesMinted,
    estimatedOwnershipPercentage,
  };
}

export async function zapAddLiquiditySharesOnly(
  playerId: string,
  userId: string,
  sharesIn: number,
): Promise<ZapAddLiquidityResult> {
  return await db.transaction(async (tx) => {
    try {
      // 1) Lock pool row
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
        feeGrowthPerLpShare: parseFloat((pool as any).feeGrowthPerLpShare || "0"),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      // 2) Verify user holding
      const [holding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, playerId),
          ),
        );

      const holdingQty = parseFloat(holding?.quantity || "0");
      if (!holding || holdingQty < sharesIn) {
        return { success: false, error: "Insufficient shares" };
      }

      // 3) Compute zap split
      const split = findZapSellSharesForAllInDeposit(poolData, sharesIn);
      const sharesSold = split.sharesSold;
      const sellQuote = split.quote;
      const priceAfterSwap = split.priceAfterSwap;
      const sharesDeposited = split.sharesDeposited;
      const playMoneyDeposited = split.playMoneyDeposited;

      if (sharesSold <= 0 || sharesDeposited <= 0 || playMoneyDeposited <= 0) {
        return { success: false, error: "Zap amount too small" };
      }

      // 4) Apply the internal sell (same logic as executeSell)
      const poolSharesAfterSell = poolData.shares + sharesSold;
      const poolPlayMoneyAfterSell = poolData.playMoney - sellQuote.sbOut + sellQuote.poolFee;
      const poolFeesAfterSell = poolData.feesAccumulated + sellQuote.poolFee;
      const feeGrowthDelta =
        poolData.lpSharesTotal > 0 ? sellQuote.poolFee / poolData.lpSharesTotal : 0;
      const poolFeeGrowthAfterSell = poolData.feeGrowthPerLpShare + feeGrowthDelta;
      const poolVolumeAfterSell = poolData.totalVolume + sellQuote.sbOut;
      const kAfterSell = poolSharesAfterSell * poolPlayMoneyAfterSell;

      if (poolSharesAfterSell <= 0 || poolPlayMoneyAfterSell <= 0) {
        return { success: false, error: "Swap would deplete pool" };
      }

      await tx
        .update(playerPools)
        .set({
          shares: poolSharesAfterSell.toFixed(2),
          playMoney: poolPlayMoneyAfterSell.toFixed(2),
          k: kAfterSell.toFixed(2),
          feesAccumulated: poolFeesAfterSell.toFixed(2),
          feeGrowthPerLpShare: poolFeeGrowthAfterSell.toFixed(12),
          totalVolume: poolVolumeAfterSell.toFixed(2),
          totalTrades: poolData.totalTrades + 1,
          updatedAt: new Date(),
        })
        .where(eq(playerPools.playerId, playerId));

      // Deduct sold shares from holding
      const qtyAfterSell = holdingQty - sharesSold;
      if (qtyAfterSell < sharesDeposited - 0.0001) {
        return { success: false, error: "Insufficient shares after swap" };
      }

      // 5) Credit user SB from the sell
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");

      if (!user) {
        return { success: false, error: "User not found" };
      }

      const balanceAfterSell = parseFloat(user.balance) + sellQuote.sellerReceives;

      // 6) Record the trade
      const [trade] = await tx
        .insert(trades)
        .values({
          playerId,
          buyerId: "pool",
          sellerId: userId,
          buyOrderId: null,
          sellOrderId: null,
          quantity: Math.round(sharesSold).toString(),
          price: sellQuote.effectivePrice.toFixed(2),
          executedAt: new Date(),
        })
        .returning();

      await tx
        .update(players)
        .set({
          lastTradePrice: priceAfterSwap.toFixed(2),
          currentPrice: priceAfterSwap.toFixed(2),
          // volume24h is updated asynchronously as a true rolling 24h metric.
          // Keep a lightweight counter here for immediate UI feedback between refreshes.
          volume24h: sql`${players.volume24h} + ${Math.round(sharesSold)}`,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, playerId));

      // 7) Now add liquidity at the post-swap ratio
      const expectedPlayMoney = sharesDeposited * priceAfterSwap;
      const ratioDiff = Math.abs(playMoneyDeposited - expectedPlayMoney) / expectedPlayMoney;
      if (ratioDiff > 0.01) {
        return { success: false, error: "Zap deposit ratio mismatch" };
      }

      // Ensure user has SB to deposit
      if (balanceAfterSell < playMoneyDeposited) {
        return { success: false, error: "Insufficient balance for liquidity deposit" };
      }

      // Calculate LP shares to mint against the post-sell pool state
      const lpTotalBefore = poolData.lpSharesTotal;
      let lpSharesToMint: number;
      if (lpTotalBefore <= 0 || poolSharesAfterSell <= 0) {
        lpSharesToMint = sharesDeposited;
      } else {
        lpSharesToMint = (sharesDeposited / poolSharesAfterSell) * lpTotalBefore;
      }

      const poolSharesAfterAdd = poolSharesAfterSell + sharesDeposited;
      const poolPlayMoneyAfterAdd = poolPlayMoneyAfterSell + playMoneyDeposited;
      const lpTotalAfterAdd = lpTotalBefore + lpSharesToMint;
      const kAfterAdd = poolSharesAfterAdd * poolPlayMoneyAfterAdd;

      await tx
        .update(playerPools)
        .set({
          shares: poolSharesAfterAdd.toFixed(2),
          playMoney: poolPlayMoneyAfterAdd.toFixed(2),
          k: kAfterAdd.toFixed(2),
          lpSharesTotal: lpTotalAfterAdd.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(playerPools.playerId, playerId));

      // Update holding after depositing remaining shares (may drop below threshold)
      const qtyAfterAdd = qtyAfterSell - sharesDeposited;
      if (qtyAfterAdd > MIN_HOLDING_THRESHOLD) {
        const holdingPower = holding.power || 1;
        await tx
          .update(holdings)
          .set({
            quantity: Math.round(qtyAfterAdd).toString(),
            powerLevel: (qtyAfterAdd * holdingPower).toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, holding.id));
      } else {
        await tx.delete(holdings).where(eq(holdings.id, holding.id));
      }

      // Update user balance after deposit
      const balanceAfterAdd = balanceAfterSell - playMoneyDeposited;
      await tx
        .update(users)
        .set({ balance: balanceAfterAdd.toFixed(2) })
        .where(eq(users.id, userId));

      // Create/update LP position
      const [existingPosition] = await tx
        .select()
        .from(lpPositions)
        .where(and(eq(lpPositions.userId, userId), eq(lpPositions.playerId, playerId)));

      if (existingPosition) {
        const posLpShares = parseFloat(existingPosition.lpShares);
        const posSnapshot = parseFloat((existingPosition as any).feeGrowthSnapshot || "0");
        const posFeesTotal = parseFloat((existingPosition as any).feesEarnedTotal || "0");
        const pendingFees = (poolFeeGrowthAfterSell - posSnapshot) * posLpShares;
        const newFeesTotal = posFeesTotal + pendingFees;

        await tx
          .update(lpPositions)
          .set({
            lpShares: (parseFloat(existingPosition.lpShares) + lpSharesToMint).toFixed(2),
            feeGrowthSnapshot: poolFeeGrowthAfterSell.toFixed(12),
            feesEarnedTotal: newFeesTotal.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(lpPositions.id, existingPosition.id));
      } else {
        await tx.insert(lpPositions).values({
          userId,
          playerId,
          lpShares: lpSharesToMint.toFixed(2),
          feeGrowthSnapshot: poolFeeGrowthAfterSell.toFixed(12),
          feesEarnedTotal: "0",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      await tx.insert(lpTransactions).values({
        userId,
        playerId,
        transactionType: "add",
        lpShares: lpSharesToMint.toFixed(2),
        sharesAmount: sharesDeposited.toFixed(2),
        playMoneyAmount: playMoneyDeposited.toFixed(2),
        poolSharesBefore: poolSharesAfterSell.toFixed(2),
        poolPlayMoneyBefore: poolPlayMoneyAfterSell.toFixed(2),
        poolLpSharesTotalBefore: lpTotalBefore.toFixed(2),
        timestamp: new Date(),
      });

      const ownershipPercentage = lpSharesToMint / (lpTotalBefore + lpSharesToMint);

      broadcast({
        type: "trade",
        playerId,
        price: priceAfterSwap.toFixed(2),
        quantity: sharesSold,
        buyerId: "pool",
        sellerId: userId,
      });
      broadcast({
        type: "portfolio",
        userId,
        balance: balanceAfterAdd.toFixed(2),
      });
      broadcast({ type: "marketActivity" });

      return {
        success: true,
        sharesIn,
        sharesSold,
        sbReceived: sellQuote.sellerReceives,
        sharesDeposited,
        playMoneyDeposited,
        lpSharesMinted: lpSharesToMint,
        ownershipPercentage,
        priceAfterSwap,
      };
    } catch (error: any) {
      console.error("[AMM] Zap add liquidity failed:", error);
      return { success: false, error: error.message };
    }
  });
}

export async function zapAddLiquiditySbOnly(
  playerId: string,
  userId: string,
  sbIn: number,
): Promise<ZapAddLiquidityResultSb> {
  return await db.transaction(async (tx) => {
    try {
      // 1) Lock pool row
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
        feeGrowthPerLpShare: parseFloat((pool as any).feeGrowthPerLpShare || "0"),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      // 2) Lock user balance
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");

      if (!user) {
        return { success: false, error: "User not found" };
      }

      const userBalance = parseFloat(user.balance);
      if (userBalance < sbIn) {
        return { success: false, error: "Insufficient balance" };
      }

      // 3) Compute zap split
      const split = findZapBuySbForAllInDeposit(poolData, sbIn);
      const sbSwapped = split.sbSwapped;
      const buyQuote = split.quote;
      const priceAfterSwap = split.priceAfterSwap;
      const sharesDeposited = split.sharesDeposited;
      const playMoneyDeposited = split.playMoneyDeposited;

      if (sbSwapped <= 0 || sharesDeposited <= 0 || playMoneyDeposited <= 0) {
        return { success: false, error: "Zap amount too small" };
      }

      // 4) Apply the internal buy (same logic as executeBuy)
      const poolSharesAfterBuy = poolData.shares - buyQuote.sharesOut;
      const poolPlayMoneyAfterBuy = poolData.playMoney + sbSwapped + buyQuote.poolFee;
      const poolFeesAfterBuy = poolData.feesAccumulated + buyQuote.poolFee;
      const feeGrowthDelta =
        poolData.lpSharesTotal > 0 ? buyQuote.poolFee / poolData.lpSharesTotal : 0;
      const poolFeeGrowthAfterBuy = poolData.feeGrowthPerLpShare + feeGrowthDelta;
      const poolVolumeAfterBuy = poolData.totalVolume + sbSwapped;
      const kAfterBuy = poolSharesAfterBuy * poolPlayMoneyAfterBuy;

      if (poolSharesAfterBuy <= 0 || poolPlayMoneyAfterBuy <= 0) {
        return { success: false, error: "Swap would deplete pool" };
      }

      await tx
        .update(playerPools)
        .set({
          shares: poolSharesAfterBuy.toFixed(2),
          playMoney: poolPlayMoneyAfterBuy.toFixed(2),
          k: kAfterBuy.toFixed(2),
          feesAccumulated: poolFeesAfterBuy.toFixed(2),
          feeGrowthPerLpShare: poolFeeGrowthAfterBuy.toFixed(12),
          totalVolume: poolVolumeAfterBuy.toFixed(2),
          totalTrades: poolData.totalTrades + 1,
          updatedAt: new Date(),
        })
        .where(eq(playerPools.playerId, playerId));

      // 5) Record trade (user buys from pool)
      await tx.insert(trades).values({
        playerId,
        buyerId: userId,
        sellerId: "pool",
        buyOrderId: null,
        sellOrderId: null,
        quantity: Math.round(buyQuote.sharesOut).toString(),
        price: buyQuote.effectivePrice.toFixed(2),
        executedAt: new Date(),
      });

      await tx
        .update(players)
        .set({
          lastTradePrice: priceAfterSwap.toFixed(2),
          currentPrice: priceAfterSwap.toFixed(2),
          // volume24h is updated asynchronously as a true rolling 24h metric.
          volume24h: sql`${players.volume24h} + ${Math.round(buyQuote.sharesOut)}`,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, playerId));

      // 6) Check deposit ratio vs post-buy price
      const expectedPlayMoney = sharesDeposited * priceAfterSwap;
      const ratioDiff = Math.abs(playMoneyDeposited - expectedPlayMoney) / expectedPlayMoney;
      if (ratioDiff > 0.01) {
        return { success: false, error: "Zap deposit ratio mismatch" };
      }

      // 7) Add liquidity at the post-buy ratio
      const lpTotalBefore = poolData.lpSharesTotal;
      let lpSharesToMint: number;
      if (lpTotalBefore <= 0 || poolSharesAfterBuy <= 0) {
        lpSharesToMint = sharesDeposited;
      } else {
        lpSharesToMint = (sharesDeposited / poolSharesAfterBuy) * lpTotalBefore;
      }

      const poolSharesAfterAdd = poolSharesAfterBuy + sharesDeposited;
      const poolPlayMoneyAfterAdd = poolPlayMoneyAfterBuy + playMoneyDeposited;
      const lpTotalAfterAdd = lpTotalBefore + lpSharesToMint;
      const kAfterAdd = poolSharesAfterAdd * poolPlayMoneyAfterAdd;

      await tx
        .update(playerPools)
        .set({
          shares: poolSharesAfterAdd.toFixed(2),
          playMoney: poolPlayMoneyAfterAdd.toFixed(2),
          k: kAfterAdd.toFixed(2),
          lpSharesTotal: lpTotalAfterAdd.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(playerPools.playerId, playerId));

      // 8) Deduct user SB (swap + deposit)
      const newBalance = userBalance - sbIn;
      await tx
        .update(users)
        .set({ balance: newBalance.toFixed(2) })
        .where(eq(users.id, userId));

      // 9) Create/update LP position
      const [existingPosition] = await tx
        .select()
        .from(lpPositions)
        .where(and(eq(lpPositions.userId, userId), eq(lpPositions.playerId, playerId)));

      if (existingPosition) {
        const posLpShares = parseFloat(existingPosition.lpShares);
        const posSnapshot = parseFloat((existingPosition as any).feeGrowthSnapshot || "0");
        const posFeesTotal = parseFloat((existingPosition as any).feesEarnedTotal || "0");
        const pendingFees = (poolFeeGrowthAfterBuy - posSnapshot) * posLpShares;
        const newFeesTotal = posFeesTotal + pendingFees;

        await tx
          .update(lpPositions)
          .set({
            lpShares: (parseFloat(existingPosition.lpShares) + lpSharesToMint).toFixed(2),
            feeGrowthSnapshot: poolFeeGrowthAfterBuy.toFixed(12),
            feesEarnedTotal: newFeesTotal.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(lpPositions.id, existingPosition.id));
      } else {
        await tx.insert(lpPositions).values({
          userId,
          playerId,
          lpShares: lpSharesToMint.toFixed(2),
          feeGrowthSnapshot: poolFeeGrowthAfterBuy.toFixed(12),
          feesEarnedTotal: "0",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      await tx.insert(lpTransactions).values({
        userId,
        playerId,
        transactionType: "add",
        lpShares: lpSharesToMint.toFixed(2),
        sharesAmount: sharesDeposited.toFixed(2),
        playMoneyAmount: playMoneyDeposited.toFixed(2),
        poolSharesBefore: poolSharesAfterBuy.toFixed(2),
        poolPlayMoneyBefore: poolPlayMoneyAfterBuy.toFixed(2),
        poolLpSharesTotalBefore: lpTotalBefore.toFixed(2),
        timestamp: new Date(),
      });

      const ownershipPercentage = lpSharesToMint / (lpTotalBefore + lpSharesToMint);

      broadcast({
        type: "trade",
        playerId,
        price: priceAfterSwap.toFixed(2),
        quantity: buyQuote.sharesOut,
        buyerId: userId,
        sellerId: "pool",
      });
      broadcast({ type: "portfolio", userId, balance: newBalance.toFixed(2) });
      broadcast({ type: "marketActivity" });

      return {
        success: true,
        sbIn,
        sbSwapped,
        totalSwapCost: buyQuote.totalCost,
        sharesBought: buyQuote.sharesOut,
        sharesDeposited,
        playMoneyDeposited,
        lpSharesMinted: lpSharesToMint,
        ownershipPercentage,
        priceAfterSwap,
      };
    } catch (error: any) {
      console.error("[AMM] Zap add liquidity (SB) failed:", error);
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
  playMoneyToDeposit: number,
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
        feeGrowthPerLpShare: parseFloat((pool as any).feeGrowthPerLpShare || "0"),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      // 2. Validate ratio matches current price
      const expectedPlayMoney = sharesToDeposit * poolData.currentPrice;
      const ratioDiff = Math.abs(playMoneyToDeposit - expectedPlayMoney) / expectedPlayMoney;

      if (ratioDiff > 0.01) {
        // 1% tolerance
        return {
          success: false,
          error: `Deposit ratio must match current price. Expected $${expectedPlayMoney.toFixed(2)} play money for ${sharesToDeposit} shares`,
        };
      }

      // 3. Verify user has sufficient holdings
      const [userHolding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, playerId),
          ),
        );

      const userHoldingQuantity = parseFloat(userHolding?.quantity || "0");
      if (!userHolding || userHoldingQuantity < sharesToDeposit) {
        return {
          success: false,
          error: `Insufficient shares. Have ${userHoldingQuantity}, need ${sharesToDeposit}`,
        };
      }

      // 4. Verify user has sufficient balance
      const [user] = await tx.select().from(users).where(eq(users.id, userId));

      if (!user || parseFloat(user.balance) < playMoneyToDeposit) {
        return {
          success: false,
          error: `Insufficient balance. Need $${playMoneyToDeposit.toFixed(2)}`,
        };
      }

      // 5. Calculate LP shares to mint
      // Formula: lp_shares = (shares_deposited / pool_shares) * lp_shares_total
      let lpSharesToMint: number;
      if (poolData.lpSharesTotal <= 0 || poolData.shares <= 0) {
        // First liquidity provider or edge case: 1:1 with shares deposited
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
      if (newQuantity > MIN_HOLDING_THRESHOLD) {
        const holdingPower = userHolding.power || 1;
        await tx
          .update(holdings)
          .set({
            quantity: Math.round(newQuantity).toString(),
            powerLevel: (newQuantity * holdingPower).toFixed(2),
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

      // 9. Create or update LP position (with fee accounting)
      const [existingPosition] = await tx
        .select()
        .from(lpPositions)
        .where(and(eq(lpPositions.userId, userId), eq(lpPositions.playerId, playerId)));

      if (existingPosition) {
        // Realize pending fees before adding new LP shares
        const posLpShares = parseFloat(existingPosition.lpShares);
        const posSnapshot = parseFloat((existingPosition as any).feeGrowthSnapshot || "0");
        const posFeesTotal = parseFloat((existingPosition as any).feesEarnedTotal || "0");
        const pendingFees = (poolData.feeGrowthPerLpShare - posSnapshot) * posLpShares;
        const newFeesTotal = posFeesTotal + pendingFees;

        await tx
          .update(lpPositions)
          .set({
            lpShares: (posLpShares + lpSharesToMint).toFixed(2),
            feeGrowthSnapshot: poolData.feeGrowthPerLpShare.toFixed(12),
            feesEarnedTotal: newFeesTotal.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(lpPositions.id, existingPosition.id));
      } else {
        // New position starts tracking fees from current growth level
        await tx.insert(lpPositions).values({
          userId,
          playerId,
          lpShares: lpSharesToMint.toFixed(2),
          feeGrowthSnapshot: poolData.feeGrowthPerLpShare.toFixed(12),
          feesEarnedTotal: "0",
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
  lpSharesToRemove: number,
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
        .where(and(eq(lpPositions.userId, userId), eq(lpPositions.playerId, playerId)));

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
        feeGrowthPerLpShare: parseFloat((pool as any).feeGrowthPerLpShare || "0"),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      // 2. Calculate assets to return
      // Guard against division by zero
      if (poolData.lpSharesTotal <= 0) {
        return { success: false, error: "Pool has no LP shares" };
      }
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
      const posSnapshot = parseFloat((position as any).feeGrowthSnapshot || "0");
      const posFeesTotal = parseFloat((position as any).feesEarnedTotal || "0");
      const pendingFees = (poolData.feeGrowthPerLpShare - posSnapshot) * currentLpShares;
      const newFeesTotal = posFeesTotal + pendingFees;
      if (currentLpShares <= lpSharesToRemove) {
        await tx.delete(lpPositions).where(eq(lpPositions.id, position.id));
      } else {
        await tx
          .update(lpPositions)
          .set({
            lpShares: (currentLpShares - lpSharesToRemove).toFixed(2),
            feeGrowthSnapshot: poolData.feeGrowthPerLpShare.toFixed(12),
            feesEarnedTotal: newFeesTotal.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(lpPositions.id, position.id));
      }

      // 5. Add shares back to user holdings
      const [existingHolding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, playerId),
          ),
        );

      if (existingHolding) {
        const existingQuantity = parseFloat(existingHolding.quantity);
        const newQuantity = existingQuantity + sharesToReturn;
        const holdingPower = existingHolding.power || 1;
        await tx
          .update(holdings)
          .set({
            quantity: Math.round(newQuantity).toString(),
            powerLevel: (newQuantity * holdingPower).toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existingHolding.id));
      } else {
        await tx.insert(holdings).values({
          userId,
          assetType: "player",
          assetId: playerId,
          quantity: Math.round(sharesToReturn).toString(),
          power: 1,
          powerLevel: sharesToReturn.toFixed(2),
          avgCostBasis: poolData.currentPrice.toFixed(4),
          totalCostBasis: playMoneyToReturn.toFixed(2),
          lastUpdated: new Date(),
        });
      }

      // 6. Add play money to user balance
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");

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
export async function getLpPosition(
  playerId: string,
  userId: string,
): Promise<LpPositionData | null> {
  const [position] = await db
    .select()
    .from(lpPositions)
    .where(and(eq(lpPositions.userId, userId), eq(lpPositions.playerId, playerId)));

  if (!position) {
    return null;
  }

  const pool = await getPool(playerId);
  if (!pool) {
    return null;
  }

  const lpShares = parseFloat(position.lpShares);
  // Guard against division by zero
  const ownershipPercentage = pool.lpSharesTotal > 0 ? lpShares / pool.lpSharesTotal : 0;

  const feeGrowthSnapshot = parseFloat((position as any).feeGrowthSnapshot || "0");
  const feesEarnedTotal = parseFloat((position as any).feesEarnedTotal || "0");
  const pendingFees = (pool.feeGrowthPerLpShare - feeGrowthSnapshot) * lpShares;
  const feesEarnedToDate = feesEarnedTotal + pendingFees;

  const equivalentShares = pool.shares * ownershipPercentage;
  const equivalentPlayMoney = pool.playMoney * ownershipPercentage;
  const positionValue = equivalentShares * pool.currentPrice + equivalentPlayMoney;

  return {
    userId: position.userId,
    playerId: position.playerId,
    lpShares,
    totalLpShares: pool.lpSharesTotal,
    ownershipPercentage,
    equivalentShares,
    equivalentPlayMoney,
    positionValue,
    feesEarnedToDate,
  };
}

/**
 * Add liquidity using up-to amounts.
 * Computes the optimal ratio at execution time and deposits <= maxShares and <= maxPlayMoney.
 * Any unused portion remains in the user's wallet.
 */
export async function addLiquidityOptimal(
  playerId: string,
  userId: string,
  maxShares: number,
  maxPlayMoney: number,
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
        feeGrowthPerLpShare: parseFloat((pool as any).feeGrowthPerLpShare || "0"),
        totalVolume: parseFloat(pool.totalVolume),
        totalTrades: pool.totalTrades,
        currentPrice: parseFloat(pool.playMoney) / parseFloat(pool.shares),
      };

      if (!isFinite(maxShares) || isNaN(maxShares) || maxShares <= 0) {
        return { success: false, error: "Invalid max shares amount" };
      }
      if (!isFinite(maxPlayMoney) || isNaN(maxPlayMoney) || maxPlayMoney <= 0) {
        return { success: false, error: "Invalid max play money amount" };
      }

      // 2. Compute optimal deposit amounts at current ratio
      const sharesToDeposit = Math.min(maxShares, maxPlayMoney / poolData.currentPrice);
      const playMoneyToDeposit = sharesToDeposit * poolData.currentPrice;

      if (sharesToDeposit <= 0 || playMoneyToDeposit <= 0) {
        return { success: false, error: "Deposit too small" };
      }

      const sharesUnused = Math.max(0, maxShares - sharesToDeposit);
      const playMoneyUnused = Math.max(0, maxPlayMoney - playMoneyToDeposit);

      // 3. Verify user has sufficient holdings
      const [userHolding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, playerId),
          ),
        );

      const userHoldingQuantity = parseFloat(userHolding?.quantity || "0");
      if (!userHolding || userHoldingQuantity < sharesToDeposit) {
        return {
          success: false,
          error: `Insufficient shares. Have ${userHoldingQuantity}, need ${sharesToDeposit}`,
        };
      }

      // 4. Verify user has sufficient balance
      const [user] = await tx.select().from(users).where(eq(users.id, userId));

      if (!user || parseFloat(user.balance) < playMoneyToDeposit) {
        return {
          success: false,
          error: `Insufficient balance. Need $${playMoneyToDeposit.toFixed(2)}`,
        };
      }

      // 5. Calculate LP shares to mint
      let lpSharesToMint: number;
      if (poolData.lpSharesTotal <= 0 || poolData.shares <= 0) {
        lpSharesToMint = sharesToDeposit;
      } else {
        lpSharesToMint = (sharesToDeposit / poolData.shares) * poolData.lpSharesTotal;
      }

      // 6. Update pool
      const newPoolShares = poolData.shares + sharesToDeposit;
      const newPoolPlayMoney = poolData.playMoney + playMoneyToDeposit;
      const newK = newPoolShares * newPoolPlayMoney;

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
      if (newQuantity > MIN_HOLDING_THRESHOLD) {
        const holdingPower = userHolding.power || 1;
        await tx
          .update(holdings)
          .set({
            quantity: Math.round(newQuantity).toString(),
            powerLevel: (newQuantity * holdingPower).toFixed(2),
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

      // 9. Create or update LP position (with fee accounting)
      const [existingPosition] = await tx
        .select()
        .from(lpPositions)
        .where(and(eq(lpPositions.userId, userId), eq(lpPositions.playerId, playerId)));

      if (existingPosition) {
        const posLpShares = parseFloat(existingPosition.lpShares);
        const posSnapshot = parseFloat((existingPosition as any).feeGrowthSnapshot || "0");
        const posFeesTotal = parseFloat((existingPosition as any).feesEarnedTotal || "0");
        const pendingFees = (poolData.feeGrowthPerLpShare - posSnapshot) * posLpShares;
        const newFeesTotal = posFeesTotal + pendingFees;

        await tx
          .update(lpPositions)
          .set({
            lpShares: (posLpShares + lpSharesToMint).toFixed(2),
            feeGrowthSnapshot: poolData.feeGrowthPerLpShare.toFixed(12),
            feesEarnedTotal: newFeesTotal.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(lpPositions.id, existingPosition.id));
      } else {
        await tx.insert(lpPositions).values({
          userId,
          playerId,
          lpShares: lpSharesToMint.toFixed(2),
          feeGrowthSnapshot: poolData.feeGrowthPerLpShare.toFixed(12),
          feesEarnedTotal: "0",
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

      const ownershipPercentage = lpSharesToMint / (poolData.lpSharesTotal + lpSharesToMint);

      return {
        success: true,
        lpSharesMinted: lpSharesToMint,
        sharesDeposited: sharesToDeposit,
        playMoneyDeposited: playMoneyToDeposit,
        ownershipPercentage,
        sharesUnused,
        playMoneyUnused,
      };
    } catch (error: any) {
      console.error("[AMM] Add liquidity (optimal) failed:", error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * Get all LP positions for a user
 * Optimized to batch fetch pools in a single query
 */
export async function getUserLpPositions(userId: string): Promise<LpPositionData[]> {
  const positions = await db.select().from(lpPositions).where(eq(lpPositions.userId, userId));

  if (positions.length === 0) {
    return [];
  }

  // Batch fetch all pools in a single query to avoid N+1
  const playerIds = positions.map((p) => p.playerId);
  const pools = await db
    .select()
    .from(playerPools)
    .where(
      sql`${playerPools.playerId} IN (${sql.join(
        playerIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );

  // Create a lookup map for O(1) access
  const poolMap = new Map<string, Pool>();
  for (const pool of pools) {
    const shares = parseFloat(pool.shares);
    const playMoney = parseFloat(pool.playMoney);
    poolMap.set(pool.playerId, {
      playerId: pool.playerId,
      shares,
      playMoney,
      k: parseFloat(pool.k),
      lpSharesTotal: parseFloat(pool.lpSharesTotal),
      feesAccumulated: parseFloat(pool.feesAccumulated),
      feeGrowthPerLpShare: parseFloat((pool as any).feeGrowthPerLpShare || "0"),
      totalVolume: parseFloat(pool.totalVolume),
      totalTrades: pool.totalTrades,
      currentPrice: playMoney / shares,
    });
  }

  const results: LpPositionData[] = [];

  for (const position of positions) {
    const pool = poolMap.get(position.playerId);
    if (!pool) continue;

    const lpShares = parseFloat(position.lpShares);
    // Guard against division by zero
    const ownershipPercentage = pool.lpSharesTotal > 0 ? lpShares / pool.lpSharesTotal : 0;

    const feeGrowthSnapshot = parseFloat((position as any).feeGrowthSnapshot || "0");
    const feesEarnedTotal = parseFloat((position as any).feesEarnedTotal || "0");
    const pendingFees = (pool.feeGrowthPerLpShare - feeGrowthSnapshot) * lpShares;
    const feesEarnedToDate = feesEarnedTotal + pendingFees;

    const equivalentShares = pool.shares * ownershipPercentage;
    const equivalentPlayMoney = pool.playMoney * ownershipPercentage;
    const positionValue = equivalentShares * pool.currentPrice + equivalentPlayMoney;

    results.push({
      userId: position.userId,
      playerId: position.playerId,
      lpShares,
      totalLpShares: pool.lpSharesTotal,
      ownershipPercentage,
      equivalentShares,
      equivalentPlayMoney,
      positionValue,
      feesEarnedToDate,
    });
  }

  return results;
}

/**
 * Calculate LP boost bonus for a user
 * Returns 1 if user has >=1% ownership, 0 otherwise
 */
export async function calculateLpBoost(userId: string, playerId: string): Promise<number> {
  // Market maker never gets LP boost
  if (isMarketMaker(userId)) return 0;

  const position = await getLpPosition(playerId, userId);
  if (!position) return 0;

  return position.ownershipPercentage >= LP_BOOST_THRESHOLD ? 1 : 0;
}

/**
 * Get quote for buying shares with a specific SB amount
 */
export async function getBuyQuote(playerId: string, sbAmount: number): Promise<BuyQuote | null> {
  const pool = await getPool(playerId);
  if (!pool) return null;
  return calculateBuyShares(pool, sbAmount);
}

/**
 * Get quote for selling a specific number of shares
 */
export async function getSellQuote(
  playerId: string,
  sharesAmount: number,
): Promise<SellQuote | null> {
  const pool = await getPool(playerId);
  if (!pool) return null;
  return calculateSellShares(pool, sharesAmount);
}

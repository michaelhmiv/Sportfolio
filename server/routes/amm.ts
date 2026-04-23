/**
 * AMM API Routes
 *
 * Endpoints for Automated Market Maker trading:
 * - GET /api/amm/:playerId - Get pool state and current price
 * - GET /api/amm/:playerId/quote - Get trade quote (preview)
 * - POST /api/amm/:playerId/buy - Execute buy trade
 * - POST /api/amm/:playerId/sell - Execute sell trade
 */

import { Express } from "express";
import { getPool, getBuyQuote, getSellQuote, executeBuy, executeSell } from "../amm/pool";
import { isAuthenticated } from "../supabaseAuth";
import { storage } from "../storage";

// Slippage validation bounds
const MIN_SLIPPAGE = 0.001; // 0.1%
const MAX_SLIPPAGE = 0.5; // 50%
const DEFAULT_SLIPPAGE = 0.05; // 5%
const POOL_NOT_INITIALIZED_MESSAGE = "Pool not initialized. Add liquidity first.";

function isPoolNotInitializedErrorMessage(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("pool not initialized");
}

export function registerAmmRoutes(app: Express) {
  // Helper to get user ID from authenticated request
  const getUserId = (req: any): string => {
    if (!req.user?.claims?.sub) {
      throw new Error("User not authenticated");
    }
    return req.user.claims.sub;
  };

  /**
   * GET /api/amm/:playerId
   * Get pool state for a player
   */
  app.get("/api/amm/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      console.log(`[AMM API] Fetching pool for player: ${playerId}`);

      // First check if player exists
      const player = await storage.getPlayer(playerId);
      if (!player) {
        console.error(`[AMM API] Player not found: ${playerId}`);
        return res.status(404).json({
          error: "Player not found",
          playerId: playerId,
        });
      }

      const pool = await getPool(playerId);
      if (!pool) {
        return res.json({
          playerId,
          poolInitialized: false,
          shares: 0,
          playMoney: 0,
          currentPrice: 0,
          totalVolume: 0,
          totalTrades: 0,
          k: 0,
          lpSharesTotal: 0,
          feesAccumulated: 0,
          feeGrowthPerLpShare: 0,
        });
      }

      console.log(`[AMM API] Pool found for ${playerId}:`, {
        shares: pool.shares,
        playMoney: pool.playMoney,
      });

      res.json({
        playerId: pool.playerId,
        poolInitialized: true,
        shares: pool.shares,
        playMoney: pool.playMoney,
        currentPrice: pool.currentPrice,
        totalVolume: pool.totalVolume,
        totalTrades: pool.totalTrades,
        k: pool.k,
        lpSharesTotal: pool.lpSharesTotal,
        feesAccumulated: pool.feesAccumulated,
        feeGrowthPerLpShare: pool.feeGrowthPerLpShare,
      });
    } catch (error: any) {
      console.error("[AMM API] Error getting pool:", error);
      res.status(500).json({
        error: error.message,
        details: error.stack?.split("\n")[0] || "No additional details",
      });
    }
  });

  /**
   * GET /api/amm/:playerId/quote
   * Get trade quote without executing
   * Query params: type=buy|sell&amount=XXX
   */
  app.get("/api/amm/:playerId/quote", async (req, res) => {
    try {
      const { playerId } = req.params;
      const { type, amount } = req.query;

      if (!type || !amount) {
        return res.status(400).json({ error: "Missing required params: type, amount" });
      }

      const tradeType = type as string;
      const tradeAmount = parseFloat(amount as string);

      if (isNaN(tradeAmount) || tradeAmount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      if (tradeType !== "buy" && tradeType !== "sell") {
        return res.status(400).json({ error: "Invalid type. Must be 'buy' or 'sell'" });
      }

      const pool = await getPool(playerId);
      if (!pool) {
        return res.status(409).json({
          error: POOL_NOT_INITIALIZED_MESSAGE,
          code: "POOL_NOT_INITIALIZED",
        });
      }

      if (tradeType === "buy") {
        const quote = await getBuyQuote(playerId, tradeAmount);
        if (!quote) {
          return res.status(500).json({ error: "Failed to calculate quote" });
        }

        res.json({
          type: "buy",
          sbIn: tradeAmount,
          sharesOut: quote.sharesOut,
          effectivePrice: quote.effectivePrice,
          currentPrice: pool.currentPrice,
          slippagePercent: quote.slippagePercent * 100, // Convert to percentage
          newPoolPrice: quote.newPoolPrice,
        });
      } else {
        const quote = await getSellQuote(playerId, tradeAmount);
        if (!quote) {
          return res.status(500).json({ error: "Failed to calculate quote" });
        }

        res.json({
          type: "sell",
          sharesIn: tradeAmount,
          sbOut: quote.sbOut,
          effectivePrice: quote.effectivePrice,
          currentPrice: pool.currentPrice,
          slippagePercent: quote.slippagePercent * 100, // Convert to percentage
          newPoolPrice: quote.newPoolPrice,
        });
      }
    } catch (error: any) {
      console.error("[AMM API] Error getting quote:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/amm/:playerId/buy
   * Execute a buy trade
   * Body: { sbAmount: number, maxSlippage?: number }
   */
  app.post("/api/amm/:playerId/buy", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const userId = getUserId(req);
      const { sbAmount, maxSlippage } = req.body;

      if (!sbAmount || isNaN(parseFloat(sbAmount)) || parseFloat(sbAmount) <= 0) {
        return res.status(400).json({ error: "Invalid sbAmount" });
      }

      const amount = parseFloat(sbAmount);
      if (isNaN(amount) || amount < 0.01) {
        return res.status(400).json({ error: "Minimum buy amount is $0.01" });
      }
      // Validate and clamp maxSlippage to safe bounds
      let maxSlippageDecimal =
        maxSlippage !== undefined ? parseFloat(maxSlippage) : DEFAULT_SLIPPAGE;
      if (isNaN(maxSlippageDecimal) || maxSlippageDecimal < MIN_SLIPPAGE) {
        maxSlippageDecimal = MIN_SLIPPAGE;
      } else if (maxSlippageDecimal > MAX_SLIPPAGE) {
        maxSlippageDecimal = MAX_SLIPPAGE;
      }

      const result = await executeBuy(playerId, userId, amount, maxSlippageDecimal);

      if (!result.success) {
        if (isPoolNotInitializedErrorMessage(result.error)) {
          return res.status(409).json({
            error: POOL_NOT_INITIALIZED_MESSAGE,
            code: "POOL_NOT_INITIALIZED",
          });
        }
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        tradeId: result.tradeId,
        sharesReceived: result.sharesTraded,
        pricePerShare: result.pricePerShare,
        totalCost: result.totalValue,
        slippagePercent: (result.slippagePercent || 0) * 100,
      });
    } catch (error: any) {
      console.error("[AMM API] Error executing buy:", error);
      if (isPoolNotInitializedErrorMessage(error?.message)) {
        return res.status(409).json({
          error: POOL_NOT_INITIALIZED_MESSAGE,
          code: "POOL_NOT_INITIALIZED",
        });
      }
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/amm/:playerId/sell
   * Execute a sell trade
   * Body: { sharesAmount: number, maxSlippage?: number }
   */
  app.post("/api/amm/:playerId/sell", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const userId = getUserId(req);
      const { sharesAmount, maxSlippage } = req.body;

      if (!sharesAmount || isNaN(parseFloat(sharesAmount)) || parseFloat(sharesAmount) <= 0) {
        return res.status(400).json({ error: "Invalid sharesAmount" });
      }

      const amount = parseFloat(sharesAmount);
      if (!Number.isInteger(amount)) {
        return res.status(400).json({ error: "sharesAmount must be a whole number" });
      }
      // Validate and clamp maxSlippage to safe bounds
      let maxSlippageDecimal =
        maxSlippage !== undefined ? parseFloat(maxSlippage) : DEFAULT_SLIPPAGE;
      if (isNaN(maxSlippageDecimal) || maxSlippageDecimal < MIN_SLIPPAGE) {
        maxSlippageDecimal = MIN_SLIPPAGE;
      } else if (maxSlippageDecimal > MAX_SLIPPAGE) {
        maxSlippageDecimal = MAX_SLIPPAGE;
      }

      const result = await executeSell(playerId, userId, amount, maxSlippageDecimal);

      if (!result.success) {
        if (isPoolNotInitializedErrorMessage(result.error)) {
          return res.status(409).json({
            error: POOL_NOT_INITIALIZED_MESSAGE,
            code: "POOL_NOT_INITIALIZED",
          });
        }
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        tradeId: result.tradeId,
        sharesSold: result.sharesTraded,
        pricePerShare: result.pricePerShare,
        totalProceeds: result.totalValue,
        slippagePercent: (result.slippagePercent || 0) * 100,
        poolFee: result.poolFee,
        burnFee: result.burnFee,
      });
    } catch (error: any) {
      console.error("[AMM API] Error executing sell:", error);
      if (isPoolNotInitializedErrorMessage(error?.message)) {
        return res.status(409).json({
          error: POOL_NOT_INITIALIZED_MESSAGE,
          code: "POOL_NOT_INITIALIZED",
        });
      }
      res.status(500).json({ error: error.message });
    }
  });
}

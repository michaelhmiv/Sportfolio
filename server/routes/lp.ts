/**
 * LP (Liquidity Provider) API Routes
 *
 * Endpoints for managing liquidity provider positions:
 * - GET /api/lp/positions - Get all LP positions for current user
 * - GET /api/lp/:playerId/position - Get LP position for specific player
 * - POST /api/lp/:playerId/add - Add liquidity to a pool
 * - POST /api/lp/:playerId/remove - Remove liquidity from a pool
 * - GET /api/lp/:playerId/history - Get LP transaction history
 */

import { Express } from "express";
import { isAuthenticated } from "../auth/runtime-auth";
import {
  addLiquidity,
  addLiquidityOptimal,
  removeLiquidity,
  getLpPosition,
  getUserLpPositions,
  getZapAddQuoteSharesOnly,
  zapAddLiquiditySharesOnly,
  getZapAddQuoteSbOnly,
  zapAddLiquiditySbOnly,
} from "../amm/pool";
import { storage } from "../storage";
import {
  getCanonicalPlayerMarket,
  getCanonicalPlayerMarkets,
} from "../valuation/canonical-valuation";

export function registerLpRoutes(app: Express) {
  // Helper to get user ID from authenticated request
  const getUserId = (req: any): string => {
    if (!req.user?.claims?.sub) {
      throw new Error("User not authenticated");
    }
    return req.user.claims.sub;
  };

  /**
   * GET /api/lp/positions
   * Get all LP positions for current user
   */
  app.get("/api/lp/positions", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const positions = await getUserLpPositions(userId);
      const playerIds = positions.map((position) => position.playerId);
      const [players, markets] = await Promise.all([
        storage.getPlayersByIds(playerIds),
        getCanonicalPlayerMarkets(playerIds),
      ]);
      const playersById = new Map(players.map((player) => [player.id, player]));
      const enrichedPositions = positions.map((position) => {
        const player = playersById.get(position.playerId);
        const market = markets.get(position.playerId);
        return {
          ...position,
          marketStatus: market?.marketStatus || "unpriced",
          marketPrice: market?.marketPrice ?? null,
          positionValue: market?.marketPrice == null ? null : position.positionValue,
          player: player
            ? {
                id: player.id,
                name: `${player.firstName} ${player.lastName}`,
                team: player.team,
                position: player.position,
              }
            : null,
          pool: market?.poolInitialized
            ? {
                currentPrice: market.marketPrice,
                poolTvl: market.poolTvl,
              }
            : null,
        };
      });

      res.json(enrichedPositions);
    } catch (error: any) {
      console.error("[LP API] Error getting positions:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/lp/:playerId/position
   * Get LP position for specific player
   */
  app.get("/api/lp/:playerId/position", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const userId = getUserId(req);

      const position = await getLpPosition(playerId, userId);

      if (!position) {
        return res.json({ position: null });
      }

      const [player, market] = await Promise.all([
        storage.getPlayer(playerId),
        getCanonicalPlayerMarket(playerId),
      ]);

      res.json({
        position: {
          ...position,
          player: player
            ? {
                id: player.id,
                name: `${player.firstName} ${player.lastName}`,
                team: player.team,
                position: player.position,
                marketStatus: market?.marketStatus || "unpriced",
                currentPrice: market?.marketPrice ?? null,
              }
            : null,
          marketStatus: market?.marketStatus || "unpriced",
          marketPrice: market?.marketPrice ?? null,
          positionValue: market?.marketPrice == null ? null : position.positionValue,
        },
      });
    } catch (error: any) {
      console.error("[LP API] Error getting position:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/lp/:playerId/add
   * Add liquidity to a pool
   * Body: { shares: number, playMoney: number }
   */
  app.post("/api/lp/:playerId/add", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const userId = getUserId(req);
      const { shares, playMoney } = req.body;

      if (!shares || !playMoney || shares <= 0 || playMoney <= 0) {
        return res.status(400).json({ error: "Invalid shares or play money amount" });
      }

      const result = await addLiquidity(playerId, userId, shares, playMoney);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        lpSharesMinted: result.lpSharesMinted,
        sharesDeposited: result.sharesDeposited,
        playMoneyDeposited: result.playMoneyDeposited,
        ownershipPercentage: result.ownershipPercentage,
      });
    } catch (error: any) {
      console.error("[LP API] Error adding liquidity:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/lp/:playerId/add-optimal
   * Add liquidity using up-to amounts (server computes optimal ratio at execution time).
   * Body: { maxShares: number, maxPlayMoney: number }
   */
  app.post("/api/lp/:playerId/add-optimal", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const userId = getUserId(req);
      const { maxShares, maxPlayMoney } = req.body;

      const maxSharesNum = parseFloat(maxShares);
      const maxPlayMoneyNum = parseFloat(maxPlayMoney);

      if (!maxSharesNum || !maxPlayMoneyNum || maxSharesNum <= 0 || maxPlayMoneyNum <= 0) {
        return res.status(400).json({ error: "Invalid max shares or play money amount" });
      }

      const result = await addLiquidityOptimal(playerId, userId, maxSharesNum, maxPlayMoneyNum);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        lpSharesMinted: result.lpSharesMinted,
        sharesDeposited: result.sharesDeposited,
        playMoneyDeposited: result.playMoneyDeposited,
        ownershipPercentage: result.ownershipPercentage,
        sharesUnused: result.sharesUnused,
        playMoneyUnused: result.playMoneyUnused,
      });
    } catch (error: any) {
      console.error("[LP API] Error adding liquidity (optimal):", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/lp/:playerId/zap-quote
   * Quote a single-sided (shares-only) zap into LP.
   * Query: shares=number
   */
  app.get("/api/lp/:playerId/zap-quote", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const userId = getUserId(req);
      const sharesRaw = req.query.shares as string | undefined;
      const sbRaw = req.query.sb as string | undefined;

      if (sharesRaw) {
        const sharesIn = parseFloat(sharesRaw);
        if (!sharesIn || !isFinite(sharesIn) || isNaN(sharesIn) || sharesIn <= 0) {
          return res.status(400).json({ error: "Invalid shares amount" });
        }
        const quote = await getZapAddQuoteSharesOnly(playerId, userId, sharesIn);
        return res.json({ side: "shares", ...quote });
      }

      if (sbRaw) {
        const sbIn = parseFloat(sbRaw);
        if (!sbIn || !isFinite(sbIn) || isNaN(sbIn) || sbIn <= 0) {
          return res.status(400).json({ error: "Invalid SB amount" });
        }
        const quote = await getZapAddQuoteSbOnly(playerId, userId, sbIn);
        return res.json({ side: "sb", ...quote });
      }

      return res.status(400).json({ error: "Missing query param: shares or sb" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /api/lp/:playerId/zap-add
   * Execute a single-sided (shares-only) zap into LP.
   * Body: { shares: number }
   */
  app.post("/api/lp/:playerId/zap-add", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const userId = getUserId(req);
      const { shares, sb } = req.body;

      if (shares != null) {
        const sharesIn = parseFloat(shares);
        if (!sharesIn || !isFinite(sharesIn) || isNaN(sharesIn) || sharesIn <= 0) {
          return res.status(400).json({ error: "Invalid shares amount" });
        }
        const result = await zapAddLiquiditySharesOnly(playerId, userId, sharesIn);
        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }
        return res.json({ side: "shares", ...result });
      }

      if (sb != null) {
        const sbIn = parseFloat(sb);
        if (!sbIn || !isFinite(sbIn) || isNaN(sbIn) || sbIn <= 0) {
          return res.status(400).json({ error: "Invalid SB amount" });
        }
        const result = await zapAddLiquiditySbOnly(playerId, userId, sbIn);
        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }
        return res.json({ side: "sb", ...result });
      }

      return res.status(400).json({ error: "Missing body param: shares or sb" });
    } catch (error: any) {
      console.error("[LP API] Error executing zap add:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/lp/:playerId/remove
   * Remove liquidity from a pool
   * Body: { lpShares: number }
   */
  app.post("/api/lp/:playerId/remove", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const userId = getUserId(req);
      const { lpShares } = req.body;

      if (!lpShares || lpShares <= 0) {
        return res.status(400).json({ error: "Invalid LP shares amount" });
      }

      const result = await removeLiquidity(playerId, userId, lpShares);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        lpSharesBurned: result.lpSharesBurned,
        sharesReceived: result.sharesReceived,
        playMoneyReceived: result.playMoneyReceived,
      });
    } catch (error: any) {
      console.error("[LP API] Error removing liquidity:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/lp/:playerId/history
   * Get LP transaction history for a player
   */
  app.get("/api/lp/:playerId/history", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const userId = getUserId(req);
      const limit = parseInt(req.query.limit as string) || 50;

      const history = await storage.getLpTransactionHistory(userId, playerId, limit);
      res.json(history);
    } catch (error: any) {
      console.error("[LP API] Error getting history:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/lp/history
   * Get all LP transaction history for current user
   */
  app.get("/api/lp/history", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const limit = parseInt(req.query.limit as string) || 50;

      const history = await storage.getLpTransactionHistory(userId, undefined, limit);
      res.json(history);
    } catch (error: any) {
      console.error("[LP API] Error getting history:", error);
      res.status(500).json({ error: error.message });
    }
  });
}

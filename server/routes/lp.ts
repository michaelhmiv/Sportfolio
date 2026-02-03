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
import { isAuthenticated } from "../supabaseAuth";
import { addLiquidity, removeLiquidity, getLpPosition, getUserLpPositions, getPool } from "../amm/pool";
import { storage } from "../storage";

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
      
      // Enrich with player info
      const enrichedPositions = await Promise.all(
        positions.map(async (pos) => {
          const player = await storage.getPlayer(pos.playerId);
          const pool = await getPool(pos.playerId);
          return {
            ...pos,
            player: player ? {
              id: player.id,
              name: `${player.firstName} ${player.lastName}`,
              team: player.team,
              position: player.position,
            } : null,
            pool: pool ? {
              currentPrice: pool.currentPrice,
              totalLpShares: pool.lpSharesTotal,
            } : null,
          };
        })
      );
      
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
      
      const player = await storage.getPlayer(playerId);
      
      res.json({
        position: {
          ...position,
          player: player ? {
            id: player.id,
            name: `${player.firstName} ${player.lastName}`,
            team: player.team,
            position: player.position,
            currentPrice: player.lastTradePrice,
          } : null,
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

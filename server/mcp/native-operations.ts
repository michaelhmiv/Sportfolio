import {
  getBuyQuote,
  getLpPosition,
  getPool,
  getSellQuote,
  getUserLpPositions,
  getZapAddQuoteSbOnly,
  getZapAddQuoteSharesOnly,
} from "../amm/pool";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { storage } from "../storage";

export type NativeToolInput = {
  toolName: string;
  userId: string;
  args?: Record<string, unknown>;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function optionalText(value: unknown) {
  return text(value) || undefined;
}
function positiveInt(value: unknown, fallback?: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function dateString(value: unknown) {
  const candidate = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : getTodayET();
}
function targetDate(value: unknown) {
  const { startOfDay } = getETDayBoundaries(dateString(value));
  return new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
}
async function requirePlayer(playerId: string) {
  const player = await storage.getPlayer(playerId);
  if (!player) throw new Error("Player not found");
  return player;
}

function summarizeHoldingRows(rows: any[]) {
  const marketValue = rows.reduce((sum, row) => {
    const quantity = Number(row.quantity ?? row.effectiveShares ?? 0);
    const price = Number(row.player?.currentPrice ?? row.currentPrice ?? 0);
    return sum + quantity * price;
  }, 0);
  return {
    holdingCount: rows.length,
    totalQuantity: rows.reduce(
      (sum, row) => sum + Number(row.quantity ?? row.effectiveShares ?? 0),
      0,
    ),
    estimatedMarketValue: marketValue,
  };
}

export async function runNativeReadTool(input: NativeToolInput): Promise<unknown> {
  const args = input.args || {};
  switch (input.toolName) {
    case "get_balance_state": {
      const user = await storage.getUser(input.userId);
      if (!user) throw new Error("User not found");
      const availableBalance = await storage.getAvailableBalance(input.userId);
      const lockedBalance = await storage.getTotalLockedBalance(input.userId);
      return {
        summary: "Loaded balance state.",
        balance: Number(user.balance || 0),
        availableBalance,
        lockedBalance,
      };
    }
    case "get_portfolio_summary": {
      const [user, rows] = await Promise.all([
        storage.getUser(input.userId),
        storage.getUserHoldingsWithPlayers(input.userId),
      ]);
      if (!user) throw new Error("User not found");
      return {
        summary: "Loaded portfolio summary.",
        availableBalance: await storage.getAvailableBalance(input.userId),
        cashBalance: Number(user.balance || 0),
        ...summarizeHoldingRows(rows),
        holdings: rows,
      };
    }
    case "get_holdings": {
      const rows = await storage.getUserHoldingsWithPlayers(input.userId);
      const sport = optionalText(args.sport)?.toUpperCase();
      const limit = Math.min(100, positiveInt(args.limit, 100) || 100);
      const filtered = sport
        ? rows.filter((row) => text(row.player?.sport).toUpperCase() === sport)
        : rows;
      return filtered.slice(0, limit);
    }
    case "get_trade_history":
      return storage.getMarketActivity({
        userId: input.userId,
        limit: positiveInt(args.limit, 100),
        ...(optionalText(args.playerId) ? { playerId: optionalText(args.playerId) } : {}),
      });
    case "get_portfolio_history": {
      const range = text(args.timeRange) || "1M";
      const now = new Date();
      const start = new Date(now);
      if (range === "1D") start.setDate(now.getDate() - 1);
      else if (range === "7D") start.setDate(now.getDate() - 7);
      else if (range === "1M") start.setMonth(now.getMonth() - 1);
      else if (range === "1Y") start.setFullYear(now.getFullYear() - 1);
      else if (range === "ALL") start.setTime(new Date(2020, 0, 1).getTime());
      else throw new Error("Invalid timeRange. Use 1D, 7D, 1M, 1Y, or ALL");
      const snapshots = await storage.getPortfolioSnapshotsInRange(input.userId, start, now);
      return {
        timeRange: range,
        history: snapshots.map((row) => ({
          date: row.snapshotDate.toISOString(),
          cashBalance: Number(row.cashBalance),
          portfolioValue: Number(row.portfolioValue),
          netWorth: Number(row.totalNetWorth),
          cashRank: row.cashRank,
          portfolioRank: row.portfolioRank,
        })),
      };
    }
    case "get_player_detail": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      return requirePlayer(playerId);
    }
    case "get_player_stats": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      await requirePlayer(playerId);
      return storage.getPlayerSeasonStatsFromLogs(playerId);
    }
    case "get_player_recent_games": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      await requirePlayer(playerId);
      return storage.getPlayerRecentGamesFromLogs(playerId, positiveInt(args.limit, 10) || 10);
    }
    case "get_player_financial_metrics": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      await requirePlayer(playerId);
      return storage.getPlayerFinancialMetrics(playerId);
    }
    case "get_player_shares_info": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      await requirePlayer(playerId);
      const [sharesOutstanding, availableShares, breakdown] = await Promise.all([
        storage.getPlayerSharesOutstanding([playerId]),
        storage.getAvailableShares(input.userId, "player", playerId),
        storage.getPlayerShareBreakdown(input.userId, playerId),
      ]);
      return {
        playerId,
        sharesOutstanding: sharesOutstanding.get(playerId) || 0,
        availableShares,
        breakdown,
      };
    }
    case "get_watchlists":
      return storage.getWatchlists(input.userId);
    case "get_watchlist_items": {
      const watchlistId = text(args.watchlistId);
      if (!watchlistId) throw new Error("watchlistId is required");
      const watchlists = await storage.getWatchlists(input.userId);
      if (!watchlists.some((entry) => entry.id === watchlistId))
        throw new Error("Watchlist not found");
      return storage.getWatchlistItems(watchlistId);
    }
    case "get_player_watchlists": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      return storage.getPlayerWatchlists(input.userId, playerId);
    }
    case "get_holding_multiplier_state": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      return storage.getHoldingMultiplierState(input.userId, playerId);
    }
    case "get_daily_boost_state":
      return storage.getDailyBoostsAllSports(input.userId, targetDate(args.date));
    case "get_daily_boost_history":
      return storage.getBoostPayoutHistory(input.userId, positiveInt(args.limit, 50));
    case "get_daily_boost_eligibility": {
      const sport = (text(args.sport) || "MLB").toUpperCase();
      return storage.getEligiblePlayersForBoost(input.userId, sport, targetDate(args.date));
    }
    case "get_community_boost_state":
      return storage.getCommunityBoostsAllSports(targetDate(args.date));
    case "get_lp_positions":
      return getUserLpPositions(input.userId);
    case "get_lp_position": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      return getLpPosition(playerId, input.userId);
    }
    case "get_lp_history":
      return storage.getLpTransactionHistory(
        input.userId,
        optionalText(args.playerId),
        positiveInt(args.limit, 50),
      );
    case "get_amm_pool_state": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      await requirePlayer(playerId);
      const pool = await getPool(playerId);
      return pool ? { ...pool, poolInitialized: true } : { playerId, poolInitialized: false };
    }
    case "get_amm_trade_quote": {
      const playerId = text(args.playerId);
      const quoteType = text(args.type).toLowerCase();
      const amount = positiveNumber(args.amount);
      if (!playerId || !amount || !["buy", "sell"].includes(quoteType)) {
        throw new Error("playerId, type=buy|sell, and amount are required");
      }
      await requirePlayer(playerId);
      return quoteType === "buy"
        ? { type: "buy", quote: await getBuyQuote(playerId, amount) }
        : { type: "sell", quote: await getSellQuote(playerId, amount) };
    }
    default:
      throw new Error(`Unsupported native read tool: ${input.toolName}`);
  }
}

export async function runNativeScanTool(input: NativeToolInput): Promise<unknown> {
  const args = input.args || {};
  const sport = (text(args.sport) || "MLB").toUpperCase();
  switch (input.toolName) {
    case "scan_daily_boost_candidates": {
      const items = await storage.getEligiblePlayersForBoost(
        input.userId,
        sport,
        targetDate(args.date),
      );
      return {
        summary: `Found ${items.length} eligible daily boost candidates.`,
        candidates: items.slice(0, positiveInt(args.limit, 25) || 25),
      };
    }
    case "scan_idle_balance_options": {
      const availableBalance = await storage.getAvailableBalance(input.userId);
      const scanners = await storage.getFinancialMarketScanners(sport);
      return {
        summary: `Loaded idle-balance options for ${availableBalance.toFixed(2)} available SB.`,
        availableBalance,
        opportunities: [...scanners.undervalued, ...scanners.momentum].slice(0, 10),
      };
    }
    case "scan_portfolio_cleanup_levers": {
      const holdings = await storage.getUserHoldingsWithPlayers(input.userId);
      const ranked = [...holdings]
        .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0))
        .slice(0, 15);
      return {
        summary: `Reviewed ${holdings.length} portfolio holdings.`,
        cleanupCandidates: ranked,
      };
    }
    case "scan_scout_opportunities": {
      const [assignments, players, totalScouts] = await Promise.all([
        storage.getUserScoutAssignments(input.userId),
        storage.getPlayersBySport(sport),
        storage.getTotalScoutsForUser(input.userId),
      ]);
      const assigned = new Map(assignments.map((entry) => [entry.playerId, entry.scoutCount]));
      const limit = Math.min(20, positiveInt(args.limit, 20) || 20);
      const candidates = players
        .filter((player) => player.isActive !== false)
        .sort((a, b) => Number(b.currentPrice || 0) - Number(a.currentPrice || 0))
        .slice(0, limit)
        .map((player) => ({ player, currentScoutCount: assigned.get(player.id) || 0 }));
      return {
        summary: `Loaded ${candidates.length} scout opportunities.`,
        totalScouts,
        candidates,
      };
    }
    case "scan_top_market_opportunities": {
      const scanners = await storage.getFinancialMarketScanners(sport);
      return { ...scanners, summary: `Loaded top ${sport} market opportunities.` };
    }
    case "scan_news_impact": {
      const feed = await storage.getUserActivityFeed(input.userId, {
        limit: positiveInt(args.limit, 25),
        offset: 0,
        includeBalanceAfter: false,
      });
      return { summary: "Loaded recent account and market activity for impact review.", feed };
    }
    default:
      throw new Error(`Unsupported native scan tool: ${input.toolName}`);
  }
}

export async function runNativePlanTool(input: NativeToolInput): Promise<unknown> {
  const args = input.args || {};
  if (input.toolName !== "preview_lp_zap") {
    throw new Error(`Unsupported native plan tool: ${input.toolName}`);
  }
  const playerId = text(args.playerId);
  const side = text(args.side).toLowerCase();
  const amount = positiveNumber(args.amount);
  if (!playerId || !amount || !["shares", "sb"].includes(side)) {
    throw new Error("playerId, side=shares|sb, and amount are required");
  }
  await requirePlayer(playerId);
  const quote =
    side === "shares"
      ? await getZapAddQuoteSharesOnly(playerId, input.userId, amount)
      : await getZapAddQuoteSbOnly(playerId, input.userId, amount);
  return { summary: "Loaded LP zap quote.", playerId, side, amount, quote };
}

export async function runNativeActionTool(input: NativeToolInput): Promise<unknown> {
  const args = input.args || {};
  switch (input.toolName) {
    case "create_watchlist": {
      const name = text(args.name);
      if (!name) throw new Error("name is required");
      return storage.createWatchlist(input.userId, name, false, optionalText(args.color));
    }
    case "update_watchlist": {
      const watchlistId = text(args.watchlistId);
      const name = optionalText(args.name);
      const color = optionalText(args.color);
      if (!watchlistId || (!name && !color))
        throw new Error("watchlistId and an update are required");
      const watchlists = await storage.getWatchlists(input.userId);
      if (!watchlists.some((entry) => entry.id === watchlistId))
        throw new Error("Watchlist not found");
      await storage.updateWatchlist(watchlistId, { name, color });
      return { success: true, watchlistId };
    }
    case "delete_watchlist": {
      const watchlistId = text(args.watchlistId);
      if (!watchlistId) throw new Error("watchlistId is required");
      const watchlists = await storage.getWatchlists(input.userId);
      if (!watchlists.some((entry) => entry.id === watchlistId))
        throw new Error("Watchlist not found");
      await storage.deleteWatchlist(watchlistId);
      return { success: true, watchlistId };
    }
    case "add_watchlist_player": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      await storage.addToWatchList(input.userId, playerId, optionalText(args.watchlistId));
      return { success: true, playerId };
    }
    case "remove_watchlist_player": {
      const playerId = text(args.playerId);
      if (!playerId) throw new Error("playerId is required");
      await storage.removeFromWatchList(
        input.userId,
        playerId,
        args.removeFromAll === true ? undefined : optionalText(args.watchlistId),
      );
      return { success: true, playerId };
    }
    default:
      throw new Error(`Unsupported native action tool: ${input.toolName}`);
  }
}

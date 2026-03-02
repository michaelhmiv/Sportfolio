import {
  addLiquidity,
  addLiquidityOptimal,
  executeBuy,
  executeSell,
  removeLiquidity,
  zapAddLiquiditySbOnly,
  zapAddLiquiditySharesOnly,
} from "../amm/pool";
import { getETDayBoundaries } from "../lib/time";
import { storage } from "../storage";
import { claimVestingShares } from "./vesting-claim";
import type {
  AgentAction,
  CommunityBoostCreateAction,
  DailyBoostAssignAction,
  DailyBoostRemoveAction,
  HoldingsCondenseAction,
  PoolAddLiquidityAction,
  PoolAddLiquidityOptimalAction,
  PoolBuyAction,
  PoolRemoveLiquidityAction,
  PoolSellAction,
  PoolZapSbAction,
  PoolZapSharesAction,
  ScoutProposalAction,
  VestingClaimAction,
  WatchlistAddPlayerAction,
  WatchlistRemovePlayerAction,
} from "./types";

export async function executeScoutProposalActions(
  userId: string,
  actions: ScoutProposalAction[],
): Promise<void> {
  const assignments = actions.map((action) => ({
    playerId: action.playerId,
    count: action.targetCount,
  }));

  await storage.applyScoutAssignments(userId, assignments);
}

async function executePoolBuy(userId: string, action: PoolBuyAction) {
  const result = await executeBuy(action.playerId, userId, action.sbAmount, action.maxSlippage);
  if (!result.success) {
    throw new Error(result.error || "Failed to execute pool buy");
  }
}

async function executePoolSell(userId: string, action: PoolSellAction) {
  const result = await executeSell(
    action.playerId,
    userId,
    action.sharesAmount,
    action.maxSlippage,
  );
  if (!result.success) {
    throw new Error(result.error || "Failed to execute pool sell");
  }
}

async function executePoolAddLiquidity(userId: string, action: PoolAddLiquidityAction) {
  const result = await addLiquidity(action.playerId, userId, action.shares, action.playMoney);
  if (!result.success) {
    throw new Error(result.error || "Failed to add liquidity");
  }
}

async function executePoolAddLiquidityOptimal(
  userId: string,
  action: PoolAddLiquidityOptimalAction,
) {
  const result = await addLiquidityOptimal(
    action.playerId,
    userId,
    action.maxShares,
    action.maxPlayMoney,
  );
  if (!result.success) {
    throw new Error(result.error || "Failed to add optimal liquidity");
  }
}

async function executePoolZapShares(userId: string, action: PoolZapSharesAction) {
  const result = await zapAddLiquiditySharesOnly(action.playerId, userId, action.shares);
  if (!result.success) {
    throw new Error(result.error || "Failed to execute share-side zap");
  }
}

async function executePoolZapSb(userId: string, action: PoolZapSbAction) {
  const result = await zapAddLiquiditySbOnly(action.playerId, userId, action.sb);
  if (!result.success) {
    throw new Error(result.error || "Failed to execute cash-side zap");
  }
}

async function executePoolRemoveLiquidity(userId: string, action: PoolRemoveLiquidityAction) {
  const result = await removeLiquidity(action.playerId, userId, action.lpShares);
  if (!result.success) {
    throw new Error(result.error || "Failed to remove liquidity");
  }
}

async function executeHoldingsCondense(userId: string, action: HoldingsCondenseAction) {
  await storage.condenseShares(userId, action.playerId, action.sharesToCondense);
}

async function executeDailyBoostAssign(userId: string, action: DailyBoostAssignAction) {
  const { startOfDay } = getETDayBoundaries(action.boostDate);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
  const currentBoosts = await storage.getDailyBoosts(userId, action.sport, targetDate);

  if (currentBoosts.some((boost) => boost.slotTier === action.slotTier)) {
    throw new Error(`Slot ${action.slotTier}x is already occupied`);
  }
  if (currentBoosts.some((boost) => boost.playerId === action.playerId)) {
    throw new Error("This player is already in a boost slot");
  }
  if (currentBoosts.length >= 4) {
    throw new Error("All 4 boost slots are already filled");
  }

  const game = await storage.getPlayerGameForDate(action.playerId, action.sport, targetDate);
  if (!game) {
    throw new Error("This player doesn't have a game in that boost window");
  }
  if (new Date(game.startTime) <= new Date()) {
    throw new Error("Cannot add boost - player's game has already started");
  }

  const availableShares = await storage.getAvailableShares(userId, "player", action.playerId);
  if (availableShares < 1) {
    throw new Error(`Not enough available shares. You have ${availableShares} available.`);
  }

  const breakdown = await storage.getHoldingsWithPowerBreakdown(userId, action.playerId);
  const candidates = [
    ...(breakdown.powered || []).filter((holding) => Number.parseFloat(holding.quantity) >= 1),
    ...(breakdown.regular && Number.parseFloat(breakdown.regular.quantity) >= 1
      ? [breakdown.regular]
      : []),
  ].sort((left, right) => (right.power || 1) - (left.power || 1));

  const selectedHolding = candidates[0];
  if (!selectedHolding) {
    throw new Error("No shares available for this player");
  }

  await storage.createDailyBoost({
    userId,
    playerId: action.playerId,
    sport: action.sport,
    slotTier: action.slotTier,
    boostDate: startOfDay,
    sharesEntered: 1,
    powerLevel: Number(selectedHolding.power || 1).toFixed(2),
    gameId: game.gameId,
  });
}

async function executeDailyBoostRemove(userId: string, action: DailyBoostRemoveAction) {
  const { startOfDay } = getETDayBoundaries(action.boostDate);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
  const boosts = await storage.getDailyBoostsAllSports(userId, targetDate);
  const boost = boosts.find((entry) => entry.id === action.boostId);

  if (!boost) {
    throw new Error("Boost not found or not owned by you");
  }
  if (boost.status !== "active") {
    throw new Error(
      `Cannot remove boost - status is ${boost.status}. Boosts are locked when the game starts.`,
    );
  }

  if (boost.gameId) {
    const game = await storage.getDailyGameByGameId(boost.gameId);
    if (game && new Date(game.startTime) <= new Date()) {
      throw new Error("Cannot remove boost - game has already started");
    }
  }

  await storage.deleteDailyBoost(boost.id);
}

async function executeWatchlistAdd(userId: string, action: WatchlistAddPlayerAction) {
  await storage.addToWatchList(userId, action.playerId, action.watchlistId || undefined);
}

async function executeWatchlistRemove(userId: string, action: WatchlistRemovePlayerAction) {
  await storage.removeFromWatchList(
    userId,
    action.playerId,
    action.removeFromAll ? undefined : (action.watchlistId ?? undefined),
  );
}

async function executeCommunityBoostCreate(userId: string, action: CommunityBoostCreateAction) {
  const { startOfDay } = getETDayBoundaries(action.boostDate);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
  const game = await storage.getPlayerGameForDate(action.playerId, action.sport, targetDate);

  if (!game) {
    throw new Error("This player does not have a game in that community-boost window");
  }
  if (new Date(game.startTime) <= new Date()) {
    throw new Error("Cannot create community boost - game has already started");
  }

  const availableCommunityShares = await storage.getUserCommunityBoostShares(userId);
  if (availableCommunityShares < 1) {
    throw new Error("Insufficient community shares to create community boost");
  }

  const existingBoosts = await storage.getCommunityBoostsForDate(action.sport, targetDate);
  if (existingBoosts.some((entry) => entry.playerId === action.playerId)) {
    throw new Error("This player already has a Community Boost!");
  }

  await storage.createCommunityBoost({
    creatorId: userId,
    playerId: action.playerId,
    sport: action.sport,
    boostDate: startOfDay,
    gameId: game.gameId,
  });
}

async function executeVestingClaim(userId: string, _action: VestingClaimAction) {
  await claimVestingShares(userId);
}

export async function executeAgentActions(userId: string, actions: AgentAction[]): Promise<void> {
  const scoutActions = actions.filter(
    (action): action is ScoutProposalAction => action.actionType === "scout_set_count",
  );

  if (scoutActions.length > 0) {
    await executeScoutProposalActions(userId, scoutActions);
  }

  const nonScoutActions = actions.filter((action) => action.actionType !== "scout_set_count");

  for (const action of nonScoutActions) {
    switch (action.actionType) {
      case "pool_buy":
        await executePoolBuy(userId, action);
        break;
      case "pool_sell":
        await executePoolSell(userId, action);
        break;
      case "pool_add_liquidity":
        await executePoolAddLiquidity(userId, action);
        break;
      case "pool_add_liquidity_optimal":
        await executePoolAddLiquidityOptimal(userId, action);
        break;
      case "pool_zap_add_shares":
        await executePoolZapShares(userId, action);
        break;
      case "pool_zap_add_sb":
        await executePoolZapSb(userId, action);
        break;
      case "pool_remove_liquidity":
        await executePoolRemoveLiquidity(userId, action);
        break;
      case "holdings_condense":
        await executeHoldingsCondense(userId, action);
        break;
      case "daily_boost_assign":
        await executeDailyBoostAssign(userId, action);
        break;
      case "daily_boost_remove":
        await executeDailyBoostRemove(userId, action);
        break;
      case "watchlist_add_player":
        await executeWatchlistAdd(userId, action);
        break;
      case "watchlist_remove_player":
        await executeWatchlistRemove(userId, action);
        break;
      case "community_boost_create":
        await executeCommunityBoostCreate(userId, action);
        break;
      case "vesting_claim":
        await executeVestingClaim(userId, action);
        break;
      default:
        break;
    }
  }
}

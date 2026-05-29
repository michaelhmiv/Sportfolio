/**
 * Bot Profiles V2 — Deterministic, profile-driven behavior configuration.
 *
 * Each role has hard-coded defaults. Individual bot_profiles rows can override
 * any field via their DB columns.
 */

export type BotRole =
  | "market_maker"
  | "trader"
  | "casual"
  | "contest"
  | "cold_market";

export type BotStage =
  | "scouting"
  | "accumulating"
  | "pool_building"
  | "steady_state";

export type ActionType =
  | "scout_assign"
  | "scout_rebalance"
  | "pool_create"
  | "pool_add_liquidity"
  | "buy"
  | "sell"
  | "boost_assign";

export interface BotProfileV2 {
  /** Bot user ID (references users table) */
  userId: string;
  /** Bot profile ID (references bot_profiles table) */
  profileId: string;
  /** Display name */
  botName: string;
  /** Role determines strategy defaults */
  role: BotRole;
  /** Is this bot currently active */
  isActive: boolean;
  /** Per-tick action probability (0-1). Lower = less frequent. */
  actionProbability: number;
  /** Max actions per 24h rolling window */
  maxDailyActions: number;
  /** Cooldown hours before re-interacting with same player */
  playerCooldownHours: number;
  /** Max % of portfolio value in a single player */
  maxPlayerExposurePercent: number;
  /** Max % of actions on a single sport in 24h */
  maxSportConcentration: number;
  /** Active hours (UTC). Bot only acts within this window. */
  activeHoursStart: number;
  activeHoursEnd: number;
  /** Order sizing */
  minOrderSb: number;
  maxOrderSb: number;
  /** Scout strategy: how many players to scout simultaneously */
  scoutTargetCount: number;
  /** How often to rotate scouts (hours) */
  scoutRotationHours: number;
  /** Which actions are allowed for this role */
  allowedActions: ActionType[];
  /** Weight preferences for action selection */
  actionWeights: Partial<Record<ActionType, number>>;
}

export interface RoleDefaults {
  actionProbability: number;
  maxDailyActions: number;
  playerCooldownHours: number;
  maxPlayerExposurePercent: number;
  maxSportConcentration: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  minOrderSb: number;
  maxOrderSb: number;
  scoutTargetCount: number;
  scoutRotationHours: number;
  allowedActions: ActionType[];
  actionWeights: Partial<Record<ActionType, number>>;
}

export const ROLE_DEFAULTS: Record<BotRole, RoleDefaults> = {
  market_maker: {
    actionProbability: 0.55,
    maxDailyActions: 20,
    playerCooldownHours: 8,
    maxPlayerExposurePercent: 12,
    maxSportConcentration: 0.5,
    activeHoursStart: 8,
    activeHoursEnd: 23,
    minOrderSb: 15,
    maxOrderSb: 200,
    scoutTargetCount: 8,
    scoutRotationHours: 168, // weekly
    allowedActions: [
      "scout_assign",
      "scout_rebalance",
      "pool_create",
      "pool_add_liquidity",
      "buy",
      "sell",
    ],
    actionWeights: {
      pool_create: 35,
      pool_add_liquidity: 25,
      buy: 15,
      sell: 10,
      scout_assign: 10,
      scout_rebalance: 5,
    },
  },
  trader: {
    actionProbability: 0.35,
    maxDailyActions: 15,
    playerCooldownHours: 12,
    maxPlayerExposurePercent: 15,
    maxSportConcentration: 0.55,
    activeHoursStart: 9,
    activeHoursEnd: 23,
    minOrderSb: 20,
    maxOrderSb: 400,
    scoutTargetCount: 4,
    scoutRotationHours: 72,
    allowedActions: [
      "scout_assign",
      "scout_rebalance",
      "pool_create",
      "buy",
      "sell",
      "boost_assign",
    ],
    actionWeights: {
      buy: 35,
      sell: 25,
      pool_create: 15,
      boost_assign: 10,
      scout_assign: 10,
      scout_rebalance: 5,
    },
  },
  casual: {
    actionProbability: 0.15,
    maxDailyActions: 8,
    playerCooldownHours: 24,
    maxPlayerExposurePercent: 10,
    maxSportConcentration: 0.6,
    activeHoursStart: 11,
    activeHoursEnd: 22,
    minOrderSb: 10,
    maxOrderSb: 80,
    scoutTargetCount: 3,
    scoutRotationHours: 48,
    allowedActions: [
      "scout_assign",
      "scout_rebalance",
      "pool_create",
      "buy",
      "sell",
    ],
    actionWeights: {
      buy: 30,
      sell: 20,
      scout_assign: 25,
      scout_rebalance: 10,
      pool_create: 15,
    },
  },
  contest: {
    actionProbability: 0.3,
    maxDailyActions: 12,
    playerCooldownHours: 12,
    maxPlayerExposurePercent: 15,
    maxSportConcentration: 0.6,
    activeHoursStart: 10,
    activeHoursEnd: 23,
    minOrderSb: 15,
    maxOrderSb: 150,
    scoutTargetCount: 5,
    scoutRotationHours: 48,
    allowedActions: [
      "scout_assign",
      "scout_rebalance",
      "pool_create",
      "buy",
      "sell",
      "boost_assign",
    ],
    actionWeights: {
      boost_assign: 30,
      buy: 25,
      scout_assign: 20,
      sell: 10,
      pool_create: 10,
      scout_rebalance: 5,
    },
  },
  cold_market: {
    actionProbability: 0.2,
    maxDailyActions: 8,
    playerCooldownHours: 48,
    maxPlayerExposurePercent: 8,
    maxSportConcentration: 0.45,
    activeHoursStart: 8,
    activeHoursEnd: 22,
    minOrderSb: 10,
    maxOrderSb: 60,
    scoutTargetCount: 10,
    scoutRotationHours: 120,
    allowedActions: [
      "scout_assign",
      "scout_rebalance",
      "pool_create",
      "pool_add_liquidity",
      "buy",
    ],
    actionWeights: {
      scout_assign: 30,
      pool_create: 35,
      pool_add_liquidity: 15,
      buy: 10,
      scout_rebalance: 10,
    },
  },
};

/**
 * Determine the bot's current lifecycle stage based on its holdings/state.
 */
export function determineBotStage(state: {
  totalHoldings: number;
  uniquePlayersHeld: number;
  balance: number;
  lpPositionCount: number;
  poolsCreated: number;
}): BotStage {
  if (state.totalHoldings === 0) {
    return "scouting";
  }

  if (state.uniquePlayersHeld < 3 || state.balance < 5000) {
    return "accumulating";
  }

  if (state.lpPositionCount < 5 && state.poolsCreated < 10) {
    return "pool_building";
  }

  return "steady_state";
}

/**
 * Get allowed actions for a given stage (restricts what the bot can do).
 */
export function getStageAllowedActions(stage: BotStage): ActionType[] {
  switch (stage) {
    case "scouting":
      return ["scout_assign"];
    case "accumulating":
      return ["scout_assign", "scout_rebalance", "buy"];
    case "pool_building":
      return [
        "scout_assign",
        "scout_rebalance",
        "pool_create",
        "pool_add_liquidity",
        "buy",
        "sell",
      ];
    case "steady_state":
      return [
        "scout_assign",
        "scout_rebalance",
        "pool_create",
        "pool_add_liquidity",
        "buy",
        "sell",
        "boost_assign",
      ];
  }
}

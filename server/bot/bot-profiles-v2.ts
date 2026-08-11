/**
 * Bot Profiles V2 — Deterministic, profile-driven behavior configuration.
 *
 * Each role has hard-coded defaults. Individual bot_profiles rows can override
 * any field via their DB columns.
 */

export type BotRole = "market_maker" | "trader" | "casual" | "contest" | "cold_market";

export type BotStage = "scouting" | "accumulating" | "pool_building" | "steady_state";

export type ActionType =
  | "scout_assign"
  | "scout_rebalance"
  | "pool_create"
  | "pool_add_liquidity"
  | "buy"
  | "sell"
  | "boost_assign";

export interface BotEnginePolicy {
  marketActionTypes: ActionType[];
  lookbackHours: {
    playerCooldown: number;
    sportMix: number;
    antiHammering: number;
    otherBotCoordination: number;
    slateWindow: number;
  };
  caps: {
    perBotPerPlayer24h: number;
    globalPerPlayer24h: number;
  };
  sportTargets: {
    minShare: number;
    maxShare: number;
    tolerance: number;
  };
}

export const BOT_ENGINE_POLICY: BotEnginePolicy = {
  marketActionTypes: ["pool_create", "pool_add_liquidity", "buy", "sell", "boost_assign"],
  lookbackHours: {
    playerCooldown: 24,
    sportMix: 24,
    antiHammering: 24,
    otherBotCoordination: 2,
    slateWindow: 48,
  },
  caps: {
    perBotPerPlayer24h: 1,
    globalPerPlayer24h: 4,
  },
  sportTargets: {
    minShare: 0.15,
    maxShare: 0.55,
    tolerance: 0.05,
  },
};

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
    actionProbability: 0.75,
    maxDailyActions: 40,
    playerCooldownHours: 4,
    maxPlayerExposurePercent: 12,
    maxSportConcentration: 0.5,
    activeHoursStart: 0,
    activeHoursEnd: 24,
    minOrderSb: 15,
    maxOrderSb: 200,
    scoutTargetCount: 8,
    scoutRotationHours: 48,
    allowedActions: [
      "scout_assign",
      "scout_rebalance",
      "pool_create",
      "pool_add_liquidity",
      "buy",
      "sell",
    ],
    actionWeights: {
      pool_create: 25,
      pool_add_liquidity: 15,
      buy: 10,
      sell: 5,
      scout_assign: 10,
      scout_rebalance: 5,
    },
  },
  trader: {
    actionProbability: 0.7,
    maxDailyActions: 30,
    playerCooldownHours: 4,
    maxPlayerExposurePercent: 15,
    maxSportConcentration: 0.55,
    activeHoursStart: 0,
    activeHoursEnd: 24,
    minOrderSb: 20,
    maxOrderSb: 400,
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
      buy: 25,
      sell: 15,
      pool_create: 10,
      boost_assign: 10,
      scout_assign: 10,
      scout_rebalance: 5,
    },
  },
  casual: {
    actionProbability: 0.5,
    maxDailyActions: 20,
    playerCooldownHours: 6,
    maxPlayerExposurePercent: 10,
    maxSportConcentration: 0.6,
    activeHoursStart: 0,
    activeHoursEnd: 24,
    minOrderSb: 10,
    maxOrderSb: 80,
    scoutTargetCount: 4,
    scoutRotationHours: 48,
    allowedActions: ["scout_assign", "scout_rebalance", "pool_create", "buy", "sell"],
    actionWeights: {
      buy: 25,
      sell: 15,
      scout_assign: 15,
      scout_rebalance: 10,
      pool_create: 10,
    },
  },
  contest: {
    actionProbability: 0.65,
    maxDailyActions: 25,
    playerCooldownHours: 4,
    maxPlayerExposurePercent: 15,
    maxSportConcentration: 0.6,
    activeHoursStart: 0,
    activeHoursEnd: 24,
    minOrderSb: 15,
    maxOrderSb: 150,
    scoutTargetCount: 5,
    scoutRotationHours: 24,
    allowedActions: [
      "scout_assign",
      "scout_rebalance",
      "pool_create",
      "buy",
      "sell",
      "boost_assign",
    ],
    actionWeights: {
      boost_assign: 20,
      buy: 20,
      sell: 10,
      scout_assign: 10,
      pool_create: 5,
      scout_rebalance: 5,
    },
  },
  cold_market: {
    actionProbability: 0.55,
    maxDailyActions: 20,
    playerCooldownHours: 6,
    maxPlayerExposurePercent: 8,
    maxSportConcentration: 0.45,
    activeHoursStart: 0,
    activeHoursEnd: 24,
    minOrderSb: 10,
    maxOrderSb: 60,
    scoutTargetCount: 10,
    scoutRotationHours: 72,
    allowedActions: ["scout_assign", "scout_rebalance", "pool_create", "pool_add_liquidity", "buy"],
    actionWeights: {
      scout_assign: 20,
      pool_create: 20,
      pool_add_liquidity: 10,
      buy: 10,
      scout_rebalance: 5,
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

  if (state.uniquePlayersHeld < 3 || state.balance < 500) {
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
      return ["scout_assign", "scout_rebalance", "buy", "stack_shares"];
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

/**
 * Deterministic Bot Engine V2
 *
 * Replaces the LLM-based runtime with a simple state-machine per bot.
 * Each tick:  decide stage → pick action type → select target → execute → log.
 *
 * Anti-loop guarantees:
 *   - Per-player cooldowns (hard block)
 *   - Sport rotation (concentration limits)
 *   - Action type diversity (least-used preferred)
 *   - Other-bot awareness (don't cluster)
 *   - Weighted random target selection (not always #1)
 *   - Position size caps
 */

import { db } from "../db";
import { botActionsLog, botProfiles, botRunLogs, dailyGames, players, users } from "@shared/schema";
import { eq, and, sql, gte } from "drizzle-orm";
import {
  type BotProfileV2,
  type BotRole,
  type BotStage,
  type ActionType,
  BOT_ENGINE_POLICY,
  ROLE_DEFAULTS,
  determineBotStage,
  getStageAllowedActions,
} from "./bot-profiles-v2";
import {
  type SelectionContext,
  getBotCooldownPlayerIds,
  getBotMarketActionCountsByPlayer,
  getOtherBotRecentPlayerIds,
  getGlobalMarketActionCountsByPlayer,
  getSportActionCounts,
  getBotHeldPlayerIds,
  getBotScoutAssignments,
  selectCandidates,
  pickFromCandidates,
} from "./player-selector";
import { executeBotAction, calculateActionParams } from "./action-executor";
import { storage } from "../storage";
import { getTodayETBoundaries } from "../lib/time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BotState {
  profile: BotProfileV2;
  balance: number;
  totalHoldings: number;
  uniquePlayersHeld: number;
  lpPositionCount: number;
  poolsCreated: number;
  stage: BotStage;
  scoutAssignments: { playerId: string; scoutCount: number }[];
  maxScouts: number;
}

interface TickResult {
  botsProcessed: number;
  botsSkipped: number;
  errors: number;
  details: Array<{
    botName: string;
    role: BotRole;
    stage: BotStage;
    actionType?: ActionType;
    playerName?: string;
    success: boolean;
    reason: string;
  }>;
}

const ENGINE_DISABLED_VALUES = new Set(["0", "false", "off", "disabled"]);

export function isBotEngineEnabled(
  value: string | undefined = process.env.BOT_ENGINE_ENABLED,
): boolean {
  if (!value) return true;
  return !ENGINE_DISABLED_VALUES.has(value.trim().toLowerCase());
}

function normalizeToUnit(weights: Map<string, number>): Map<string, number> {
  const total = Array.from(weights.values()).reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) {
    const equal = new Map<string, number>();
    const sports = Array.from(weights.keys());
    const perSport = sports.length > 0 ? 1 / sports.length : 0;
    for (const sport of sports) {
      equal.set(sport, perSport);
    }
    return equal;
  }

  const normalized = new Map<string, number>();
  for (const [sport, value] of weights.entries()) {
    normalized.set(sport, Math.max(0, value) / total);
  }
  return normalized;
}

export function computeClampedSportTargets(
  weights: Map<string, number>,
  minShare: number,
  maxShare: number,
): Map<string, number> {
  const sports = Array.from(weights.keys());
  if (sports.length === 0) {
    return new Map();
  }

  const raw = normalizeToUnit(weights);
  const targets = new Map<string, number>();
  const lockedLow = new Set<string>();
  const lockedHigh = new Set<string>();

  for (const sport of sports) {
    targets.set(sport, raw.get(sport) || 0);
  }

  for (let i = 0; i < 10; i++) {
    let changed = false;
    let remaining = 1;
    const freeSports = sports.filter((sport) => !lockedLow.has(sport) && !lockedHigh.has(sport));

    for (const sport of lockedLow) {
      targets.set(sport, minShare);
      remaining -= minShare;
    }
    for (const sport of lockedHigh) {
      targets.set(sport, maxShare);
      remaining -= maxShare;
    }

    if (remaining <= 0 || freeSports.length === 0) {
      break;
    }

    const freeRawTotal = freeSports.reduce((sum, sport) => sum + (raw.get(sport) || 0), 0);
    for (const sport of freeSports) {
      const proportion =
        freeRawTotal > 0 ? (raw.get(sport) || 0) / freeRawTotal : 1 / freeSports.length;
      targets.set(sport, remaining * proportion);
    }

    for (const sport of freeSports) {
      const value = targets.get(sport) || 0;
      if (value < minShare) {
        lockedLow.add(sport);
        changed = true;
      } else if (value > maxShare) {
        lockedHigh.add(sport);
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return normalizeToUnit(targets);
}

async function computeSportTargetsFromActiveSlate(): Promise<Map<string, number>> {
  const { startOfDay } = getTodayETBoundaries();
  const windowEnd = new Date(
    Date.now() + BOT_ENGINE_POLICY.lookbackHours.slateWindow * 60 * 60 * 1000,
  );

  const gameRows = await db
    .select({
      sport: dailyGames.sport,
      count: sql<number>`count(distinct ${dailyGames.gameId})::int`,
    })
    .from(dailyGames)
    .where(
      and(
        gte(dailyGames.startTime, startOfDay),
        sql`${dailyGames.startTime} <= ${windowEnd}`,
        sql`COALESCE(LOWER(${dailyGames.status}), '') NOT IN ('completed', 'final', 'cancelled', 'postponed')`,
      ),
    )
    .groupBy(dailyGames.sport);

  const weights = new Map<string, number>();
  for (const row of gameRows) {
    const sport = String(row.sport || "")
      .trim()
      .toUpperCase();
    if (!sport) continue;
    weights.set(sport, Number(row.count || 0));
  }

  if (weights.size === 0) {
    const playerRows = await db
      .select({
        sport: players.sport,
        count: sql<number>`count(*)::int`,
      })
      .from(players)
      .where(eq(players.isActive, true))
      .groupBy(players.sport);

    for (const row of playerRows) {
      const sport = String(row.sport || "")
        .trim()
        .toUpperCase();
      if (!sport) continue;
      weights.set(sport, Number(row.count || 0));
    }
  }

  return computeClampedSportTargets(
    weights,
    BOT_ENGINE_POLICY.sportTargets.minShare,
    BOT_ENGINE_POLICY.sportTargets.maxShare,
  );
}

// ---------------------------------------------------------------------------
// Bot Profile Loading
// ---------------------------------------------------------------------------

/**
 * Load all active bot profiles from the database and map to V2 profiles.
 */
async function loadActiveBots(): Promise<BotProfileV2[]> {
  const rows = await db
    .select()
    .from(botProfiles)
    .innerJoin(users, eq(botProfiles.userId, users.id))
    .where(eq(botProfiles.isActive, true));

  const profiles: BotProfileV2[] = [];

  for (const row of rows) {
    const profile = row.bot_profiles;
    const role = roleOrFallback(profile.botRole as string);
    const defaults = ROLE_DEFAULTS[role];

    profiles.push({
      userId: profile.userId,
      profileId: profile.id,
      botName: profile.botName,
      role,
      isActive: profile.isActive,
      actionProbability: profile.aggressiveness
        ? parseFloat(profile.aggressiveness)
        : defaults.actionProbability,
      maxDailyActions: profile.maxDailyOrders || defaults.maxDailyActions,
      playerCooldownHours:
        Math.max(1, Math.floor(profile.maxActionCooldownMs / 3600000)) ||
        defaults.playerCooldownHours,
      maxPlayerExposurePercent: profile.maxPlayerExposurePercent
        ? parseFloat(String(profile.maxPlayerExposurePercent))
        : defaults.maxPlayerExposurePercent,
      maxSportConcentration: defaults.maxSportConcentration,
      activeHoursStart: profile.activeHoursStart || defaults.activeHoursStart,
      activeHoursEnd: profile.activeHoursEnd || defaults.activeHoursEnd,
      minOrderSb: profile.minOrderSize || defaults.minOrderSb,
      maxOrderSb: profile.maxOrderSize || defaults.maxOrderSb,
      scoutTargetCount: defaults.scoutTargetCount,
      scoutRotationHours: defaults.scoutRotationHours,
      allowedActions: defaults.allowedActions,
      actionWeights: defaults.actionWeights,
    });
  }

  return profiles;
}

function roleOrFallback(role: string): BotRole {
  const valid: BotRole[] = ["market_maker", "trader", "casual", "contest", "cold_market"];
  return valid.includes(role as BotRole) ? (role as BotRole) : "trader";
}

// ---------------------------------------------------------------------------
// Daily Counters
// ---------------------------------------------------------------------------

async function getDailyActionCount(botUserId: string): Promise<number> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(botActionsLog)
    .where(
      and(
        eq(botActionsLog.botUserId, botUserId),
        eq(botActionsLog.success, true),
        gte(botActionsLog.createdAt, today),
      ),
    );

  return row?.count || 0;
}

async function resetDailyCounters(profile: BotProfileV2) {
  const now = new Date();
  await db
    .update(botProfiles)
    .set({
      ordersToday: 0,
      volumeToday: 0,
      lastResetDate: now,
      updatedAt: now,
    })
    .where(eq(botProfiles.id, profile.profileId));
}

// ---------------------------------------------------------------------------
// Active Hours Check
// ---------------------------------------------------------------------------

function isWithinActiveHours(profile: BotProfileV2): boolean {
  const hour = new Date().getUTCHours();
  const { activeHoursStart, activeHoursEnd } = profile;
  if (activeHoursStart <= activeHoursEnd) {
    return hour >= activeHoursStart && hour < activeHoursEnd;
  }
  // Overnight window (e.g., 20-04)
  return hour >= activeHoursStart || hour < activeHoursEnd;
}

// ---------------------------------------------------------------------------
// Action Type Selection
// ---------------------------------------------------------------------------

function selectActionType(
  stage: BotStage,
  _role: BotRole,
  recentActionTypes: ActionType[],
  profile: BotProfileV2,
): ActionType | null {
  const stageAllowed = getStageAllowedActions(stage);
  const roleAllowed = profile.allowedActions;
  const allowed = stageAllowed.filter((a) => roleAllowed.includes(a));

  if (allowed.length === 0) return null;

  // Count recent uses of each action type
  const recentCounts = new Map<ActionType, number>();
  for (const at of recentActionTypes) {
    recentCounts.set(at, (recentCounts.get(at) || 0) + 1);
  }

  // Score: prefer least-used, weight from profile
  const scored = allowed
    .filter((at) => {
      // Block: no 3+ consecutive same action
      const last3 = recentActionTypes.slice(0, 3);
      return !last3.every((r) => r === at);
    })
    .map((at) => {
      const recentCount = recentCounts.get(at) || 0;
      const weight = profile.actionWeights[at] || 10;
      const score = weight - recentCount * 3 + Math.random() * 5;
      return { type: at, score };
    });

  if (scored.length === 0) {
    // Fallback: just pick least-used
    const minCount = Math.min(...allowed.map((a) => recentCounts.get(a) || 0));
    const fallback = allowed.filter((a) => (recentCounts.get(a) || 0) === minCount);
    return fallback[Math.floor(Math.random() * fallback.length)] || allowed[0];
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0].type;
}

function getCoverageFallbackPriority(stage: BotStage): ActionType[] {
  switch (stage) {
    case "scouting":
      return ["scout_assign"];
    case "accumulating":
      return ["buy", "scout_assign", "scout_rebalance"];
    case "pool_building":
      return [
        "pool_create",
        "buy",
        "pool_add_liquidity",
        "sell",
        "scout_assign",
        "scout_rebalance",
      ];
    case "steady_state":
      return [
        "pool_create",
        "buy",
        "pool_add_liquidity",
        "sell",
        "boost_assign",
        "scout_assign",
        "scout_rebalance",
      ];
  }
}

function buildActionAttemptOrder(
  stage: BotStage,
  profile: BotProfileV2,
  primary: ActionType | null,
): ActionType[] {
  const roleAllowed = new Set(profile.allowedActions);
  const stageAllowed = new Set(getStageAllowedActions(stage));
  const allowed = (actionType: ActionType) =>
    roleAllowed.has(actionType) && stageAllowed.has(actionType);

  const sequence: ActionType[] = [];
  if (primary && allowed(primary)) {
    sequence.push(primary);
  }

  for (const fallbackAction of getCoverageFallbackPriority(stage)) {
    if (!allowed(fallbackAction)) continue;
    if (sequence.includes(fallbackAction)) continue;
    sequence.push(fallbackAction);
  }

  return sequence;
}

// ---------------------------------------------------------------------------
// Bot State Loading
// ---------------------------------------------------------------------------

async function loadBotState(profile: BotProfileV2): Promise<BotState | null> {
  const [user] = await db
    .select({ balance: users.balance })
    .from(users)
    .where(eq(users.id, profile.userId));

  if (!user) return null;

  const balance = parseFloat(user.balance);

  // Count holdings (players held + total shares)
  const holdingsResult = await db.execute(sql`
    SELECT 
      COUNT(*)::int as unique_players,
      COALESCE(SUM(CAST(quantity AS FLOAT)), 0) as total_shares
    FROM holdings
    WHERE user_id = ${profile.userId}
      AND asset_type = 'player'
      AND CAST(quantity AS FLOAT) > 0.01
  `);
  const holdingRow = holdingsResult.rows[0] as Record<string, unknown> | undefined;
  const uniquePlayersHeld = Number(holdingRow?.unique_players || 0);
  const totalHoldings = Number(holdingRow?.total_shares || 0);

  // Count LP positions
  const lpResult = await db.execute(sql`
    SELECT COUNT(*)::int as lp_count
    FROM lp_positions
    WHERE user_id = ${profile.userId}
      AND CAST(lp_shares AS FLOAT) > 0
  `);
  const lpRow = lpResult.rows[0] as Record<string, unknown> | undefined;
  const lpPositionCount = Number(lpRow?.lp_count || 0);

  // Count pools this bot has created (via LP transactions)
  const poolsResult = await db.execute(sql`
    SELECT COUNT(DISTINCT player_id)::int as pools_created
    FROM lp_transactions
    WHERE user_id = ${profile.userId}
      AND operation = 'add'
  `);
  const poolRow = poolsResult.rows[0] as Record<string, unknown> | undefined;
  const poolsCreated = Number(poolRow?.pools_created || 0);

  // Get current scout assignments
  const scouts = await getBotScoutAssignments(profile.userId);
  const maxScouts = 10; // All bots are premium

  // Determine stage
  const stage = determineBotStage({
    totalHoldings,
    uniquePlayersHeld,
    balance,
    lpPositionCount,
    poolsCreated,
  });

  return {
    profile,
    balance,
    totalHoldings,
    uniquePlayersHeld,
    lpPositionCount,
    poolsCreated,
    stage,
    scoutAssignments: scouts,
    maxScouts,
  };
}

// ---------------------------------------------------------------------------
// Single Bot Tick
// ---------------------------------------------------------------------------

async function runBotTick(
  state: BotState,
  sportTargets: Map<string, number>,
): Promise<{
  actionType?: ActionType;
  playerName?: string;
  success: boolean;
  reason: string;
}> {
  const { profile, stage } = state;

  // 1. Daily cap check
  const dailyCount = await getDailyActionCount(profile.userId);
  if (dailyCount >= profile.maxDailyActions) {
    return { success: false, reason: "daily_action_cap" };
  }

  // 2. Active hours check
  if (!isWithinActiveHours(profile)) {
    return { success: false, reason: "outside_active_hours" };
  }

  // 3. Probability roll
  if (Math.random() > profile.actionProbability) {
    return { success: false, reason: "probability_skip" };
  }

  // 4. Get recent action types for this bot (last 20 actions)
  const recentActionsResult = await db.execute(sql`
    SELECT action_type
    FROM bot_actions_log
    WHERE bot_user_id = ${profile.userId}
    ORDER BY created_at DESC
    LIMIT 20
  `);
  const recentActionTypes: ActionType[] = [];
  for (const row of recentActionsResult.rows) {
    const at = (row as Record<string, unknown>).action_type as string;
    if (at) recentActionTypes.push(at as ActionType);
  }

  // 5. Pick action type
  const primaryActionType = selectActionType(stage, profile.role, recentActionTypes, profile);

  const actionAttemptOrder = buildActionAttemptOrder(stage, profile, primaryActionType);
  if (actionAttemptOrder.length === 0) {
    return { success: false, reason: "no_eligible_action_type" };
  }

  // 6. Build selection context inputs once for this tick
  const recentIds = await getBotCooldownPlayerIds(profile.userId, profile.playerCooldownHours);
  const otherBotIds = await getOtherBotRecentPlayerIds(
    profile.userId,
    BOT_ENGINE_POLICY.lookbackHours.otherBotCoordination,
  );
  const sportCounts = await getSportActionCounts(profile.userId, {
    windowHours: BOT_ENGINE_POLICY.lookbackHours.sportMix,
    actionTypes: BOT_ENGINE_POLICY.marketActionTypes,
  });
  const heldIds = await getBotHeldPlayerIds(profile.userId);
  const botMarketCounts = await getBotMarketActionCountsByPlayer(
    profile.userId,
    BOT_ENGINE_POLICY.lookbackHours.antiHammering,
    BOT_ENGINE_POLICY.marketActionTypes,
  );
  const globalMarketCounts = await getGlobalMarketActionCountsByPlayer(
    BOT_ENGINE_POLICY.lookbackHours.antiHammering,
    BOT_ENGINE_POLICY.marketActionTypes,
  );

  let lastReason = "no_eligible_action_type";

  // 7. Attempt primary action first, then coverage-oriented fallbacks.
  for (const actionType of actionAttemptOrder) {
    if (actionType === "scout_assign") {
      const scoutResult = await handleScoutAssign(state);
      if (scoutResult.success) return scoutResult;
      lastReason = scoutResult.reason;
      continue;
    }

    if (actionType === "scout_rebalance") {
      const scoutResult = await handleScoutRebalance(state);
      if (scoutResult.success) return scoutResult;
      lastReason = scoutResult.reason;
      continue;
    }

    const context: SelectionContext = {
      botUserId: profile.userId,
      actionType,
      recentPlayerIds: recentIds,
      otherBotRecentPlayerIds: otherBotIds,
      sportActionCounts: sportCounts,
      sportTargets,
      sportTargetTolerance: BOT_ENGINE_POLICY.sportTargets.tolerance,
      maxSportConcentration: profile.maxSportConcentration,
      heldPlayerIds: heldIds,
      marketActionTypes: new Set(BOT_ENGINE_POLICY.marketActionTypes),
      botMarketActionCountsByPlayer: botMarketCounts,
      globalMarketActionCountsByPlayer: globalMarketCounts,
      maxBotMarketActionsPerPlayer24h: BOT_ENGINE_POLICY.caps.perBotPerPlayer24h,
      maxGlobalMarketActionsPerPlayer24h: BOT_ENGINE_POLICY.caps.globalPerPlayer24h,
    };

    const candidates = await selectCandidates(context, 20);
    const target = pickFromCandidates(candidates);
    if (!target) {
      lastReason = `no_eligible_players_for_${actionType}`;
      continue;
    }

    const params = calculateActionParams(actionType, target, {
      minOrderSb: profile.minOrderSb,
      maxOrderSb: profile.maxOrderSb,
    });

    const result = await executeBotAction(
      profile.userId,
      profile.profileId,
      actionType,
      target,
      params,
    );

    if (result.success) {
      return {
        actionType,
        playerName: target.playerName,
        success: true,
        reason: "executed",
      };
    }

    lastReason = result.errorMessage || "execution_failed";
  }

  return {
    actionType: primaryActionType || undefined,
    success: false,
    reason: lastReason,
  };
}

// ---------------------------------------------------------------------------
// Scout Handling
// ---------------------------------------------------------------------------

async function handleScoutAssign(state: BotState): Promise<{
  actionType: ActionType;
  playerName?: string;
  success: boolean;
  reason: string;
}> {
  const { profile, scoutAssignments, maxScouts } = state;

  const currentUsed = scoutAssignments.reduce((sum, s) => sum + s.scoutCount, 0);
  if (currentUsed >= maxScouts) {
    return { actionType: "scout_assign", success: false, reason: "scout_slots_full" };
  }

  // Find an active player not yet scouted and without a pool
  const scoutedIds = new Set(scoutAssignments.map((s) => s.playerId));

  const rows = await db.execute(sql`
    SELECT p.id, p.first_name, p.last_name, p.sport
    FROM players p
    WHERE p.is_active = true
      AND p.id NOT IN (
        SELECT player_id FROM player_pools
      )
    ORDER BY RANDOM()
    LIMIT 10
  `);

  for (const row of rows.rows) {
    const r = row as Record<string, unknown>;
    const pid = String(r.id || "");
    if (scoutedIds.has(pid)) continue;

    await storage.assignScouts(profile.userId, pid, 1);

    return {
      actionType: "scout_assign",
      playerName: `${r.first_name} ${r.last_name}`,
      success: true,
      reason: `assigned_scout_to_${pid}`,
    };
  }

  return { actionType: "scout_assign", success: false, reason: "no_unscouted_players_found" };
}

async function handleScoutRebalance(state: BotState): Promise<{
  actionType: ActionType;
  playerName?: string;
  success: boolean;
  reason: string;
}> {
  const { profile, scoutAssignments } = state;

  if (scoutAssignments.length === 0) {
    return { actionType: "scout_rebalance", success: false, reason: "no_scouts_to_rebalance" };
  }

  // Pick a random current scout to remove from
  const source = scoutAssignments[Math.floor(Math.random() * scoutAssignments.length)];
  const newCount = Math.max(0, source.scoutCount - 1);
  await storage.assignScouts(profile.userId, source.playerId, newCount);

  // Assign scout to a new player
  const scoutedIds = new Set(scoutAssignments.map((s) => s.playerId));

  const rows = await db.execute(sql`
    SELECT p.id, p.first_name, p.last_name
    FROM players p
    WHERE p.is_active = true
      AND p.id NOT IN (
        SELECT player_id FROM player_pools
      )
    ORDER BY RANDOM()
    LIMIT 5
  `);

  for (const row of rows.rows) {
    const r = row as Record<string, unknown>;
    const pid = String(r.id || "");
    if (scoutedIds.has(pid)) continue;

    await storage.assignScouts(profile.userId, pid, 1);

    return {
      actionType: "scout_rebalance",
      playerName: `${r.first_name} ${r.last_name}`,
      success: true,
      reason: `rebalanced_from_${source.playerId}`,
    };
  }

  // Couldn't rebalance — put the scout back
  await storage.assignScouts(profile.userId, source.playerId, source.scoutCount);
  return { actionType: "scout_rebalance", success: false, reason: "no_rebalance_target_found" };
}

// ---------------------------------------------------------------------------
// Main Engine Tick
// ---------------------------------------------------------------------------

/**
 * Run one tick of the deterministic bot engine.
 * Called by the scheduler every 15 minutes.
 */
export async function runDeterministicBotEngineTick(): Promise<TickResult> {
  if (!isBotEngineEnabled()) {
    return {
      botsProcessed: 0,
      botsSkipped: 0,
      errors: 0,
      details: [
        {
          botName: "engine",
          role: "trader",
          stage: "steady_state",
          success: false,
          reason: "engine_disabled",
        },
      ],
    };
  }

  const activeBots = await loadActiveBots();
  const sportTargets = await computeSportTargetsFromActiveSlate();

  if (activeBots.length === 0) {
    return { botsProcessed: 0, botsSkipped: 0, errors: 0, details: [] };
  }

  const result: TickResult = {
    botsProcessed: 0,
    botsSkipped: 0,
    errors: 0,
    details: [],
  };

  for (const profile of activeBots) {
    try {
      const state = await loadBotState(profile);
      if (!state) {
        result.botsSkipped++;
        result.details.push({
          botName: profile.botName,
          role: profile.role,
          stage: "scouting" as BotStage,
          success: false,
          reason: "user_not_found",
        });
        continue;
      }

      const tickResult = await runBotTick(state, sportTargets);

      // Log to bot_run_logs
      await db.insert(botRunLogs).values({
        cycleKey: new Date().toISOString().slice(0, 13),
        botUserId: profile.userId,
        botProfileId: profile.profileId,
        status: tickResult.success ? "executed" : "no_action",
        role: profile.role,
        summary: `${tickResult.actionType || "no_action"}: ${tickResult.playerName || tickResult.reason}`,
        plannedActions: [],
        executedActions: [],
        citations: [],
        toolTrace: [],
        completedAt: new Date(),
      });

      if (tickResult.success) {
        result.botsProcessed++;
      } else if (tickResult.reason.includes("cap") || tickResult.reason.includes("skip")) {
        result.botsSkipped++;
      } else {
        // Could not find eligible target — not an error, just nothing to do this tick
        result.botsSkipped++;
      }

      result.details.push({
        botName: profile.botName,
        role: profile.role,
        stage: state.stage,
        actionType: tickResult.actionType,
        playerName: tickResult.playerName,
        success: tickResult.success,
        reason: tickResult.reason,
      });
    } catch (error: any) {
      result.errors++;
      result.details.push({
        botName: profile.botName,
        role: profile.role,
        stage: "scouting" as BotStage,
        success: false,
        reason: error?.message || "unknown_error",
      });

      // Log error
      try {
        await db.insert(botRunLogs).values({
          cycleKey: new Date().toISOString().slice(0, 13),
          botUserId: profile.userId,
          botProfileId: profile.profileId,
          status: "failed",
          role: profile.role,
          summary: error?.message || "Bot tick failed",
          errorMessage: error?.message || "Bot tick failed",
          plannedActions: [],
          executedActions: [],
          citations: [],
          toolTrace: [],
          completedAt: new Date(),
        });
      } catch (_) {
        // Silently ignore log failures
      }
    }
  }

  return result;
}

/**
 * Get engine status for admin/monitoring.
 */
export async function getDeterministicEngineStatus() {
  const activeBots = await loadActiveBots();
  const sportTargets = await computeSportTargetsFromActiveSlate();
  return {
    engineEnabled: isBotEngineEnabled(),
    policy: BOT_ENGINE_POLICY,
    activeBots: activeBots.length,
    sportTargets: Object.fromEntries(sportTargets.entries()),
    bots: activeBots.map((b) => ({
      name: b.botName,
      role: b.role,
      isActive: b.isActive,
    })),
  };
}

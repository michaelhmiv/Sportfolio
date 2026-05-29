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
import {
  botProfiles,
  botRunLogs,
  users,
} from "@shared/schema";
import { eq, and, sql, gte } from "drizzle-orm";
import {
  type BotProfileV2,
  type BotRole,
  type BotStage,
  type ActionType,
  ROLE_DEFAULTS,
  determineBotStage,
  getStageAllowedActions,
} from "./bot-profiles-v2";
import {
  type SelectionContext,
  getBotCooldownPlayerIds,
  getOtherBotRecentPlayerIds,
  getSportActionCounts,
  getBotHeldPlayerIds,
  getPooledPlayerIds,
  getBotScoutAssignments,
  selectCandidates,
  pickFromCandidates,
} from "./player-selector";
import {
  executeBotAction,
  calculateActionParams,
} from "./action-executor";
import { storage } from "../storage";

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
      actionProbability:
        (profile.aggressiveness
          ? parseFloat(profile.aggressiveness)
          : defaults.actionProbability),
      maxDailyActions: profile.maxDailyOrders || defaults.maxDailyActions,
      playerCooldownHours:
        Math.max(1, Math.floor(profile.maxActionCooldownMs / 3600000)) ||
        defaults.playerCooldownHours,
      maxPlayerExposurePercent:
        profile.maxPlayerExposurePercent
          ? parseFloat(String(profile.maxPlayerExposurePercent))
          : defaults.maxPlayerExposurePercent,
      maxSportConcentration: defaults.maxSportConcentration,
      activeHoursStart:
        profile.activeHoursStart || defaults.activeHoursStart,
      activeHoursEnd:
        profile.activeHoursEnd || defaults.activeHoursEnd,
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
  const valid: BotRole[] = [
    "market_maker",
    "trader",
    "casual",
    "contest",
    "cold_market",
  ];
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
    .from(botRunLogs)
    .where(and(eq(botRunLogs.botUserId, botUserId), gte(botRunLogs.createdAt, today)));

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
  role: BotRole,
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
    const minCount = Math.min(
      ...allowed.map((a) => recentCounts.get(a) || 0),
    );
    const fallback = allowed.filter(
      (a) => (recentCounts.get(a) || 0) === minCount,
    );
    return fallback[Math.floor(Math.random() * fallback.length)] || allowed[0];
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0].type;
}

// ---------------------------------------------------------------------------
// Bot State Loading
// ---------------------------------------------------------------------------

async function loadBotState(
  profile: BotProfileV2,
): Promise<BotState | null> {
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
  const actionType = selectActionType(
    stage,
    profile.role,
    recentActionTypes,
    profile,
  );
  if (!actionType) {
    return { success: false, reason: "no_eligible_action_type" };
  }

  // 6. Scouting-specific logic
  if (actionType === "scout_assign") {
    return handleScoutAssign(state);
  }
  if (actionType === "scout_rebalance") {
    return handleScoutRebalance(state);
  }

  // 7. Build selection context
  const recentIds = await getBotCooldownPlayerIds(
    profile.userId,
    profile.playerCooldownHours,
  );
  const otherBotIds = await getOtherBotRecentPlayerIds(profile.userId, 2);
  const sportCounts = await getSportActionCounts(profile.userId);
  const heldIds = await getBotHeldPlayerIds(profile.userId);

  const context: SelectionContext = {
    botUserId: profile.userId,
    actionType,
    recentPlayerIds: recentIds,
    otherBotRecentPlayerIds: otherBotIds,
    sportActionCounts: sportCounts,
    maxSportConcentration: profile.maxSportConcentration,
    heldPlayerIds: heldIds,
    pooledPlayerIds: new Set(), // Populated by selectCandidates
  };

  // 8. Select candidates
  const candidates = await selectCandidates(context, 20);
  const target = pickFromCandidates(candidates);

  if (!target) {
    return {
      success: false,
      reason: `no_eligible_players_for_${actionType}`,
    };
  }

  // 9. Calculate params and execute
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

  return {
    actionType,
    playerName: target.playerName,
    success: result.success,
    reason: result.success
      ? "executed"
      : (result.errorMessage || "execution_failed"),
  };
}

// ---------------------------------------------------------------------------
// Scout Handling
// ---------------------------------------------------------------------------

async function handleScoutAssign(
  state: BotState,
): Promise<{
  actionType: ActionType;
  playerName?: string;
  success: boolean;
  reason: string;
}> {
  const { profile, scoutAssignments, maxScouts } = state;

  const currentUsed = scoutAssignments.reduce((sum, s) => sum + s.scoutCount, 0);
  if (currentUsed >= maxScouts) {
    return { success: false, reason: "scout_slots_full" };
  }

  // Get all players WITHOUT pools (scout targets for bootstrapping)
  const pooledIds = await getPooledPlayerIds();

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

  return { success: false, reason: "no_unscouted_players_found" };
}

async function handleScoutRebalance(
  state: BotState,
): Promise<{
  actionType: ActionType;
  playerName?: string;
  success: boolean;
  reason: string;
}> {
  const { profile, scoutAssignments } = state;

  if (scoutAssignments.length === 0) {
    return { success: false, reason: "no_scouts_to_rebalance" };
  }

  // Pick a random current scout to remove from
  const source =
    scoutAssignments[Math.floor(Math.random() * scoutAssignments.length)];
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
  return { success: false, reason: "no_rebalance_target_found" };
}

// ---------------------------------------------------------------------------
// Main Engine Tick
// ---------------------------------------------------------------------------

/**
 * Run one tick of the deterministic bot engine.
 * Called by the scheduler every 15 minutes.
 */
export async function runDeterministicBotEngineTick(): Promise<TickResult> {
  const activeBots = await loadActiveBots();

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

      const tickResult = await runBotTick(state);

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
  return {
    activeBots: activeBots.length,
    bots: activeBots.map((b) => ({
      name: b.botName,
      role: b.role,
      isActive: b.isActive,
    })),
  };
}

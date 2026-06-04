/**
 * Player Selector — Weighted scoring with anti-loop guarantees.
 *
 * Selects target players for bot actions using a scoring system that
 * prevents repetitive behavior through cooldowns, sport rotation,
 * global coordination, and randomized jitter.
 */

import { db } from "../db";
import { botActionsLog, holdings, playerPools, players, scoutAssignments } from "@shared/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { ActionType } from "./bot-profiles-v2";

export interface PlayerCandidate {
  playerId: string;
  playerName: string;
  sport: string;
  team: string;
  position: string;
  hasPool: boolean;
  totalTrades: number;
  lastTradePrice: number | null;
  currentPrice: number | null;
  fairValue: number | null;
  hasUpcomingGame: boolean;
  /** Score computed by the selector (higher = better target) */
  score: number;
}

export interface SelectionContext {
  botUserId: string;
  actionType: ActionType;
  recentPlayerIds: Set<string>;
  otherBotRecentPlayerIds: Set<string>;
  availableSharesByPlayer: Map<string, number>;
  sportActionCounts: Map<string, number>;
  sportTargets: Map<string, number>;
  sportTargetTolerance: number;
  maxSportConcentration: number;
  heldPlayerIds: Set<string>;
  marketActionTypes: Set<ActionType>;
  botMarketActionCountsByPlayer: Map<string, number>;
  globalMarketActionCountsByPlayer: Map<string, number>;
  maxBotMarketActionsPerPlayer24h: number;
  maxGlobalMarketActionsPerPlayer24h: number;
}

/**
 * Get player IDs that this bot has interacted with recently (within cooldown window).
 */
export async function getBotCooldownPlayerIds(
  botUserId: string,
  cooldownHours: number,
): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

  const rows = await db
    .select({
      playerId: sql<string>`
        COALESCE(
          action_details->'action'->>'playerId',
          action_details->>'playerId'
        )
      `,
    })
    .from(botActionsLog)
    .where(
      and(
        eq(botActionsLog.botUserId, botUserId),
        eq(botActionsLog.success, true),
        gte(botActionsLog.createdAt, cutoff),
      ),
    );

  const ids = new Set<string>();
  for (const row of rows) {
    if (row.playerId && typeof row.playerId === "string" && row.playerId.trim()) {
      ids.add(row.playerId.trim());
    }
  }
  return ids;
}

/**
 * Get player IDs that ANY other bot has interacted with in the last N hours.
 */
export async function getOtherBotRecentPlayerIds(
  excludeBotUserId: string,
  windowHours: number = 2,
): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const rows = await db
    .select({
      playerId: sql<string>`
        COALESCE(
          action_details->'action'->>'playerId',
          action_details->>'playerId'
        )
      `,
    })
    .from(botActionsLog)
    .where(
      and(
        sql`${botActionsLog.botUserId} != ${excludeBotUserId}`,
        eq(botActionsLog.success, true),
        gte(botActionsLog.createdAt, cutoff),
      ),
    );

  const ids = new Set<string>();
  for (const row of rows) {
    if (row.playerId && typeof row.playerId === "string" && row.playerId.trim()) {
      ids.add(row.playerId.trim());
    }
  }
  return ids;
}

/**
 * Get sport action counts for a bot in the last 24h.
 */
export async function getSportActionCounts(
  botUserId: string,
  options?: { windowHours?: number; actionTypes?: ActionType[] },
): Promise<Map<string, number>> {
  const windowHours = options?.windowHours ?? 24;
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const actionTypes = options?.actionTypes ?? [];
  const actionFilter =
    actionTypes.length > 0
      ? sql`AND bal.action_type IN (${sql.join(
          actionTypes.map((actionType) => sql`${actionType}`),
          sql`, `,
        )})`
      : sql``;

  const rows = await db.execute(sql`
    SELECT p.sport, COUNT(*)::int as cnt
    FROM bot_actions_log bal
    JOIN players p ON p.id = COALESCE(
      bal.action_details->'action'->>'playerId',
      bal.action_details->>'playerId'
    )
    WHERE bal.bot_user_id = ${botUserId}
      AND bal.success = true
      AND bal.created_at >= ${cutoff}
      ${actionFilter}
    GROUP BY p.sport
  `);

  const counts = new Map<string, number>();
  for (const row of rows.rows) {
    const r = row as Record<string, unknown>;
    if (typeof r.sport === "string" && r.sport) {
      counts.set(r.sport, Number(r.cnt || 0));
    }
  }
  return counts;
}

async function getMarketActionCountsByPlayer(
  whereClause: any,
  windowHours: number,
  actionTypes: ActionType[],
): Promise<Map<string, number>> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const typeFilter = inArray(botActionsLog.actionType, actionTypes);
  const rows = await db
    .select({
      playerId: sql<string>`
        COALESCE(
          ${botActionsLog.actionDetails}->'action'->>'playerId',
          ${botActionsLog.actionDetails}->>'playerId'
        )
      `,
      count: sql<number>`count(*)::int`,
    })
    .from(botActionsLog)
    .where(
      and(
        whereClause,
        eq(botActionsLog.success, true),
        gte(botActionsLog.createdAt, cutoff),
        typeFilter,
      ),
    )
    .groupBy(
      sql`
        COALESCE(
          ${botActionsLog.actionDetails}->'action'->>'playerId',
          ${botActionsLog.actionDetails}->>'playerId'
        )
      `,
    );

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.playerId || !row.playerId.trim()) continue;
    counts.set(row.playerId.trim(), Number(row.count || 0));
  }
  return counts;
}

export async function getBotMarketActionCountsByPlayer(
  botUserId: string,
  windowHours: number,
  actionTypes: ActionType[],
): Promise<Map<string, number>> {
  return getMarketActionCountsByPlayer(
    eq(botActionsLog.botUserId, botUserId),
    windowHours,
    actionTypes,
  );
}

export async function getGlobalMarketActionCountsByPlayer(
  windowHours: number,
  actionTypes: ActionType[],
): Promise<Map<string, number>> {
  return getMarketActionCountsByPlayer(sql`TRUE`, windowHours, actionTypes);
}

/**
 * Get player IDs that the bot currently holds shares of.
 */
export async function getBotHeldPlayerIds(botUserId: string): Promise<Set<string>> {
  const rows = await db
    .select({ assetId: holdings.assetId })
    .from(holdings)
    .where(
      and(
        eq(holdings.userId, botUserId),
        eq(holdings.assetType, "player"),
        sql`CAST(${holdings.quantity} AS FLOAT) > 0.01`,
      ),
    );

  return new Set(rows.map((r) => r.assetId));
}

export function shouldBlockMarketActionForPlayer(input: {
  actionType: ActionType;
  marketActionTypes: Set<ActionType>;
  playerId: string;
  botCountsByPlayer: Map<string, number>;
  globalCountsByPlayer: Map<string, number>;
  maxBotActionsPerPlayer24h: number;
  maxGlobalActionsPerPlayer24h: number;
}): boolean {
  if (!input.marketActionTypes.has(input.actionType)) {
    return false;
  }

  const botCount = input.botCountsByPlayer.get(input.playerId) || 0;
  if (botCount >= input.maxBotActionsPerPlayer24h) {
    return true;
  }

  const globalCount = input.globalCountsByPlayer.get(input.playerId) || 0;
  return globalCount >= input.maxGlobalActionsPerPlayer24h;
}

export function isSportOverTarget(input: {
  sport: string;
  sportActionCounts: Map<string, number>;
  sportTargets: Map<string, number>;
  tolerance: number;
}): boolean {
  const target = input.sportTargets.get(input.sport);
  if (typeof target !== "number") {
    return false;
  }

  const totalActions = Array.from(input.sportActionCounts.values()).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (totalActions <= 0) {
    return false;
  }

  const sportCount = input.sportActionCounts.get(input.sport) || 0;
  const currentShare = sportCount / totalActions;
  return currentShare > target + input.tolerance;
}

/**
 * Get all player IDs that have an active pool.
 */
export async function getPooledPlayerIds(): Promise<Set<string>> {
  const rows = await db.select({ playerId: playerPools.playerId }).from(playerPools);

  return new Set(rows.map((r) => r.playerId).filter(Boolean) as string[]);
}

/**
 * Get the bot's current scout assignments.
 */
export async function getBotScoutAssignments(
  botUserId: string,
): Promise<{ playerId: string; scoutCount: number }[]> {
  const rows = await db
    .select({
      playerId: scoutAssignments.playerId,
      scoutCount: scoutAssignments.scoutCount,
    })
    .from(scoutAssignments)
    .where(eq(scoutAssignments.userId, botUserId));

  return rows.map((r) => ({
    playerId: r.playerId,
    scoutCount: r.scoutCount,
  }));
}

/**
 * Select candidate players for a given action type.
 * Returns scored candidates sorted by score descending.
 */
export async function selectCandidates(
  context: SelectionContext,
  limit: number = 20,
): Promise<PlayerCandidate[]> {
  // Fetch active players with optional pool data
  const rows = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      sport: players.sport,
      team: players.team,
      position: players.position,
      currentPrice: players.currentPrice,
      lastTradePrice: players.lastTradePrice,
      poolPlayerId: playerPools.playerId,
      totalTrades: playerPools.totalTrades,
    })
    .from(players)
    .leftJoin(playerPools, eq(players.id, playerPools.playerId))
    .where(eq(players.isActive, true))
    .limit(500); // Sample size — shuffle later

  const totalSportActions = Array.from(context.sportActionCounts.values()).reduce(
    (a, b) => a + b,
    0,
  );
  const isMarketAction = context.marketActionTypes.has(context.actionType);
  const preferredCandidates: PlayerCandidate[] = [];
  const fallbackOverTargetCandidates: PlayerCandidate[] = [];

  for (const row of rows) {
    const playerId = row.id;
    const hasPool = Boolean(row.poolPlayerId);
    const sport = row.sport;
    const availableShares = context.availableSharesByPlayer.get(playerId) || 0;

    // Hard block: cooldown
    if (context.recentPlayerIds.has(playerId)) {
      continue;
    }

    // Action-specific eligibility
    if (context.actionType === "pool_create" && hasPool) {
      continue; // Can't create a pool that already exists
    }
    if (context.actionType === "pool_add_liquidity" && !hasPool) {
      continue; // Can only add to existing pools (use pool_create for new)
    }
    if (context.actionType === "sell" && !context.heldPlayerIds.has(playerId)) {
      continue; // Can't sell what you don't own
    }
    if (context.actionType === "buy" && !hasPool) {
      continue; // Can't buy without a pool
    }
    if (context.actionType === "pool_create" && !context.heldPlayerIds.has(playerId)) {
      continue; // Need shares to create a pool
    }
    if (context.actionType === "boost_assign" && !context.heldPlayerIds.has(playerId)) {
      continue; // Need shares to boost
    }
    if (
      (context.actionType === "sell" ||
        context.actionType === "pool_create" ||
        context.actionType === "pool_add_liquidity" ||
        context.actionType === "boost_assign") &&
      availableShares < 1
    ) {
      continue; // Can't use locked-only holdings
    }

    if (
      shouldBlockMarketActionForPlayer({
        actionType: context.actionType,
        marketActionTypes: context.marketActionTypes,
        playerId,
        botCountsByPlayer: context.botMarketActionCountsByPlayer,
        globalCountsByPlayer: context.globalMarketActionCountsByPlayer,
        maxBotActionsPerPlayer24h: context.maxBotMarketActionsPerPlayer24h,
        maxGlobalActionsPerPlayer24h: context.maxGlobalMarketActionsPerPlayer24h,
      })
    ) {
      continue;
    }

    // Sport concentration check (soft: penalize, don't block)
    const sportCount = context.sportActionCounts.get(sport) || 0;
    const sportShare = totalSportActions > 0 ? sportCount / totalSportActions : 0;
    const overConcentrated = sportShare > context.maxSportConcentration;

    // Scoring
    let score = 100; // base

    // Other bot recently touched → strong penalty
    if (context.otherBotRecentPlayerIds.has(playerId)) {
      score -= 500;
    }

    // No pool → bonus for pool_create actions
    if (!hasPool && context.actionType === "pool_create") {
      score += 200;
    }

    // Cold pool (low trades) → bonus
    if (hasPool && (row.totalTrades || 0) < 5) {
      score += 100;
    }

    // Sport rotation bonus
    if (!overConcentrated) {
      score += 50;
    } else {
      score -= 150;
    }

    // Sport deficit bonus (prefer underrepresented sports)
    const sportDeficit = Math.max(0, 3 - sportCount);
    score += sportDeficit * 40;

    // Already held → slight preference for sell/LP actions
    if (context.heldPlayerIds.has(playerId)) {
      if (context.actionType === "sell" || context.actionType === "pool_add_liquidity") {
        score += 80;
      }
    }

    // Randomized jitter (0-80 points)
    score += Math.random() * 80;

    const candidate: PlayerCandidate = {
      playerId,
      playerName: `${row.firstName} ${row.lastName}`,
      sport,
      team: row.team,
      position: row.position,
      hasPool,
      totalTrades: row.totalTrades || 0,
      lastTradePrice: row.lastTradePrice ? parseFloat(row.lastTradePrice) : null,
      currentPrice: row.currentPrice ? parseFloat(row.currentPrice) : null,
      fairValue: null, // Computed separately if needed
      hasUpcomingGame: false, // TODO: wire to schedule data
      score,
    };

    if (
      isMarketAction &&
      isSportOverTarget({
        sport,
        sportActionCounts: context.sportActionCounts,
        sportTargets: context.sportTargets,
        tolerance: context.sportTargetTolerance,
      })
    ) {
      fallbackOverTargetCandidates.push(candidate);
      continue;
    }

    preferredCandidates.push(candidate);
  }

  const candidates =
    preferredCandidates.length > 0 ? preferredCandidates : fallbackOverTargetCandidates;

  // Sort by score descending, take top N
  candidates.sort((a, b) => b.score - a.score);

  // Return top candidates but pick randomly from top-3 for final selection
  return candidates.slice(0, limit);
}

/**
 * Pick a single player from candidates. Picks randomly from top-3
 * (weighted toward #1 but not deterministic).
 */
export function pickFromCandidates(candidates: PlayerCandidate[]): PlayerCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const top = candidates.slice(0, Math.min(3, candidates.length));
  // Weight: 50% chance #1, 30% chance #2, 20% chance #3
  const roll = Math.random();
  if (roll < 0.5) return top[0];
  if (roll < 0.8 && top.length > 1) return top[1];
  return top[top.length - 1];
}

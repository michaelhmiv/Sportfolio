import "dotenv/config";

import { randomUUID } from "crypto";
import {
  boostPayouts,
  communityBoosts,
  dailyBoosts,
  holdings,
  holdingsLocks,
  lpPositions,
  lpTransactions,
  orders,
  playerGameStats,
  playerIdAliases,
  playerMarketMetrics,
  playerMultiplierEvents,
  playerMultipliers,
  playerPools,
  players,
  priceHistory,
  scoutAssignments,
  scoutDistributions,
  scoutHistory,
  sharePayouts,
  trades,
  userAgentProposals,
  users,
  vesting,
  vestingClaims,
  vestingSplits,
  watchList,
} from "@shared/schema";
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "../server/db";
import { getETDayBoundaries, getGameDay } from "../server/lib/time";

const DRY_RUN = process.argv.includes("--dry-run");

type Tx = typeof db | any;

interface DuplicateGroup {
  firstName: string;
  lastName: string;
  sport: string;
  team: string;
  playerIds: string[];
}

interface CandidateMetrics {
  id: string;
  sport: string;
  team: string;
  totalShares: number;
  volume24h: number;
  lastUpdatedMs: number;
  statsCount: number;
  latestStatMs: number;
  holdingsCount: number;
  multiplierCount: number;
  activeBoostCount: number;
  communityBoostCount: number;
  sharePayoutCount: number;
  lpPositionCount: number;
  poolCount: number;
}

interface RepairSummary {
  duplicateGroups: number;
  aliasesCreated: number;
  playersDeleted: number;
  safeUpdates: number;
  holdingsMerged: number;
  multipliersMerged: number;
  lpPositionsMerged: number;
  lpPoolsUnwound: number;
  scoutAssignmentsMerged: number;
  sharePayoutsMerged: number;
  zeroBoostsRepaired: number;
}

const summary: RepairSummary = {
  duplicateGroups: 0,
  aliasesCreated: 0,
  playersDeleted: 0,
  safeUpdates: 0,
  holdingsMerged: 0,
  multipliersMerged: 0,
  lpPositionsMerged: 0,
  lpPoolsUnwound: 0,
  scoutAssignmentsMerged: 0,
  sharePayoutsMerged: 0,
  zeroBoostsRepaired: 0,
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateMs(value: unknown): number {
  if (!value) return 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getDuplicateGroups(): Promise<DuplicateGroup[]> {
  const result = await db.execute(sql`
    SELECT
      MIN(first_name)::text AS first_name,
      MIN(last_name)::text AS last_name,
      UPPER(sport)::text AS sport,
      UPPER(team)::text AS team,
      array_agg(id ORDER BY id) AS player_ids
    FROM players
    GROUP BY LOWER(first_name), LOWER(last_name), UPPER(sport), UPPER(team)
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, MIN(last_name), MIN(first_name)
  `);

  return result.rows.map((row: any) => ({
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    sport: String(row.sport),
    team: String(row.team),
    playerIds: (row.player_ids as string[]) || [],
  }));
}

async function getCandidateMetrics(playerId: string): Promise<CandidateMetrics> {
  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) {
    throw new Error(`Player ${playerId} not found while scoring duplicate group`);
  }

  const [
    statsResult,
    holdingsResult,
    multiplierResult,
    activeBoostResult,
    communityBoostResult,
    sharePayoutResult,
    lpPositionResult,
    poolResult,
  ] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS total, MAX(game_date) AS latest_game_date
      FROM player_game_stats
      WHERE player_id = ${playerId}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM holdings
      WHERE asset_type = 'player'
        AND asset_id = ${playerId}
        AND CAST(quantity AS numeric) > 0
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM player_multipliers
      WHERE player_id = ${playerId}
        AND multiplier > 0
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM daily_boosts
      WHERE player_id = ${playerId}
        AND status IN ('active', 'locked')
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM community_boosts
      WHERE player_id = ${playerId}
        AND status <> 'cancelled'
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM share_payouts
      WHERE player_id = ${playerId}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM lp_positions
      WHERE player_id = ${playerId}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM player_pools
      WHERE player_id = ${playerId}
    `),
  ]);

  const statsRow = statsResult.rows[0] as any;

  return {
    id: player.id,
    sport: player.sport,
    team: player.team,
    totalShares: player.totalShares,
    volume24h: toNumber(player.volume24h),
    lastUpdatedMs: toDateMs(player.lastUpdated),
    statsCount: toNumber(statsRow?.total),
    latestStatMs: toDateMs(statsRow?.latest_game_date),
    holdingsCount: toNumber((holdingsResult.rows[0] as any)?.total),
    multiplierCount: toNumber((multiplierResult.rows[0] as any)?.total),
    activeBoostCount: toNumber((activeBoostResult.rows[0] as any)?.total),
    communityBoostCount: toNumber((communityBoostResult.rows[0] as any)?.total),
    sharePayoutCount: toNumber((sharePayoutResult.rows[0] as any)?.total),
    lpPositionCount: toNumber((lpPositionResult.rows[0] as any)?.total),
    poolCount: toNumber((poolResult.rows[0] as any)?.total),
  };
}

function compareCandidates(left: CandidateMetrics, right: CandidateMetrics): number {
  const activityLeft =
    left.holdingsCount +
    left.multiplierCount +
    left.activeBoostCount +
    left.communityBoostCount +
    left.sharePayoutCount +
    left.lpPositionCount +
    left.poolCount;
  const activityRight =
    right.holdingsCount +
    right.multiplierCount +
    right.activeBoostCount +
    right.communityBoostCount +
    right.sharePayoutCount +
    right.lpPositionCount +
    right.poolCount;

  return (
    right.statsCount - left.statsCount ||
    right.latestStatMs - left.latestStatMs ||
    activityRight - activityLeft ||
    right.totalShares - left.totalShares ||
    right.volume24h - left.volume24h ||
    right.lastUpdatedMs - left.lastUpdatedMs ||
    left.id.localeCompare(right.id)
  );
}

async function chooseCanonicalPlayerId(group: DuplicateGroup) {
  const candidates = await Promise.all(
    group.playerIds.map((playerId) => getCandidateMetrics(playerId)),
  );
  candidates.sort(compareCandidates);
  return {
    canonical: candidates[0],
    aliases: candidates.slice(1),
  };
}

async function upsertAlias(
  tx: Tx,
  aliasPlayerId: string,
  canonicalPlayerId: string,
  sport: string,
) {
  if (DRY_RUN || aliasPlayerId === canonicalPlayerId) return;

  await tx
    .insert(playerIdAliases)
    .values({
      aliasPlayerId,
      canonicalPlayerId,
      sport,
      reason: "issue_99_duplicate_repair",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: playerIdAliases.aliasPlayerId,
      set: {
        canonicalPlayerId,
        sport,
        reason: "issue_99_duplicate_repair",
        updatedAt: new Date(),
      },
    });

  summary.aliasesCreated += 1;
}

async function mergeHoldings(tx: Tx, oldPlayerId: string, canonicalPlayerId: string) {
  const oldRows = await tx
    .select()
    .from(holdings)
    .where(and(eq(holdings.assetType, "player"), eq(holdings.assetId, oldPlayerId)));

  for (const oldRow of oldRows) {
    const [canonicalRow] = await tx
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, oldRow.userId),
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, canonicalPlayerId),
        ),
      )
      .limit(1);

    if (!canonicalRow) {
      if (!DRY_RUN) {
        await tx
          .update(holdings)
          .set({ assetId: canonicalPlayerId, lastUpdated: new Date() })
          .where(eq(holdings.id, oldRow.id));
      }
      summary.holdingsMerged += 1;
      continue;
    }

    const mergedQuantity = toNumber(oldRow.quantity) + toNumber(canonicalRow.quantity);
    const mergedTotalCost = toNumber(oldRow.totalCostBasis) + toNumber(canonicalRow.totalCostBasis);
    const mergedAvgCost =
      mergedQuantity > 0 ? (mergedTotalCost / mergedQuantity).toFixed(4) : "0.0000";

    if (!DRY_RUN) {
      await tx
        .update(holdings)
        .set({
          quantity: mergedQuantity.toFixed(4),
          totalCostBasis: mergedTotalCost.toFixed(2),
          avgCostBasis: mergedAvgCost,
          lastUpdated: new Date(),
        })
        .where(eq(holdings.id, canonicalRow.id));

      await tx.delete(holdings).where(eq(holdings.id, oldRow.id));
    }

    summary.holdingsMerged += 1;
  }
}

async function mergePlayerMultipliers(tx: Tx, oldPlayerId: string, canonicalPlayerId: string) {
  const oldRows = await tx
    .select()
    .from(playerMultipliers)
    .where(eq(playerMultipliers.playerId, oldPlayerId));

  for (const oldRow of oldRows) {
    const [canonicalRow] = await tx
      .select()
      .from(playerMultipliers)
      .where(
        and(
          eq(playerMultipliers.userId, oldRow.userId),
          eq(playerMultipliers.playerId, canonicalPlayerId),
        ),
      )
      .limit(1);

    if (!canonicalRow) {
      if (!DRY_RUN) {
        await tx
          .update(playerMultipliers)
          .set({ playerId: canonicalPlayerId, updatedAt: new Date() })
          .where(eq(playerMultipliers.id, oldRow.id));
      }
      summary.multipliersMerged += 1;
      continue;
    }

    const mergedMultiplier = oldRow.multiplier + canonicalRow.multiplier;
    const mergedTotalCost = toNumber(oldRow.totalCostBasis) + toNumber(canonicalRow.totalCostBasis);
    const mergedAvgCost =
      mergedMultiplier > 0 ? (mergedTotalCost / mergedMultiplier).toFixed(4) : "0.0000";

    if (!DRY_RUN) {
      await tx
        .update(playerMultipliers)
        .set({
          multiplier: mergedMultiplier,
          totalCostBasis: mergedTotalCost.toFixed(2),
          avgCostBasis: mergedAvgCost,
          updatedAt: new Date(),
        })
        .where(eq(playerMultipliers.id, canonicalRow.id));

      await tx
        .insert(playerMultiplierEvents)
        .values({
          id: randomUUID(),
          userId: oldRow.userId,
          playerId: canonicalPlayerId,
          eventType: "migration_backfill",
          sharesConsumed: 0,
          effectiveSharesBurned: 0,
          multiplierDelta: oldRow.multiplier,
          multiplierAfter: mergedMultiplier,
          consumedTotalCostBasis: "0.00",
          retainedTotalCostBasis: mergedTotalCost.toFixed(2),
          boostId: null,
        })
        .onConflictDoNothing();

      await tx.delete(playerMultipliers).where(eq(playerMultipliers.id, oldRow.id));
    }

    summary.multipliersMerged += 1;
  }
}

async function mergeLpPositions(tx: Tx, oldPlayerId: string, canonicalPlayerId: string) {
  const oldRows = await tx.select().from(lpPositions).where(eq(lpPositions.playerId, oldPlayerId));

  for (const oldRow of oldRows) {
    const [canonicalRow] = await tx
      .select()
      .from(lpPositions)
      .where(
        and(eq(lpPositions.userId, oldRow.userId), eq(lpPositions.playerId, canonicalPlayerId)),
      )
      .limit(1);

    if (!canonicalRow) {
      if (!DRY_RUN) {
        await tx
          .update(lpPositions)
          .set({ playerId: canonicalPlayerId, updatedAt: new Date() })
          .where(eq(lpPositions.id, oldRow.id));
      }
      summary.lpPositionsMerged += 1;
      continue;
    }

    const mergedLpShares = toNumber(oldRow.lpShares) + toNumber(canonicalRow.lpShares);
    const mergedFeesEarned =
      toNumber(oldRow.feesEarnedTotal) + toNumber(canonicalRow.feesEarnedTotal);
    const feeGrowthSnapshot = Math.max(
      toNumber(oldRow.feeGrowthSnapshot),
      toNumber(canonicalRow.feeGrowthSnapshot),
    );

    if (!DRY_RUN) {
      await tx
        .update(lpPositions)
        .set({
          lpShares: mergedLpShares.toFixed(2),
          feesEarnedTotal: mergedFeesEarned.toFixed(2),
          feeGrowthSnapshot: feeGrowthSnapshot.toFixed(12),
          updatedAt: new Date(),
        })
        .where(eq(lpPositions.id, canonicalRow.id));
      await tx.delete(lpPositions).where(eq(lpPositions.id, oldRow.id));
    }

    summary.lpPositionsMerged += 1;
  }
}

async function mergeScoutAssignments(tx: Tx, oldPlayerId: string, canonicalPlayerId: string) {
  const oldRows = await tx
    .select()
    .from(scoutAssignments)
    .where(eq(scoutAssignments.playerId, oldPlayerId));

  for (const oldRow of oldRows) {
    const [canonicalRow] = await tx
      .select()
      .from(scoutAssignments)
      .where(
        and(
          eq(scoutAssignments.userId, oldRow.userId),
          eq(scoutAssignments.playerId, canonicalPlayerId),
        ),
      )
      .limit(1);

    if (!canonicalRow) {
      if (!DRY_RUN) {
        await tx
          .update(scoutAssignments)
          .set({ playerId: canonicalPlayerId, updatedAt: new Date() })
          .where(eq(scoutAssignments.id, oldRow.id));
      }
      summary.scoutAssignmentsMerged += 1;
      continue;
    }

    if (!DRY_RUN) {
      await tx
        .update(scoutAssignments)
        .set({
          scoutCount: canonicalRow.scoutCount + oldRow.scoutCount,
          updatedAt: new Date(),
        })
        .where(eq(scoutAssignments.id, canonicalRow.id));
      await tx.delete(scoutAssignments).where(eq(scoutAssignments.id, oldRow.id));
    }

    summary.scoutAssignmentsMerged += 1;
  }
}

async function creditHoldingFromPoolExit(
  tx: Tx,
  userId: string,
  canonicalPlayerId: string,
  sharesToReturn: number,
  playMoneyToReturn: number,
) {
  const [existingHolding] = await tx
    .select()
    .from(holdings)
    .where(
      and(
        eq(holdings.userId, userId),
        eq(holdings.assetType, "player"),
        eq(holdings.assetId, canonicalPlayerId),
      ),
    )
    .limit(1);

  const roundedShares = Math.round(sharesToReturn);
  if (roundedShares > 0) {
    if (existingHolding) {
      const mergedQuantity = toNumber(existingHolding.quantity) + roundedShares;
      const mergedTotalCost = toNumber(existingHolding.totalCostBasis) + playMoneyToReturn;
      const mergedAvgCost =
        mergedQuantity > 0 ? (mergedTotalCost / mergedQuantity).toFixed(4) : "0.0000";

      await tx
        .update(holdings)
        .set({
          quantity: mergedQuantity.toFixed(4),
          totalCostBasis: mergedTotalCost.toFixed(2),
          avgCostBasis: mergedAvgCost,
          lastUpdated: new Date(),
        })
        .where(eq(holdings.id, existingHolding.id));
    } else {
      const avgCost = roundedShares > 0 ? (playMoneyToReturn / roundedShares).toFixed(4) : "0.0000";
      await tx.insert(holdings).values({
        userId,
        assetType: "player",
        assetId: canonicalPlayerId,
        quantity: roundedShares.toFixed(4),
        avgCostBasis: avgCost,
        totalCostBasis: playMoneyToReturn.toFixed(2),
        lastUpdated: new Date(),
      });
    }
  }

  const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
  if (!user) {
    throw new Error(`Missing user ${userId} while unwinding alias LP position`);
  }

  const nextBalance = toNumber(user.balance) + playMoneyToReturn;
  await tx
    .update(users)
    .set({ balance: nextBalance.toFixed(2) })
    .where(eq(users.id, userId));
}

async function unwindAliasPool(tx: Tx, oldPlayerId: string, canonicalPlayerId: string) {
  const [canonicalPool] = await tx
    .select()
    .from(playerPools)
    .where(eq(playerPools.playerId, canonicalPlayerId))
    .limit(1);

  if (!canonicalPool) {
    if (!DRY_RUN) {
      await tx
        .update(playerPools)
        .set({ playerId: canonicalPlayerId, updatedAt: new Date() })
        .where(eq(playerPools.playerId, oldPlayerId));
    }
    summary.lpPoolsUnwound += 1;
    return;
  }

  const lpRows = await tx
    .select()
    .from(lpPositions)
    .where(eq(lpPositions.playerId, oldPlayerId))
    .orderBy(
      sql`CASE WHEN ${lpPositions.userId} = 'market_maker' THEN 1 ELSE 0 END`,
      lpPositions.id,
    );

  for (const lpRow of lpRows) {
    const [pool] = await tx
      .select()
      .from(playerPools)
      .where(eq(playerPools.playerId, oldPlayerId))
      .limit(1)
      .for("update");
    if (!pool) break;

    const poolShares = toNumber(pool.shares);
    const poolPlayMoney = toNumber(pool.playMoney);
    const poolLpShares = toNumber(pool.lpSharesTotal);
    const lpShares = toNumber(lpRow.lpShares);
    if (poolShares <= 0 || poolPlayMoney <= 0 || poolLpShares <= 0 || lpShares <= 0) {
      throw new Error(`Invalid alias pool state while unwinding ${oldPlayerId}`);
    }

    const ownership = lpShares / poolLpShares;
    const sharesToReturn = poolShares * ownership;
    const playMoneyToReturn = poolPlayMoney * ownership;
    const nextPoolShares = poolShares - sharesToReturn;
    const nextPoolPlayMoney = poolPlayMoney - playMoneyToReturn;
    const nextLpSharesTotal = poolLpShares - lpShares;

    if (!DRY_RUN) {
      await creditHoldingFromPoolExit(
        tx,
        lpRow.userId,
        canonicalPlayerId,
        sharesToReturn,
        playMoneyToReturn,
      );

      await tx.insert(lpTransactions).values({
        userId: lpRow.userId,
        playerId: canonicalPlayerId,
        transactionType: "remove",
        lpShares: lpShares.toFixed(2),
        sharesAmount: sharesToReturn.toFixed(2),
        playMoneyAmount: playMoneyToReturn.toFixed(2),
        poolSharesBefore: poolShares.toFixed(2),
        poolPlayMoneyBefore: poolPlayMoney.toFixed(2),
        poolLpSharesTotalBefore: poolLpShares.toFixed(2),
        timestamp: new Date(),
      });

      await tx.delete(lpPositions).where(eq(lpPositions.id, lpRow.id));

      if (nextLpSharesTotal > 0 && nextPoolShares > 0 && nextPoolPlayMoney > 0) {
        await tx
          .update(playerPools)
          .set({
            shares: nextPoolShares.toFixed(2),
            playMoney: nextPoolPlayMoney.toFixed(2),
            k: (nextPoolShares * nextPoolPlayMoney).toFixed(2),
            lpSharesTotal: nextLpSharesTotal.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(playerPools.playerId, oldPlayerId));
      } else {
        await tx.delete(playerPools).where(eq(playerPools.playerId, oldPlayerId));
      }
    }
  }

  if (!DRY_RUN) {
    await tx.delete(lpPositions).where(eq(lpPositions.playerId, oldPlayerId));
    await tx.delete(playerPools).where(eq(playerPools.playerId, oldPlayerId));
  }

  summary.lpPoolsUnwound += 1;
}

async function repairPlayerPools(tx: Tx, oldPlayerId: string, canonicalPlayerId: string) {
  const [oldPool] = await tx
    .select()
    .from(playerPools)
    .where(eq(playerPools.playerId, oldPlayerId))
    .limit(1);
  if (!oldPool) return;

  const [canonicalPool] = await tx
    .select()
    .from(playerPools)
    .where(eq(playerPools.playerId, canonicalPlayerId))
    .limit(1);

  if (!canonicalPool) {
    if (!DRY_RUN) {
      await tx
        .update(playerPools)
        .set({ playerId: canonicalPlayerId, updatedAt: new Date() })
        .where(eq(playerPools.playerId, oldPlayerId));
    }
    summary.safeUpdates += 1;
    return;
  }
  await unwindAliasPool(tx, oldPlayerId, canonicalPlayerId);
}

async function repairPlayerMarketMetrics(tx: Tx, oldPlayerId: string, canonicalPlayerId: string) {
  const [oldMetrics] = await tx
    .select()
    .from(playerMarketMetrics)
    .where(eq(playerMarketMetrics.playerId, oldPlayerId))
    .limit(1);
  if (!oldMetrics) return;

  const [canonicalMetrics] = await tx
    .select()
    .from(playerMarketMetrics)
    .where(eq(playerMarketMetrics.playerId, canonicalPlayerId))
    .limit(1);

  if (!DRY_RUN) {
    if (canonicalMetrics) {
      await tx.delete(playerMarketMetrics).where(eq(playerMarketMetrics.playerId, oldPlayerId));
    } else {
      await tx
        .update(playerMarketMetrics)
        .set({ playerId: canonicalPlayerId, updatedAt: new Date() })
        .where(eq(playerMarketMetrics.playerId, oldPlayerId));
    }
  }

  summary.safeUpdates += 1;
}

async function repairSharePayouts(tx: Tx, oldPlayerId: string, canonicalPlayerId: string) {
  const oldRows = await tx
    .select()
    .from(sharePayouts)
    .where(eq(sharePayouts.playerId, oldPlayerId));

  for (const oldRow of oldRows) {
    const [canonicalRow] = await tx
      .select()
      .from(sharePayouts)
      .where(
        and(
          eq(sharePayouts.userId, oldRow.userId),
          eq(sharePayouts.playerId, canonicalPlayerId),
          eq(sharePayouts.gameId, oldRow.gameId),
        ),
      )
      .limit(1);

    if (!canonicalRow) {
      if (!DRY_RUN) {
        await tx
          .update(sharePayouts)
          .set({ playerId: canonicalPlayerId })
          .where(eq(sharePayouts.id, oldRow.id));
      }
      summary.sharePayoutsMerged += 1;
      continue;
    }

    const oldPayout = toNumber(oldRow.payoutAmount);
    const canonicalPayout = toNumber(canonicalRow.payoutAmount);
    const oldFantasyPoints = toNumber(oldRow.fantasyPoints);
    const canonicalFantasyPoints = toNumber(canonicalRow.fantasyPoints);
    const sameComputedValues =
      oldPayout === canonicalPayout &&
      oldFantasyPoints === canonicalFantasyPoints &&
      String(oldRow.earningModel) === String(canonicalRow.earningModel) &&
      String(oldRow.baseRate) === String(canonicalRow.baseRate);

    if (!sameComputedValues && oldPayout > 0 && canonicalPayout > 0) {
      throw new Error(
        `Conflicting share payout rows for user ${oldRow.userId} game ${oldRow.gameId} (${oldPlayerId} -> ${canonicalPlayerId})`,
      );
    }

    const winningRow =
      canonicalPayout > oldPayout ||
      (canonicalPayout === oldPayout && canonicalFantasyPoints >= oldFantasyPoints)
        ? canonicalRow
        : oldRow;
    const mergedEarningUnits = toNumber(oldRow.earningUnits) + toNumber(canonicalRow.earningUnits);

    if (!DRY_RUN) {
      await tx
        .update(sharePayouts)
        .set({
          playerId: canonicalPlayerId,
          earningUnits: mergedEarningUnits.toFixed(2),
          earningModel: winningRow.earningModel,
          baseRate: winningRow.baseRate,
          fantasyPoints: winningRow.fantasyPoints,
          payoutAmount: winningRow.payoutAmount,
          status: winningRow.status,
          voidReason: winningRow.voidReason,
          processedAt: winningRow.processedAt,
        })
        .where(eq(sharePayouts.id, canonicalRow.id));

      await tx.delete(sharePayouts).where(eq(sharePayouts.id, oldRow.id));
    }

    summary.sharePayoutsMerged += 1;
  }
}

async function rewriteSimpleReferences(tx: Tx, oldPlayerId: string, canonicalPlayerId: string) {
  const updates = [
    tx.update(orders).set({ playerId: canonicalPlayerId }).where(eq(orders.playerId, oldPlayerId)),
    tx.update(trades).set({ playerId: canonicalPlayerId }).where(eq(trades.playerId, oldPlayerId)),
    tx
      .update(playerGameStats)
      .set({ playerId: canonicalPlayerId, lastFetchedAt: new Date() })
      .where(eq(playerGameStats.playerId, oldPlayerId)),
    tx
      .update(priceHistory)
      .set({ playerId: canonicalPlayerId })
      .where(eq(priceHistory.playerId, oldPlayerId)),
    tx
      .update(scoutDistributions)
      .set({ playerId: canonicalPlayerId })
      .where(eq(scoutDistributions.playerId, oldPlayerId)),
    tx
      .update(scoutHistory)
      .set({ playerId: canonicalPlayerId })
      .where(eq(scoutHistory.playerId, oldPlayerId)),
    tx
      .update(holdingsLocks)
      .set({ assetId: canonicalPlayerId })
      .where(and(eq(holdingsLocks.assetType, "player"), eq(holdingsLocks.assetId, oldPlayerId))),
    tx
      .update(dailyBoosts)
      .set({ playerId: canonicalPlayerId })
      .where(eq(dailyBoosts.playerId, oldPlayerId)),
    tx
      .update(boostPayouts)
      .set({ playerId: canonicalPlayerId })
      .where(eq(boostPayouts.playerId, oldPlayerId)),
    tx
      .update(communityBoosts)
      .set({ playerId: canonicalPlayerId })
      .where(eq(communityBoosts.playerId, oldPlayerId)),
    tx
      .update(lpTransactions)
      .set({ playerId: canonicalPlayerId })
      .where(eq(lpTransactions.playerId, oldPlayerId)),
    tx
      .update(playerMultiplierEvents)
      .set({ playerId: canonicalPlayerId })
      .where(eq(playerMultiplierEvents.playerId, oldPlayerId)),
    tx
      .update(watchList)
      .set({ playerId: canonicalPlayerId })
      .where(eq(watchList.playerId, oldPlayerId)),
    tx
      .update(userAgentProposals)
      .set({ playerId: canonicalPlayerId })
      .where(eq(userAgentProposals.playerId, oldPlayerId)),
    tx
      .update(vesting)
      .set({ playerId: canonicalPlayerId })
      .where(eq(vesting.playerId, oldPlayerId)),
    tx
      .update(vestingSplits)
      .set({ playerId: canonicalPlayerId })
      .where(eq(vestingSplits.playerId, oldPlayerId)),
    tx
      .update(vestingClaims)
      .set({ playerId: canonicalPlayerId })
      .where(eq(vestingClaims.playerId, oldPlayerId)),
  ];

  if (!DRY_RUN) {
    await Promise.all(updates);
  }

  summary.safeUpdates += updates.length;
}

async function getRemainingReferenceCount(tx: Tx, playerId: string): Promise<number> {
  const checks = await Promise.all([
    tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(holdings)
      .where(eq(holdings.assetId, playerId)),
    tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(playerMultipliers)
      .where(eq(playerMultipliers.playerId, playerId)),
    tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(holdingsLocks)
      .where(eq(holdingsLocks.assetId, playerId)),
    tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(playerGameStats)
      .where(eq(playerGameStats.playerId, playerId)),
    tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(dailyBoosts)
      .where(eq(dailyBoosts.playerId, playerId)),
    tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(communityBoosts)
      .where(eq(communityBoosts.playerId, playerId)),
    tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(playerPools)
      .where(eq(playerPools.playerId, playerId)),
    tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(lpPositions)
      .where(eq(lpPositions.playerId, playerId)),
    tx
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(sharePayouts)
      .where(eq(sharePayouts.playerId, playerId)),
  ]);

  return checks.reduce((total, rows) => total + toNumber(rows[0]?.total), 0);
}

async function repairHistoricalZeroBoosts() {
  const zeroBoosts = await db
    .select()
    .from(dailyBoosts)
    .where(
      and(
        eq(dailyBoosts.status, "processed"),
        eq(dailyBoosts.fantasyPoints, "0.00"),
        eq(dailyBoosts.payout, "0.00"),
        ne(dailyBoosts.gameId, ""),
      ),
    )
    .orderBy(desc(dailyBoosts.boostDate));

  for (const boost of zeroBoosts) {
    const [aliasRow] = await db
      .select()
      .from(playerIdAliases)
      .where(eq(playerIdAliases.aliasPlayerId, boost.playerId))
      .limit(1);
    const canonicalPlayerId = aliasRow?.canonicalPlayerId || boost.playerId;
    const identityIds = aliasRow ? [canonicalPlayerId, boost.playerId] : [canonicalPlayerId];

    const statsRows = await db
      .select()
      .from(playerGameStats)
      .where(
        and(
          inArray(playerGameStats.playerId, Array.from(new Set(identityIds))),
          eq(playerGameStats.gameId, boost.gameId || ""),
        ),
      )
      .orderBy(desc(playerGameStats.lastFetchedAt), desc(playerGameStats.gameDate))
      .limit(1);
    const stats = statsRows[0];
    if (!stats) continue;

    const fantasyPoints = toNumber(stats.fantasyPoints);
    if (fantasyPoints <= 0) continue;

    const dateStr = getGameDay(boost.boostDate);
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
    const [communityCountRow] = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(communityBoosts)
      .where(
        and(
          eq(communityBoosts.sport, boost.sport),
          gte(communityBoosts.boostDate, startOfDay),
          lte(communityBoosts.boostDate, endOfDay),
          ne(communityBoosts.status, "cancelled"),
          inArray(communityBoosts.playerId, Array.from(new Set(identityIds))),
        ),
      );
    const effectiveMultiplier = boost.slotTier + toNumber(communityCountRow?.total);
    const effectivePower = toNumber(boost.shareMultiplier || boost.sharesEntered);
    const payout = Math.max(0, effectivePower * fantasyPoints * effectiveMultiplier);
    if (payout <= 0) continue;

    console.log(
      `[repair-zero-boosts] ${boost.id}: ${boost.playerId} -> ${canonicalPlayerId}, FP ${fantasyPoints.toFixed(2)}, payout ${payout.toFixed(2)}`,
    );

    if (DRY_RUN) {
      summary.zeroBoostsRepaired += 1;
      continue;
    }

    await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ balance: users.balance })
        .from(users)
        .where(eq(users.id, boost.userId))
        .limit(1)
        .for("update");
      if (!user) {
        throw new Error(`User ${boost.userId} missing while repairing boost ${boost.id}`);
      }

      const nextBalance = toNumber(user.balance) + payout;
      await tx
        .update(users)
        .set({ balance: nextBalance.toFixed(2) })
        .where(eq(users.id, boost.userId));

      await tx
        .update(dailyBoosts)
        .set({
          playerId: canonicalPlayerId,
          fantasyPoints: fantasyPoints.toFixed(2),
          payout: payout.toFixed(2),
        })
        .where(eq(dailyBoosts.id, boost.id));

      const payoutRows = await tx
        .select()
        .from(boostPayouts)
        .where(eq(boostPayouts.boostId, boost.id));

      if (payoutRows.length > 0) {
        await tx
          .update(boostPayouts)
          .set({
            playerId: canonicalPlayerId,
            fantasyPoints: fantasyPoints.toFixed(2),
            multiplier: effectiveMultiplier,
            payoutAmount: payout.toFixed(2),
          })
          .where(eq(boostPayouts.boostId, boost.id));
      } else {
        await tx.insert(boostPayouts).values({
          boostId: boost.id,
          userId: boost.userId,
          playerId: canonicalPlayerId,
          sharesUsed: boost.sharesEntered,
          fantasyPoints: fantasyPoints.toFixed(2),
          multiplier: effectiveMultiplier,
          payoutAmount: payout.toFixed(2),
        });
      }
    });

    summary.zeroBoostsRepaired += 1;
  }
}

async function repairDuplicateGroups() {
  const groups = await getDuplicateGroups();
  summary.duplicateGroups = groups.length;

  for (const group of groups) {
    const { canonical, aliases } = await chooseCanonicalPlayerId(group);
    console.log(
      `[repair] ${group.firstName} ${group.lastName} (${group.sport} ${group.team}) -> canonical ${canonical.id}; aliases ${aliases.map((alias) => alias.id).join(", ")}`,
    );

    for (const alias of aliases) {
      await db.transaction(async (tx) => {
        await upsertAlias(tx, alias.id, canonical.id, group.sport);
        await mergeHoldings(tx, alias.id, canonical.id);
        await mergePlayerMultipliers(tx, alias.id, canonical.id);
        await mergeScoutAssignments(tx, alias.id, canonical.id);
        await repairPlayerPools(tx, alias.id, canonical.id);
        await mergeLpPositions(tx, alias.id, canonical.id);
        await repairSharePayouts(tx, alias.id, canonical.id);
        await repairPlayerMarketMetrics(tx, alias.id, canonical.id);
        await rewriteSimpleReferences(tx, alias.id, canonical.id);

        const remainingReferences = await getRemainingReferenceCount(tx, alias.id);
        if (remainingReferences > 0) {
          throw new Error(
            `Player ${alias.id} still has ${remainingReferences} unresolved references after repair`,
          );
        }

        if (!DRY_RUN) {
          await tx.delete(players).where(eq(players.id, alias.id));
        }

        summary.playersDeleted += 1;
      });
    }
  }
}

async function main() {
  console.log(`=== Player ID Integrity Repair (${DRY_RUN ? "dry-run" : "apply"}) ===`);
  await repairDuplicateGroups();
  await repairHistoricalZeroBoosts();

  console.log("\nSummary:");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nRepair failed:", error);
    process.exit(1);
  });

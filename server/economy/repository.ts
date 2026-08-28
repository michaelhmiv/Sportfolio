import { sql } from "drizzle-orm";
import type { DailyGame } from "@shared/schema";
import { db } from "../db";
import {
  ECONOMY_VERSION,
  getFantasyPointBenchmark,
  getSeasonTargetSb,
  resolveEconomyClass,
  resolveEconomySeasonPhase,
} from "./config";
import { calculateBoostPayout, calculateGameEarnings } from "./math";

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decimal(value: number, places: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(places);
}

function floorCents(value: number): number {
  return Math.floor(Math.max(0, value) * 100 + 1e-9) / 100;
}

function isSettlableNascarStats(sport: unknown, statsJson: unknown): boolean {
  if (String(sport || "").toUpperCase() !== "NASCAR") return true;
  if (!statsJson || typeof statsJson !== "object" || Array.isArray(statsJson)) return true;
  const stats = statsJson as Record<string, unknown>;
  const runType = Number(stats.runType ?? stats.run_type);
  if (Number.isFinite(runType)) return runType === 3;
  const runName = String(stats.runName ?? stats.run_name ?? "").toLowerCase();
  return !runName || (!runName.includes("qualifying") && !runName.includes("practice"));
}

function gamePhase(game: Pick<DailyGame, "seasonType">) {
  return resolveEconomySeasonPhase({ seasonType: game.seasonType });
}

type SnapshotHolding = {
  user_id: string;
  player_id: string;
  eligible_shares: string;
  sport: string;
  position: string;
};

export async function ensureGameShareSnapshots(
  game: Pick<DailyGame, "gameId" | "sport" | "homeTeam" | "awayTeam" | "seasonType" | "startTime">,
  onlyPlayerIds?: string[],
): Promise<{ playersSnapshotted: number; userSnapshots: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`economy-v2:snapshot:${game.gameId}`}))`,
    );

    const existingResult: any = await tx.execute(sql`
      SELECT player_id FROM player_game_earnings WHERE game_id = ${game.gameId}
    `);
    const existing = new Set<string>(
      (existingResult.rows || []).map((row: any) => String(row.player_id)),
    );

    const holdingsResult: any = onlyPlayerIds?.length
      ? await tx.execute(sql`
          SELECT
            h.user_id,
            h.asset_id AS player_id,
            h.quantity::text AS eligible_shares,
            p.sport,
            p.position
          FROM holdings h
          INNER JOIN players p ON p.id = h.asset_id
          WHERE h.asset_type = 'player'
            AND h.quantity::numeric > 0
            AND h.user_id <> 'market_maker'
            AND h.asset_id IN (${sql.join(
              onlyPlayerIds.map((playerId) => sql`${playerId}`),
              sql`, `,
            )})
        `)
      : await tx.execute(sql`
          SELECT
            h.user_id,
            h.asset_id AS player_id,
            h.quantity::text AS eligible_shares,
            p.sport,
            p.position
          FROM holdings h
          INNER JOIN players p ON p.id = h.asset_id
          WHERE h.asset_type = 'player'
            AND h.quantity::numeric > 0
            AND h.user_id <> 'market_maker'
            AND UPPER(p.sport) = ${String(game.sport).toUpperCase()}
            AND (
              UPPER(p.sport) = 'NASCAR'
              OR p.team = ${game.homeTeam}
              OR p.team = ${game.awayTeam}
            )
        `);

    const holdings = (holdingsResult.rows || []) as SnapshotHolding[];
    const byPlayer = new Map<string, SnapshotHolding[]>();
    for (const holding of holdings) {
      if (existing.has(holding.player_id)) continue;
      const list = byPlayer.get(holding.player_id) || [];
      list.push(holding);
      byPlayer.set(holding.player_id, list);
    }

    let playersSnapshotted = 0;
    let userSnapshots = 0;
    const seasonPhase = gamePhase(game);

    for (const [playerId, playerHoldings] of byPlayer.entries()) {
      const player = playerHoldings[0];
      const economyClass = resolveEconomyClass({
        sport: player.sport,
        position: player.position,
        statsJson:
          String(game.sport).toUpperCase() === "NASCAR" ? { series: game.awayTeam } : undefined,
      });
      if (!economyClass) continue;

      const totalEligibleShares = playerHoldings.reduce(
        (sum, holding) => sum + numberValue(holding.eligible_shares),
        0,
      );
      if (!(totalEligibleShares > 0)) continue;

      const target = getSeasonTargetSb(seasonPhase);
      const benchmark = getFantasyPointBenchmark(economyClass, seasonPhase);
      const insertEarnings: any = await tx.execute(sql`
        INSERT INTO player_game_earnings (
          player_id, game_id, sport, economy_version, season_phase, economy_class,
          season_target_sb, benchmark_fantasy_points, total_eligible_shares, status
        ) VALUES (
          ${playerId}, ${game.gameId}, ${game.sport}, ${ECONOMY_VERSION}, ${seasonPhase},
          ${economyClass}, ${decimal(target, 4)}, ${decimal(Number.isFinite(benchmark) ? benchmark : 0, 4)},
          ${decimal(totalEligibleShares, 4)}, ${seasonPhase === "preseason" ? "voided" : "snapshotted"}
        )
        ON CONFLICT (player_id, game_id) DO NOTHING
        RETURNING id
      `);
      if ((insertEarnings.rows || []).length === 0) continue;
      playersSnapshotted++;

      for (const holding of playerHoldings) {
        await tx.execute(sql`
          INSERT INTO share_payouts (user_id, player_id, game_id, eligible_shares, status)
          VALUES (
            ${holding.user_id}, ${playerId}, ${game.gameId}, ${holding.eligible_shares},
            ${seasonPhase === "preseason" ? "voided" : "pending"}
          )
          ON CONFLICT (user_id, player_id, game_id) DO NOTHING
        `);
        userSnapshots++;
      }
    }

    return { playersSnapshotted, userSnapshots };
  });
}

type SettlementContextRow = {
  earnings_id: string;
  player_id: string;
  total_eligible_shares: string;
  sport: string;
  position: string;
  season_type: string | null;
  stats_season: string | null;
  fantasy_points: string | null;
  stats_json: unknown;
};

export async function settleBaseEarningsForGame(
  game: Pick<DailyGame, "gameId" | "sport" | "seasonType">,
): Promise<{ playersSettled: number; userPayouts: number; sbIssued: number }> {
  const contextResult: any = await db.execute(sql`
    SELECT
      e.id AS earnings_id,
      e.player_id,
      e.total_eligible_shares::text,
      p.sport,
      p.position,
      ${game.seasonType ?? null}::text AS season_type,
      stats.season AS stats_season,
      stats.fantasy_points::text,
      stats.stats_json
    FROM player_game_earnings e
    INNER JOIN players p ON p.id = e.player_id
    LEFT JOIN LATERAL (
      SELECT pgs.season, pgs.fantasy_points, pgs.stats_json
      FROM player_game_stats pgs
      WHERE pgs.player_id = e.player_id AND pgs.game_id = e.game_id
      ORDER BY pgs.last_fetched_at DESC
      LIMIT 1
    ) stats ON true
    WHERE e.game_id = ${game.gameId}
      AND e.status = 'snapshotted'
  `);

  let playersSettled = 0;
  let userPayouts = 0;
  let sbIssued = 0;

  for (const row of (contextResult.rows || []) as SettlementContextRow[]) {
    if (row.fantasy_points == null) continue;
    if (!isSettlableNascarStats(row.sport, row.stats_json)) continue;

    const seasonPhase = resolveEconomySeasonPhase({
      seasonType: row.season_type,
      statsSeason: row.stats_season,
    });
    const economyClass = resolveEconomyClass({
      sport: row.sport,
      position: row.position,
      statsJson: row.stats_json,
    });
    if (!economyClass) continue;

    const math = calculateGameEarnings({
      fantasyPoints: numberValue(row.fantasy_points),
      eligibleSingles: numberValue(row.total_eligible_shares),
      economyClass,
      seasonPhase,
    });

    const result = await db.transaction(async (tx) => {
      const locked: any = await tx.execute(sql`
        SELECT status FROM player_game_earnings WHERE id = ${row.earnings_id} FOR UPDATE
      `);
      if (locked.rows?.[0]?.status !== "snapshotted") return { count: 0, issued: 0 };

      const payoutResult: any = await tx.execute(sql`
        WITH payable AS (
          SELECT
            sp.id,
            sp.user_id,
            FLOOR((sp.eligible_shares::numeric * ${decimal(math.gameEpsSb, 8)}) * 100) / 100 AS payout
          FROM share_payouts sp
          WHERE sp.player_id = ${row.player_id}
            AND sp.game_id = ${game.gameId}
            AND sp.status = 'pending'
        ),
        updated AS (
          UPDATE share_payouts sp
          SET
            fantasy_points = ${decimal(math.fantasyPoints, 4)},
            game_eps_sb = ${decimal(math.gameEpsSb, 8)},
            payout_amount = payable.payout,
            status = 'processed',
            processed_at = now()
          FROM payable
          WHERE sp.id = payable.id AND sp.status = 'pending'
          RETURNING sp.user_id, sp.payout_amount
        ),
        credits AS (
          SELECT user_id, SUM(payout_amount::numeric) AS amount
          FROM updated
          GROUP BY user_id
        ),
        credited AS (
          UPDATE users u
          SET balance = u.balance::numeric + credits.amount
          FROM credits
          WHERE u.id = credits.user_id
          RETURNING u.id
        ),
        events AS (
          INSERT INTO economy_events (event_type, user_id, player_id, game_id, sb_delta, shares_delta, metadata)
          SELECT
            'base_player_earnings', updated.user_id, ${row.player_id}, ${game.gameId},
            updated.payout_amount::numeric, 0,
            jsonb_build_object(
              'economyVersion', ${ECONOMY_VERSION}::text,
              'gameEpsSb', ${decimal(math.gameEpsSb, 8)}::numeric,
              'seasonPhase', ${seasonPhase}::text,
              'economyClass', ${economyClass}::text
            )
          FROM updated
          RETURNING id
        )
        SELECT
          (SELECT count(*)::integer FROM updated) AS payout_count,
          COALESCE((SELECT SUM(payout_amount::numeric) FROM updated), 0)::text AS issued,
          (SELECT count(*)::integer FROM credited) AS users_credited,
          (SELECT count(*)::integer FROM events) AS events_created
      `);

      await tx.execute(sql`
        UPDATE player_game_earnings
        SET
          economy_version = ${ECONOMY_VERSION},
          season_phase = ${seasonPhase},
          economy_class = ${economyClass},
          season_target_sb = ${decimal(math.seasonTargetSb, 4)},
          benchmark_fantasy_points = ${decimal(math.benchmarkFantasyPoints, 4)},
          fantasy_points = ${decimal(math.fantasyPoints, 4)},
          sb_per_fantasy_point = ${decimal(math.sbPerFantasyPoint, 8)},
          base_pool_sb = ${decimal(math.gameBasePoolSb, 4)},
          game_eps_sb = ${decimal(math.gameEpsSb, 8)},
          status = 'processed',
          processed_at = now()
        WHERE id = ${row.earnings_id}
      `);

      return {
        count: Number(payoutResult.rows?.[0]?.payout_count || 0),
        issued: numberValue(payoutResult.rows?.[0]?.issued),
      };
    });

    if (result.count > 0) {
      playersSettled++;
      userPayouts += result.count;
      sbIssued += result.issued;
    }
  }

  return { playersSettled, userPayouts, sbIssued };
}

export async function lockDirectShareBoost(
  boostId: string,
  game: Pick<DailyGame, "gameId" | "sport" | "homeTeam" | "awayTeam" | "seasonType" | "startTime">,
): Promise<{ locked: boolean; sharesBurned: number }> {
  const boostLookup: any = await db.execute(sql`
    SELECT player_id FROM daily_boosts WHERE id = ${boostId} AND status = 'active'
  `);
  const playerId = String(boostLookup.rows?.[0]?.player_id || "");
  if (!playerId) return { locked: false, sharesBurned: 0 };

  // This commit is deliberately completed BEFORE the burn transaction. The snapshot is immutable,
  // so the boosted quantity receives its ordinary 1x base EPS even though those Singles are burned.
  await ensureGameShareSnapshots(game, [playerId]);

  return db.transaction(async (tx) => {
    const boostResult: any = await tx.execute(sql`
      SELECT id, user_id, player_id, shares_entered::text, status
      FROM daily_boosts
      WHERE id = ${boostId}
      FOR UPDATE
    `);
    const boost = boostResult.rows?.[0];
    if (!boost || boost.status !== "active") return { locked: false, sharesBurned: 0 };

    const sharesBurned = numberValue(boost.shares_entered);
    if (!(sharesBurned > 0)) throw new Error(`Boost ${boostId} has invalid share quantity.`);

    const holdingResult: any = await tx.execute(sql`
      SELECT id, quantity::text, avg_cost_basis::text, total_cost_basis::text
      FROM holdings
      WHERE user_id = ${boost.user_id}
        AND asset_type = 'player'
        AND asset_id = ${boost.player_id}
      FOR UPDATE
    `);
    const holding = holdingResult.rows?.[0];
    if (!holding) throw new Error(`Boost ${boostId} holding no longer exists.`);
    const oldQuantity = numberValue(holding.quantity);
    if (oldQuantity + 1e-9 < sharesBurned) {
      throw new Error(`Boost ${boostId} cannot burn ${sharesBurned}; holding has ${oldQuantity}.`);
    }

    const newQuantity = Math.max(0, oldQuantity - sharesBurned);
    const avgCost = numberValue(holding.avg_cost_basis);
    const newTotalCost = newQuantity > 0 ? avgCost * newQuantity : 0;

    await tx.execute(sql`
      UPDATE holdings
      SET
        quantity = ${decimal(newQuantity, 4)},
        avg_cost_basis = ${decimal(newQuantity > 0 ? avgCost : 0, 4)},
        total_cost_basis = ${decimal(newTotalCost, 2)},
        last_updated = now()
      WHERE id = ${holding.id}
    `);
    await tx.execute(sql`DELETE FROM holdings_locks WHERE lock_reference_id = ${boostId}`);
    await tx.execute(sql`
      UPDATE daily_boosts
      SET status = 'locked', shares_burned = ${decimal(sharesBurned, 4)}, locked_at = now()
      WHERE id = ${boostId}
    `);
    await tx.execute(sql`
      UPDATE players
      SET total_shares = GREATEST(0, total_shares::numeric - ${decimal(sharesBurned, 4)}), last_updated = now()
      WHERE id = ${boost.player_id}
    `);
    await tx.execute(sql`
      INSERT INTO economy_events (event_type, user_id, player_id, game_id, sb_delta, shares_delta, metadata)
      VALUES (
        'boost_share_burn', ${boost.user_id}, ${boost.player_id}, ${game.gameId}, 0,
        ${decimal(-sharesBurned, 4)},
        jsonb_build_object(
          'boostId', ${boostId}::text,
          'economyVersion', ${ECONOMY_VERSION}::text
        )
      )
    `);
    return { locked: true, sharesBurned };
  });
}

export async function settleDirectShareBoost(
  boostId: string,
  fantasyPoints: number,
  communityBoostCount: number,
): Promise<
  | { settled: false; reason: "not_ready" | "already_settled" }
  | {
      settled: true;
      gameEpsSb: number;
      baseComponentSb: number;
      boostBonusSb: number;
      totalEconomicEarningsSb: number;
      effectiveMultiplier: number;
      sharesBurned: number;
    }
> {
  const context: any = await db.execute(sql`
    SELECT
      b.id, b.user_id, b.player_id, b.game_id, b.slot_tier,
      b.shares_burned::text,
      e.game_eps_sb::text,
      e.status AS earnings_status
    FROM daily_boosts b
    LEFT JOIN player_game_earnings e
      ON e.player_id = b.player_id AND e.game_id = b.game_id
    WHERE b.id = ${boostId} AND b.status = 'locked'
  `);
  const row = context.rows?.[0];
  if (!row) return { settled: false, reason: "already_settled" };
  if (row.earnings_status !== "processed" || row.game_eps_sb == null) {
    return { settled: false, reason: "not_ready" };
  }

  const sharesBurned = numberValue(row.shares_burned);
  const gameEpsSb = numberValue(row.game_eps_sb);
  const effectiveMultiplier = Math.max(1, Number(row.slot_tier) + Math.max(0, communityBoostCount));
  const payout = calculateBoostPayout({ sharesBurned, gameEpsSb, effectiveMultiplier });
  const actualBonus = floorCents(payout.boostBonusSb);

  const settled = await db.transaction(async (tx) => {
    const locked: any = await tx.execute(sql`
      SELECT status FROM daily_boosts WHERE id = ${boostId} FOR UPDATE
    `);
    if (locked.rows?.[0]?.status !== "locked") return false;

    const inserted: any = await tx.execute(sql`
      INSERT INTO boost_payouts (
        boost_id, user_id, player_id, game_id, shares_used, fantasy_points, multiplier,
        game_eps_sb, base_component_sb, boost_bonus_sb, total_economic_earnings_sb, payout_amount
      ) VALUES (
        ${boostId}, ${row.user_id}, ${row.player_id}, ${row.game_id}, ${decimal(sharesBurned, 4)},
        ${decimal(fantasyPoints, 4)}, ${effectiveMultiplier}, ${decimal(gameEpsSb, 8)},
        ${decimal(payout.baseComponentSb, 4)}, ${decimal(actualBonus, 4)},
        ${decimal(payout.baseComponentSb + actualBonus, 4)}, ${decimal(actualBonus, 4)}
      )
      ON CONFLICT (boost_id) DO NOTHING
      RETURNING id
    `);
    if ((inserted.rows || []).length === 0) return false;

    if (actualBonus > 0) {
      await tx.execute(sql`
        UPDATE users SET balance = balance::numeric + ${decimal(actualBonus, 2)} WHERE id = ${row.user_id}
      `);
    }
    await tx.execute(sql`
      UPDATE daily_boosts
      SET
        fantasy_points = ${decimal(fantasyPoints, 2)},
        game_eps_sb = ${decimal(gameEpsSb, 8)},
        base_component_sb = ${decimal(payout.baseComponentSb, 4)},
        boost_bonus_sb = ${decimal(actualBonus, 4)},
        total_economic_earnings_sb = ${decimal(payout.baseComponentSb + actualBonus, 4)},
        payout = ${decimal(payout.baseComponentSb + actualBonus, 2)},
        status = 'processed',
        processed_at = now()
      WHERE id = ${boostId}
    `);
    await tx.execute(sql`
      INSERT INTO economy_events (event_type, user_id, player_id, game_id, sb_delta, shares_delta, metadata)
      VALUES (
        'boost_bonus', ${row.user_id}, ${row.player_id}, ${row.game_id}, ${decimal(actualBonus, 4)}, 0,
        jsonb_build_object(
          'boostId', ${boostId}::text,
          'economyVersion', ${ECONOMY_VERSION}::text,
          'slotTier', ${Number(row.slot_tier)}::integer,
          'communityBoostCount', ${Math.max(0, communityBoostCount)}::integer,
          'gameEpsSb', ${decimal(gameEpsSb, 8)}::numeric
        )
      )
    `);
    return true;
  });

  if (!settled) return { settled: false, reason: "already_settled" };
  return {
    settled: true,
    gameEpsSb,
    baseComponentSb: payout.baseComponentSb,
    boostBonusSb: actualBonus,
    totalEconomicEarningsSb: payout.baseComponentSb + actualBonus,
    effectiveMultiplier,
    sharesBurned,
  };
}

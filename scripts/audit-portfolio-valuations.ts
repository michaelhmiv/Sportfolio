/**
 * Read-only production audit for legacy versus canonical portfolio valuation.
 *
 * Usage:
 *   npm run audit:portfolio-valuations
 *
 * Historical snapshots are immutable accounting records. `--apply` is rejected
 * until a separately reviewed repair plan can reconstruct the correct price at
 * each snapshot timestamp.
 */
import { sql } from "drizzle-orm";
import {
  holdings,
  playerMultipliers,
  playerPools,
  players,
  portfolioSnapshots,
  users,
} from "@shared/schema";
import { db, pool } from "../server/db";
import {
  getAllCanonicalPortfolioValues,
  VALUATION_VERSION,
} from "../server/valuation/canonical-valuation";

if (process.argv.includes("--apply")) {
  throw new Error(
    "Repair mode is intentionally unavailable: historical snapshot prices cannot be reconstructed safely from current AMM state.",
  );
}

const legacyResult: any = await db.execute(sql`
  WITH legacy_positions AS (
    SELECT
      ${holdings.userId} AS user_id,
      ${holdings.assetId} AS player_id,
      ${holdings.quantity}::numeric AS effective_shares
    FROM ${holdings}
    WHERE ${holdings.assetType} = 'player'
    UNION ALL
    SELECT
      ${playerMultipliers.userId} AS user_id,
      ${playerMultipliers.playerId} AS player_id,
      ${playerMultipliers.multiplier}::numeric AS effective_shares
    FROM ${playerMultipliers}
  )
  SELECT
    ${users.id} AS user_id,
    ${users.email} AS email,
    ${users.username} AS username,
    COALESCE(SUM(lp.effective_shares * COALESCE(${players.lastTradePrice}::numeric, 0)), 0)::text
      AS legacy_portfolio_value
  FROM ${users}
  LEFT JOIN legacy_positions lp ON lp.user_id = ${users.id}
  LEFT JOIN ${players} ON ${players.id} = lp.player_id
  WHERE ${users.deletedAt} IS NULL
  GROUP BY ${users.id}, ${users.email}, ${users.username}
`);

const canonical = await getAllCanonicalPortfolioValues();
const canonicalByUser = new Map(canonical.map((row) => [row.userId, row]));
const accountingResult: any = await db.execute(sql`
  WITH singles_accounting AS (
    SELECT
      ${holdings.userId} AS user_id,
      COALESCE(SUM(CASE
        WHEN ${playerPools.shares}::numeric > 0 AND ${playerPools.playMoney}::numeric > 0
        THEN ${holdings.quantity}::numeric ELSE 0 END), 0)::text AS priced_singles,
      COALESCE(SUM(CASE
        WHEN ${playerPools.playerId} IS NULL
          OR ${playerPools.shares}::numeric <= 0
          OR ${playerPools.playMoney}::numeric <= 0
        THEN ${holdings.quantity}::numeric ELSE 0 END), 0)::text AS unpriced_singles
    FROM ${holdings}
    LEFT JOIN ${playerPools} ON ${playerPools.playerId} = ${holdings.assetId}
    WHERE ${holdings.assetType} = 'player'
    GROUP BY ${holdings.userId}
  ), stack_accounting AS (
    SELECT
      ${playerMultipliers.userId} AS user_id,
      COALESCE(SUM(${playerMultipliers.multiplier}::numeric), 0)::text AS stack_power
    FROM ${playerMultipliers}
    GROUP BY ${playerMultipliers.userId}
  ), snapshot_accounting AS (
    SELECT ${portfolioSnapshots.userId} AS user_id, COUNT(*)::int AS snapshot_count
    FROM ${portfolioSnapshots}
    GROUP BY ${portfolioSnapshots.userId}
  )
  SELECT
    ${users.id} AS user_id,
    COALESCE(sa.priced_singles, '0') AS priced_singles,
    COALESCE(sa.unpriced_singles, '0') AS unpriced_singles,
    COALESCE(st.stack_power, '0') AS stack_power,
    COALESCE(sn.snapshot_count, 0)::int AS snapshot_count
  FROM ${users}
  LEFT JOIN singles_accounting sa ON sa.user_id = ${users.id}
  LEFT JOIN stack_accounting st ON st.user_id = ${users.id}
  LEFT JOIN snapshot_accounting sn ON sn.user_id = ${users.id}
  WHERE ${users.deletedAt} IS NULL
`);
const accountingRows = accountingResult?.rows ?? accountingResult;
const accountingByUser = new Map(accountingRows.map((row: any) => [row.user_id, row]));
const legacyRows = legacyResult?.rows ?? legacyResult;
const userAuditRows = legacyRows
  .map((row: any) => {
    const canonicalRow = canonicalByUser.get(row.user_id);
    const accountingRow = accountingByUser.get(row.user_id) as any;
    const legacyPortfolioValue = Number(row.legacy_portfolio_value || 0);
    const canonicalPortfolioValue = canonicalRow?.portfolioValue || 0;
    return {
      userId: row.user_id,
      email: row.email,
      username: row.username,
      legacyPortfolioValue,
      canonicalPortfolioValue,
      singlesMarketValue: canonicalRow?.singlesMarketValue || 0,
      lpMarketValue: canonicalRow?.lpMarketValue || 0,
      delta: canonicalPortfolioValue - legacyPortfolioValue,
      pricedSingles: Number(accountingRow?.priced_singles || 0),
      unpricedSingles: Number(accountingRow?.unpriced_singles || 0),
      stackPowerExcluded: Number(accountingRow?.stack_power || 0),
      snapshotCount: Number(accountingRow?.snapshot_count || 0),
    };
  })
  .sort((left: any, right: any) => Math.abs(right.delta) - Math.abs(left.delta));
const usersWithDeltas = userAuditRows.filter((row: any) => Math.abs(row.delta) >= 0.01);

const snapshotAuditResult: any = await db.execute(sql`
  WITH latest_snapshot AS (
    SELECT DISTINCT ON (${portfolioSnapshots.userId})
      ${portfolioSnapshots.userId} AS user_id,
      DATE(${portfolioSnapshots.snapshotDate}) AS snapshot_date,
      ${portfolioSnapshots.portfolioValue}::numeric AS portfolio_value,
      ${portfolioSnapshots.totalNetWorth}::numeric AS total_net_worth,
      ${portfolioSnapshots.cashBalance}::numeric AS cash_balance
    FROM ${portfolioSnapshots}
    ORDER BY ${portfolioSnapshots.userId}, ${portfolioSnapshots.snapshotDate} DESC
  ), duplicate_days AS (
    SELECT
      ${portfolioSnapshots.userId} AS user_id,
      DATE(${portfolioSnapshots.snapshotDate}) AS snapshot_date,
      COUNT(*)::int AS duplicate_count
    FROM ${portfolioSnapshots}
    GROUP BY ${portfolioSnapshots.userId}, DATE(${portfolioSnapshots.snapshotDate})
    HAVING COUNT(*) > 1
  )
  SELECT
    (SELECT COUNT(*)::int FROM duplicate_days) AS duplicate_user_days,
    (SELECT COUNT(*)::int FROM latest_snapshot
      WHERE ABS((cash_balance + portfolio_value) - total_net_worth) >= 0.01
    ) AS internally_inconsistent_latest_snapshots
`);
const snapshotRows = snapshotAuditResult?.rows ?? snapshotAuditResult;

console.log(
  JSON.stringify(
    {
      auditMode: "read_only",
      valuationVersion: VALUATION_VERSION,
      generatedAt: new Date().toISOString(),
      usersAudited: canonical.length,
      usersWithValuationDeltas: usersWithDeltas.length,
      allZeroLeaderboard:
        canonical.length > 0 && canonical.every((row) => row.portfolioValue === 0),
      missingSnapshotUsers: userAuditRows.filter((row: any) => row.snapshotCount === 0).length,
      users: userAuditRows,
      snapshots: {
        duplicateUserDays: Number(snapshotRows[0]?.duplicate_user_days || 0),
        internallyInconsistentLatestSnapshots: Number(
          snapshotRows[0]?.internally_inconsistent_latest_snapshots || 0,
        ),
        note: "Historical rows were not modified or backfilled.",
      },
    },
    null,
    2,
  ),
);

await pool.end();

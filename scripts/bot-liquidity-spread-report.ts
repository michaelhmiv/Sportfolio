import "dotenv/config";
import { Client } from "pg";

const LP_ACTION_TYPES = [
  "pool_add_liquidity",
  "pool_add_liquidity_optimal",
  "pool_zap_add_shares",
  "pool_zap_add_sb",
] as const;

type SummaryRow = {
  label: "current_24h" | "previous_24h";
  total_actions: number;
  distinct_players: number;
  top_player_share: number;
  distinct_sports: number;
  max_sport_share: number;
};

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toPct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

const connectionString = process.env.DEV_DATABASE_URL;

if (!connectionString) {
  console.error(
    "Missing DEV_DATABASE_URL. Set DEV_DATABASE_URL to the intended local/dev Postgres target before running this report.",
  );
  process.exit(1);
}

const client = new Client({ connectionString });

const summarySql = `
WITH windows AS (
  SELECT 'current_24h'::text AS label, NOW() - INTERVAL '24 hours' AS start_at, NOW() AS end_at
  UNION ALL
  SELECT 'previous_24h'::text AS label, NOW() - INTERVAL '48 hours' AS start_at, NOW() - INTERVAL '24 hours' AS end_at
),
lp_actions AS (
  SELECT
    w.label,
    COALESCE(
      bal.action_details->'action'->>'playerId',
      bal.action_details->>'playerId'
    ) AS player_id
  FROM windows w
  LEFT JOIN bot_actions_log bal
    ON bal.created_at >= w.start_at
   AND bal.created_at < w.end_at
   AND bal.success = true
   AND bal.action_type = ANY($1::text[])
),
filtered_actions AS (
  SELECT label, player_id
  FROM lp_actions
  WHERE player_id IS NOT NULL
),
totals AS (
  SELECT
    label,
    COUNT(*) AS total_actions,
    COUNT(DISTINCT player_id) AS distinct_players
  FROM filtered_actions
  GROUP BY label
),
player_counts AS (
  SELECT label, player_id, COUNT(*) AS action_count
  FROM filtered_actions
  GROUP BY label, player_id
),
top_player AS (
  SELECT DISTINCT ON (label)
    label,
    action_count
  FROM player_counts
  ORDER BY label, action_count DESC, player_id
),
sport_counts AS (
  SELECT
    fa.label,
    COALESCE(p.sport, 'UNKNOWN') AS sport,
    COUNT(*) AS action_count
  FROM filtered_actions fa
  LEFT JOIN players p ON p.id = fa.player_id
  GROUP BY fa.label, COALESCE(p.sport, 'UNKNOWN')
),
sport_rollup AS (
  SELECT
    label,
    COUNT(*) AS distinct_sports,
    MAX(action_count)::numeric / NULLIF(SUM(action_count), 0) AS max_sport_share
  FROM sport_counts
  GROUP BY label
)
SELECT
  w.label,
  COALESCE(t.total_actions, 0) AS total_actions,
  COALESCE(t.distinct_players, 0) AS distinct_players,
  COALESCE(tp.action_count::numeric / NULLIF(t.total_actions, 0), 0) AS top_player_share,
  COALESCE(sr.distinct_sports, 0) AS distinct_sports,
  COALESCE(sr.max_sport_share, 0) AS max_sport_share
FROM windows w
LEFT JOIN totals t ON t.label = w.label
LEFT JOIN top_player tp ON tp.label = w.label
LEFT JOIN sport_rollup sr ON sr.label = w.label
ORDER BY CASE w.label WHEN 'current_24h' THEN 1 ELSE 2 END;
`;

const topTargetsSql = `
WITH lp_actions AS (
  SELECT
    COALESCE(
      bal.action_details->'action'->>'playerId',
      bal.action_details->>'playerId'
    ) AS player_id
  FROM bot_actions_log bal
  WHERE bal.created_at >= NOW() - INTERVAL '24 hours'
    AND bal.success = true
    AND bal.action_type = ANY($1::text[])
),
filtered AS (
  SELECT player_id
  FROM lp_actions
  WHERE player_id IS NOT NULL
),
totals AS (
  SELECT COUNT(*) AS total_actions
  FROM filtered
)
SELECT
  f.player_id,
  COALESCE(CONCAT(p.first_name, ' ', p.last_name), f.player_id) AS player_name,
  COALESCE(p.sport, 'UNKNOWN') AS sport,
  COUNT(*) AS action_count,
  COUNT(*)::numeric / NULLIF((SELECT total_actions FROM totals), 0) AS action_share
FROM filtered f
LEFT JOIN players p ON p.id = f.player_id
GROUP BY f.player_id, p.first_name, p.last_name, p.sport
ORDER BY action_count DESC, f.player_id
LIMIT 10;
`;

const sportBreakdownSql = `
WITH lp_actions AS (
  SELECT
    COALESCE(
      bal.action_details->'action'->>'playerId',
      bal.action_details->>'playerId'
    ) AS player_id
  FROM bot_actions_log bal
  WHERE bal.created_at >= NOW() - INTERVAL '24 hours'
    AND bal.success = true
    AND bal.action_type = ANY($1::text[])
),
filtered AS (
  SELECT player_id
  FROM lp_actions
  WHERE player_id IS NOT NULL
)
SELECT
  COALESCE(p.sport, 'UNKNOWN') AS sport,
  COUNT(*) AS action_count,
  COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) AS action_share
FROM filtered f
LEFT JOIN players p ON p.id = f.player_id
GROUP BY COALESCE(p.sport, 'UNKNOWN')
ORDER BY action_count DESC, sport;
`;

const initializedPoolsSql = `
SELECT
  COALESCE(p.sport, 'UNKNOWN') AS sport,
  COUNT(*) AS initialized_pool_count
FROM player_pools pp
LEFT JOIN players p ON p.id = pp.player_id
WHERE
  pp.total_trades > 0
  OR pp.shares::numeric > 0
  OR pp.play_money::numeric > 0
  OR pp.lp_shares_total::numeric > 0
GROUP BY COALESCE(p.sport, 'UNKNOWN')
ORDER BY initialized_pool_count DESC, sport;
`;

async function main() {
  await client.connect();
  try {
    const summaryResult = await client.query(summarySql, [LP_ACTION_TYPES]);
    const summaryRows = summaryResult.rows.map((row) => ({
      label: row.label as SummaryRow["label"],
      total_actions: toNumber(row.total_actions),
      distinct_players: toNumber(row.distinct_players),
      top_player_share: toNumber(row.top_player_share),
      distinct_sports: toNumber(row.distinct_sports),
      max_sport_share: toNumber(row.max_sport_share),
    }));

    const current = summaryRows.find((row) => row.label === "current_24h");
    const previous = summaryRows.find((row) => row.label === "previous_24h");

    const topTargetsResult = await client.query(topTargetsSql, [LP_ACTION_TYPES]);
    const sportBreakdownResult = await client.query(sportBreakdownSql, [LP_ACTION_TYPES]);
    const initializedPoolsResult = await client.query(initializedPoolsSql);

    console.log("\nLP Spread Comparison (Current 24h vs Previous 24h)");
    console.table(
      summaryRows.map((row) => ({
        window: row.label,
        totalLpActions: row.total_actions,
        distinctTargetPlayers: row.distinct_players,
        topPlayerShare: toPct(row.top_player_share),
        distinctSports: row.distinct_sports,
        maxSportShare: toPct(row.max_sport_share),
      })),
    );

    if (current && previous) {
      const distinctPlayersImproved = current.distinct_players >= previous.distinct_players;
      const topShareImproved = current.top_player_share <= previous.top_player_share;
      const sportSpreadImproved =
        current.distinct_sports >= previous.distinct_sports &&
        current.max_sport_share <= previous.max_sport_share;

      console.log("\nPost-Change Objective Checks");
      console.table([
        {
          objective: "Higher distinct LP target players (24h)",
          current: current.distinct_players,
          previous: previous.distinct_players,
          status: distinctPlayersImproved ? "PASS" : "REVIEW",
        },
        {
          objective: "Lower top-player LP action share (24h)",
          current: toPct(current.top_player_share),
          previous: toPct(previous.top_player_share),
          status: topShareImproved ? "PASS" : "REVIEW",
        },
        {
          objective: "Better sport LP coverage (24h)",
          current: `${current.distinct_sports} sports, max ${toPct(current.max_sport_share)}`,
          previous: `${previous.distinct_sports} sports, max ${toPct(previous.max_sport_share)}`,
          status: sportSpreadImproved ? "PASS" : "REVIEW",
        },
      ]);
    }

    console.log("\nTop LP Target Players (Current 24h)");
    console.table(
      topTargetsResult.rows.map((row) => ({
        playerId: row.player_id,
        player: row.player_name,
        sport: row.sport,
        actions: toNumber(row.action_count),
        share: toPct(toNumber(row.action_share)),
      })),
    );

    console.log("\nLP Action Sport Breakdown (Current 24h)");
    console.table(
      sportBreakdownResult.rows.map((row) => ({
        sport: row.sport,
        actions: toNumber(row.action_count),
        share: toPct(toNumber(row.action_share)),
      })),
    );

    console.log("\nInitialized Pools by Sport (Current State)");
    console.table(
      initializedPoolsResult.rows.map((row) => ({
        sport: row.sport,
        initializedPools: toNumber(row.initialized_pool_count),
      })),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to generate bot liquidity spread report.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

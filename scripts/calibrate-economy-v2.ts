import { Client } from "pg";
import {
  resolveEconomyClass,
  resolveEconomySeasonPhase,
  type EconomyClass,
  type EconomySeasonPhase,
} from "../server/economy/config";

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "sportfolio-economy-v2-calibration-readonly",
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(`
      SELECT
        pgs.player_id,
        COALESCE(NULLIF(pgs.season, ''), EXTRACT(YEAR FROM dg.date)::text) AS season,
        pgs.fantasy_points::text,
        pgs.stats_json,
        p.sport,
        p.position,
        dg.season_type,
        dg.away_team
      FROM player_game_stats pgs
      INNER JOIN players p ON p.id = pgs.player_id
      LEFT JOIN daily_games dg ON dg.game_id = pgs.game_id
      WHERE pgs.fantasy_points IS NOT NULL
        AND UPPER(p.sport) IN ('MLB','NFL','NHL','NASCAR')
    `);

    const totals = new Map<string, number>();
    for (const row of result.rows) {
      const economyClass = resolveEconomyClass({
        sport: row.sport,
        position: row.position,
        statsJson:
          String(row.sport).toUpperCase() === "NASCAR"
            ? { ...(row.stats_json || {}), series: row.away_team }
            : row.stats_json,
      });
      if (!economyClass) continue;
      const phase = resolveEconomySeasonPhase({
        seasonType: row.season_type,
        statsSeason: row.season,
      });
      if (phase === "preseason") continue;
      const fp = Number(row.fantasy_points);
      if (!Number.isFinite(fp)) continue;
      const season = String(row.season || "unknown");
      const key = `${economyClass}|${phase}|${row.player_id}|${season}`;
      totals.set(key, (totals.get(key) || 0) + Math.max(0, fp));
    }

    const grouped = new Map<string, number[]>();
    for (const [key, total] of totals) {
      const [economyClass, phase] = key.split("|") as [EconomyClass, EconomySeasonPhase];
      const groupKey = `${economyClass}|${phase}`;
      const values = grouped.get(groupKey) || [];
      values.push(total);
      grouped.set(groupKey, values);
    }

    const report = [...grouped.entries()]
      .map(([key, values]) => {
        const [economyClass, phase] = key.split("|") as [EconomyClass, EconomySeasonPhase];
        return {
          economyClass,
          phase,
          playerSeasons: values.length,
          p50: percentile(values, 0.5),
          p70: percentile(values, 0.7),
          p75: percentile(values, 0.75),
          p80: percentile(values, 0.8),
          p90: percentile(values, 0.9),
        };
      })
      .sort((a, b) => a.economyClass.localeCompare(b.economyClass) || a.phase.localeCompare(b.phase));

    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

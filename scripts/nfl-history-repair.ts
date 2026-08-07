import "dotenv/config";
import { pool } from "../server/db";
import { syncNFLSchedule } from "../server/jobs/sync-nfl-schedule";
import { syncNflverseStats } from "../server/jobs/sync-nflverse-stats";

const REPAIR_ID = "nfl_history_calendar_boundary_repair_v2";
const LOCK_NAME = "sportfolio:nfl:history-calendar-boundary-repair-v2";
const HISTORICAL_SEASONS = [2024, 2025] as const;

type CoverageKey = `${number}:${string}`;

async function main() {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NFL_MIGRATION_ALLOW_NON_PROD !== "true"
  ) {
    throw new Error(
      "nfl:repair-history is production-only unless NFL_MIGRATION_ALLOW_NON_PROD=true",
    );
  }

  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_NAME]);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS sportfolio_operational_migrations (
        id text PRIMARY KEY,
        completed_at timestamptz NOT NULL DEFAULT now(),
        details jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    const marker = await client.query(
      "SELECT 1 FROM sportfolio_operational_migrations WHERE id=$1",
      [REPAIR_ID],
    );
    if (marker.rowCount) {
      console.log(`[nfl_history_repair] ${REPAIR_ID} already completed; no-op`);
      return;
    }

    const schedules = [];
    for (const season of HISTORICAL_SEASONS) {
      const schedule = await syncNFLSchedule({ season, fullSeason: true });
      schedules.push({ season, ...schedule });
      console.log(`[nfl_history_repair] schedule ${season} ${JSON.stringify(schedule)}`);
      if (schedule.errors.length !== 0) {
        throw new Error(`NFL ${season} schedule repair failed: ${JSON.stringify(schedule)}`);
      }
    }

    const coverageRows = await client.query<{ season: number; season_type: string; games: number }>(
      `
        SELECT season, season_type, count(*)::int AS games
        FROM daily_games
        WHERE sport = 'NFL' AND season = ANY($1::int[])
        GROUP BY season, season_type
        ORDER BY season, season_type
      `,
      [[...HISTORICAL_SEASONS]],
    );
    console.log(`[nfl_history_repair] coverage ${JSON.stringify(coverageRows.rows)}`);
    const coverage = new Map<CoverageKey, number>(
      coverageRows.rows.map((row) => [
        `${Number(row.season)}:${String(row.season_type)}` as CoverageKey,
        Number(row.games),
      ]),
    );
    for (const season of HISTORICAL_SEASONS) {
      const regular = coverage.get(`${season}:regular`) || 0;
      const postseason = coverage.get(`${season}:postseason`) || 0;
      if (regular !== 272 || postseason !== 13) {
        throw new Error(
          `NFL ${season} schedule coverage invalid: regular=${regular}, postseason=${postseason}`,
        );
      }
    }

    const result = await syncNflverseStats({ years: [...HISTORICAL_SEASONS] });
    console.log(`[nfl_history_repair] stats ${JSON.stringify(result)}`);
    if (result.errorCount !== 0 || result.recordsProcessed === 0 || result.gamesMissing !== 0) {
      throw new Error(`NFL history repair verification failed: ${JSON.stringify(result)}`);
    }

    const verification = await client.query<{ stats: number; orphan_stats: number }>(`
      SELECT
        count(*) FILTER (WHERE s.sport = 'NFL' AND s.season IN ('2024', '2025'))::int AS stats,
        count(*) FILTER (
          WHERE s.sport = 'NFL'
            AND s.season IN ('2024', '2025')
            AND g.game_id IS NULL
        )::int AS orphan_stats
      FROM player_game_stats s
      LEFT JOIN daily_games g ON g.game_id = s.game_id
    `);
    const verificationRow = verification.rows[0] || { stats: 0, orphan_stats: 0 };
    console.log(`[nfl_history_repair] verification ${JSON.stringify(verificationRow)}`);
    if (Number(verificationRow.stats) === 0 || Number(verificationRow.orphan_stats) !== 0) {
      throw new Error(`NFL history DB verification failed: ${JSON.stringify(verificationRow)}`);
    }

    await client.query(
      "INSERT INTO sportfolio_operational_migrations(id, details) VALUES ($1, $2::jsonb)",
      [
        REPAIR_ID,
        JSON.stringify({
          schedules,
          coverage: coverageRows.rows,
          stats: result,
          verification: verificationRow,
        }),
      ],
    );
    console.log(`[nfl_history_repair] ${REPAIR_ID} completed successfully`);
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_NAME]);
      } catch (error) {
        console.warn("[nfl_history_repair] advisory unlock failed", error);
      }
    }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[nfl_history_repair] failed", error);
  process.exitCode = 1;
});

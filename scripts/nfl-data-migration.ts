import "dotenv/config";
import { pool } from "../server/db";
import { syncNFLRoster } from "../server/jobs/sync-nfl-roster";
import { syncNFLSchedule } from "../server/jobs/sync-nfl-schedule";
import { syncNflverseStats } from "../server/jobs/sync-nflverse-stats";

const MIGRATION_ID = "nfl_espn_nflverse_rebuild_v1";
const LOCK_NAME = "sportfolio:nfl:espn-nflverse-rebuild-v1";

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function scalar(client: any, text: string, params: unknown[] = []): Promise<number> {
  const response = await client.query(text, params);
  return Number(response.rows?.[0]?.count || 0);
}

async function main() {
  if (process.env.NODE_ENV !== "production" && process.env.NFL_MIGRATION_ALLOW_NON_PROD !== "true") {
    throw new Error("nfl:migrate-data is production-only unless NFL_MIGRATION_ALLOW_NON_PROD=true");
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
    const existingMarker = await client.query(
      "SELECT completed_at, details FROM sportfolio_operational_migrations WHERE id = $1",
      [MIGRATION_ID],
    );
    if (existingMarker.rowCount) {
      console.log(`[nfl_migration] ${MIGRATION_ID} already completed; no-op`);
      return;
    }

    // The application schema starts using these only after this pre-deploy operation.
    await client.query("ALTER TABLE daily_games ADD COLUMN IF NOT EXISTS season integer");
    await client.query("ALTER TABLE daily_games ADD COLUMN IF NOT EXISTS season_type text");
    await client.query(
      "CREATE INDEX IF NOT EXISTS daily_games_sport_season_week_idx ON daily_games (sport, season, week)",
    );

    const playerRows = await client.query(
      "SELECT id FROM players WHERE UPPER(sport) = 'NFL' ORDER BY id",
    );
    const legacyIds = playerRows.rows.map((row: any) => String(row.id));
    const before = {
      players: legacyIds.length,
      games: await scalar(client, "SELECT count(*) FROM daily_games WHERE UPPER(sport)='NFL'"),
      stats: await scalar(client, "SELECT count(*) FROM player_game_stats WHERE UPPER(sport)='NFL'"),
      pools: await scalar(
        client,
        "SELECT count(*) FROM player_pools pp JOIN players p ON p.id=pp.player_id WHERE UPPER(p.sport)='NFL'",
      ),
      pricedPlayers: await scalar(
        client,
        "SELECT count(*) FROM players WHERE UPPER(sport)='NFL' AND last_trade_price IS NOT NULL",
      ),
    };
    console.log(`[nfl_migration] legacy inventory ${JSON.stringify(before)}`);

    await client.query("BEGIN");
    try {
      if (legacyIds.length > 0) {
        const columns = await client.query(`
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema='public'
            AND column_name IN ('player_id','asset_id','canonical_player_id','alias_player_id')
          ORDER BY table_name, column_name
        `);
        for (const row of columns.rows) {
          const table = String(row.table_name);
          const column = String(row.column_name);
          if (table === "players") continue;
          const statement = `DELETE FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} = ANY($1::text[])`;
          const deleted = await client.query(statement, [legacyIds]);
          if (deleted.rowCount) {
            console.log(`[nfl_migration] removed ${deleted.rowCount} rows from ${table}.${column}`);
          }
        }
      }
      await client.query("DELETE FROM player_id_aliases WHERE UPPER(sport)='NFL'");
      await client.query("DELETE FROM player_game_stats WHERE UPPER(sport)='NFL'");
      await client.query("DELETE FROM daily_games WHERE UPPER(sport)='NFL'");
      await client.query("DELETE FROM players WHERE UPPER(sport)='NFL'");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const roster = await syncNFLRoster();
    console.log(`[nfl_migration] roster ${JSON.stringify(roster)}`);
    if (roster.errors.length > 0 || roster.playersAdded + roster.playersUpdated === 0) {
      throw new Error(`NFL roster rebuild failed: ${roster.errors.join("; ") || "no players"}`);
    }

    const years = [2024, 2025, 2026];
    const schedules = [];
    for (const year of years) {
      const schedule = await syncNFLSchedule({ season: year, fullSeason: true });
      schedules.push({ year, ...schedule });
      console.log(`[nfl_migration] schedule ${year} ${JSON.stringify(schedule)}`);
      if (year <= 2025 && schedule.gamesProcessed === 0) {
        throw new Error(`NFL ${year} schedule rebuild returned no games`);
      }
    }

    const history = await syncNflverseStats({ years });
    console.log(`[nfl_migration] nflverse history ${JSON.stringify(history)}`);
    if (history.recordsProcessed === 0) {
      throw new Error("NFL historical backfill returned no player-game records");
    }

    const verification = {
      players: await scalar(client, "SELECT count(*) FROM players WHERE UPPER(sport)='NFL'"),
      games: await scalar(client, "SELECT count(*) FROM daily_games WHERE UPPER(sport)='NFL'"),
      stats: await scalar(client, "SELECT count(*) FROM player_game_stats WHERE UPPER(sport)='NFL'"),
      orphanStats: await scalar(
        client,
        `SELECT count(*) FROM player_game_stats s
         LEFT JOIN players p ON p.id=s.player_id
         WHERE UPPER(s.sport)='NFL' AND p.id IS NULL`,
      ),
      invalidPositions: await scalar(
        client,
        "SELECT count(*) FROM players WHERE UPPER(sport)='NFL' AND position NOT IN ('QB','RB','WR','TE','K')",
      ),
      seededLastTradePrices: await scalar(
        client,
        "SELECT count(*) FROM players WHERE UPPER(sport)='NFL' AND last_trade_price IS NOT NULL",
      ),
      seededPools: await scalar(
        client,
        "SELECT count(*) FROM player_pools pp JOIN players p ON p.id=pp.player_id WHERE UPPER(p.sport)='NFL'",
      ),
    };
    console.log(`[nfl_migration] verification ${JSON.stringify(verification)}`);
    if (
      verification.players === 0 ||
      verification.games === 0 ||
      verification.stats === 0 ||
      verification.orphanStats !== 0 ||
      verification.invalidPositions !== 0 ||
      verification.seededLastTradePrices !== 0 ||
      verification.seededPools !== 0
    ) {
      throw new Error(`NFL migration verification failed: ${JSON.stringify(verification)}`);
    }

    const details = {
      before,
      after: verification,
      roster,
      schedules: schedules.map(({ year, requestCount, gamesProcessed, errors }) => ({
        year,
        requestCount,
        gamesProcessed,
        errorCount: errors.length,
      })),
      history: {
        requestCount: history.requestCount,
        recordsProcessed: history.recordsProcessed,
        gamesMissing: history.gamesMissing,
        errorCount: history.errorCount,
      },
    };
    await client.query(
      "INSERT INTO sportfolio_operational_migrations(id, details) VALUES ($1, $2::jsonb)",
      [MIGRATION_ID, JSON.stringify(details)],
    );
    console.log(`[nfl_migration] ${MIGRATION_ID} completed successfully`);
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_NAME]);
      } catch (error) {
        console.warn("[nfl_migration] advisory unlock failed", error);
      }
    }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[nfl_migration] failed", error);
  process.exitCode = 1;
});

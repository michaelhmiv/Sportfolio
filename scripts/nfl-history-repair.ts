import "dotenv/config";
import { pool } from "../server/db";
import { syncNflverseStats } from "../server/jobs/sync-nflverse-stats";

const REPAIR_ID = "nfl_postseason_week_reconcile_v1";
const LOCK_NAME = "sportfolio:nfl:postseason-week-reconcile-v1";

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

    const result = await syncNflverseStats({ years: [2024, 2025] });
    console.log(`[nfl_history_repair] result ${JSON.stringify(result)}`);
    if (result.errorCount !== 0 || result.recordsProcessed === 0 || result.gamesMissing !== 0) {
      throw new Error(`NFL history repair verification failed: ${JSON.stringify(result)}`);
    }

    await client.query(
      "INSERT INTO sportfolio_operational_migrations(id, details) VALUES ($1, $2::jsonb)",
      [REPAIR_ID, JSON.stringify({ result })],
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

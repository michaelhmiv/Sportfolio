#!/usr/bin/env node
/* global process, console */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(HERE, "../migrations/0068_economy_v2.sql");
const LOCK_KEY = "sportfolio:economy-v2:0068";

export async function inspectEconomyV2Schema(client) {
  const result = await client.query(`
    SELECT
      to_regclass('public.player_game_earnings') IS NOT NULL AS earnings_table,
      to_regclass('public.economy_events') IS NOT NULL AS events_table,
      to_regclass('public.player_multipliers') IS NULL AS stack_table_removed,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'daily_boosts'
          AND column_name = 'boost_bonus_sb'
      ) AS boost_bonus_column,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'share_payouts'
          AND column_name = 'eligible_shares'
      ) AS eligible_shares_column
  `);
  const row = result.rows[0] || {};
  const complete =
    row.earnings_table === true &&
    row.events_table === true &&
    row.stack_table_removed === true &&
    row.boost_bonus_column === true &&
    row.eligible_shares_column === true;
  return { complete, ...row };
}

async function assertPostMigrationInvariants(client) {
  const state = await inspectEconomyV2Schema(client);
  if (!state.complete) {
    throw new Error(`Economy V2 schema incomplete after migration: ${JSON.stringify(state)}`);
  }

  const invalid = await client.query(`
    SELECT
      (SELECT count(*)::bigint FROM holdings WHERE quantity::numeric < 0) AS negative_holdings,
      (SELECT count(*)::bigint FROM players WHERE total_shares::numeric < 0) AS negative_player_totals,
      (SELECT count(*)::bigint FROM daily_boosts WHERE shares_entered::numeric <= 0) AS invalid_boosts
  `);
  const row = invalid.rows[0];
  if (
    Number(row?.negative_holdings || 0) > 0 ||
    Number(row?.negative_player_totals || 0) > 0 ||
    Number(row?.invalid_boosts || 0) > 0
  ) {
    throw new Error(`Economy V2 invariant failure: ${JSON.stringify(row)}`);
  }
  return state;
}

export async function applyEconomyV2Migration({ databaseUrl = process.env.DATABASE_URL } = {}) {
  const resolved = String(databaseUrl || "").trim();
  if (!resolved) throw new Error("DATABASE_URL is required.");

  const client = new Client({
    connectionString: resolved,
    application_name: "sportfolio-economy-v2-migration-0068",
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    const initial = await inspectEconomyV2Schema(client);
    if (initial.complete) return { status: "already_applied", ...initial };

    const migrationSql = await readFile(MIGRATION_PATH, "utf8");
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY]);
      const lockedState = await inspectEconomyV2Schema(client);
      if (lockedState.complete) {
        await client.query("COMMIT");
        return { status: "already_applied", ...lockedState };
      }
      await client.query(migrationSql);
      const applied = await assertPostMigrationInvariants(client);
      await client.query("COMMIT");
      return { status: "applied", ...applied };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const result = await applyEconomyV2Migration();
  console.log(JSON.stringify({ migration: "0068_economy_v2", ...result }));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        migration: "0068_economy_v2",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}

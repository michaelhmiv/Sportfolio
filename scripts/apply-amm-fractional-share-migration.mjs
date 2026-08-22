#!/usr/bin/env node
/* global process, console */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(HERE, "../migrations/0069_amm_fractional_share_precision.sql");
const LOCK_KEY = "sportfolio:amm-fractional-shares:0069";

export async function inspectAmmFractionalShareSchema(client) {
  const result = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'player_pools'
          AND column_name = 'shares'
          AND numeric_scale = 4
      ) AS pool_shares_fractional,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'lp_transactions'
          AND column_name = 'shares_amount'
          AND numeric_scale = 4
      ) AS lp_shares_amount_fractional,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'lp_transactions'
          AND column_name = 'pool_shares_before'
          AND numeric_scale = 4
      ) AS lp_pool_shares_fractional
  `);

  const row = result.rows[0] || {};
  return {
    ...row,
    complete:
      row.pool_shares_fractional === true &&
      row.lp_shares_amount_fractional === true &&
      row.lp_pool_shares_fractional === true,
  };
}

export async function applyAmmFractionalShareMigration({
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const resolved = String(databaseUrl || "").trim();
  if (!resolved) throw new Error("DATABASE_URL is required.");

  const client = new Client({
    connectionString: resolved,
    application_name: "sportfolio-amm-fractional-shares-migration-0069",
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    const initial = await inspectAmmFractionalShareSchema(client);
    if (initial.complete) return { status: "already_applied", ...initial };

    const migrationSql = await readFile(MIGRATION_PATH, "utf8");
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY]);
      const lockedState = await inspectAmmFractionalShareSchema(client);
      if (lockedState.complete) {
        await client.query("COMMIT");
        return { status: "already_applied", ...lockedState };
      }

      await client.query(migrationSql);
      const applied = await inspectAmmFractionalShareSchema(client);
      if (!applied.complete) {
        throw new Error(`AMM fractional-share schema incomplete: ${JSON.stringify(applied)}`);
      }
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
  const result = await applyAmmFractionalShareMigration();
  console.log(JSON.stringify({ migration: "0069_amm_fractional_share_precision", ...result }));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        migration: "0069_amm_fractional_share_precision",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}

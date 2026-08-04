#!/usr/bin/env node
/* global process, console */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(HERE, "../migrations/0053_scout_distribution_claims.sql");
const LOCK_KEY = "sportfolio:scout_distribution_claims:0053";
const REQUIRED_INDEX = "scout_distribution_claims_event_idx";

export function assertSchedulerQuiesced(environment = process.env) {
  if (String(environment.RUN_SCHEDULED_JOBS || "").toLowerCase() !== "false") {
    throw new Error(
      "RUN_SCHEDULED_JOBS must be false before applying scout distribution claim migration 0053.",
    );
  }
}

export async function inspectScoutClaimsSchema(client) {
  const tableResult = await client.query(
    "SELECT to_regclass('public.scout_distribution_claims')::text AS table_name",
  );
  const tableExists = Boolean(tableResult.rows[0]?.table_name);
  if (!tableExists) {
    return { tableExists: false, uniqueIndexExists: false, claimCount: 0 };
  }

  const verification = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
         FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'scout_distribution_claims'
           AND indexname = $1
           AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
       ) AS unique_index_exists,
       (SELECT count(*)::bigint FROM scout_distribution_claims) AS claim_count`,
    [REQUIRED_INDEX],
  );
  return {
    tableExists: true,
    uniqueIndexExists: verification.rows[0]?.unique_index_exists === true,
    claimCount: Number(verification.rows[0]?.claim_count || 0),
  };
}

function assertCompleteSchema(state) {
  if (!state.tableExists || !state.uniqueIndexExists) {
    throw new Error(
      "scout_distribution_claims exists without its required unique event index; refusing to continue.",
    );
  }
}

export async function applyScoutClaimsMigration({ databaseUrl, environment = process.env } = {}) {
  const resolvedDatabaseUrl = String(databaseUrl || environment.DATABASE_URL || "").trim();
  if (!resolvedDatabaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const client = new Client({
    connectionString: resolvedDatabaseUrl,
    application_name: "sportfolio-scout-claims-migration-0053",
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    const initial = await inspectScoutClaimsSchema(client);
    if (initial.tableExists) {
      assertCompleteSchema(initial);
      return { status: "already_applied", ...initial };
    }

    assertSchedulerQuiesced(environment);
    const sql = await readFile(MIGRATION_PATH, "utf8");
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY]);
      const lockedState = await inspectScoutClaimsSchema(client);
      if (lockedState.tableExists) {
        assertCompleteSchema(lockedState);
        await client.query("COMMIT");
        return { status: "already_applied", ...lockedState };
      }

      await client.query("SET LOCAL sportfolio.scout_distribution_scheduler_quiesced = 'on'");
      await client.query(sql);
      const applied = await inspectScoutClaimsSchema(client);
      assertCompleteSchema(applied);
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
  const result = await applyScoutClaimsMigration();
  console.log(
    JSON.stringify({
      migration: "0053_scout_distribution_claims",
      status: result.status,
      tableExists: result.tableExists,
      uniqueIndexExists: result.uniqueIndexExists,
      claimCount: result.claimCount,
    }),
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        migration: "0053_scout_distribution_claims",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}

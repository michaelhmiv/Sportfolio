from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

migration_script = r'''#!/usr/bin/env node
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
'''

(ROOT / "scripts/apply-scout-claims-migration.mjs").write_text(migration_script)

contract_test = r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/apply-scout-claims-migration.mjs", "utf8");

describe("scout claim production migration runner", () => {
  it("fails closed unless scheduled jobs are quiesced before first application", () => {
    expect(source).toContain('RUN_SCHEDULED_JOBS must be false');
    expect(source).toContain("assertSchedulerQuiesced(environment)");
  });

  it("uses a transaction-scoped advisory lock and the migration safety GUC", () => {
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("sportfolio.scout_distribution_scheduler_quiesced");
    expect(source).toContain('client.query("ROLLBACK")');
  });

  it("verifies both the table and unique event index before success", () => {
    expect(source).toContain("to_regclass('public.scout_distribution_claims')");
    expect(source).toContain("scout_distribution_claims_event_idx");
    expect(source).toContain("CREATE UNIQUE INDEX%");
    expect(source).toContain("assertCompleteSchema(applied)");
  });

  it("does not print database credentials", () => {
    expect(source).not.toContain("console.log(resolvedDatabaseUrl");
    expect(source).not.toContain("connectionString:", source.indexOf("console"));
  });
});
'''
(ROOT / "server/scout-claims-migration.contract.test.ts").write_text(contract_test)

runbook = '''# Scout distribution claim migration repair\n\nProduction logs showed every hourly scout distribution failing after the claim-first writer shipped. The repository contains migration `0053_scout_distribution_claims.sql`, but the Railway service has no automatic migration command.\n\nThe repair is intentionally two-deployment and fail-closed:\n\n1. Deploy with `RUN_SCHEDULED_JOBS=false` and verify no scheduler starts.\n2. Configure `node scripts/apply-scout-claims-migration.mjs` as the temporary Railway pre-deploy command.\n3. Redeploy. The script acquires a transaction-scoped advisory lock, sets the migration safety GUC, applies migration 0053, and verifies the table plus unique event index.\n4. Remove the temporary pre-deploy command, restore `RUN_SCHEDULED_JOBS=true`, and redeploy.\n5. Verify the next scout distribution records successful claims without duplicate payouts.\n\nThe runner is idempotent. When the complete schema already exists, it verifies and exits without requiring scheduler quiescence. A partial table without the required unique index is treated as an error and is not modified automatically.\n'''
(ROOT / "docs/operations/scout-distribution-claims-repair.md").write_text(runbook)

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text())
package["scripts"]["db:migrate:scout-claims"] = "node scripts/apply-scout-claims-migration.mjs"
package_path.write_text(json.dumps(package, indent=2) + "\n")

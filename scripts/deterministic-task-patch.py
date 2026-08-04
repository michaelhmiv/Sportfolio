from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

helper = '''import { createHash } from "node:crypto";

export type ScoutDistributionAdvisoryLockKeys = readonly [number, number];

/**
 * Derive the two signed 32-bit keys accepted by PostgreSQL's portable
 * pg_advisory_xact_lock(integer, integer) overload. Hashing in application
 * code avoids depending on optional database hash functions.
 */
export function deriveScoutDistributionAdvisoryLockKeys(
  eventKey: string,
): ScoutDistributionAdvisoryLockKeys {
  if (!eventKey.trim()) {
    throw new Error("Scout distribution advisory lock event key is required.");
  }
  const digest = createHash("sha256").update(eventKey, "utf8").digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)] as const;
}
'''
(ROOT / "server/scout-distribution-lock.ts").write_text(helper)

test = '''import { describe, expect, it } from "vitest";
import { deriveScoutDistributionAdvisoryLockKeys } from "./scout-distribution-lock";

describe("deriveScoutDistributionAdvisoryLockKeys", () => {
  it("is deterministic and returns signed 32-bit integers", () => {
    const first = deriveScoutDistributionAdvisoryLockKeys(
      "2026-08-04T17:00:00.000Z|mlb_641329|user_1",
    );
    const second = deriveScoutDistributionAdvisoryLockKeys(
      "2026-08-04T17:00:00.000Z|mlb_641329|user_1",
    );
    expect(first).toEqual(second);
    for (const key of first) {
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(-2147483648);
      expect(key).toBeLessThanOrEqual(2147483647);
    }
  });

  it("separates distinct claim events", () => {
    expect(deriveScoutDistributionAdvisoryLockKeys("event-a")).not.toEqual(
      deriveScoutDistributionAdvisoryLockKeys("event-b"),
    );
  });

  it("rejects an empty event key", () => {
    expect(() => deriveScoutDistributionAdvisoryLockKeys("   ")).toThrow(
      "event key is required",
    );
  });
});
'''
(ROOT / "server/scout-distribution-lock.test.ts").write_text(test)

storage_path = ROOT / "server/storage.ts"
storage = storage_path.read_text()
import_line = 'import { deriveScoutDistributionAdvisoryLockKeys } from "./scout-distribution-lock";\n'
if import_line not in storage:
    match = re.search(r'^(import .*?;\n)', storage, re.M)
    if not match:
        raise SystemExit("Could not locate storage import insertion point")
    storage = storage[: match.end()] + import_line + storage[match.end() :]

pattern = re.compile(
    r'(?P<indent>\s*)await\s+tx\.execute\(\s*sql`SELECT pg_advisory_xact_lock\(hashtextextended\(\$\{(?P<key>[^}]+)\},\s*0\)\)`\s*\);'
)
match = pattern.search(storage)
if not match:
    raise SystemExit("Unsupported scout advisory lock query was not found")
indent = match.group("indent")
key_expr = match.group("key").strip()
replacement = (
    f'{indent}const [advisoryLockKeyA, advisoryLockKeyB] = '
    f'deriveScoutDistributionAdvisoryLockKeys({key_expr});\n'
    f'{indent}await tx.execute(\n'
    f'{indent}  sql`SELECT pg_advisory_xact_lock(${{advisoryLockKeyA}}, ${{advisoryLockKeyB}})`,\n'
    f'{indent});'
)
storage = pattern.sub(replacement, storage, count=1)
if "hashtextextended" in storage:
    raise SystemExit("storage.ts still contains hashtextextended")
storage_path.write_text(storage)

verify = '''#!/usr/bin/env node
/* global process, console */
import { Client } from "pg";
import { createHash } from "node:crypto";

function deriveKeys(eventKey) {
  const digest = createHash("sha256").update(eventKey, "utf8").digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (String(process.env.RUN_SCHEDULED_JOBS || "").toLowerCase() !== "false") {
  throw new Error("RUN_SCHEDULED_JOBS must be false for advisory-lock verification.");
}

const client = new Client({
  connectionString: databaseUrl,
  application_name: "sportfolio-scout-lock-verifier",
  connectionTimeoutMillis: 10_000,
});
await client.connect();
try {
  const [keyA, keyB] = deriveKeys("sportfolio:scout_distribution:verification");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [keyA, keyB]);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  console.log(JSON.stringify({
    check: "scout_distribution_advisory_lock",
    status: "ok",
    overload: "pg_advisory_xact_lock(integer, integer)",
  }));
} finally {
  await client.end();
}
'''
(ROOT / "scripts/verify-scout-distribution-lock.mjs").write_text(verify)

contract = '''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("scout distribution advisory lock contract", () => {
  it("uses portable two-integer advisory locking", () => {
    const source = readFileSync("server/storage.ts", "utf8");
    expect(source).toContain("deriveScoutDistributionAdvisoryLockKeys");
    expect(source).toContain("pg_advisory_xact_lock(${advisoryLockKeyA}, ${advisoryLockKeyB})");
    expect(source).not.toContain("hashtextextended");
  });

  it("keeps the production verifier non-mutating and scheduler-quiesced", () => {
    const source = readFileSync("scripts/verify-scout-distribution-lock.mjs", "utf8");
    expect(source).toContain('RUN_SCHEDULED_JOBS must be false');
    expect(source).toContain('SELECT pg_advisory_xact_lock($1::integer, $2::integer)');
    expect(source).toContain('ROLLBACK');
    expect(source).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });
});
'''
(ROOT / "server/scout-distribution-lock.contract.test.ts").write_text(contract)

docs_dir = ROOT / "docs/operations"
docs_dir.mkdir(parents=True, exist_ok=True)
(docs_dir / "scout-distribution-advisory-lock.md").write_text('''# Scout distribution advisory lock repair\n\nProduction PostgreSQL rejected the database-side `hashtextextended` helper used to derive a transaction advisory-lock key. The writer now hashes the canonical claim event key in Node.js and calls PostgreSQL's built-in two-integer `pg_advisory_xact_lock(integer, integer)` overload.\n\nBefore restoring scheduled jobs, run `node scripts/verify-scout-distribution-lock.mjs` with `RUN_SCHEDULED_JOBS=false`. The verifier starts a transaction, acquires the same lock overload with a synthetic key, and rolls back without inserting claims or changing balances.\n\nRollback: disable scheduled jobs, revert this commit, and keep the scheduler disabled until an alternative portable lock is validated.\n''')

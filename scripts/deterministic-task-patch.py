from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
storage_path = ROOT / "server/storage.ts"
storage = storage_path.read_text(encoding="utf-8")

helper_import = 'import { advisoryLockKeyPair } from "./utils/advisory-lock-key";'
if helper_import not in storage:
    anchor = 'import { getUserActivitySourceFetchWindow } from "./activity-feed";'
    if anchor not in storage:
        raise SystemExit("Could not find advisory-lock import anchor")
    storage = storage.replace(anchor, f"{anchor}\n{helper_import}", 1)

old_lock = '''      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${reservationDomain}, 0))`,
      );'''
new_lock = '''      const [reservationLockKeyA, reservationLockKeyB] = advisoryLockKeyPair(
        reservationDomain,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${reservationLockKeyA}, ${reservationLockKeyB})`,
      );'''


def replace_lock(source: str, start_marker: str, end_marker: str) -> str:
    start = source.find(start_marker)
    end = source.find(end_marker, start + len(start_marker))
    if start < 0 or end <= start:
        raise SystemExit(f"Could not isolate {start_marker}")
    method = source[start:end]
    if method.count(old_lock) != 1:
        raise SystemExit(f"Expected exactly one legacy lock in {start_marker}")
    if "holdingReservationDomain(" not in method:
        raise SystemExit(f"Missing canonical reservation domain in {start_marker}")
    method = method.replace(old_lock, new_lock, 1)
    return source[:start] + method + source[end:]


storage = replace_lock(storage, "  async reserveShares(", "  async releaseShares(")
storage = replace_lock(
    storage,
    "  async creditScoutDistribution(",
    "  async getScoutRoster(",
)

for start_marker, end_marker in (
    ("  async reserveShares(", "  async releaseShares("),
    ("  async creditScoutDistribution(", "  async getScoutRoster("),
):
    start = storage.find(start_marker)
    end = storage.find(end_marker, start + len(start_marker))
    method = storage[start:end]
    if "hashtextextended" in method:
        raise SystemExit(f"Legacy lock remains in {start_marker}")
    if method.count("advisoryLockKeyPair(") != 1:
        raise SystemExit(f"Portable key helper not wired exactly once in {start_marker}")

rewarded_lock = 'pg_advisory_xact_lock(hashtextextended(${grant.userId}, 0))'
if rewarded_lock not in storage:
    raise SystemExit("Unrelated rewarded-scout lock changed unexpectedly")

storage_path.write_text(storage, encoding="utf-8")

helper = '''import { createHash } from "node:crypto";

export type AdvisoryLockKeyPair = readonly [number, number];

/** Derive PostgreSQL's portable two-int advisory-lock identity in application code. */
export function advisoryLockKeyPair(identity: string): AdvisoryLockKeyPair {
  if (!identity.trim()) {
    throw new Error("Advisory lock identity is required.");
  }
  const digest = createHash("sha256").update(identity, "utf8").digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}
'''
helper_path = ROOT / "server/utils/advisory-lock-key.ts"
helper_path.parent.mkdir(parents=True, exist_ok=True)
helper_path.write_text(helper, encoding="utf-8")

unit_test = '''import { describe, expect, it } from "vitest";
import { advisoryLockKeyPair } from "./advisory-lock-key";

describe("advisoryLockKeyPair", () => {
  it("is deterministic and returns exactly two signed 32-bit integers", () => {
    const identity = "holding-reservation:user-1:mlb:player-641329";
    const first = advisoryLockKeyPair(identity);
    expect(first).toEqual(advisoryLockKeyPair(identity));
    expect(first).toHaveLength(2);
    for (const key of first) {
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(-2_147_483_648);
      expect(key).toBeLessThanOrEqual(2_147_483_647);
    }
  });

  it("does not trivially collapse representative reservation identities", () => {
    const identities = [
      "holding-reservation:user-1:mlb:player-1",
      "holding-reservation:user-1:mlb:player-2",
      "holding-reservation:user-2:mlb:player-1",
      "holding-reservation:user-1:nhl:player-1",
      "holding-reservation:user-1:nascar:driver-1",
    ];
    const pairs = identities.map((identity) => advisoryLockKeyPair(identity).join(":"));
    expect(new Set(pairs).size).toBe(identities.length);
  });

  it("rejects an empty identity", () => {
    expect(() => advisoryLockKeyPair("   ")).toThrow("Advisory lock identity is required");
  });
});
'''
(ROOT / "server/utils/advisory-lock-key.test.ts").write_text(unit_test, encoding="utf-8")

contract_test = '''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function methodSource(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function expectReservationLock(method: string): void {
  expect(method).toContain("holdingReservationDomain(");
  expect(method).toContain("userId");
  expect(method).toContain("playerId");
  expect(method).toContain("sport");
  expect(method).toContain("advisoryLockKeyPair(");
  expect(method).toContain("reservationDomain");
  expect(method).toContain(
    "pg_advisory_xact_lock(${reservationLockKeyA}, ${reservationLockKeyB})",
  );
  expect(method).not.toContain("hashtextextended");
}

describe("holding reservation advisory-lock wiring", () => {
  it("coordinates reserveShares on the canonical reservation identity", () => {
    const source = readFileSync("server/storage.ts", "utf8");
    expectReservationLock(methodSource(source, "async reserveShares", "async releaseShares"));
  });

  it("coordinates creditScoutDistribution on the same reservation identity", () => {
    const source = readFileSync("server/storage.ts", "utf8");
    const method = methodSource(source, "async creditScoutDistribution", "async getScoutRoster");
    expectReservationLock(method);
    expect(method).toContain("insert(scoutDistributionClaims)");
    expect(method).toContain("onConflictDoNothing()");
  });

  it("leaves the unrelated rewarded-scout lock unchanged", () => {
    const source = readFileSync("server/storage.ts", "utf8");
    expect(source).toContain(
      "pg_advisory_xact_lock(hashtextextended(${grant.userId}, 0))",
    );
  });
});
'''
(ROOT / "server/holding-reservation-advisory-lock.contract.test.ts").write_text(
    contract_test,
    encoding="utf-8",
)

verifier = '''#!/usr/bin/env node
/* global process, console */
import { Client } from "pg";
import { createHash } from "node:crypto";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (String(process.env.RUN_SCHEDULED_JOBS || "").toLowerCase() !== "false") {
  throw new Error("RUN_SCHEDULED_JOBS must be false for advisory-lock verification.");
}
const digest = createHash("sha256").update("holding-reservation:verification", "utf8").digest();
const keys = [digest.readInt32BE(0), digest.readInt32BE(4)];
const client = new Client({ connectionString: databaseUrl, application_name: "sportfolio-lock-check" });
await client.connect();
try {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", keys);
  } finally {
    await client.query("ROLLBACK");
  }
  console.log(JSON.stringify({ status: "ok", overload: "pg_advisory_xact_lock(integer, integer)" }));
} finally {
  await client.end();
}
'''
(ROOT / "scripts/verify-holding-reservation-lock.mjs").write_text(verifier, encoding="utf-8")

verifier_test = '''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("holding reservation production verifier", () => {
  it("is scheduler-quiesced, non-mutating, and checks the exact overload", () => {
    const source = readFileSync("scripts/verify-holding-reservation-lock.mjs", "utf8");
    expect(source).toContain("RUN_SCHEDULED_JOBS must be false");
    expect(source).toContain("SELECT pg_advisory_xact_lock($1::integer, $2::integer)");
    expect(source).toContain("ROLLBACK");
    expect(source).not.toContain("INSERT INTO");
    expect(source).not.toContain("UPDATE ");
    expect(source).not.toContain("DELETE FROM");
  });
});
'''
(ROOT / "scripts/verify-holding-reservation-lock.test.ts").write_text(
    verifier_test,
    encoding="utf-8",
)

runbook = '''# Holding reservation advisory lock repair

`reserveShares` and `creditScoutDistribution` derive the same signed 32-bit key pair from their existing `holdingReservationDomain(userId, playerId, sport)` identity in Node.js and call PostgreSQL's built-in `pg_advisory_xact_lock(integer, integer)` overload. Transaction scope, holding identity, distribution keys, and claim idempotency remain unchanged. Unrelated advisory-lock domains are intentionally untouched.

Before enabling scheduled jobs, run `node scripts/verify-holding-reservation-lock.mjs` while `RUN_SCHEDULED_JOBS=false`. It acquires the exact overload in a transaction and rolls back without application writes. On any regression, disable scheduled jobs and revert the repair.
'''
runbook_path = ROOT / "docs/operations/holding-reservation-advisory-lock.md"
runbook_path.parent.mkdir(parents=True, exist_ok=True)
runbook_path.write_text(runbook, encoding="utf-8")

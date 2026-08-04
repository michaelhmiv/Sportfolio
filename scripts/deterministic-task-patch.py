from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
storage_path = ROOT / "server/storage.ts"
storage = storage_path.read_text()

old_lock = '''      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${reservationDomain}, 0))`,
      );'''
new_lock = '''      const [advisoryLockKeyA, advisoryLockKeyB] =
        deriveScoutDistributionAdvisoryLockKeys(reservationDomain);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${advisoryLockKeyA}, ${advisoryLockKeyB})`,
      );'''

lock_count = storage.count(old_lock)
if lock_count != 2:
    raise SystemExit(
        f"Expected exactly two coordinated holding reservation locks, found {lock_count}"
    )
storage = storage.replace(old_lock, new_lock)
storage_path.write_text(storage)

contract = '''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function methodSource(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("scout distribution advisory lock contract", () => {
  it("uses portable two-integer locking in the actual scout claim writer", () => {
    const source = readFileSync("server/storage.ts", "utf8");
    const writer = methodSource(
      source,
      "async creditScoutDistribution",
      "async getScoutRoster",
    );

    expect(writer).toContain(
      "deriveScoutDistributionAdvisoryLockKeys(reservationDomain)",
    );
    expect(writer).toContain(
      "pg_advisory_xact_lock(${advisoryLockKeyA}, ${advisoryLockKeyB})",
    );
    expect(writer).not.toContain("hashtextextended");
    expect(writer).toContain("insert(scoutDistributionClaims)");
    expect(writer).toContain("onConflictDoNothing()");
  });

  it("keeps holding reservations on the same portable lock domain", () => {
    const source = readFileSync("server/storage.ts", "utf8");
    const reservations = methodSource(source, "async reserveShares", "async releaseShares");

    expect(reservations).toContain(
      "deriveScoutDistributionAdvisoryLockKeys(reservationDomain)",
    );
    expect(reservations).toContain(
      "pg_advisory_xact_lock(${advisoryLockKeyA}, ${advisoryLockKeyB})",
    );
    expect(reservations).not.toContain("hashtextextended");
  });

  it("keeps the production verifier non-mutating and scheduler-quiesced", () => {
    const source = readFileSync("scripts/verify-scout-distribution-lock.mjs", "utf8");
    expect(source).toContain("RUN_SCHEDULED_JOBS must be false");
    expect(source).toContain("SELECT pg_advisory_xact_lock($1::integer, $2::integer)");
    expect(source).toContain("ROLLBACK");
    expect(source).not.toMatch(/\\b(?:INSERT\\s+INTO|UPDATE\\s+\\w+|DELETE\\s+FROM)\\b/i);
  });
});
'''
(ROOT / "server/scout-distribution-lock.contract.test.ts").write_text(contract)

(ROOT / "docs/operations/scout-distribution-advisory-lock.md").write_text(
    '''# Scout distribution advisory lock repair\n\nProduction PostgreSQL rejected the database-side `hashtextextended` helper used by the scout claim writer. The writer now hashes its existing holding-reservation domain in Node.js and calls PostgreSQL's built-in two-integer `pg_advisory_xact_lock(integer, integer)` overload. `reserveShares` derives the same keys from the same domain, preserving serialization between scout credits and holding reservations.\n\nBefore restoring scheduled jobs, run `node scripts/verify-scout-distribution-lock.mjs` with `RUN_SCHEDULED_JOBS=false`. The verifier starts a transaction, acquires the exact two-integer overload with a synthetic key, and rolls back without inserting claims or changing balances.\n\nRollback: disable scheduled jobs, revert this commit, and keep the scheduler disabled until an alternative portable lock is validated.\n'''
)

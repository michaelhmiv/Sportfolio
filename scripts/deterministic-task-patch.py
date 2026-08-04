from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
storage_path = ROOT / "server/storage.ts"
storage = storage_path.read_text(encoding="utf-8")

wrong_reward_lock = '''      const [advisoryLockKeyA, advisoryLockKeyB] = deriveScoutDistributionAdvisoryLockKeys(
        grant.userId,
      );

      await tx.execute(sql`SELECT pg_advisory_xact_lock(${advisoryLockKeyA}, ${advisoryLockKeyB})`);'''
original_reward_lock = '''      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${grant.userId}, 0))`);'''

if wrong_reward_lock in storage:
    storage = storage.replace(wrong_reward_lock, original_reward_lock, 1)
elif original_reward_lock not in storage:
    raise SystemExit("Could not identify the rewarded scout boost advisory lock")

helper_import = 'import { deriveScoutDistributionAdvisoryLockKeys } from "./scout-distribution-lock";'
if helper_import not in storage:
    import_anchor = 'import { getUserActivitySourceFetchWindow } from "./activity-feed";'
    if import_anchor not in storage:
        raise SystemExit("Could not find scout advisory lock import anchor")
    storage = storage.replace(import_anchor, f"{import_anchor}\n{helper_import}", 1)

old_reservation_lock = '''      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${reservationDomain}, 0))`,
      );'''
new_reservation_lock = '''      const [reservationLockKeyA, reservationLockKeyB] =
        deriveScoutDistributionAdvisoryLockKeys(reservationDomain);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${reservationLockKeyA}, ${reservationLockKeyB})`,
      );'''


def replace_method_lock(source: str, start_marker: str, end_marker: str) -> str:
    start = source.find(start_marker)
    end = source.find(end_marker, start + len(start_marker))
    if start < 0 or end <= start:
        raise SystemExit(f"Could not isolate method range: {start_marker} -> {end_marker}")

    method = source[start:end]
    count = method.count(old_reservation_lock)
    if count != 1:
        raise SystemExit(f"Expected one reservation lock in {start_marker}, found {count}")

    method = method.replace(old_reservation_lock, new_reservation_lock, 1)
    return source[:start] + method + source[end:]


storage = replace_method_lock(
    storage,
    "  async creditScoutDistribution(",
    "  async getScoutRoster(",
)
storage = replace_method_lock(
    storage,
    "  async reserveShares(",
    "  async releaseShares(",
)

if wrong_reward_lock in storage:
    raise SystemExit("Rewarded scout boost lock was not restored")
if original_reward_lock not in storage:
    raise SystemExit("Rewarded scout boost lock changed unexpectedly")
if "pg_advisory_lock(hashtextextended(${input.lockKey}, 0))" not in storage:
    raise SystemExit("Backup advisory lock changed unexpectedly")
if storage.count("deriveScoutDistributionAdvisoryLockKeys(reservationDomain)") != 2:
    raise SystemExit("Expected exactly two coordinated reservation-domain key derivations")

storage_path.write_text(storage, encoding="utf-8")

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
  it("uses the portable two-integer lock in the actual scout claim writer", () => {
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
      "pg_advisory_xact_lock(${reservationLockKeyA}, ${reservationLockKeyB})",
    );
    expect(writer).not.toContain(
      "pg_advisory_xact_lock(hashtextextended(${reservationDomain}, 0))",
    );
    expect(writer).toContain("insert(scoutDistributionClaims)");
    expect(writer).toContain("onConflictDoNothing()");
  });

  it("keeps share reservations on the same portable lock domain", () => {
    const source = readFileSync("server/storage.ts", "utf8");
    const reservations = methodSource(source, "async reserveShares", "async releaseShares");

    expect(reservations).toContain(
      "deriveScoutDistributionAdvisoryLockKeys(reservationDomain)",
    );
    expect(reservations).toContain(
      "pg_advisory_xact_lock(${reservationLockKeyA}, ${reservationLockKeyB})",
    );
    expect(reservations).not.toContain(
      "pg_advisory_xact_lock(hashtextextended(${reservationDomain}, 0))",
    );
  });

  it("does not rewrite unrelated rewarded-scout or backup locks", () => {
    const source = readFileSync("server/storage.ts", "utf8");
    const rewardedScout = methodSource(
      source,
      "async grantRewardedScoutBoost",
      "async getActiveRewardedScoutBoost",
    );

    expect(rewardedScout).toContain(
      "pg_advisory_xact_lock(hashtextextended(${grant.userId}, 0))",
    );
    expect(source).toContain("pg_advisory_lock(hashtextextended(${input.lockKey}, 0))");
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
(ROOT / "server/scout-distribution-lock.contract.test.ts").write_text(
    contract,
    encoding="utf-8",
)

runbook = '''# Scout distribution advisory lock repair

Production PostgreSQL rejected the database-side `hashtextextended` helper used by the scout claim writer. `creditScoutDistribution` now hashes its existing holding-reservation domain in Node.js and calls PostgreSQL's built-in two-integer `pg_advisory_xact_lock(integer, integer)` overload. `reserveShares` derives the same keys from the same domain, preserving serialization between scout credits and share reservations.

The rewarded-scout boost grant and backup-process locks are intentionally unchanged because they are separate lock domains and were not part of the scheduled scout-distribution failure.

Before restoring scheduled jobs, run `node scripts/verify-scout-distribution-lock.mjs` with `RUN_SCHEDULED_JOBS=false`. The verifier starts a transaction, acquires the exact two-integer overload with a synthetic key, and rolls back without inserting claims or changing balances.

Rollback: disable scheduled jobs, revert this commit, and keep the scheduler disabled until an alternative portable lock is validated.
'''
(ROOT / "docs/operations/scout-distribution-advisory-lock.md").write_text(
    runbook,
    encoding="utf-8",
)

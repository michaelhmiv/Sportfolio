import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("scout distribution advisory lock contract", () => {
  it("uses portable two-integer advisory locking", () => {
    const source = readFileSync("server/storage.ts", "utf8");
    expect(source).toContain("deriveScoutDistributionAdvisoryLockKeys");
    expect(source).toContain("pg_advisory_xact_lock(${advisoryLockKeyA}, ${advisoryLockKeyB})");
    const scoutLockStart = source.indexOf(
      "const [advisoryLockKeyA, advisoryLockKeyB] = deriveScoutDistributionAdvisoryLockKeys",
    );
    const scoutLockCallStart = source.indexOf("pg_advisory_xact_lock", scoutLockStart);
    const scoutLockEnd = source.indexOf(");", scoutLockCallStart) + 2;
    expect(scoutLockStart).toBeGreaterThanOrEqual(0);
    expect(scoutLockCallStart).toBeGreaterThan(scoutLockStart);
    expect(scoutLockEnd).toBeGreaterThan(scoutLockCallStart);
    expect(source.slice(scoutLockStart, scoutLockEnd)).not.toContain("hashtextextended");
  });

  it("keeps the production verifier non-mutating and scheduler-quiesced", () => {
    const source = readFileSync("scripts/verify-scout-distribution-lock.mjs", "utf8");
    expect(source).toContain("RUN_SCHEDULED_JOBS must be false");
    expect(source).toContain("SELECT pg_advisory_xact_lock($1::integer, $2::integer)");
    expect(source).toContain("ROLLBACK");
    expect(source).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM)\b/i);
  });
});

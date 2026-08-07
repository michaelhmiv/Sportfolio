import { readFileSync } from "node:fs";
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

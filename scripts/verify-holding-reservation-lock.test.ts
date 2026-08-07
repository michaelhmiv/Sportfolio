import { readFileSync } from "node:fs";
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

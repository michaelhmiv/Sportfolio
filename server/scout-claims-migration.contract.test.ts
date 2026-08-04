import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/apply-scout-claims-migration.mjs", "utf8");

describe("scout claim production migration runner", () => {
  it("fails closed unless scheduled jobs are quiesced before first application", () => {
    expect(source).toContain("RUN_SCHEDULED_JOBS must be false");
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

  it("does not include database credentials in structured log payloads", () => {
    const loggingSection = source.slice(source.indexOf("async function main()"));
    expect(loggingSection).not.toContain("resolvedDatabaseUrl");
    expect(loggingSection).not.toContain("DATABASE_URL");
    expect(loggingSection).not.toContain("connectionString");
  });
});

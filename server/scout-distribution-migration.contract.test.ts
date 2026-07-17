import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/0053_scout_distribution_claims.sql"),
  "utf8",
);

describe("scout distribution claim migration", () => {
  it("fails closed unless operators explicitly quiesce every scheduler and manual runner", () => {
    expect(migration).toContain("sportfolio.scout_distribution_scheduler_quiesced");
    expect(migration).toMatch(/RAISE EXCEPTION[\s\S]+scheduler/i);
    expect(migration).toMatch(/LOCK TABLE\s+"scout_distributions"[\s\S]+ACCESS EXCLUSIVE/i);
  });

  it("fails closed when any alias component has a cycle or no terminal identity", () => {
    expect(migration).toMatch(/IF EXISTS[\s\S]+RAISE EXCEPTION[\s\S]+alias graph/i);
    expect(migration).toMatch(/cycle|non-terminal/i);
  });

  it("backfills terminal canonical identities across alias chains", () => {
    expect(migration).toMatch(/WITH RECURSIVE\s+"alias_paths"/i);
    expect(migration).toMatch(/NOT EXISTS[\s\S]+"player_id_aliases"/i);
    expect(migration).toMatch(/COALESCE\([^)]*"canonical_player_id"[^)]*,\s*sd\."player_id"\)/i);
  });

  it("collapses historical alias and canonical rows into one hourly claim", () => {
    expect(migration).toMatch(
      /GROUP BY\s+sd\."hour_timestamp",\s*COALESCE\([^)]*"canonical_player_id"[^)]*,\s*sd\."player_id"\),\s*sd\."user_id"/i,
    );
  });
});

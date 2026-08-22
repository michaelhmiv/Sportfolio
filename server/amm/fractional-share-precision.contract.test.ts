import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/0069_amm_fractional_share_precision.sql"),
  "utf8",
);
const schema = readFileSync(resolve(process.cwd(), "shared/schema.ts"), "utf8");
const migrationRunner = readFileSync(
  resolve(process.cwd(), "scripts/apply-amm-fractional-share-migration.mjs"),
  "utf8",
);

describe("AMM fractional share precision contract", () => {
  it("upgrades pool reserves and LP share audit quantities to four decimals", () => {
    expect(migration).toMatch(/player_pools[\s\S]+shares TYPE numeric\(12, 4\)/i);
    expect(migration).toMatch(/shares_amount TYPE numeric\(12, 4\)/i);
    expect(migration).toMatch(/pool_shares_before TYPE numeric\(12, 4\)/i);
  });

  it("keeps the Drizzle schema aligned with the migration", () => {
    expect(schema).toMatch(
      /shares:\s*decimal\("shares",\s*\{\s*precision:\s*12,\s*scale:\s*4\s*\}\)/,
    );
    expect(schema).toMatch(
      /sharesAmount:\s*decimal\("shares_amount",\s*\{\s*precision:\s*12,\s*scale:\s*4\s*\}\)/,
    );
    expect(schema).toMatch(
      /poolSharesBefore:\s*decimal\("pool_shares_before",\s*\{\s*precision:\s*12,\s*scale:\s*4\s*\}\)/,
    );
  });

  it("has a rerunnable pre-deploy migration runner", () => {
    expect(migrationRunner).toContain("0069_amm_fractional_share_precision.sql");
    expect(migrationRunner).toContain("pg_advisory_xact_lock");
    expect(migrationRunner).toContain("already_applied");
  });
});

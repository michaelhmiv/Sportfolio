import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/0067_player_total_shares_decimal.sql"),
  "utf8",
);
const schema = readFileSync(resolve(process.cwd(), "shared/schema.ts"), "utf8");

describe("fractional player total shares", () => {
  it("migrates players.total_shares to the established four-decimal share precision", () => {
    expect(migration).toMatch(/ALTER TABLE players[\s\S]+total_shares TYPE decimal\(12, 4\)/i);
    expect(migration).toMatch(/USING total_shares::decimal\(12, 4\)/i);
    expect(migration).toMatch(/total_shares SET DEFAULT '0\.0000'/i);
  });

  it("keeps the Drizzle schema aligned with the database migration", () => {
    expect(schema).toMatch(
      /totalShares:\s*decimal\("total_shares",\s*\{\s*precision:\s*12,\s*scale:\s*4\s*\}\)[\s\S]*?default\("0\.0000"\)/,
    );
  });
});

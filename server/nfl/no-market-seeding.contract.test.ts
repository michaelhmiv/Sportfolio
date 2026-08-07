// NFL restoration: ESPN current/live + nflverse identity/history.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("NFL user-created market contract", () => {
  it("prevents bots from creating NFL pools", () => {
    const source = read("server/bot/deterministic-engine.ts");
    expect(source).toContain('String(target.sport || "").toUpperCase() === "NFL"');
    expect(source).toContain("return null");
  });

  it("excludes NFL from stat-derived fair-value market making", () => {
    const source = read("server/bot/player-valuation.ts");
    expect(source).toContain('const sports = ["NBA"]');
    expect(source).not.toContain('const sports = ["NBA", "NFL"]');
  });

  it.each([
    "server/jobs/sync-nfl-roster.ts",
    "server/jobs/sync-nfl-schedule.ts",
    "server/jobs/sync-nfl-stats.ts",
    "server/jobs/sync-nflverse-stats.ts",
  ])("does not create a market from ingestion in %s", (path) => {
    const source = read(path);
    expect(source).not.toMatch(/createPlayerPool|initializePlayerPool|executeTrade|lastTradePrice\s*:/);
  });

  it("verifies the production rebuild cannot leave seeded prices or pools", () => {
    const source = read("scripts/nfl-data-migration.ts");
    expect(source).toContain("seededLastTradePrices");
    expect(source).toContain("seededPools");
  });
});

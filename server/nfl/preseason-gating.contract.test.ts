// NFL restoration: ESPN current/live + nflverse identity/history.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("NFL preseason display-only contract", () => {
  it.each([
    "server/jobs/snapshot-share-payouts.ts",
    "server/jobs/settle-share-payouts.ts",
    "server/jobs/lock-boost-shares.ts",
    "server/jobs/settle-boosts.ts",
  ])("guards %s with unified Economy V2 preseason semantics", (path) => {
    const source = read(path);
    expect(source).toContain('from "../economy/config"');
    expect(source).toContain("resolveEconomySeasonPhase");
    expect(source).toContain('=== "preseason"');
  });

  it("does not hide preseason from the NFL schedule/live provider", () => {
    const schedule = read("server/jobs/sync-nfl-schedule.ts");
    const live = read("server/jobs/sync-nfl-stats.ts");
    expect(schedule).toContain('"preseason"');
    expect(live).toContain("gameplayEligible");
    expect(live).toContain("seasonType: game.seasonType");
  });
});

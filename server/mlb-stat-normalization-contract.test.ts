import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseStatsToJson } from "./mlb-statsapi";

const MLB_SNAKE_CASE_KEYS = [
  "at_bats",
  "runs_batted_in",
  "home_runs",
  "stolen_bases",
  "strikeouts_batting",
  "innings_pitched",
  "pitching_strikeouts",
  "earned_runs",
] as const;

describe("MLB stat normalization contract", () => {
  it("normalizes MLB boxscore stats to the canonical camelCase stat shape", () => {
    const stats = parseStatsToJson({
      batting: {
        atBats: 4,
        hits: 2,
        doubles: 0,
        triples: 0,
        homeRuns: 1,
        runs: 1,
        rbi: 2,
        baseOnBalls: 1,
        hitByPitch: 0,
        stolenBases: 1,
        strikeOuts: 1,
      },
      pitching: {
        inningsPitched: 6,
        strikeOuts: 6,
        earnedRuns: 0,
        runs: 1,
        hits: 4,
        baseOnBalls: 2,
        wins: 1,
        saves: 0,
      },
    });

    expect(stats).toMatchObject({
      atBats: 4,
      hits: 2,
      runs: 1,
      runsBattedIn: 2,
      homeRuns: 1,
      stolenBases: 1,
      walks: 1,
      strikeoutsBatting: 1,
      inningsPitched: 6,
      pitchingStrikeouts: 6,
      earnedRuns: 0,
      runsAllowed: 1,
      hitsAllowed: 4,
      walksAllowed: 2,
      wins: 1,
      saves: 0,
    });

    for (const key of MLB_SNAKE_CASE_KEYS) {
      expect(stats).not.toHaveProperty(key);
    }
  });

  it("does not read legacy snake_case MLB stat keys in storage or live routes", () => {
    const storageSource = readFileSync("server/storage.ts", "utf8");
    const routesSource = readFileSync("server/routes.ts", "utf8");
    const relevantSource = [storageSource, routesSource].join("\n");

    for (const key of MLB_SNAKE_CASE_KEYS) {
      expect(relevantSource).not.toContain(key);
    }
  });
});

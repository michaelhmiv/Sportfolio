import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

interface FixtureState {
  schema: string;
  docs: string;
}

const root = process.cwd();
const checkerSource = readFileSync(join(root, "scripts/check-agent-invariants.mjs"), "utf8");
const canonicalFixture: FixtureState = {
  schema: readFileSync(join(root, "shared/schema.ts"), "utf8"),
  docs: readFileSync(join(root, "docs/wiki/agent/api-map.md"), "utf8"),
};
const fixtureDirectories: string[] = [];

function replaceInScope(
  text: string,
  start: string,
  end: string,
  from: string,
  to: string,
): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  const block = text.slice(startIndex, endIndex);
  expect(block).toContain(from);
  return `${text.slice(0, startIndex)}${block.replace(from, to)}${text.slice(endIndex)}`;
}

function runChecker(fixture: FixtureState) {
  const directory = mkdtempSync(join(tmpdir(), "sportfolio-invariant-"));
  fixtureDirectories.push(directory);

  const files = [
    ["scripts/check-agent-invariants.mjs", checkerSource],
    ["shared/schema.ts", fixture.schema],
    ["docs/wiki/agent/api-map.md", fixture.docs],
  ] as const;

  for (const [relativePath, content] of files) {
    const destination = join(directory, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }

  return spawnSync(process.execPath, [join(directory, "scripts/check-agent-invariants.mjs")], {
    encoding: "utf8",
  });
}

function schemaMutation(start: string, end: string, from: string, to: string): FixtureState {
  return {
    ...canonicalFixture,
    schema: replaceInScope(canonicalFixture.schema, start, end, from, to),
  };
}

const holdingsStart = "export const holdings = pgTable(";
const multipliersStart = "export const playerMultipliers = pgTable(";
const eventsStart = "export const playerMultiplierEvents = pgTable(";
const locksStart = "export const holdingsLocks = pgTable(";

afterAll(() => {
  for (const directory of fixtureDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("check-agent-invariants CLI", () => {
  it("accepts the canonical schema and API map", () => {
    expect(runChecker(canonicalFixture).status).toBe(0);
  });

  it.each([
    [
      "holdings table name",
      () => schemaMutation(holdingsStart, multipliersStart, '"holdings"', '"holdings_renamed"'),
    ],
    [
      "player multipliers table name",
      () =>
        schemaMutation(
          multipliersStart,
          eventsStart,
          '"player_multipliers"',
          '"player_multipliers_renamed"',
        ),
    ],
    [
      "player multipliers multiplier field",
      () =>
        schemaMutation(
          multipliersStart,
          eventsStart,
          'multiplier: integer("multiplier").notNull()',
          'multiplierValue: integer("multiplier_value").notNull()',
        ),
    ],
    [
      "player multiplier events table name",
      () =>
        schemaMutation(
          eventsStart,
          locksStart,
          '"player_multiplier_events"',
          '"player_multiplier_events_renamed"',
        ),
    ],
    [
      "retired holdings.power",
      () =>
        schemaMutation(
          holdingsStart,
          multipliersStart,
          '    quantity: decimal("quantity",',
          '    power: integer("power"),\n    quantity: decimal("quantity",',
        ),
    ],
    [
      "retired holdings.powerLevel",
      () =>
        schemaMutation(
          holdingsStart,
          multipliersStart,
          '    quantity: decimal("quantity",',
          '    powerLevel: integer("power_level"),\n    quantity: decimal("quantity",',
        ),
    ],
  ])("rejects a schema with a changed %s", (_name, mutate) => {
    expect(runChecker(mutate()).status).not.toBe(0);
  });

  it.each([
    "/api/holdings/stack-shares",
    "/api/holdings/:playerId/multiplier-state",
    "/api/daily-boosts/assign",
  ])("rejects an API map missing the exact %s endpoint", (endpoint) => {
    const fixture = {
      ...canonicalFixture,
      docs: canonicalFixture.docs.replace(`\`${endpoint}\``, `\`${endpoint}-removed\``),
    };
    expect(runChecker(fixture).status).not.toBe(0);
  });

  it.each(["/api/holdings/condense", "/api/holdings/:playerId/power-level"])(
    "rejects retired API guidance for %s",
    (endpoint) => {
      const fixture = { ...canonicalFixture, docs: `${canonicalFixture.docs}\n${endpoint}\n` };
      expect(runChecker(fixture).status).not.toBe(0);
    },
  );
});

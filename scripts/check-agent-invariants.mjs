import { readFileSync } from "node:fs";

const checks = [
  {
    file: "shared/schema.ts",
    scopes: [
      {
        name: "holdings",
        start: "export const holdings = pgTable(",
        end: "export const playerMultipliers = pgTable(",
        mustInclude: ['"holdings"'],
        mustExcludePatterns: [
          { label: "holdings.power property", regex: /\bpower\s*:/ },
          { label: "holdings.powerLevel property", regex: /\bpowerLevel\s*:/ },
          { label: 'holdings "power" column', regex: /["']power["']/ },
          { label: 'holdings "power_level" column', regex: /["']power_level["']/ },
        ],
      },
      {
        name: "playerMultipliers",
        start: "export const playerMultipliers = pgTable(",
        end: "export const playerMultiplierEvents = pgTable(",
        mustInclude: ['"player_multipliers"', 'multiplier: integer("multiplier").notNull()'],
      },
      {
        name: "playerMultiplierEvents",
        start: "export const playerMultiplierEvents = pgTable(",
        end: "export const holdingsLocks = pgTable(",
        mustInclude: ['"player_multiplier_events"'],
      },
    ],
  },
  {
    file: "docs/wiki/agent/api-map.md",
    mustIncludePatterns: [
      {
        label: "/api/holdings/stack-shares endpoint",
        regex: /`\/api\/holdings\/stack-shares`/,
      },
      {
        label: "/api/holdings/:playerId/multiplier-state endpoint",
        regex: /`\/api\/holdings\/:playerId\/multiplier-state`/,
      },
      {
        label: "/api/daily-boosts/assign endpoint",
        regex: /`\/api\/daily-boosts\/assign`/,
      },
    ],
    mustExclude: ["/api/holdings/condense", "/api/holdings/:playerId/power-level"],
  },
];

for (const check of checks) {
  const content = readFileSync(new URL(`../${check.file}`, import.meta.url), "utf8");
  for (const token of check.mustInclude ?? []) {
    if (!content.includes(token)) {
      console.error(`Invariant check failed: ${check.file} missing token: ${token}`);
      process.exit(1);
    }
  }
  for (const { label, regex } of check.mustIncludePatterns ?? []) {
    if (!regex.test(content)) {
      console.error(`Invariant check failed: ${check.file} missing ${label}`);
      process.exit(1);
    }
  }
  for (const token of check.mustExclude ?? []) {
    if (content.includes(token)) {
      console.error(`Invariant check failed: ${check.file} contains retired token: ${token}`);
      process.exit(1);
    }
  }
  for (const scope of check.scopes ?? []) {
    const startIndex = content.indexOf(scope.start);
    const endIndex = content.indexOf(scope.end, startIndex + scope.start.length);
    if (startIndex === -1 || endIndex === -1) {
      console.error(
        `Invariant check failed: ${check.file} missing ${scope.name} scope boundary: ${scope.start} -> ${scope.end}`,
      );
      process.exit(1);
    }

    const scopedContent = content.slice(startIndex, endIndex);
    for (const token of scope.mustInclude ?? []) {
      if (!scopedContent.includes(token)) {
        console.error(
          `Invariant check failed: ${check.file} ${scope.name} scope missing token: ${token}`,
        );
        process.exit(1);
      }
    }
    for (const { label, regex } of scope.mustExcludePatterns ?? []) {
      if (regex.test(scopedContent)) {
        console.error(`Invariant check failed: ${check.file} contains retired ${label}`);
        process.exit(1);
      }
    }
  }
}

console.log("Agent invariant checks passed.");

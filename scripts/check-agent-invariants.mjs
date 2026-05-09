import { readFileSync } from "node:fs";

const checks = [
  {
    file: "shared/schema.ts",
    mustInclude: ['power: integer("power")', 'powerLevel: decimal("power_level",'],
  },
  {
    file: "docs/wiki/agent/api-map.md",
    mustInclude: ["/api/holdings/condense", "/api/daily-boosts/assign"],
  },
];

for (const check of checks) {
  const content = readFileSync(new URL(`../${check.file}`, import.meta.url), "utf8");
  for (const token of check.mustInclude) {
    if (!content.includes(token)) {
      console.error(`Invariant check failed: ${check.file} missing token: ${token}`);
      process.exit(1);
    }
  }
}

console.log("Agent invariant checks passed.");

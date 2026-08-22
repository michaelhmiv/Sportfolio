import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const branch = "factory/task-dead-code-economy-v2-cleanup";

function replaceExactly(source, search, replacement, expectedCount, label) {
  const actual = source.split(search).length - 1;
  if (actual !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} occurrences, found ${actual}`);
  }
  return source.split(search).join(replacement);
}

function update(path, transform) {
  const source = readFileSync(path, "utf8");
  const next = transform(source);
  if (next === source) throw new Error(`${path}: transform produced no change`);
  writeFileSync(path, next);
}

update("server/market-mobile-overview.test.ts", (source) =>
  replaceExactly(
    source,
    "    expect(personalBoost?.bestShareMultiplier).toBe(1);\n",
    "",
    1,
    "bestShareMultiplier assertion",
  ),
);

update("client/src/components/dashboard-showcase-card.helpers.test.ts", (source) => {
  let next = source;
  const staleEligibleLines = [
    "    effectiveShares: overrides.effectiveShares ?? \"1.00\",\n",
    "    multiplier: overrides.multiplier ?? \"1.00\",\n",
    "    bestShareMultiplier: overrides.bestShareMultiplier ?? 1,\n",
    "    hasStackedShare: overrides.hasStackedShare ?? false,\n",
    "    regularShares: overrides.regularShares ?? 1,\n",
    "    availableRegularShares: overrides.availableRegularShares ?? 1,\n",
  ];
  for (const line of staleEligibleLines) {
    next = replaceExactly(next, line, "", 1, line.trim());
  }
  next = replaceExactly(next, "            topMultiplierPlayers: [],\n", "", 3, "topMultiplierPlayers");
  next = replaceExactly(next, "                multiplier: 2,\n", "", 2, "game multiplier 2");
  next = replaceExactly(next, "                multiplier: 1,\n", "", 1, "game multiplier 1");
  next = replaceExactly(next, "        multiplier: 2,\n", "", 1, "race multiplier");
  next = replaceExactly(next, '      detail: "6 sh | earn",\n', '      detail: "6 Singles | earning",\n', 1, "earning detail");
  next = replaceExactly(next, '      detail: "4 sh | 2.0x",\n', '      detail: "4 Singles",\n', 1, "owned detail");
  next = replaceExactly(next, '      detail: "Gap | no shares",\n', '      detail: "Gap | no Singles",\n', 1, "gap detail");
  next = replaceExactly(next, '      detail: "3 sh | 2.0x",\n', '      detail: "3 Singles",\n', 1, "NASCAR detail");
  return next;
});

update("client/src/components/ui/visual-system.contrast.test.ts", (source) => {
  let next = replaceExactly(
    source,
    '  "components/market-mobile-home.tsx",\n',
    "",
    1,
    "dead mobile home surface",
  );
  next = replaceExactly(
    next,
    "keeps text-content readable on every translucent stacked-share tier in %s",
    "keeps text-content readable on every translucent Daily Boost tier in %s",
    1,
    "stacked-share test title",
  );
  return next;
});

update("docs/ui/ui-surface-matrix.md", (source) => {
  let next = source
    .split("\n")
    .filter((line) => !line.startsWith("| `/power`"))
    .filter((line) => !line.startsWith("| `client/src/components/market-mobile-home.tsx`"))
    .filter((line) => !line.startsWith("| `client/src/components/portfolio-stacking-tab.tsx`"))
    .join("\n");
  next = next
    .replaceAll("client/src/components/market-mobile-home.tsx, ", "")
    .replaceAll(", client/src/components/market-mobile-home.tsx", "")
    .replaceAll("client/src/components/portfolio-stacking-tab.tsx, ", "")
    .replaceAll(", client/src/components/portfolio-stacking-tab.tsx", "");
  return next;
});

const formatFiles = [
  "server/market-mobile-overview.test.ts",
  "client/src/components/dashboard-showcase-card.helpers.test.ts",
  "client/src/components/ui/visual-system.contrast.test.ts",
  "docs/ui/ui-surface-matrix.md",
];
execFileSync("./node_modules/.bin/prettier", ["--write", ...formatFiles], { stdio: "inherit" });

rmSync(".factory/tasks/finalize-stale-economy-tests.md", { force: true });
rmSync("scripts/finalize-stale-economy-tests.mjs", { force: true });
rmSync("scripts/npm-lifecycle-finalizer.sh", { force: true });
rmSync(".npmrc", { force: true });

execFileSync(
  "./node_modules/.bin/vitest",
  [
    "run",
    "server/market-mobile-overview.test.ts",
    "client/src/components/dashboard-showcase-card.helpers.test.ts",
    "client/src/components/ui/visual-system.contrast.test.ts",
  ],
  { stdio: "inherit" },
);
execFileSync("./node_modules/.bin/prettier", ["--check", ...formatFiles, "package.json"], {
  stdio: "inherit",
});

execSync('git config user.name "cleanup-finalizer[bot]"');
execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
execSync("git add -A");
execSync('git commit -m "test: align cleanup contracts with Singles economy"', { stdio: "inherit" });
execSync(`git push origin HEAD:${branch}`, { stdio: "inherit" });

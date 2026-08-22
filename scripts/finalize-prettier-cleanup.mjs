import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const branch = "factory/task-dead-code-economy-v2-cleanup";
const formatFiles = [
  "client/src/App.tsx",
  "client/src/components/market-mobile-player-sheet.tsx",
  "client/src/components/game-command-center-card.tsx",
  "client/src/components/game-command-center-modal.tsx",
  "server/mcp/public-tool-registry.ts",
];

execFileSync("./node_modules/.bin/prettier", ["--write", ...formatFiles], {
  stdio: "inherit",
});

const packagePath = "package.json";
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
pkg.scripts.prepare = "husky";
pkg.scripts["format:check"] = "prettier . --check";
pkg.scripts["code:dead"] = "knip";
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
execFileSync("./node_modules/.bin/prettier", ["--write", packagePath], {
  stdio: "inherit",
});

rmSync(".factory/tasks/finalize-prettier-cleanup.md", { force: true });
rmSync("scripts/finalize-prettier-cleanup.mjs", { force: true });

execFileSync("./node_modules/.bin/prettier", ["--check", ...formatFiles, packagePath], {
  stdio: "inherit",
});

execSync('git config user.name "cleanup-finalizer[bot]"');
execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
execSync("git add -A");
execSync('git commit -m "chore: finalize cleanup formatting"', { stdio: "inherit" });
execSync(`git push origin HEAD:${branch}`, { stdio: "inherit" });

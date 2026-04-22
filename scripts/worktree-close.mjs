#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const DEFAULT_WORKTREE_DIR = ".claude/worktrees";

function usage() {
  console.log(`Usage:
  node scripts/worktree-close.mjs <name|path|branch> [options]

Options:
  --force           Remove even with uncommitted changes
  --delete-branch   Delete the local branch after removing worktree
  --no-prune        Skip "git worktree prune"
  --help            Show this help

Examples:
  node scripts/worktree-close.mjs market-card-refresh
  node scripts/worktree-close.mjs codex/market-card-refresh --delete-branch
  node scripts/worktree-close.mjs .claude/worktrees/market-card-refresh --force
`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runOptional(command, args, options = {}) {
  try {
    return { ok: true, output: run(command, args, options) };
  } catch (error) {
    return { ok: false, error };
  }
}

function runInteractive(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseWorktrees(porcelainOutput) {
  const blocks = porcelainOutput
    .split(/\r?\n\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const items = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let worktreePath = "";
    let branch = "";

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length).trim();
      }
      if (line.startsWith("branch refs/heads/")) {
        branch = line.slice("branch refs/heads/".length).trim();
      }
    }

    if (worktreePath) {
      items.push({
        path: path.resolve(worktreePath),
        branch: branch || "",
      });
    }
  }

  return items;
}

function normalizeFsPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

const args = process.argv.slice(2);
let force = false;
let deleteBranch = false;
let shouldPrune = true;
const positional = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  }
  if (arg === "--force") {
    force = true;
    continue;
  }
  if (arg === "--delete-branch") {
    deleteBranch = true;
    continue;
  }
  if (arg === "--no-prune") {
    shouldPrune = false;
    continue;
  }
  positional.push(arg);
}

if (positional.length !== 1) {
  usage();
  process.exit(1);
}

const commonDirResult = runOptional("git", [
  "rev-parse",
  "--path-format=absolute",
  "--git-common-dir",
]);
if (!commonDirResult.ok) {
  console.error("Could not resolve git common directory.");
  process.exit(1);
}

const commonDir = commonDirResult.output;
const repoRoot = path.resolve(commonDir, "..");
const worktreeRoot = path.resolve(repoRoot, DEFAULT_WORKTREE_DIR);

const worktrees = parseWorktrees(run("git", ["worktree", "list", "--porcelain"]));
const token = positional[0];

const tokenAsRepoPath = path.resolve(repoRoot, token);
const tokenAsCwdPath = path.resolve(process.cwd(), token);
const tokenAsDefaultWorktreePath = path.resolve(worktreeRoot, token);

const tokenCandidates = new Set(
  [tokenAsRepoPath, tokenAsCwdPath, tokenAsDefaultWorktreePath].map(normalizeFsPath),
);

const target = worktrees.find((entry) => {
  const entryPath = normalizeFsPath(entry.path);
  return (
    entry.branch === token || path.basename(entry.path) === token || tokenCandidates.has(entryPath)
  );
});

if (!target) {
  console.error(`No worktree found for "${token}".`);
  console.error('Use "npm run worktree:list" to see active worktrees.');
  process.exit(1);
}

const normalizedTargetPath = normalizeFsPath(target.path);
const normalizedWorktreeRoot = normalizeFsPath(worktreeRoot);
if (!normalizedTargetPath.startsWith(`${normalizedWorktreeRoot}${path.sep}`)) {
  console.error(`Refusing to remove worktree outside ${worktreeRoot}`);
  console.error(`Target was: ${target.path}`);
  process.exit(1);
}

const dirtyResult = runOptional("git", ["-C", target.path, "status", "--porcelain"]);
if (!dirtyResult.ok) {
  console.error(`Could not inspect worktree status: ${target.path}`);
  process.exit(1);
}

if (dirtyResult.output && !force) {
  console.error(`Worktree has uncommitted changes: ${target.path}`);
  console.error("Re-run with --force if you intentionally want to remove it.");
  process.exit(1);
}

const removeArgs = ["worktree", "remove"];
if (force) {
  removeArgs.push("--force");
}
removeArgs.push(target.path);
runInteractive("git", removeArgs, repoRoot);

if (shouldPrune) {
  runInteractive("git", ["worktree", "prune"], repoRoot);
}

if (deleteBranch && target.branch) {
  const remaining = parseWorktrees(
    run("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot }),
  );
  const inUse = remaining.some((entry) => entry.branch === target.branch);
  if (inUse) {
    console.log(
      `Branch ${target.branch} is still checked out in another worktree; skipping delete.`,
    );
  } else {
    const exists = runOptional(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${target.branch}`],
      {
        cwd: repoRoot,
      },
    ).ok;
    if (exists) {
      runInteractive("git", ["branch", force ? "-D" : "-d", target.branch], repoRoot);
    }
  }
}

console.log("");
console.log("Worktree removed:");
console.log(`- Path:   ${target.path}`);
if (target.branch) {
  console.log(`- Branch: ${target.branch}`);
}

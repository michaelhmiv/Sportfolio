#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE = "origin/main";
const DEFAULT_DIR = ".claude/worktrees";

function usage() {
  console.log(`Usage:
  node scripts/worktree-bootstrap.mjs <name> [options]
  node scripts/worktree-bootstrap.mjs --branch <branch> [options]

Options:
  --branch <name>   Explicit branch name (default: codex/<slug>)
  --base <ref>      Base ref for new branches (default: ${DEFAULT_BASE})
  --dir <path>      Worktree root directory (default: ${DEFAULT_DIR})
  --install         Run npm install in the new worktree
  --no-fetch        Skip "git fetch origin --prune" before creating worktree
  --help            Show this help
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

function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseWorktreeBranches(porcelainOutput) {
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

    if (worktreePath && branch) {
      items.push({ path: path.resolve(worktreePath), branch });
    }
  }

  return items;
}

const args = process.argv.slice(2);
const positional = [];
let explicitBranch = "";
let baseRef = DEFAULT_BASE;
let worktreeDir = DEFAULT_DIR;
let installDeps = false;
let shouldFetch = true;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  }
  if (arg === "--install") {
    installDeps = true;
    continue;
  }
  if (arg === "--no-fetch") {
    shouldFetch = false;
    continue;
  }
  if (arg === "--branch") {
    explicitBranch = args[i + 1] ?? "";
    i += 1;
    continue;
  }
  if (arg === "--base") {
    baseRef = args[i + 1] ?? "";
    i += 1;
    continue;
  }
  if (arg === "--dir") {
    worktreeDir = args[i + 1] ?? "";
    i += 1;
    continue;
  }
  positional.push(arg);
}

if (!positional.length && !explicitBranch) {
  usage();
  process.exit(1);
}

const repoRootResult = runOptional("git", ["rev-parse", "--show-toplevel"]);
if (!repoRootResult.ok) {
  console.error("Could not resolve git repository root.");
  process.exit(1);
}

const repoRoot = repoRootResult.output;
const nameInput = positional[0] ?? explicitBranch;
const slug = toSlug(nameInput || "worktree") || "worktree";
const branchName = explicitBranch || `codex/${slug}`;
const worktreeName = toSlug(positional[0] ?? branchName.split("/").pop() ?? branchName) || slug;
const targetDir = path.resolve(repoRoot, worktreeDir);
const targetPath = path.join(targetDir, worktreeName);

if (fs.existsSync(targetPath)) {
  console.error(`Target path already exists: ${targetPath}`);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const currentWorktrees = parseWorktreeBranches(
  run("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot }),
);
const existingBranchWorktree = currentWorktrees.find((entry) => entry.branch === branchName);
if (existingBranchWorktree) {
  console.error(`Branch "${branchName}" is already checked out at ${existingBranchWorktree.path}.`);
  process.exit(1);
}

if (shouldFetch && baseRef.startsWith("origin/")) {
  runInteractive("git", ["fetch", "origin", "--prune"], repoRoot);
}

const baseResult = runOptional("git", ["rev-parse", "--verify", `${baseRef}^{commit}`], {
  cwd: repoRoot,
});
if (!baseResult.ok) {
  console.error(`Base ref "${baseRef}" does not exist. Use --base to override.`);
  process.exit(1);
}

const hasLocalBranch = runOptional(
  "git",
  ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
  {
    cwd: repoRoot,
  },
).ok;

if (hasLocalBranch) {
  runInteractive("git", ["worktree", "add", targetPath, branchName], repoRoot);
} else {
  runInteractive("git", ["worktree", "add", "-b", branchName, targetPath, baseRef], repoRoot);
}

if (installDeps) {
  runInteractive("npm", ["install"], targetPath);
}

console.log("");
console.log("Worktree ready:");
console.log(`- Branch: ${branchName}`);
console.log(`- Path:   ${targetPath}`);
console.log("");
console.log("Next steps:");
console.log(`1. cd "${targetPath}"`);
console.log("2. npm run dev");
console.log("3. gh pr create --fill --base main --head <branch>");

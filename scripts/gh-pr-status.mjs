#!/usr/bin/env node

import { execFileSync } from "node:child_process";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runJson(command, args, options = {}) {
  const raw = run(command, args, options);
  return JSON.parse(raw || "null");
}

function summarizeChecks(checks) {
  let passing = 0;
  let failing = 0;
  let pending = 0;
  let skipped = 0;

  for (const check of checks) {
    const bucket = String(check.bucket || "").toUpperCase();
    const state = String(check.state || "").toUpperCase();

    if (bucket === "PASS" || state === "SUCCESS") {
      passing += 1;
      continue;
    }
    if (
      bucket === "FAIL" ||
      state === "FAILURE" ||
      state === "ERROR" ||
      state === "CANCELLED" ||
      state === "TIMED_OUT"
    ) {
      failing += 1;
      continue;
    }
    if (
      bucket === "PENDING" ||
      state === "PENDING" ||
      state === "QUEUED" ||
      state === "IN_PROGRESS" ||
      state === "WAITING"
    ) {
      pending += 1;
      continue;
    }
    skipped += 1;
  }

  return { passing, failing, pending, skipped };
}

try {
  const repoRoot = run("git", ["rev-parse", "--show-toplevel"]);
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot });

  if (branch === "HEAD") {
    console.log("Current checkout is detached HEAD. Switch to a branch first.");
    process.exit(0);
  }

  if (branch === "main" || branch === "master") {
    console.log(`Current branch is "${branch}".`);
    console.log("Create a feature branch/worktree before opening a PR.");
    console.log("Example: npm run worktree:new -- my-change");
    process.exit(0);
  }

  const prs = runJson(
    "gh",
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--limit",
      "1",
      "--json",
      "number,title,url,isDraft,baseRefName,headRefName",
    ],
    { cwd: repoRoot },
  );

  if (!Array.isArray(prs) || prs.length === 0) {
    console.log(`No open PR found for branch "${branch}".`);
    console.log(`Create one with: gh pr create --fill --base main --head ${branch}`);
    process.exit(0);
  }

  const pr = prs[0];
  console.log(`PR #${pr.number}: ${pr.title}`);
  console.log(`URL: ${pr.url}`);
  console.log(
    `Base: ${pr.baseRefName} | Head: ${pr.headRefName} | Draft: ${pr.isDraft ? "yes" : "no"}`,
  );

  let checks = [];
  try {
    checks = runJson(
      "gh",
      ["pr", "checks", String(pr.number), "--json", "name,state,bucket,link"],
      { cwd: repoRoot },
    );
  } catch {
    console.log("Could not load PR checks (gh pr checks failed).");
    process.exit(0);
  }

  if (!Array.isArray(checks) || checks.length === 0) {
    console.log("No checks reported yet.");
    process.exit(0);
  }

  const summary = summarizeChecks(checks);
  console.log(
    `Checks: ${summary.passing} passing, ${summary.pending} pending, ${summary.failing} failing, ${summary.skipped} other`,
  );

  for (const check of checks) {
    const state = String(check.state || "").toLowerCase();
    const name = check.name || "unnamed check";
    const link = check.link || "";
    console.log(`- ${name}: ${state}${link ? ` (${link})` : ""}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("gh-pr-status failed.");
  console.error(message);
  process.exit(1);
}

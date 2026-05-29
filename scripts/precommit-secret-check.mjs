#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(stderr || stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function getStagedFiles() {
  const output = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getStagedFileContent(filePath) {
  const result = spawnSync("git", ["show", `:${filePath}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    return "";
  }

  return result.stdout || "";
}

const blockedFileNamePatterns = [/\.p8$/i, /AuthKey_[A-Z0-9]{10}\.p8$/i];
const blockedContentPatterns = [
  /-----BEGIN PRIVATE KEY-----/,
  /-----BEGIN EC PRIVATE KEY-----/,
  /-----BEGIN RSA PRIVATE KEY-----/,
];
const ignoredFiles = new Set(["scripts/precommit-secret-check.mjs"]);

const stagedFiles = getStagedFiles();

if (stagedFiles.length === 0) {
  process.exit(0);
}

const blockedFindings = [];

for (const filePath of stagedFiles) {
  if (ignoredFiles.has(filePath)) {
    continue;
  }

  if (blockedFileNamePatterns.some((pattern) => pattern.test(filePath))) {
    blockedFindings.push({ filePath, reason: "blocked key filename pattern" });
    continue;
  }

  const content = getStagedFileContent(filePath);
  const matchedPattern = blockedContentPatterns.find((pattern) => pattern.test(content));
  if (matchedPattern) {
    blockedFindings.push({ filePath, reason: "private key material detected in staged content" });
  }
}

if (blockedFindings.length > 0) {
  console.error("\n[secret-check] Commit blocked to protect private key material.");
  for (const finding of blockedFindings) {
    console.error(` - ${finding.filePath}: ${finding.reason}`);
  }
  console.error(
    "\nRemove the sensitive file/content from staging and keep key files in a secure external vault.",
  );
  process.exit(1);
}

process.exit(0);

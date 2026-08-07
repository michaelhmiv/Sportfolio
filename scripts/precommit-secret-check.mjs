#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
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
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status !== 0) {
    return "";
  }

  return result.stdout || "";
}

const blockedFileNamePatterns = [
  /(^|\/)\.env($|\.)/i,
  /\.p8$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /AuthKey_[A-Z0-9]{10}\.p8$/i,
  /(?:service[-_]?account|firebase[-_]?admin|google[-_]?credentials).*\.json$/i,
  /(?:id_rsa|id_ed25519)$/i,
];

const allowedFilePaths = new Set([".env.example", "scripts/precommit-secret-check.mjs"]);

const blockedContentPatterns = [
  {
    name: "private key material",
    pattern:
      /-----BEGIN (?:OPENSSH |EC |RSA |DSA )?PRIVATE KEY-----|"private_key"\s*:\s*"-----BEGIN/,
  },
  {
    name: "GitHub access token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    name: "OpenAI-compatible API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "Perplexity API key",
    pattern: /\bpplx-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    name: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    name: "Stripe live secret",
    pattern: /\bsk_live_[0-9A-Za-z]{20,}\b/,
  },
  {
    name: "Discord webhook URL",
    pattern:
      /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+/i,
  },
  {
    name: "credential-bearing PostgreSQL URL",
    pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{8,}@[^\s/]+/i,
  },
  {
    name: "JWT-like credential",
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  },
];

const stagedFiles = getStagedFiles();

if (stagedFiles.length === 0) {
  process.exit(0);
}

const blockedFindings = [];

for (const filePath of stagedFiles) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const baseName = path.posix.basename(normalizedPath);

  if (allowedFilePaths.has(normalizedPath)) {
    continue;
  }

  if (
    blockedFileNamePatterns.some(
      (pattern) => pattern.test(normalizedPath) || pattern.test(baseName),
    )
  ) {
    blockedFindings.push({ filePath, reason: "blocked credential or key filename pattern" });
    continue;
  }

  const content = getStagedFileContent(filePath);
  const matchedPattern = blockedContentPatterns.find(({ pattern }) => pattern.test(content));
  if (matchedPattern) {
    blockedFindings.push({ filePath, reason: `${matchedPattern.name} detected in staged content` });
  }
}

if (blockedFindings.length > 0) {
  console.error(
    "\n[secret-check] Commit blocked because possible credential material was detected.",
  );
  for (const finding of blockedFindings) {
    console.error(` - ${finding.filePath}: ${finding.reason}`);
  }
  console.error(
    "\nRemove the credential from the commit, rotate it if it was ever valid, and store it in the deployment provider or a secrets vault.",
  );
  process.exit(1);
}

process.exit(0);

#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const ROOTS = ["client", "server", "shared", "plugins", "config", "docs", "packages"];
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
]);
const SKIP_PARTS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);
const FORBIDDEN = [
  /playerMultipliers/g,
  /PlayerMultiplier/g,
  /player_multipliers/g,
  /stack_shares/g,
  /stage_stack_shares/g,
  /preview_stack_shares/g,
  /stageStackSharesSchema/g,
  /stageStackShares/g,
  /previewStackShares/g,
  /Stack Power/g,
  /stackPower/g,
  /gameplayPower/g,
  /shareMultiplier/g,
  /shareSourceType/g,
  /isStackedShare/g,
  /stackedShares/g,
  /STACKED_SHARE_PAYOUT_CUTOVER_AT/g,
  /stackShares\s*\(/g,
];

async function walk(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_PARTS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else if (TEXT_EXTENSIONS.has(extname(entry.name))) output.push(path);
  }
  return output;
}

const violations = [];
for (const root of ROOTS) {
  let files = [];
  try {
    files = await walk(join(ROOT, root));
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  for (const file of files) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of FORBIDDEN) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) violations.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error("Retired Stack economy residue detected in active repository surfaces:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Economy V2 retired-Stack audit passed: no active legacy identifiers found.");

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const tracked = spawnSync("git", ["ls-files"], { encoding: "utf8" });
if (tracked.status !== 0) {
  console.error("Failed to enumerate tracked files via git ls-files");
  process.exit(tracked.status ?? 1);
}

const textExtensions = new Set([
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".html",
]);

const textNames = new Set(["CODEOWNERS", ".gitattributes", ".gitignore"]);

const problems = [];

for (const file of tracked.stdout.split("\n").filter(Boolean)) {
  const base = path.basename(file);
  const ext = path.extname(file).toLowerCase();
  const isTextCandidate = textExtensions.has(ext) || textNames.has(base);
  if (!isTextCandidate) continue;

  const bytes = readFileSync(file);

  if (bytes.includes(0)) {
    problems.push(`${file}: contains NUL bytes`);
    continue;
  }

  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    problems.push(`${file}: UTF-16 BOM detected (use UTF-8)`);
  }
}

if (problems.length) {
  console.error("Text encoding check failed:\n");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log("Text encoding check passed.");

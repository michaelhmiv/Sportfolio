import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

const HARD_EXCLUDED_DIRS = [
  ".git",
  "node_modules",
  "dist",
  "tmp",
  "coverage",
  "test-results",
  "playwright-report",
  "mobile/ios/App/build",
  "mobile/ios/App/Pods",
  "mobile/android/app/build",
  "mobile/android/.gradle",
];

const DEFAULT_EXCLUDED_DIRS = [
  ...HARD_EXCLUDED_DIRS,
  ".claude",
  "vendor",
  "attached_assets",
  "mobile/android/app/src/main/assets/public/assets",
  "mobile/ios/App/App/public/assets",
  "docs/wiki/changelog",
];

const HARD_EXCLUDED_FILES = new Set(["mobile/android/local.properties"]);
const DEFAULT_EXCLUDED_FILES = new Set([
  "package-lock.json",
  ".agent-dev.log",
  ".codex-agent-dev.log",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".7z",
  ".rar",
  ".jar",
  ".jks",
  ".der",
  ".pem",
  ".p8",
  ".p12",
  ".key",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
]);

const LARGEST_FILE_LIMIT = 25;
const DIRECTORY_LIMIT = 30;

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

function normalizeRelativePath(value) {
  return normalizeSlashes(value).replace(/^\.\//, "");
}

function isPathOrChild(candidate, target) {
  return candidate === target || candidate.startsWith(`${target}/`);
}

function shouldExcludeDirectory(relativePath, exclusions) {
  if (!relativePath) return false;
  return exclusions.some((excluded) => isPathOrChild(relativePath, excluded));
}

function shouldExcludeByHardPolicy(relativeFilePath) {
  if (HARD_EXCLUDED_FILES.has(relativeFilePath)) return true;
  const basename = path.posix.basename(relativeFilePath);
  return basename.startsWith(".env") && basename !== ".env.example";
}

function shouldExcludeByDefaultPolicy(relativeFilePath) {
  if (DEFAULT_EXCLUDED_FILES.has(relativeFilePath)) return true;
  if (shouldExcludeDirectory(relativeFilePath, DEFAULT_EXCLUDED_DIRS)) return true;

  const basename = path.posix.basename(relativeFilePath);
  if (basename.endsWith(".log")) return true;
  if (basename.startsWith(".env") && basename !== ".env.example") return true;

  return false;
}

function isLikelyBinaryBuffer(buffer) {
  const maxBytes = Math.min(buffer.length, 8192);
  if (maxBytes === 0) return false;

  let suspicious = 0;
  for (let index = 0; index < maxBytes; index += 1) {
    const byte = buffer[index];
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32) || byte === 127) suspicious += 1;
  }

  return suspicious / maxBytes > 0.3;
}

function countLines(text) {
  if (text.length === 0) return 0;
  const matches = text.match(/\r\n|\n|\r/g);
  return (matches?.length ?? 0) + 1;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTokenRange(chars) {
  const low = Math.round(chars / 5);
  const high = Math.round(chars / 3);
  return `${formatNumber(low)}-${formatNumber(high)}`;
}

function getTopLevelDirectory(relativeFilePath) {
  const segments = relativeFilePath.split("/").filter(Boolean);
  return segments.length === 0 ? "[root]" : segments[0];
}

function walkFiles(rootDirectory, directoryExclusions) {
  const files = [];
  const stack = [{ absolutePath: rootDirectory, relativePath: "" }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;

    let entries = [];
    try {
      entries = fs.readdirSync(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const childRelativePath = normalizeRelativePath(
        current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name,
      );
      const childAbsolutePath = path.join(current.absolutePath, entry.name);

      if (entry.isDirectory()) {
        if (shouldExcludeDirectory(childRelativePath, directoryExclusions)) continue;
        stack.push({ absolutePath: childAbsolutePath, relativePath: childRelativePath });
        continue;
      }

      if (entry.isFile()) {
        files.push({ absolutePath: childAbsolutePath, relativePath: childRelativePath });
      }
    }
  }

  return files;
}

function analyzeFiles(files, useDefaultExclusions) {
  const result = {
    candidateFiles: 0,
    processedFiles: 0,
    skippedByPolicy: 0,
    skippedBinary: 0,
    textFiles: 0,
    totalChars: 0,
    totalLines: 0,
    largestFiles: [],
    directoryCharTotals: new Map(),
  };

  for (const file of files) {
    const relativePath = file.relativePath;
    result.candidateFiles += 1;

    const skipByPolicy =
      shouldExcludeByHardPolicy(relativePath) ||
      (useDefaultExclusions && shouldExcludeByDefaultPolicy(relativePath));

    if (skipByPolicy) {
      result.skippedByPolicy += 1;
      continue;
    }

    result.processedFiles += 1;

    const extension = path.posix.extname(relativePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(extension)) {
      result.skippedBinary += 1;
      continue;
    }

    let buffer;
    try {
      buffer = fs.readFileSync(file.absolutePath);
    } catch {
      continue;
    }

    if (isLikelyBinaryBuffer(buffer)) {
      result.skippedBinary += 1;
      continue;
    }

    const text = buffer.toString("utf8");
    const chars = text.length;
    const lines = countLines(text);

    result.textFiles += 1;
    result.totalChars += chars;
    result.totalLines += lines;

    const topLevelDirectory = getTopLevelDirectory(relativePath);
    result.directoryCharTotals.set(
      topLevelDirectory,
      (result.directoryCharTotals.get(topLevelDirectory) ?? 0) + chars,
    );

    result.largestFiles.push({
      relativePath,
      lines,
      chars,
      tokenRange: formatTokenRange(chars),
    });
  }

  result.largestFiles.sort((left, right) => right.chars - left.chars);
  result.largestFiles = result.largestFiles.slice(0, LARGEST_FILE_LIMIT);

  return result;
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function printDirectoryTable(directoryCharTotals) {
  const rows = [...directoryCharTotals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, DIRECTORY_LIMIT);

  for (const [directory, chars] of rows) {
    const tokenRange = formatTokenRange(chars);
    console.log(
      `${directory.padEnd(20)} chars=${formatNumber(chars).padStart(12)}  tokens~${tokenRange}`,
    );
  }
}

function printLargestFilesTable(files) {
  for (const file of files) {
    const paddedPath = file.relativePath.padEnd(70);
    console.log(
      `${paddedPath} lines=${String(file.lines).padStart(6)}  chars=${String(file.chars).padStart(8)}  tokens~${file.tokenRange}`,
    );
  }
}

const filesAfterHardDirectoryExclusions = walkFiles(REPO_ROOT, HARD_EXCLUDED_DIRS);
const baseline = analyzeFiles(filesAfterHardDirectoryExclusions, false);
const defaultContext = analyzeFiles(filesAfterHardDirectoryExclusions, true);

console.log("Context Audit");
console.log("=============");
console.log(`repo: ${REPO_ROOT}`);
console.log(`generated: ${new Date().toISOString()}`);

printSection("Hard Ignored Directories");
for (const dir of HARD_EXCLUDED_DIRS) console.log(`- ${dir}`);

printSection("Suggested Default Exclusions");
for (const dir of DEFAULT_EXCLUDED_DIRS) console.log(`- ${dir}/`);
for (const file of DEFAULT_EXCLUDED_FILES) console.log(`- ${file}`);
console.log("- .env* (except .env.example)");
console.log("- *.log");
console.log("- binary/image/archive/build artifacts");

printSection("Total Text Context (After Hard Exclusions)");
console.log(`candidate files: ${formatNumber(baseline.candidateFiles)}`);
console.log(`processed files: ${formatNumber(baseline.processedFiles)}`);
console.log(`skipped by policy: ${formatNumber(baseline.skippedByPolicy)}`);
console.log(`skipped as binary: ${formatNumber(baseline.skippedBinary)}`);
console.log(`text files: ${formatNumber(baseline.textFiles)}`);
console.log(`text lines: ${formatNumber(baseline.totalLines)}`);
console.log(`text chars: ${formatNumber(baseline.totalChars)}`);
console.log(`estimated tokens: ${formatTokenRange(baseline.totalChars)}`);

printSection("Estimated Context After Default Exclusions");
console.log(`candidate files: ${formatNumber(defaultContext.candidateFiles)}`);
console.log(`processed files: ${formatNumber(defaultContext.processedFiles)}`);
console.log(`skipped by policy: ${formatNumber(defaultContext.skippedByPolicy)}`);
console.log(`skipped as binary: ${formatNumber(defaultContext.skippedBinary)}`);
console.log(`text files: ${formatNumber(defaultContext.textFiles)}`);
console.log(`text lines: ${formatNumber(defaultContext.totalLines)}`);
console.log(`text chars: ${formatNumber(defaultContext.totalChars)}`);
console.log(`estimated tokens: ${formatTokenRange(defaultContext.totalChars)}`);

const reductionPercent =
  baseline.totalChars === 0
    ? 0
    : Math.max(0, ((baseline.totalChars - defaultContext.totalChars) / baseline.totalChars) * 100);
console.log(`reduction vs baseline chars: ${reductionPercent.toFixed(2)}%`);

printSection("Largest Text Files (Baseline)");
printLargestFilesTable(baseline.largestFiles);

printSection("Top-Level Directory Token Estimates (Baseline)");
printDirectoryTable(baseline.directoryCharTotals);

printSection("Top-Level Directory Token Estimates (After Default Exclusions)");
printDirectoryTable(defaultContext.directoryCharTotals);

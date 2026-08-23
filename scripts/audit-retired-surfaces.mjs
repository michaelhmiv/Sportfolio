import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const scanRoots = [
  ".github",
  "client",
  "config",
  "docs",
  "mobile",
  "packages",
  "plugins",
  "scripts",
  "server",
  "shared",
  "skills",
  "tasks",
  ".env.example",
  "AGENTS.md",
  "CLAUDE.md",
  "CODEOWNERS",
  "DATABASE.md",
  "README.md",
  "WORKSPACE_ISOLATION.md",
  "chatgpt-app-submission.json",
  "package.json",
];

const excluded = new Set([
  "docs/runbooks/retired-product-database-cleanup.md",
  "scripts/audit-retired-runtime.mjs",
  "scripts/audit-retired-surfaces.mjs",
  "server/jobs/retired-capabilities.contract.test.ts",
]);
const excludedPrefixes = ["migrations/", "node_modules/", "dist/", "coverage/"];

const forbidden = [
  ["retired orchestrator brand", /hermes/i],
  ["retired messaging provider", /telnyx/i],
  ["retired backend path", /(?:^|[\s`'"(])server\/agent(?:\/|\b)/i],
  ["retired client path", /(?:^|[\s`'"(])client\/src\/features\/agent(?:\/|\b)/i],
  ["retired documentation path", /(?:^|[\s`'"(])docs\/wiki\/agent(?:\/|\b)/i],
  ["retired web route", /(?:^|[\s`'"(])\/(?:agent|sms\/link)(?:[\s`'"),./]|$)/i],
  ["retired API route", /\/api\/(?:agent|sms)(?:\/|\b)/i],
  [
    "retired environment variable",
    /(?:HERMES_|TELNYX_|SMS_LINK_SECRET|USER_AGENT_MANAGED_PROVIDER|USER_AGENT_SECRET_KEY)/,
  ],
  [
    "retired database identifier",
    /(?:user_agent_|agent_(?:system|runtime|skills?|skill_reviews?|advisory|live|strategy|strategies|threads?|messages?|memories?|schedules?|proposals?|action_bundles?|improvement|continuity|research|source)|sms_message_events|user_phone_link)/i,
  ],
  [
    "retired product language",
    /(?:Sportfolio Agent|\bagent[-_ ](?:thread|profile|strategy|advisory|runtime|operator|shell|conversation|message|memory|schedule|skill|proposal)|SMS[-_ ]?link|SMS settings)/i,
  ],
  ["raw MLB provider publication", /mlb_mcp__/i],
];

async function filesAt(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (
      ["node_modules", ".git", "dist", "build", "coverage", "attached_assets"].includes(entry.name)
    ) {
      continue;
    }
    const child = join(path, entry.name);
    if (entry.isDirectory()) output.push(...(await filesAt(child)));
    else if (entry.isFile()) output.push(child);
  }
  return output;
}

const files = [];
for (const entry of scanRoots) {
  try {
    files.push(...(await filesAt(join(root, entry))));
  } catch {
    // Optional roots are ignored.
  }
}

const failures = [];
for (const file of files) {
  const rel = relative(root, file).split(sep).join("/");
  if (excluded.has(rel) || excludedPrefixes.some((prefix) => rel.startsWith(prefix))) continue;

  for (const [label, pattern] of forbidden) {
    if (pattern.test(rel)) failures.push(`${rel}: ${label} in path`);
  }

  if (
    !/\.(?:[cm]?[jt]sx?|json|md|ya?ml|example|txt|swift|sql)$/.test(rel) &&
    !["README.md", "package.json", "CODEOWNERS"].includes(rel)
  ) {
    continue;
  }

  const text = await readFile(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(text)) failures.push(`${rel}: ${label}`);
  }
}

if (failures.length) {
  console.error("Retired surface audit failed:\n" + [...new Set(failures)].sort().join("\n"));
  process.exit(1);
}

console.log("Retired surface audit passed.");

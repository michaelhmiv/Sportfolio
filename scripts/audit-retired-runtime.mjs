#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = ["client/src", "server", "shared", "scripts"];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const ignoredFiles = new Set([
  "scripts/audit-retired-runtime.mjs",
  "scripts/audit-retired-surfaces.mjs",
]);
const forbidden = [
  /@supabase\/supabase-js/,
  /SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)/,
  /HERMES_INTERNAL_/,
  /\bHERMES_/,
  /\bTELNYX_/,
  /\bSMS_LINK_/,
  /\bUSER_AGENT_MANAGED_PROVIDER\b/,
  /\bUSER_AGENT_SECRET_KEY\b/,
  /\bMLB_MCP_(?:ENABLED|URL|TIMEOUT_MS|HEALTH_CACHE_MS|AUTH_BEARER|MAX_RESPONSE_CHARS|CIRCUIT_FAILURE_THRESHOLD|CIRCUIT_RESET_MS)\b/,
];
const allowedFiles = new Set([
  "scripts/auth-supabase-inventory.ts",
  "scripts/auth-supabase-inventory.test.ts",
  "scripts/verify-auth-cutover.ts",
  "scripts/verify-auth-cutover.test.ts",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (extensions.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const findings = [];
for (const root of roots) {
  for (const file of await walk(root)) {
    const normalized = file.replaceAll("\\", "/");
    if (ignoredFiles.has(normalized) || allowedFiles.has(normalized)) continue;
    const source = await readFile(file, "utf8");
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (forbidden.some((pattern) => pattern.test(lines[index]))) {
        findings.push(`${normalized}:${index + 1}: ${lines[index].trim()}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Retired runtime references remain:\n" + findings.join("\n"));
  process.exit(1);
}
console.log("Retired runtime audit passed.");

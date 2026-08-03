import { readFileSync } from "node:fs";

const files = [
  "server/mcp/plugin/adapters.ts",
  "server/mcp/plugin/registry.ts",
  "server/mcp/plugin/sanitizer.ts",
  "plugins/sportfolio/skills/sportfolio-companion/SKILL.md",
  "client/src/pages/oauth-consent.tsx",
  "client/src/pages/connected-apps.tsx",
];

const combined = files.map((path) => `\n/* ${path} */\n${readFileSync(path, "utf8")}`).join("\n");
const failures: string[] = [];

const forbiddenCalls = [
  /console\.(?:log|info|debug)\([^\n]*(?:access[_-]?token|refresh[_-]?token|authorization_id|client_secret|password)/i,
  /structuredContent\s*:\s*(?:raw|result)\b/i,
  /return\s+(?:raw|result)\s*;\s*$/im,
];
for (const pattern of forbiddenCalls) {
  if (pattern.test(combined)) failures.push(`Matched forbidden pattern: ${pattern}`);
}

const appBinding = readFileSync("plugins/sportfolio/.app.json", "utf8");
if (/client_secret|access_token|refresh_token|service_role|jwt_secret/i.test(appBinding)) {
  failures.push("Plugin package contains a secret-bearing field.");
}

const manifest = readFileSync("plugins/sportfolio/.codex-plugin/plugin.json", "utf8");
if (/"capabilities"\s*:\s*\[[^\]]*"Write"/s.test(manifest)) {
  failures.push("Plugin manifest advertises write capability.");
}

const sanitizer = readFileSync("server/mcp/plugin/sanitizer.ts", "utf8");
for (const required of ["access[_-]?token", "refresh[_-]?token", "service[_-]?role", "stack", "sql"]) {
  if (!sanitizer.includes(required)) failures.push(`Sanitizer is missing required blocked pattern: ${required}`);
}

if (failures.length) {
  console.error("Plugin privacy check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`Plugin privacy check passed across ${files.length} sensitive files.`);

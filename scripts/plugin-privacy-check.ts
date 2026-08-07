import { readFileSync } from "node:fs";
import { buildPluginStaticCatalog } from "../server/mcp/plugin/registry";

const files = [
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
  /structuredContent\s*:\s*(?:raw|result)\b(?!\.)/i,
  /return\s+(?:raw|result)\s*;\s*$/im,
];
for (const pattern of forbiddenCalls) {
  if (pattern.test(combined)) failures.push(`Matched forbidden pattern: ${pattern}`);
}

const appBinding = readFileSync("plugins/sportfolio/.app.json", "utf8");
if (/client_secret|access_token|refresh_token|service_role|jwt_secret/i.test(appBinding)) {
  failures.push("Plugin package contains a secret-bearing field.");
}

const manifest = JSON.parse(
  readFileSync("plugins/sportfolio/.codex-plugin/plugin.json", "utf8"),
) as { interface?: { capabilities?: string[] } };
if (!manifest.interface?.capabilities?.includes("Write")) {
  failures.push("The approved MCP surface must advertise authenticated write capability.");
}

const catalog = buildPluginStaticCatalog();
for (const tool of catalog.filter((entry) => !entry.readOnly)) {
  if (tool.access !== "oauth" || tool.securitySchemes[0]?.type !== "oauth2") {
    failures.push(`Write tool ${tool.name} is not protected by OAuth.`);
  }
}

for (const name of ["list_api_tokens", "revoke_api_token"]) {
  const tool = catalog.find((entry) => entry.name === name);
  if (!tool || tool.access !== "oauth" || tool.securitySchemes[0]?.type !== "oauth2") {
    failures.push(`Approved sensitive account tool ${name} must remain OAuth-only.`);
  }
}

const sanitizer = readFileSync("server/mcp/plugin/sanitizer.ts", "utf8");
for (const required of [
  "access[_-]?token",
  "refresh[_-]?token",
  "service[_-]?role",
  "stack",
  "sql",
]) {
  if (!sanitizer.includes(required))
    failures.push(`Sanitizer is missing required blocked pattern: ${required}`);
}

if (failures.length) {
  console.error("Plugin privacy check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`Plugin privacy check passed across ${files.length} sensitive files.`);

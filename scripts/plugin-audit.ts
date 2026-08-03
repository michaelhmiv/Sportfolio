import { readFileSync } from "node:fs";
import { PLUGIN_V1_EXCLUDED_CAPABILITIES, PLUGIN_V1_TOOLS } from "../server/mcp/plugin/capability-policy";
import { PLUGIN_TOOL_ADAPTERS } from "../server/mcp/plugin/adapters";
import { buildPluginCatalog } from "../server/mcp/plugin/catalog";

const errors: string[] = [];
const toolNames = PLUGIN_V1_TOOLS.map((tool) => tool.name);
const adapterNames = PLUGIN_TOOL_ADAPTERS.map((tool) => tool.name);
const catalog = buildPluginCatalog();

if (new Set(toolNames).size !== toolNames.length) errors.push("Marketplace policy contains duplicate tools.");
if (JSON.stringify([...toolNames].sort()) !== JSON.stringify([...adapterNames].sort())) {
  errors.push("Marketplace policy and adapter tool names differ.");
}
if (catalog.length !== 22) errors.push(`Expected 22 marketplace tools; found ${catalog.length}.`);
if (catalog.some((tool) => !tool.annotations.readOnlyHint || tool.annotations.openWorldHint || tool.annotations.destructiveHint)) {
  errors.push("Marketplace v1 contains unsafe annotations.");
}
if (catalog.some((tool) => tool.access === "oauth" && tool.securitySchemes[0]?.type !== "oauth2")) {
  errors.push("Connected tools must declare OAuth 2 security.");
}
if (catalog.some((tool) => tool.access === "public" && tool.securitySchemes[0]?.type !== "noauth")) {
  errors.push("Public tools must declare no authentication.");
}

const bannedPatterns = [
  /^stage_/,
  /^confirm_/,
  /^cancel_/,
  /api[_-]?token/i,
  /byok/i,
  /sms/i,
  /premium/i,
  /checkout/i,
  /billing/i,
  /schedule/i,
  /agent_thread/i,
  /hosted_research/i,
];
for (const name of toolNames) {
  if (bannedPatterns.some((pattern) => pattern.test(name))) errors.push(`Restricted tool exposed: ${name}`);
}

const skill = readFileSync("plugins/sportfolio/skills/sportfolio-companion/SKILL.md", "utf8");
for (const banned of ["paste your API token", "enter your password", "send your SMS code"]) {
  if (skill.toLowerCase().includes(banned.toLowerCase())) errors.push(`Marketplace skill contains unsafe instruction: ${banned}`);
}
for (const tool of toolNames) {
  if (!skill.includes(`\`${tool}\``)) errors.push(`Marketplace skill does not reference ${tool}.`);
}

const excludedReasons = new Set(PLUGIN_V1_EXCLUDED_CAPABILITIES.map((entry) => entry.reason));
if (excludedReasons.size < 5) errors.push("Marketplace exclusion policy is insufficiently classified.");

if (errors.length > 0) {
  console.error("Plugin readiness audit failed:\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log(`Plugin readiness audit passed: ${catalog.length} tools, ${PLUGIN_V1_EXCLUDED_CAPABILITIES.length} exclusions.`);

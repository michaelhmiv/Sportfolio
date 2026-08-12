import { readFileSync } from "node:fs";
import { buildPublicToolRegistry } from "../server/mcp/public-tool-registry";
import { buildPluginStaticCatalog } from "../server/mcp/plugin/registry";
import { getDeniedPublicToolNames } from "../server/mcp/public-tool-policy";

const errors: string[] = [];
const sourceTools = buildPublicToolRegistry();
const catalog = buildPluginStaticCatalog();
const sourceNames = sourceTools.map((tool) => tool.name).sort();
const catalogNames = catalog.map((tool) => tool.name).sort();

if (new Set(sourceNames).size !== sourceNames.length) {
  errors.push("The approved public MCP registry contains duplicate tool names.");
}
if (new Set(catalogNames).size !== catalogNames.length) {
  errors.push("The marketplace catalog contains duplicate tool names.");
}
if (JSON.stringify(sourceNames) !== JSON.stringify(catalogNames)) {
  errors.push("The marketplace catalog does not exactly match the approved public MCP registry.");
}
if (catalog.length === 0) {
  errors.push("The approved marketplace catalog is empty.");
}

for (const deniedName of getDeniedPublicToolNames()) {
  if (catalogNames.includes(deniedName)) {
    errors.push(`Retired capability leaked into the marketplace catalog: ${deniedName}.`);
  }
}

for (const tool of catalog) {
  if (tool.openWorld !== false) {
    errors.push(`${tool.name} must explicitly remain closed-world.`);
  }
  if (tool.readOnly && tool.destructive) {
    errors.push(`${tool.name} cannot be both read-only and destructive.`);
  }
  if (tool.access === "public" && !tool.readOnly) {
    errors.push(`${tool.name} is a write tool exposed without OAuth.`);
  }
  if (tool.access === "oauth" && tool.securitySchemes[0]?.type !== "oauth2") {
    errors.push(`${tool.name} must declare OAuth 2 security.`);
  }
  if (tool.access === "public" && tool.securitySchemes[0]?.type !== "noauth") {
    errors.push(`${tool.name} must declare noauth security.`);
  }
  if (tool.executionModel === "staged_write" && !tool.requiresConfirmation) {
    errors.push(`${tool.name} stages a write but is not marked as requiring confirmation.`);
  }
}

const requiredActionTools = [
  "stage_market_buy",
  "stage_market_sell",
  "stage_scout_assignment",
  "stage_daily_boost_assign",
  "stage_daily_boost_remove",
  "stage_lp_add",
  "stage_lp_remove",
  "stage_community_boost_create",
  "create_watchlist",
  "update_watchlist",
  "delete_watchlist",
  "add_watchlist_player",
  "remove_watchlist_player",
  "confirm_pending_action",
  "cancel_pending_action",
];
for (const name of requiredActionTools) {
  if (!catalogNames.includes(name))
    errors.push(`Required approved MCP action is missing: ${name}.`);
}

const confirmTool = catalog.find((tool) => tool.name === "confirm_pending_action");
if (!confirmTool || confirmTool.readOnly || !confirmTool.destructive) {
  errors.push("confirm_pending_action must be an authenticated destructive finalizer.");
}

for (const name of ["list_api_tokens", "revoke_api_token"]) {
  const tool = catalog.find((entry) => entry.name === name);
  if (!tool) {
    errors.push(`Approved account-security capability is missing: ${name}.`);
  } else if (tool.access !== "oauth") {
    errors.push(`${name} must never be exposed without OAuth.`);
  }
}

const registrySource = readFileSync("server/mcp/plugin/registry.ts", "utf8");
if (!registrySource.includes("outputSchema: envelopeOutputSchema")) {
  errors.push("Marketplace tools must declare an outputSchema.");
}
if (!registrySource.includes("destructiveHint: catalog.destructive")) {
  errors.push("Marketplace tools must explicitly declare destructiveHint.");
}

const skill = readFileSync("plugins/sportfolio/skills/sportfolio-companion/SKILL.md", "utf8");
if (/version 1 is read-only|plugin is read-only|read-only marketplace tools/i.test(skill)) {
  errors.push("The Sportfolio skill still describes the marketplace app as read-only.");
}
for (const requiredPhrase of [
  "stage_market_buy",
  "stage_market_sell",
  "confirm_pending_action",
  "explicit confirmation",
]) {
  if (!skill.toLowerCase().includes(requiredPhrase.toLowerCase())) {
    errors.push(`The Sportfolio skill is missing required action guidance: ${requiredPhrase}.`);
  }
}

if (errors.length > 0) {
  console.error("Plugin readiness audit failed:\n- " + errors.join("\n- "));
  process.exit(1);
}

const writeCount = catalog.filter((tool) => !tool.readOnly).length;
const stagedCount = catalog.filter((tool) => tool.executionModel === "staged_write").length;
const destructiveCount = catalog.filter((tool) => tool.destructive).length;
console.log(
  `Plugin readiness audit passed: ${catalog.length} approved static tools, ${writeCount} writes, ${stagedCount} staged actions, ${destructiveCount} destructive actions.`,
);

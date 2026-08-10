import { readFileSync } from "node:fs";
import {
  buildAllPluginPresentationCatalog,
  getAllPluginUiResourceUris,
  SPORTFOLIO_SHARED_UI_RESOURCE_URI,
} from "../server/mcp/plugin/ui/catalog";

const errors: string[] = [];
const catalog = buildAllPluginPresentationCatalog();
const names = catalog.map((entry) => entry.name);
const resources = catalog.map((entry) => entry.resourceUri);
const expectedResources = getAllPluginUiResourceUris().sort();

if (catalog.length === 0) {
  errors.push("Sportfolio must expose at least one presentation tool.");
}
if (expectedResources.length !== 1) {
  errors.push(
    `Expected one shared Sportfolio UI resource, found ${expectedResources.length} resources.`,
  );
}
if (new Set(names).size !== names.length) {
  errors.push("Sportfolio presentation tool names must be unique.");
}
if (new Set(resources).size !== 1) {
  errors.push("All Sportfolio presentation tools must reuse the shared UI resource URI.");
}
if (expectedResources[0] !== SPORTFOLIO_SHARED_UI_RESOURCE_URI) {
  errors.push(
    "The registered UI resource must be the shared content-addressed Sportfolio shell.",
  );
}

for (const entry of catalog) {
  if (!entry.name.startsWith("render_")) {
    errors.push(`${entry.name} must use the render_ presentation-tool prefix.`);
  }
  if (!entry.readOnly || entry.destructive || entry.openWorld) {
    errors.push(`${entry.name} must be read-only, non-destructive, and closed-world.`);
  }
  if (entry.resourceUri !== SPORTFOLIO_SHARED_UI_RESOURCE_URI) {
    errors.push(`${entry.name} must reference the shared Sportfolio UI shell.`);
  }
  if (!/^ui:\/\/sportfolio\/app\/[a-f0-9]{16}\.html$/.test(entry.resourceUri)) {
    errors.push(`${entry.name} has an invalid content-addressed resource URI: ${entry.resourceUri}`);
  }
  if (!entry.featureFlag.startsWith("PLUGIN_UI_")) {
    errors.push(`${entry.name} must have a dedicated PLUGIN_UI_* feature flag.`);
  }
}

const buildScript = readFileSync("scripts/build-plugin-ui.mjs", "utf8");
const widgetEntryMatch = buildScript.match(
  /client\/src\/plugin-ui\/[A-Za-z0-9._/-]+\.(?:tsx|ts|jsx|js)/,
);
if (!widgetEntryMatch) {
  errors.push(
    "Unable to resolve the ChatGPT widget source entrypoint from build-plugin-ui.mjs.",
  );
}

const widgetSources = [
  widgetEntryMatch ? readFileSync(widgetEntryMatch[0], "utf8") : "",
  readFileSync("client/src/plugin-ui/sportfolio-widget-v2.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-sports-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-action-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-market-portfolio-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-gameplay-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-overview-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/action-review-panel.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/openai-host.ts", "utf8"),
].join("\n");

for (const required of [
  "tools/call",
  "ui/notifications/tool-result",
  "openai:set_globals",
  "requestDisplayMode",
  "ui/update-model-context",
  "setWidgetState",
  "stage_market_buy",
  "stage_market_sell",
  "stage_lp_add",
  "stage_lp_remove",
  "confirm_pending_action",
  "cancel_pending_action",
  "transactionId",
  "render_score_slate",
  "render_live_event",
  "render_action_review",
  "get_portfolio_history",
  "requestModal",
  'requestDisplayMode("pip")',
  '"dashboard"',
  '"collections"',
  '"rankings"',
]) {
  if (!widgetSources.includes(required)) {
    errors.push(`Widget source is missing required bridge or action contract: ${required}.`);
  }
}

const surfaceSource = [
  readFileSync("server/mcp/plugin/ui/surface.ts", "utf8"),
  readFileSync("server/mcp/plugin/ui/sports-surface.ts", "utf8"),
  readFileSync("server/mcp/plugin/ui/action-surface.ts", "utf8"),
  readFileSync("server/mcp/plugin/ui/gameplay-surface.ts", "utf8"),
  readFileSync("server/mcp/plugin/ui/overview-surface.ts", "utf8"),
  readFileSync("server/mcp/plugin/ui/shared-resource.ts", "utf8"),
].join("\n");
for (const required of [
  "text/html;profile=mcp-app",
  "openai/outputTemplate",
  "ui: { resourceUri",
  "connectDomains: []",
  "resourceDomains: []",
  "render_scouting",
  "render_boosts",
  "render_watchlist",
  "render_dashboard",
  "render_collections",
  "render_rankings",
  "get_dashboard_overview",
  "list_collections",
  "get_collection_detail",
  "get_leaderboard",
]) {
  if (!surfaceSource.includes(required)) {
    errors.push(`UI surface is missing required metadata or presentation contract: ${required}.`);
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
if (!packageJson.scripts?.["plugin:ui:build"]?.includes("build-plugin-ui.mjs")) {
  errors.push("package.json must expose plugin:ui:build.");
}
if (!packageJson.scripts?.build?.includes("plugin:ui:build")) {
  errors.push("The production build must build the plugin UI before bundling the server.");
}

if (errors.length) {
  console.error("Plugin UI audit failed:\n- " + errors.join("\n- "));
  process.exit(1);
}

console.log(
  `Plugin UI audit passed: ${catalog.length} presentation tools share ${expectedResources.length} content-addressed resource.`,
);

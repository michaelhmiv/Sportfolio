import { readFileSync } from "node:fs";
// The audit imports presentation catalogs, which transitively import the server
// database module. The audit itself is static and must never require a real
// database URL or attempt a database connection.
process.env.NODE_ENV ||= "test";
process.env.DEV_DATABASE_URL ||= "postgresql://127.0.0.1:5432/sportfolio_plugin_ui_audit";

const {
  buildAllPluginPresentationCatalog,
  getAllPluginUiResourceUris,
  SPORTFOLIO_SHARED_UI_RESOURCE_URI,
} = await import("../server/mcp/plugin/ui/catalog");
const { SPORTFOLIO_WIDGET_HTML_TEMPLATE } =
  await import("../server/mcp/plugin/ui/generated-widget");
const { buildPublicToolRegistry } = await import("../server/mcp/public-tool-registry");

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
  errors.push("The registered UI resource must be the shared content-addressed Sportfolio shell.");
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
    errors.push(
      `${entry.name} has an invalid content-addressed resource URI: ${entry.resourceUri}`,
    );
  }
  if (!entry.featureFlag.startsWith("PLUGIN_UI_")) {
    errors.push(`${entry.name} must have a dedicated PLUGIN_UI_* feature flag.`);
  }
}

const fixtureExpectations: Record<string, Record<string, unknown>> = {
  render_player_market: { playerId: "mlb_669022" },
  render_liquidity_position: { playerId: "mlb_669022" },
  render_live_event: { eventId: "mlb_game_1" },
};
for (const [toolName, expected] of Object.entries(fixtureExpectations)) {
  const entry = catalog.find((candidate) => candidate.name === toolName);
  const fixtureArgs = entry?.fixtureArgs as Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(expected)) {
    if (fixtureArgs?.[key] !== value) {
      errors.push(`${toolName} must use the production-shaped ${key} fixture ${String(value)}.`);
    }
  }
}

const buildScript = readFileSync("scripts/build-plugin-ui.mjs", "utf8");
const widgetEntryMatch = buildScript.match(
  /client\/src\/plugin-ui\/[A-Za-z0-9._/-]+\.(?:tsx|ts|jsx|js)/,
);
if (!widgetEntryMatch) {
  errors.push("Unable to resolve the ChatGPT widget source entrypoint from build-plugin-ui.mjs.");
}
for (const required of ['format: "esm"', "splitting: false", "write: false", "inlineModule"]) {
  if (!buildScript.includes(required)) {
    errors.push(`Plugin UI build is missing self-contained bundle requirement: ${required}.`);
  }
}
if (
  buildScript.includes("client/public/assets/plugin-ui") ||
  buildScript.includes("splitting: true")
) {
  errors.push("Plugin UI build must not depend on externally hosted split JavaScript assets.");
}

const widgetBytes = Buffer.byteLength(SPORTFOLIO_WIDGET_HTML_TEMPLATE, "utf8");
if (widgetBytes > 500_000) {
  errors.push(`Plugin UI resource is ${widgetBytes} bytes; budget is 500,000 bytes.`);
}
if (!SPORTFOLIO_WIDGET_HTML_TEMPLATE.includes('<script type="module">')) {
  errors.push("Plugin UI resource must inline its ESM application module.");
}
if (/<script[^>]+src=/i.test(SPORTFOLIO_WIDGET_HTML_TEMPLATE)) {
  errors.push("Plugin UI resource must not require an external JavaScript bootstrap.");
}

const entrySource = widgetEntryMatch ? readFileSync(widgetEntryMatch[0], "utf8") : "";
const hostSource = readFileSync("client/src/plugin-ui/openai-host.ts", "utf8");
const widgetSources = [
  entrySource,
  readFileSync("client/src/plugin-ui/sportfolio-widget-v2.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-sports-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-action-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-market-portfolio-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-gameplay-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/sportfolio-overview-widget.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/action-review-panel.tsx", "utf8"),
  readFileSync("client/src/plugin-ui/player-avatar.tsx", "utf8"),
  hostSource,
].join("\n");

if (widgetSources.includes("ui://sportfolio/action-review/v1.html")) {
  errors.push("Widget source must not reference the inactive legacy action-review UI resource.");
}
if (/requestModal\\(\\s*\\{\\s*transactionId\\s*\\}\\s*,/.test(widgetSources)) {
  errors.push("Widget action review must use the active shared UI resource.");
}

const registeredWidgetToolNames = new Set([
  ...buildPublicToolRegistry().map((tool) => tool.name),
  ...catalog.map((entry) => entry.name),
  "resolve_players",
  "stage_scout_assignments",
]);
const staticWidgetCalls = Array.from(widgetSources.matchAll(/callTool\(\s*"([^"]+)"/g)).map(
  (match) => match[1],
);
for (const toolName of new Set(staticWidgetCalls)) {
  if (!registeredWidgetToolNames.has(toolName)) {
    errors.push(`Widget calls unregistered MCP tool ${toolName}.`);
  }
}

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
  "onError={() => setImageFailed(true)}",
  'loading="lazy"',
]) {
  if (!widgetSources.includes(required)) {
    errors.push(`Widget source is missing required bridge or action contract: ${required}.`);
  }
}

for (const required of ["subscribeHostMessages", "routeSnapshot", "viewFromToolOutput"]) {
  if (!entrySource.includes(required)) {
    errors.push(`Widget entrypoint is missing delayed-result routing contract: ${required}.`);
  }
}
for (const required of [
  "bridgeSnapshot.toolOutput = params",
  "applyBridgeMessage",
  "initializePromise",
]) {
  if (!hostSource.includes(required)) {
    errors.push(`OpenAI host bridge is missing cached MCP state contract: ${required}.`);
  }
}

const surfaceSource = [
  readFileSync("server/mcp/plugin/ui/surface.ts", "utf8"),
  readFileSync("server/mcp/plugin/ui/sports-surface.ts", "utf8"),
  readFileSync("server/mcp/plugin/ui/action-surface.ts", "utf8"),
  readFileSync("server/mcp/plugin/ui/gameplay-surface.ts", "utf8"),
  readFileSync("server/mcp/plugin/ui/overview-surface.ts", "utf8"),
].join("\n");
const sharedResourceSource = readFileSync("server/mcp/plugin/ui/shared-resource.ts", "utf8");
for (const required of [
  "text/html;profile=mcp-app",
  "openai/outputTemplate",
  "ui: { resourceUri",
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
for (const required of [
  "buildSportfolioWidgetHtml",
  "connectDomains: []",
  "resourceDomains: [assetOrigin]",
]) {
  if (!sharedResourceSource.includes(required)) {
    errors.push(`Shared UI resource is missing required loader/CSP contract: ${required}.`);
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
if (!packageJson.scripts?.["plugin:ui:build"]?.includes("build-plugin-ui.mjs")) {
  errors.push("package.json must expose plugin:ui:build.");
}
if (!packageJson.scripts?.["plugin:ui:harness"]?.includes("plugin-ui-harness.mjs")) {
  errors.push("package.json must expose plugin:ui:harness.");
}
if (!packageJson.scripts?.["plugin:ui:live-smoke"]?.includes("plugin-ui-live-smoke.ts")) {
  errors.push("package.json must expose plugin:ui:live-smoke.");
}
if (!packageJson.scripts?.build?.includes("plugin:ui:build")) {
  errors.push("The production build must build the plugin UI before bundling the server.");
}

if (errors.length) {
  console.error("Plugin UI audit failed:\n- " + errors.join("\n- "));
  process.exit(1);
}

console.log(
  `Plugin UI audit passed: ${catalog.length} presentation tools share one self-contained ${widgetBytes}-byte MCP App resource.`,
);

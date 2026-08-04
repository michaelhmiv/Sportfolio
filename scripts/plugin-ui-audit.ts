import { readFileSync } from "node:fs";
import {
  buildPluginPresentationCatalog,
  SPORTFOLIO_UI_RESOURCE_URIS,
} from "../server/mcp/plugin/ui/surface";

const errors: string[] = [];
const catalog = buildPluginPresentationCatalog();
const names = catalog.map((entry) => entry.name);
const resources = catalog.map((entry) => entry.resourceUri);

if (catalog.length !== 5) {
  errors.push(`Expected 5 Sportfolio presentation tools, found ${catalog.length}.`);
}
if (new Set(names).size !== names.length) {
  errors.push("Sportfolio presentation tool names must be unique.");
}
if (new Set(resources).size !== resources.length) {
  errors.push("Each Sportfolio presentation surface must use a distinct resource URI.");
}

for (const entry of catalog) {
  if (!entry.name.startsWith("render_")) {
    errors.push(`${entry.name} must use the render_ presentation-tool prefix.`);
  }
  if (!entry.readOnly || entry.destructive || entry.openWorld) {
    errors.push(`${entry.name} must be read-only, non-destructive, and closed-world.`);
  }
  if (!/^ui:\/\/sportfolio\/[a-z0-9-]+\/v\d+\.html$/.test(entry.resourceUri)) {
    errors.push(`${entry.name} has an invalid or unversioned resource URI: ${entry.resourceUri}`);
  }
  if (!entry.featureFlag.startsWith("PLUGIN_UI_")) {
    errors.push(`${entry.name} must have a dedicated PLUGIN_UI_* feature flag.`);
  }
}

const expectedResources = Object.values(SPORTFOLIO_UI_RESOURCE_URIS).sort();
if (JSON.stringify([...resources].sort()) !== JSON.stringify(expectedResources)) {
  errors.push("Presentation catalog resources do not match SPORTFOLIO_UI_RESOURCE_URIS.");
}

const widgetSource = readFileSync("client/src/plugin-ui/sportfolio-widget.tsx", "utf8");
for (const required of [
  "tools/call",
  "ui/notifications/tool-result",
  "openai:set_globals",
  "requestDisplayMode",
  "stage_market_buy",
  "stage_market_sell",
  "stage_lp_add",
  "stage_lp_remove",
  "confirm_pending_action",
  "cancel_pending_action",
]) {
  if (!widgetSource.includes(required)) {
    errors.push(`Widget source is missing required bridge or action contract: ${required}.`);
  }
}

const surfaceSource = readFileSync("server/mcp/plugin/ui/surface.ts", "utf8");
for (const required of [
  "text/html;profile=mcp-app",
  "openai/outputTemplate",
  "ui: { resourceUri",
  "connectDomains: []",
  "resourceDomains: []",
]) {
  if (!surfaceSource.includes(required)) {
    errors.push(`UI surface is missing required metadata: ${required}.`);
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
  `Plugin UI audit passed: ${catalog.length} presentation tools and ${resources.length} versioned resources.`,
);

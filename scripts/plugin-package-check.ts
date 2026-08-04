import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson(path: string): any {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

const manifest = readJson("plugins/sportfolio/.codex-plugin/plugin.json");
const appBinding = readJson("plugins/sportfolio/.app.json");
const marketplace = readJson(".agents/plugins/marketplace.json");

if (manifest.name !== "sportfolio") throw new Error("Plugin name must remain sportfolio.");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) {
  throw new Error("Plugin version must be semantic.");
}
if (manifest.skills !== "./skills/") throw new Error("Manifest skills path must be ./skills/.");
if (manifest.apps !== "./.app.json") throw new Error("Manifest apps path must be ./.app.json.");
if (!Array.isArray(manifest.interface?.capabilities)) {
  throw new Error("Plugin must advertise capabilities.");
}
for (const capability of ["Read", "Write"]) {
  if (!manifest.interface.capabilities.includes(capability)) {
    throw new Error(`Full Sportfolio MCP parity must advertise ${capability} capability.`);
  }
}
for (const field of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
  const value = manifest.interface?.[field];
  if (typeof value !== "string" || !value.startsWith("https://")) {
    throw new Error(`Manifest interface.${field} must be an HTTPS URL.`);
  }
}

const appId = appBinding.apps?.sportfolio?.id;
if (typeof appId !== "string") throw new Error("Missing apps.sportfolio.id in .app.json.");
if (
  appId !== "REPLACE_WITH_SPORTFOLIO_PLUGIN_ASDK_APP_ID" &&
  !/^plugin_asdk_app_[A-Za-z0-9_-]+$/.test(appId)
) {
  throw new Error("Sportfolio app binding must be the documented placeholder or a plugin_asdk_app ID.");
}

const entry = marketplace.plugins?.find((plugin: any) => plugin.name === "sportfolio");
if (!entry) throw new Error("Repo marketplace is missing Sportfolio.");
if (entry.source?.source !== "local" || entry.source?.path !== "./plugins/sportfolio") {
  throw new Error("Repo marketplace Sportfolio source path is invalid.");
}
if (entry.policy?.authentication !== "ON_INSTALL") {
  throw new Error("Sportfolio authentication must occur on install.");
}

console.log(`Sportfolio plugin package ${manifest.version} is structurally valid.`);
if (appId === "REPLACE_WITH_SPORTFOLIO_PLUGIN_ASDK_APP_ID") {
  console.log("Production app binding remains pending, as expected before ChatGPT registration.");
}

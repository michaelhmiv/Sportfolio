import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sourcePath = "scripts/apply-chatgpt-ui-hardening.mjs";
let source = readFileSync(sourcePath, "utf8");
const noOpAnchor = `replaceRequired(\n  "server/mcp/plugin/ui/sports-surface.ts",\n  \`  executePublicTool,\\n\`,\n  \`  executePublicTool,\\n\`,\n  "sports import anchor",\n);\n`;
if (!source.includes(noOpAnchor)) {
  throw new Error("Expected sports import anchor was not found in deterministic patch source.");
}
source = source.replace(noOpAnchor, "");
const generatedPath = "/tmp/apply-chatgpt-ui-hardening-fixed.mjs";
writeFileSync(generatedPath, source);
await import(pathToFileURL(generatedPath).href);

// The score-slate insight calls are scoped to the authenticated block. Persist
// only their availability states outside that block for the presentation payload.
const sportsPath = "server/mcp/plugin/ui/sports-surface.ts";
let sports = readFileSync(sportsPath, "utf8");
const mapAnchor = `  const insightByGame = new Map<string, JsonRecord>();\n  if (context.auth) {`;
if (!sports.includes(mapAnchor)) throw new Error("score-slate insight map anchor missing");
sports = sports.replace(
  mapAnchor,
  `  const insightByGame = new Map<string, JsonRecord>();\n  let insightSourceStates: Record<string, ComposedToolState> = {};\n  if (context.auth) {`,
);
const loopAnchor = `    for (const [, response] of insightResponses) {`;
if (!sports.includes(loopAnchor)) throw new Error("score-slate insight loop anchor missing");
sports = sports.replace(
  loopAnchor,
  `    insightSourceStates = Object.fromEntries(\n      insightResponses.map(([name, result]) => [name, result.state]),\n    );\n    for (const [, response] of insightResponses) {`,
);
const stateAnchor = `      gameInsights: Object.fromEntries(insightResponses.map(([name, result]) => [name, result.state])),`;
if (!sports.includes(stateAnchor)) throw new Error("score-slate source-state anchor missing");
sports = sports.replace(stateAnchor, `      gameInsights: insightSourceStates,`);
writeFileSync(sportsPath, sports);

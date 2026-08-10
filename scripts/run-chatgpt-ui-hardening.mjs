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

// Make protocol test failures report the HTTP status/body instead of only a
// boolean assertion so we can distinguish test-shape errors from server defects.
const protocolPath = "server/mcp/plugin/ui/protocol-resource.test.ts";
let protocol = readFileSync(protocolPath, "utf8");
const httpAnchor = `    expect(response.ok).toBe(true);\n    const text = await response.text();`;
if (!protocol.includes(httpAnchor)) throw new Error("protocol HTTP assertion anchor missing");
protocol = protocol.replace(
  httpAnchor,
  `    const text = await response.text();\n    if (!response.ok) {\n      throw new Error(\`MCP \${method} returned HTTP \${response.status}: \${text}\`);\n    }`,
);
writeFileSync(protocolPath, protocol);

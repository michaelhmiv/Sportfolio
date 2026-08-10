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

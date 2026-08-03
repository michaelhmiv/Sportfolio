import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPluginCatalog } from "../server/mcp/plugin/catalog";

const snapshotPath = fileURLToPath(
  new URL("../server/mcp/plugin/catalog.snapshot.json", import.meta.url),
);
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
  version: string;
  tools: Array<{
    name: string;
    sourceTool: string;
    access: "public" | "oauth";
    dataClassification: string;
  }>;
};

const actual = buildPluginCatalog().map((tool) => ({
  name: tool.name,
  sourceTool: tool.sourceTool,
  access: tool.access,
  dataClassification: tool.dataClassification,
}));

const expectedJson = JSON.stringify(snapshot.tools, null, 2);
const actualJson = JSON.stringify(actual, null, 2);
if (expectedJson !== actualJson) {
  console.error("Marketplace MCP catalog changed without updating catalog.snapshot.json.");
  console.error("Expected:", expectedJson);
  console.error("Actual:", actualJson);
  process.exit(1);
}

for (const tool of buildPluginCatalog()) {
  if (!tool.description.trim() || tool.description.length < 40) {
    throw new Error(`Marketplace tool ${tool.name} needs a substantive description.`);
  }
  if (!tool.annotations.readOnlyHint || tool.annotations.openWorldHint || tool.annotations.destructiveHint) {
    throw new Error(`Marketplace v1 annotations are unsafe for ${tool.name}.`);
  }
  const expectedSecurity = tool.access === "public" ? "noauth" : "oauth2";
  if (tool.securitySchemes[0]?.type !== expectedSecurity) {
    throw new Error(`Marketplace security scheme mismatch for ${tool.name}.`);
  }
}

console.log(`Plugin catalog ${snapshot.version} verified: ${actual.length} tools.`);

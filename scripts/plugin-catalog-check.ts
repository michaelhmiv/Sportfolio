import { buildPublicToolRegistry } from "../server/mcp/public-tool-registry";
import { buildPluginCatalog } from "../server/mcp/plugin/catalog";

const sourceNames = buildPublicToolRegistry().map((tool) => tool.name).sort();
const catalog = buildPluginCatalog();
const catalogNames = catalog.map((tool) => tool.name).sort();

if (JSON.stringify(sourceNames) !== JSON.stringify(catalogNames)) {
  throw new Error("Marketplace catalog no longer matches the shared site MCP registry.");
}

for (const tool of catalog) {
  if (!tool.description.trim()) {
    throw new Error(`Marketplace tool ${tool.name} needs a description.`);
  }
  if (
    typeof tool.annotations.readOnlyHint !== "boolean" ||
    tool.annotations.openWorldHint !== false ||
    typeof tool.annotations.destructiveHint !== "boolean"
  ) {
    throw new Error(`Marketplace annotations are missing or unsafe for ${tool.name}.`);
  }
  if (tool.annotations.readOnlyHint && tool.annotations.destructiveHint) {
    throw new Error(`Read-only marketplace tool ${tool.name} cannot be destructive.`);
  }
  const expectedSecurity = tool.access === "public" ? "noauth" : "oauth2";
  if (tool.securitySchemes[0]?.type !== expectedSecurity) {
    throw new Error(`Marketplace security scheme mismatch for ${tool.name}.`);
  }
  if (tool.access === "public" && !tool.readOnly) {
    throw new Error(`Write tool ${tool.name} cannot be public.`);
  }
}

const writes = catalog.filter((tool) => !tool.readOnly);
const staged = catalog.filter((tool) => tool.executionModel === "staged_write");
const destructive = catalog.filter((tool) => tool.destructive);
if (writes.length === 0 || staged.length === 0 || destructive.length === 0) {
  throw new Error("Full Sportfolio MCP parity must include write, staged, and destructive actions.");
}

console.log(
  `Plugin full-surface catalog verified: ${catalog.length} static tools, ${writes.length} writes, ${staged.length} staged actions, ${destructive.length} destructive actions.`,
);

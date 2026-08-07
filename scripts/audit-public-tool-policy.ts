process.env.NODE_ENV ||= "test";
process.env.DEV_DATABASE_URL ||= "postgresql://127.0.0.1:5432/sportfolio_audit";

const [
  { buildPublicPromptRegistry, buildPublicToolRegistry },
  { CURATED_MLB_TOOL_NAMES },
  { getDeniedPublicToolNames },
] = await Promise.all([
  import("../server/mcp/public-tool-registry"),
  import("../server/mcp/providers/mlb/provider"),
  import("../server/mcp/public-tool-policy"),
]);

const publicTools = buildPublicToolRegistry().map((tool) => tool.name);
const missingMlbTools = CURATED_MLB_TOOL_NAMES.filter((name) => !publicTools.includes(name));
if (missingMlbTools.length)
  throw new Error(`Missing semantic MLB tools: ${missingMlbTools.join(", ")}`);

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      publicTools,
      publicPrompts: buildPublicPromptRegistry().map((prompt) => prompt.name),
      deniedLegacyTools: getDeniedPublicToolNames(),
      semanticMlbTools: CURATED_MLB_TOOL_NAMES,
    },
    null,
    2,
  ),
);

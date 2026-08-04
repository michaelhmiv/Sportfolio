import {
  buildPublicPromptRegistry,
  buildPublicToolRegistry,
  resolveDynamicMlbPublicTools,
} from "../server/mcp/public-tool-registry";
import { getDeniedPublicToolNames } from "../server/mcp/public-tool-policy";

const dynamic = await resolveDynamicMlbPublicTools({
  getInternalMlbMcpToolCatalog: async () => {
    throw new Error("The audit must not invoke provider discovery.");
  },
});

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      publicTools: buildPublicToolRegistry().map((tool) => tool.name),
      publicPrompts: buildPublicPromptRegistry().map((prompt) => prompt.name),
      deniedLegacyTools: getDeniedPublicToolNames(),
      dynamicProviderTools: dynamic.tools.map((tool) => tool.toolName),
      dynamicSource: dynamic.sourceStatus,
    },
    null,
    2,
  ),
);

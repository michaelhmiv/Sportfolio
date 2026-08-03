import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDefaultPublicMcpDependencies } from "../public-tool-registry";
import type { PluginMcpContext } from "./context";
import {
  executePluginToolAdapter,
  getPluginToolInputSchema,
  getPluginToolOutputSchema,
  PLUGIN_TOOL_ADAPTERS,
} from "./adapters";
import { getPluginV1ToolPolicy } from "./capability-policy";

function securitySchemesFor(access: "public" | "oauth") {
  return access === "public"
    ? [{ type: "noauth" as const }]
    : [{ type: "oauth2" as const, scopes: ["openid"] }];
}

export async function registerPluginMarketplaceSurface(
  server: McpServer,
  context: PluginMcpContext,
): Promise<void> {
  const deps = createDefaultPublicMcpDependencies();

  for (const adapter of PLUGIN_TOOL_ADAPTERS) {
    const policy = getPluginV1ToolPolicy(adapter.name);
    if (!policy) {
      throw new Error(`Plugin adapter is not present in the marketplace policy: ${adapter.name}`);
    }

    const securitySchemes = securitySchemesFor(policy.access);
    server.registerTool(
      adapter.name,
      {
        title: adapter.title,
        description: adapter.description,
        inputSchema: getPluginToolInputSchema(adapter),
        outputSchema: getPluginToolOutputSchema(),
        securitySchemes,
        annotations: {
          title: adapter.title,
          readOnlyHint: policy.readOnly,
          openWorldHint: policy.openWorld,
          destructiveHint: policy.destructive,
        },
        _meta: {
          securitySchemes,
          marketplaceVersion: "v1",
          access: policy.access,
          dataClassification: policy.dataClassification,
          sourceTool: adapter.sourceTool,
        },
      } as any,
      async (args: Record<string, unknown>) =>
        (await executePluginToolAdapter(adapter, context, args || {}, deps)) as any,
    );
  }
}

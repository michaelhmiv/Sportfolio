import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createDefaultPublicMcpDependencies,
  type PublicMcpDependencies,
} from "../public-tool-registry";
import { observePluginMcpTool } from "../../observability/metrics";
import type { PluginMcpContext } from "./context";
import {
  executePluginToolAdapter,
  getPluginToolInputSchema,
  getPluginToolOutputSchema,
  PLUGIN_TOOL_ADAPTERS,
} from "./adapters";
import { getPluginV1ToolPolicy } from "./capability-policy";
import { PluginDeadlineError, withPluginDeadline } from "./runtime-guard";

function securitySchemesFor(access: "public" | "oauth") {
  return access === "public"
    ? [{ type: "noauth" as const }]
    : [{ type: "oauth2" as const, scopes: ["openid"] }];
}

function outputSize(value: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return undefined;
  }
}

export async function registerPluginMarketplaceSurface(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies = createDefaultPublicMcpDependencies(),
): Promise<void> {
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
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        try {
          const result = await withPluginDeadline(
            executePluginToolAdapter(adapter, context, args || {}, deps),
          );
          const isError = Boolean((result as { isError?: boolean }).isError);
          observePluginMcpTool({
            tool: adapter.name,
            status: isError ? "error" : "success",
            access: policy.access,
            durationMs: Date.now() - startedAt,
            outputBytes: outputSize(result),
          });
          return result as any;
        } catch (error) {
          const timeout = error instanceof PluginDeadlineError;
          observePluginMcpTool({
            tool: adapter.name,
            status: timeout ? "timeout" : "error",
            access: policy.access,
            durationMs: Date.now() - startedAt,
          });
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: timeout
                  ? "Sportfolio took too long to respond. Try the request again."
                  : "Sportfolio could not complete this read-only request.",
              },
            ],
            structuredContent: {
              code: timeout ? "tool_timeout" : "tool_execution_failed",
              message: timeout
                ? "The tool exceeded its execution deadline."
                : "The tool could not be completed.",
            },
          } as any;
        }
      },
    );
  }
}

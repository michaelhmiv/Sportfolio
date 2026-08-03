import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PublicMcpDependencies } from "../public-tool-registry";
import type { PluginMcpContext } from "./context";
import { registerPluginMarketplaceSurface } from "./registry";

const PLUGIN_SERVER_INFO = {
  name: "sportfolio-marketplace-plugin",
  version: "1.0.0",
} as const;

export async function createPluginMcpServer(
  context: PluginMcpContext,
  deps?: PublicMcpDependencies,
): Promise<McpServer> {
  const server = new McpServer(PLUGIN_SERVER_INFO, {
    capabilities: {
      logging: {},
    },
  });

  await registerPluginMarketplaceSurface(server, context, deps);
  return server;
}

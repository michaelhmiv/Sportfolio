import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PublicMcpDependencies } from "../public-tool-registry";
import type { PluginMcpContext } from "./context";
import { registerPluginMarketplaceSurface } from "./registry";
import { registerActionPluginUiSurface } from "./ui/action-surface";
import { registerGameplayPluginUiSurface } from "./ui/gameplay-surface";
import { registerOverviewPluginUiSurface } from "./ui/overview-surface";
import { registerSportsPluginUiSurface } from "./ui/sports-surface";
import { registerPluginUiSurface } from "./ui/surface";

const PLUGIN_SERVER_INFO = {
  name: "sportfolio-marketplace-plugin",
  version: "1.1.0",
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
  await registerPluginUiSurface(server, context);
  await registerSportsPluginUiSurface(server, context, deps);
  await registerActionPluginUiSurface(server, context);
  await registerGameplayPluginUiSurface(server, context, deps);
  await registerOverviewPluginUiSurface(server, context, deps);
  return server;
}

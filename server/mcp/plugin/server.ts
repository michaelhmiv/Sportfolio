import { McpServer } from "@modelcontextprotocol/server";
import type { McpServer as LegacyMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  version: "1.2.0",
} as const;

/**
 * Build the public ChatGPT/plugin server on the MCP v2 implementation so the
 * endpoint can serve the modern 2026-07-28 protocol. The registration modules
 * intentionally retain their v1 McpServer type imports while the rest of the
 * repository's sessionful /mcp API-token server remains on SDK v1. The public
 * registration APIs used by these modules are runtime-compatible across the
 * two SDK generations; this narrow cast keeps the migration isolated to the
 * plugin surface instead of forcing the legacy personal-token server to move
 * protocols at the same time.
 */
export async function createPluginMcpServer(
  context: PluginMcpContext,
  deps?: PublicMcpDependencies,
): Promise<McpServer> {
  const server = new McpServer(PLUGIN_SERVER_INFO, {
    capabilities: {
      logging: {},
    },
  });
  const registrationServer = server as unknown as LegacyMcpServer;

  await registerPluginMarketplaceSurface(registrationServer, context, deps);
  await registerPluginUiSurface(registrationServer, context);
  await registerSportsPluginUiSurface(registrationServer, context, deps);
  await registerActionPluginUiSurface(registrationServer, context);
  await registerGameplayPluginUiSurface(registrationServer, context, deps);
  await registerOverviewPluginUiSurface(registrationServer, context, deps);
  return server;
}

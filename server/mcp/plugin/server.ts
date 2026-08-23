import { McpServer } from "@modelcontextprotocol/server";
import type { McpServer as LegacyMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMarketResearchTools } from "../market-research-tools";
import type { PublicMcpDependencies } from "../public-tool-registry";
import type { PluginMcpContext } from "./context";
import { registerPluginMarketplaceSurface } from "./registry";
import { registerActionPluginUiSurface } from "./ui/action-surface";
import { registerGameplayPluginUiSurface } from "./ui/gameplay-surface";
import { registerOverviewPluginUiSurface } from "./ui/overview-surface";
import {
  registerSharedPluginUiResource,
  SPORTFOLIO_SHARED_UI_RESOURCE_URI,
} from "./ui/shared-resource";
import { registerSportsPluginUiSurface } from "./ui/sports-surface";
import { registerPluginUiSurface } from "./ui/surface";
import { normalizePresentationToolResult } from "./ui/presentation-contract";

const PLUGIN_SERVER_INFO = {
  name: "sportfolio-marketplace-plugin",
  version: "1.4.0",
} as const;

function canonicalPresentationServer(server: LegacyMcpServer): LegacyMcpServer {
  return new Proxy(server as any, {
    get(target, property) {
      if (property === "registerResource") {
        return (...args: any[]) => {
          const uri = args[1];
          if (
            typeof uri === "string" &&
            uri.startsWith("ui://sportfolio/") &&
            uri !== SPORTFOLIO_SHARED_UI_RESOURCE_URI
          ) {
            // Surface modules still own their semantic legacy URI constants for
            // catalogs/tests, but production advertises exactly one immutable
            // content-addressed MCP App resource. This prevents stale v1 resource
            // registrations from competing with current render-tool metadata.
            return undefined;
          }
          return target.registerResource(...args);
        };
      }
      if (property === "registerTool") {
        return (...args: any[]) => {
          const handler = args[2];
          if (typeof handler !== "function") {
            return target.registerTool(...args);
          }
          const wrappedHandler = async (...handlerArgs: any[]) =>
            normalizePresentationToolResult(await handler(...handlerArgs));
          return target.registerTool(args[0], args[1], wrappedHandler);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as LegacyMcpServer;
}

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

  // Register exactly one content-addressed MCP App resource. Every render tool
  // references this URI and selects its React surface from structuredContent.view.
  registerSharedPluginUiResource(registrationServer);

  await registerPluginMarketplaceSurface(registrationServer, context, deps);
  registerMarketResearchTools(registrationServer, { plugin: true });

  const presentationServer = canonicalPresentationServer(registrationServer);
  await registerPluginUiSurface(presentationServer, context);
  await registerSportsPluginUiSurface(presentationServer, context, deps);
  await registerActionPluginUiSurface(presentationServer, context);
  await registerGameplayPluginUiSurface(presentationServer, context, deps);
  await registerOverviewPluginUiSurface(presentationServer, context, deps);
  return server;
}

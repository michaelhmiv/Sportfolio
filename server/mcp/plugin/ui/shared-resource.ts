import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";

const widgetHash = createHash("sha256").update(SPORTFOLIO_WIDGET_HTML).digest("hex").slice(0, 16);

export const SPORTFOLIO_SHARED_UI_RESOURCE_URI = `ui://sportfolio/app/${widgetHash}.html`;

const SPORTFOLIO_UI_PREFIX = "ui://sportfolio/";
const SHARED_RESOURCE_NAME = "sportfolio-plugin-ui-shared";
const SHARED_RESOURCE_DESCRIPTION =
  "Shared Sportfolio interactive UI shell. The rendered view is selected from tool structured content.";

type MutableMcpServer = {
  registerResource: (...args: any[]) => any;
  registerTool: (...args: any[]) => any;
};

function isSportfolioUiUri(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SPORTFOLIO_UI_PREFIX);
}

/**
 * Register exactly one versioned Sportfolio MCP App resource and transparently
 * rewrite every Sportfolio presentation tool to reference it. Existing surface
 * modules can continue declaring semantic view URIs while the public MCP server
 * exposes a single cacheable-by-identity UI shell to clients.
 */
export function installSharedPluginUiResource(server: McpServer): void {
  const mutableServer = server as unknown as MutableMcpServer;
  const registerResource = mutableServer.registerResource.bind(server);
  const registerTool = mutableServer.registerTool.bind(server);

  registerResource(
    SHARED_RESOURCE_NAME,
    SPORTFOLIO_SHARED_UI_RESOURCE_URI,
    {
      mimeType: "text/html;profile=mcp-app",
      description: SHARED_RESOURCE_DESCRIPTION,
    },
    async () => ({
      contents: [
        {
          uri: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
          mimeType: "text/html;profile=mcp-app",
          text: SPORTFOLIO_WIDGET_HTML,
          _meta: {
            ui: {
              domain: "https://www.sportfolio.market",
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
            "openai/widgetDescription": SHARED_RESOURCE_DESCRIPTION,
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    }),
  );

  mutableServer.registerResource = (...args: any[]) => {
    const uri = args[1];
    if (isSportfolioUiUri(uri)) {
      // All Sportfolio presentation resources contain the same generated shell.
      // Suppress duplicate registrations so discovery exposes a single resource.
      return undefined;
    }
    return registerResource(...args);
  };

  mutableServer.registerTool = (name: string, config: any, handler: any) => {
    const meta = config?._meta;
    const uiResourceUri = meta?.ui?.resourceUri;
    const outputTemplate = meta?.["openai/outputTemplate"];

    if (!isSportfolioUiUri(uiResourceUri) && !isSportfolioUiUri(outputTemplate)) {
      return registerTool(name, config, handler);
    }

    const nextMeta = {
      ...meta,
      ui: {
        ...(meta?.ui || {}),
        resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
      },
      "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,
    };

    return registerTool(name, { ...config, _meta: nextMeta }, handler);
  };
}

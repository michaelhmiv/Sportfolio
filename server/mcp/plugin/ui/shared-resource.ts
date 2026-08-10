import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildSportfolioWidgetHtml } from "./generated-widget";

const DEFAULT_ASSET_ORIGIN = "https://www.sportfolio.market";

function resolveAssetOrigin(): string {
  const configured =
    process.env.PUBLIC_SITE_URL || process.env.SITE_URL || process.env.VITE_PUBLIC_SITE_URL;
  if (!configured?.trim()) return DEFAULT_ASSET_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_ASSET_ORIGIN;
  }
}

const assetOrigin = resolveAssetOrigin();
const widgetHtml = buildSportfolioWidgetHtml(assetOrigin);
const widgetHash = createHash("sha256").update(widgetHtml).digest("hex").slice(0, 16);

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
 * Register exactly one content-addressed Sportfolio MCP App loader and
 * transparently rewrite every presentation tool to reference it. The loader is
 * intentionally tiny; view-specific ESM chunks are served from Sportfolio's
 * immutable /assets path and allowed through the declared widget CSP.
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
          text: widgetHtml,
          _meta: {
            ui: {
              domain: assetOrigin,
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [assetOrigin],
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

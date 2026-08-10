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

export const SPORTFOLIO_WIDGET_ASSET_ORIGIN = resolveAssetOrigin();
const widgetHtml = buildSportfolioWidgetHtml(SPORTFOLIO_WIDGET_ASSET_ORIGIN);
const widgetHash = createHash("sha256").update(widgetHtml).digest("hex").slice(0, 16);

export const SPORTFOLIO_SHARED_UI_RESOURCE_URI = `ui://sportfolio/app/${widgetHash}.html`;
export const SPORTFOLIO_UI_MIME_TYPE = "text/html;profile=mcp-app";

const SHARED_RESOURCE_NAME = "sportfolio-plugin-ui-shared";
const SHARED_RESOURCE_DESCRIPTION =
  "Shared Sportfolio interactive UI shell. The rendered view is selected from tool structured content.";

export function buildPluginUiResourceMeta(description = SHARED_RESOURCE_DESCRIPTION) {
  const assetOrigin = SPORTFOLIO_WIDGET_ASSET_ORIGIN;
  return {
    ui: {
      domain: assetOrigin,
      prefersBorder: true,
      csp: {
        connectDomains: [],
        resourceDomains: [assetOrigin],
      },
    },
    "openai/widgetDescription": description,
    "openai/widgetPrefersBorder": true,
  };
}

/** Register the canonical content-addressed MCP App resource exactly once. */
export function registerSharedPluginUiResource(server: McpServer): void {
  server.registerResource(
    SHARED_RESOURCE_NAME,
    SPORTFOLIO_SHARED_UI_RESOURCE_URI,
    {
      mimeType: SPORTFOLIO_UI_MIME_TYPE,
      description: SHARED_RESOURCE_DESCRIPTION,
    },
    async () =>
      ({
        contents: [
          {
            uri: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
            mimeType: SPORTFOLIO_UI_MIME_TYPE,
            text: widgetHtml,
            _meta: buildPluginUiResourceMeta(),
          },
        ],
      }) as any,
  );
}

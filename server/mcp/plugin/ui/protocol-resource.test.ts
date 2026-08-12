import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createPluginMcpServer } from "../server";
import {
  SPORTFOLIO_SHARED_UI_RESOURCE_URI,
  SPORTFOLIO_WIDGET_ASSET_ORIGIN,
} from "./shared-resource";

const PROTOCOL_VERSION = "2026-07-28";
let requestId = 0;

function requestMeta() {
  return {
    "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "plugin-ui-protocol-test", version: "1.0.0" },
  };
}

async function call(method: string, params: Record<string, unknown> = {}) {
  requestId += 1;
  const server = await createPluginMcpServer({ auth: null, requestId: `ui-protocol-${requestId}` });
  const handler = createMcpHandler(() => server);
  try {
    const response = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_VERSION,
          "mcp-method": method,
          ...(typeof params.uri === "string" ? { "mcp-name": params.uri } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method,
          params: { ...params, _meta: requestMeta() },
        }),
      }),
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`MCP ${method} returned HTTP ${response.status}: ${text}`);
    }
    const payload = response.headers.get("content-type")?.includes("text/event-stream")
      ? JSON.parse(
          text
            .split(/\r?\n/)
            .find((line) => line.startsWith("data:"))!
            .slice(5)
            .trim(),
        )
      : JSON.parse(text);
    expect(payload.error).toBeUndefined();
    return payload.result;
  } finally {
    await handler.close();
  }
}

describe("Sportfolio MCP v2 UI resource contract", () => {
  it("advertises the canonical shared resource from every presentation tool", async () => {
    const tools = await call("tools/list");
    const presentationTools = tools.tools.filter((tool: any) => tool.name.startsWith("render_"));
    expect(presentationTools.length).toBeGreaterThan(0);
    for (const tool of presentationTools) {
      expect(tool._meta?.ui?.resourceUri).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
      expect(tool._meta?.["openai/outputTemplate"]).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
      expect(tool._meta?.ui?.resourceUri).not.toMatch(/\/v\d+\.html$/);
    }
  });

  it("lists only one Sportfolio UI resource and reads its self-contained MCP App metadata", async () => {
    const resources = await call("resources/list");
    const sportfolioUiResources = resources.resources.filter((resource: any) =>
      String(resource.uri || "").startsWith("ui://sportfolio/"),
    );
    expect(sportfolioUiResources).toHaveLength(1);
    expect(sportfolioUiResources[0].uri).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
    expect(SPORTFOLIO_SHARED_UI_RESOURCE_URI).toMatch(
      /^ui:\/\/sportfolio\/app\/[a-f0-9]{16}\.html$/,
    );

    const resource = await call("resources/read", { uri: SPORTFOLIO_SHARED_UI_RESOURCE_URI });
    expect(resource.contents[0]).toMatchObject({
      uri: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
      mimeType: "text/html;profile=mcp-app",
      _meta: {
        ui: {
          domain: SPORTFOLIO_WIDGET_ASSET_ORIGIN,
          csp: { connectDomains: [], resourceDomains: [SPORTFOLIO_WIDGET_ASSET_ORIGIN] },
        },
      },
    });
    expect(resource.contents[0].text).toContain('<script type="module">');
    expect(resource.contents[0].text).not.toMatch(/<script[^>]+src=/i);
  });
});

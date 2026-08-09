import { createMcpHandler } from "@modelcontextprotocol/server";
import { createPluginMcpServer } from "../server/mcp/plugin/server";

const PROTOCOL_VERSION = "2026-07-28";

function requestMeta() {
  return {
    "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": {
      name: "sportfolio-modern-mcp-smoke",
      version: "1.0.0",
    },
  };
}

function parseJsonRpcBody(bodyText: string, contentType: string): any {
  if (contentType.includes("text/event-stream")) {
    const dataLine = bodyText
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:"));
    if (!dataLine) {
      throw new Error(`SSE response did not contain a data event: ${bodyText.slice(0, 500)}`);
    }
    return JSON.parse(dataLine.slice(5).trim());
  }
  return JSON.parse(bodyText);
}

async function callModernMcp(method: string, id: number) {
  const server = await createPluginMcpServer({
    auth: null,
    requestId: `modern-mcp-smoke-${id}`,
  });
  const handler = createMcpHandler(() => server);

  try {
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params: { _meta: requestMeta() },
        }),
      }),
    );

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`${method} returned HTTP ${response.status}: ${bodyText}`);
    }

    let body: any;
    try {
      body = parseJsonRpcBody(bodyText, response.headers.get("content-type") ?? "");
    } catch (error) {
      throw new Error(
        `${method} returned an unreadable response: ${bodyText.slice(0, 500)}`,
        { cause: error },
      );
    }

    if (body?.error) {
      throw new Error(`${method} returned JSON-RPC error: ${JSON.stringify(body.error)}`);
    }
    if (!body?.result) {
      throw new Error(`${method} response did not contain a JSON-RPC result`);
    }

    return body.result;
  } finally {
    await handler.close();
  }
}

console.log(`[MCP_MODERN_SMOKE] Running protocol=${PROTOCOL_VERSION}`);

const discover = await callModernMcp("server/discover", 1);
if (!Array.isArray(discover.supportedVersions) || !discover.supportedVersions.includes(PROTOCOL_VERSION)) {
  throw new Error(
    `server/discover did not advertise ${PROTOCOL_VERSION}: ${JSON.stringify(discover.supportedVersions)}`,
  );
}
if (!discover.capabilities?.tools) {
  throw new Error(`server/discover did not advertise tools capability: ${JSON.stringify(discover.capabilities)}`);
}

const toolList = await callModernMcp("tools/list", 2);
if (!Array.isArray(toolList.tools) || toolList.tools.length === 0) {
  throw new Error(`tools/list returned no tools: ${JSON.stringify(toolList)}`);
}

console.log(
  `[MCP_MODERN_SMOKE] PASS protocol=${PROTOCOL_VERSION} tools=${toolList.tools.length}`,
);

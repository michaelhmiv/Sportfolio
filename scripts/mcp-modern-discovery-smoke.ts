import { desc } from "drizzle-orm";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { authOauthRefreshTokens } from "../shared/schema";
import { db } from "../server/db";
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
    const dataLine = bodyText.split(/\r?\n/).find((line) => line.startsWith("data:"));
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
    const response = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_VERSION,
          "mcp-method": method,
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
      throw new Error(`${method} returned an unreadable response: ${bodyText.slice(0, 500)}`, {
        cause: error,
      });
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
if (
  !Array.isArray(discover.supportedVersions) ||
  !discover.supportedVersions.includes(PROTOCOL_VERSION)
) {
  throw new Error(
    `server/discover did not advertise ${PROTOCOL_VERSION}: ${JSON.stringify(discover.supportedVersions)}`,
  );
}
if (!discover.capabilities?.tools) {
  throw new Error(
    `server/discover did not advertise tools capability: ${JSON.stringify(discover.capabilities)}`,
  );
}

const toolList = await callModernMcp("tools/list", 2);
if (!Array.isArray(toolList.tools) || toolList.tools.length === 0) {
  throw new Error(`tools/list returned no tools: ${JSON.stringify(toolList)}`);
}

console.log(`[MCP_MODERN_SMOKE] PASS protocol=${PROTOCOL_VERSION} tools=${toolList.tools.length}`);

// Diagnostic only: scopes are authorization metadata, not credentials. Read the
// most recent persisted refresh grants so deployments can prove whether Better
// Auth retained the scopes from the OAuth authorization request without logging
// user IDs, refresh tokens, access tokens, authorization codes, or secrets.
const recentScopeGrants = await db
  .select({
    clientId: authOauthRefreshTokens.clientId,
    scopes: authOauthRefreshTokens.scopes,
    createdAt: authOauthRefreshTokens.createdAt,
    revoked: authOauthRefreshTokens.revoked,
  })
  .from(authOauthRefreshTokens)
  .orderBy(desc(authOauthRefreshTokens.createdAt))
  .limit(3);

console.log(
  `[OAUTH_SCOPE_DIAGNOSTIC] ${JSON.stringify(
    recentScopeGrants.map((grant) => ({
      clientId: grant.clientId,
      scopes: grant.scopes,
      createdAt: grant.createdAt,
      revoked: Boolean(grant.revoked),
    })),
  )}`,
);

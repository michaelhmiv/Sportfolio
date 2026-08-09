import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";
import { registerPluginMcpRoutes } from "../server/routes/plugin-mcp";
import { buildPluginStaticCatalog } from "../server/mcp/plugin/registry";

async function startServer() {
  process.env.PLUGIN_MCP_ENABLED = "true";
  process.env.PLUGIN_OAUTH_ISSUER = "https://www.sportfolio.market/api/auth/better";
  process.env.PLUGIN_MCP_RESOURCE = "https://www.sportfolio.market/mcp/plugin";

  const app = express();
  app.use(express.json());
  registerPluginMcpRoutes(app);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind smoke server.");
  return {
    server,
    url: `http://127.0.0.1:${address.port}/mcp/plugin`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main() {
  const server = await startServer();
  const transport = new StreamableHTTPClientTransport(new URL(server.url));
  const client = new Client({ name: "sportfolio-plugin-smoke", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const expectedStatic = buildPluginStaticCatalog()
      .map((entry) => entry.name)
      .sort();
    const actual = listed.tools.map((tool) => tool.name).sort();

    for (const expectedTool of expectedStatic) {
      if (!actual.includes(expectedTool)) {
        throw new Error(`Missing required static plugin tool ${expectedTool}.`);
      }
    }

    for (const publicName of ["search_docs", "search_players", "get_games_today"]) {
      const tool = listed.tools.find((entry) => entry.name === publicName);
      if (!tool) throw new Error(`Missing public plugin tool ${publicName}.`);
      const schemes = (tool as any).securitySchemes || (tool._meta as any)?.securitySchemes;
      if (!Array.isArray(schemes) || !schemes.some((scheme) => scheme?.type === "noauth")) {
        throw new Error(`${publicName} must advertise noauth.`);
      }
    }

    for (const protectedName of ["get_portfolio_summary", "stage_market_buy"]) {
      const tool = listed.tools.find((entry) => entry.name === protectedName);
      if (!tool) throw new Error(`Missing protected plugin tool ${protectedName}.`);
      const schemes = (tool as any).securitySchemes || (tool._meta as any)?.securitySchemes;
      if (!Array.isArray(schemes) || !schemes.some((scheme) => scheme?.type === "oauth2")) {
        throw new Error(`${protectedName} must advertise OAuth.`);
      }
    }

    for (const writeName of ["stage_market_buy", "stage_scout_assignment"]) {
      const tool = listed.tools.find((entry) => entry.name === writeName);
      if (!tool) throw new Error(`Missing required action tool ${writeName}.`);
      if ((tool.annotations as Record<string, unknown> | undefined)?.readOnlyHint !== false) {
        throw new Error(`${writeName} must be declared as a write action.`);
      }
    }

    const confirm = listed.tools.find((tool) => tool.name === "confirm_pending_action");
    if ((confirm?.annotations as Record<string, unknown> | undefined)?.destructiveHint !== true) {
      throw new Error("confirm_pending_action must be declared destructive.");
    }

    const docs = await client.callTool({
      name: "search_docs",
      arguments: { query: "boost" },
    });
    if (docs.isError) throw new Error("Public documentation tool failed during smoke test.");

    for (const protectedTool of ["get_portfolio_summary", "stage_market_buy"]) {
      const protectedResult = await client.callTool({
        name: protectedTool,
        arguments: protectedTool === "stage_market_buy" ? { playerId: "player_1", amount: 25 } : {},
      });
      if (!protectedResult.isError) {
        throw new Error(`${protectedTool} succeeded without OAuth.`);
      }
      const meta = protectedResult._meta as Record<string, unknown> | undefined;
      if (!Array.isArray(meta?.["mcp/www_authenticate"])) {
        throw new Error(`${protectedTool} did not return an MCP OAuth challenge.`);
      }
    }

    const sessionHeaderResponse = await fetch(server.url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-method": "tools/list",
        "mcp-protocol-version": "2026-07-28",
        "mcp-session-id": "not-allowed",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    if (sessionHeaderResponse.status < 400 || sessionHeaderResponse.status >= 500) {
      throw new Error(
        `Stateless endpoint did not reject an MCP session ID: ${sessionHeaderResponse.status}.`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          staticToolCount: expectedStatic.length,
          resolvedToolCount: actual.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await transport.close().catch(() => undefined);
    await server.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import http from "node:http";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { registerPluginMcpRoutes } from "../server/routes/plugin-mcp";
import { buildPublicToolRegistry } from "../server/mcp/public-tool-registry";

async function startServer() {
  process.env.PLUGIN_MCP_ENABLED = "true";
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerPluginMcpRoutes(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve smoke server address.");
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp/plugin`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function main() {
  const server = await startServer();
  const transport = new StreamableHTTPClientTransport(new URL(server.url));
  const client = new Client({ name: "sportfolio-plugin-smoke", version: "2.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const expectedStatic = buildPublicToolRegistry()
      .map((tool) => tool.name)
      .sort();
    const actual = listed.tools.map((tool) => tool.name).sort();
    const missing = expectedStatic.filter((name) => !actual.includes(name));
    if (missing.length > 0) {
      throw new Error(`Marketplace is missing site MCP tools: ${missing.join(", ")}.`);
    }
    if (new Set(actual).size !== actual.length) {
      throw new Error("Marketplace tool list contains duplicate names.");
    }

    for (const tool of listed.tools) {
      const annotations = tool.annotations as Record<string, unknown> | undefined;
      if (
        typeof annotations?.readOnlyHint !== "boolean" ||
        annotations?.openWorldHint !== false ||
        typeof annotations?.destructiveHint !== "boolean"
      ) {
        throw new Error(`Unsafe or missing annotations on ${tool.name}.`);
      }
      if (!tool.outputSchema) throw new Error(`Missing output schema on ${tool.name}.`);
    }

    for (const writeName of [
      "stage_market_buy",
      "stage_market_sell",
      "stage_scout_assignment",
      "stage_daily_boost_assign",
      "confirm_pending_action",
    ]) {
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
      headers: { "content-type": "application/json", "mcp-session-id": "not-allowed" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    if (sessionHeaderResponse.status !== 400) {
      throw new Error(
        `Stateless endpoint accepted an MCP session ID: ${sessionHeaderResponse.status}.`,
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
  process.exitCode = 1;
});

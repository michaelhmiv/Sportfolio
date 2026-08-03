import http from "node:http";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { registerPluginMcpRoutes } from "../server/routes/plugin-mcp";
import { PLUGIN_V1_TOOLS } from "../server/mcp/plugin/capability-policy";

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
  if (!address || typeof address === "string") throw new Error("Unable to resolve smoke server address.");
  return {
    url: `http://127.0.0.1:${address.port}/mcp/plugin`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function main() {
  const server = await startServer();
  const transport = new StreamableHTTPClientTransport(new URL(server.url));
  const client = new Client({ name: "sportfolio-plugin-smoke", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const expected = [...PLUGIN_V1_TOOLS].map((tool) => tool.name).sort();
    const actual = listed.tools.map((tool) => tool.name).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Marketplace tool list mismatch. Expected ${expected.join(", ")}; received ${actual.join(", ")}.`);
    }

    for (const tool of listed.tools) {
      const annotations = tool.annotations as Record<string, unknown> | undefined;
      if (annotations?.readOnlyHint !== true || annotations?.openWorldHint !== false || annotations?.destructiveHint !== false) {
        throw new Error(`Unsafe or missing annotations on ${tool.name}.`);
      }
      if (!tool.outputSchema) throw new Error(`Missing output schema on ${tool.name}.`);
    }

    const docs = await client.callTool({
      name: "search_sportfolio_docs",
      arguments: { query: "boost" },
    });
    if (docs.isError) throw new Error("Public documentation tool failed during smoke test.");

    const protectedResult = await client.callTool({
      name: "get_my_portfolio",
      arguments: {},
    });
    if (!protectedResult.isError) throw new Error("Protected tool succeeded without OAuth.");
    const meta = protectedResult._meta as Record<string, unknown> | undefined;
    if (!Array.isArray(meta?.["mcp/www_authenticate"])) {
      throw new Error("Protected tool did not return an MCP OAuth challenge.");
    }

    const sessionHeaderResponse = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-session-id": "not-allowed" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    if (sessionHeaderResponse.status !== 400) {
      throw new Error(`Stateless endpoint accepted an MCP session ID: ${sessionHeaderResponse.status}.`);
    }

    console.log(JSON.stringify({ ok: true, toolCount: actual.length }, null, 2));
  } finally {
    await transport.close().catch(() => undefined);
    await server.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

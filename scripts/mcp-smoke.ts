import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CURATED_MLB_TOOL_NAMES } from "../server/mcp/providers/mlb/provider";
import {
  buildPublicMcpToolRegistry,
  getPublicMcpToolFixtures,
} from "../server/mcp/public-tool-registry";
import { startMockMcpHttpServer } from "../server/mcp/testing";

function smokeArgs(
  toolName: string,
  fixtures: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  // Economy V2 retired the old stacking article. Keep the protocol smoke pinned
  // to a currently published, stable docs article so it tests transport/tool
  // execution instead of intentionally requesting removed documentation.
  if (toolName === "get_doc_article") {
    return { section: "gameplay", slug: "sports-and-slates" };
  }
  return fixtures[toolName] || {};
}

async function main() {
  const server = await startMockMcpHttpServer();
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: { Authorization: `Bearer ${server.authToken}` } },
  });
  const client = new Client({ name: "sportfolio-mcp-smoke", version: "1.0.0" });
  const failures: Array<{ toolName: string; message: string }> = [];
  try {
    await client.connect(transport);
    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of CURATED_MLB_TOOL_NAMES) {
      if (!listed.includes(name))
        failures.push({ toolName: name, message: "Missing semantic MLB tool." });
    }
    const fixtures = getPublicMcpToolFixtures();
    const deferred = new Set([
      "get_pending_action",
      "confirm_pending_action",
      "cancel_pending_action",
    ]);
    let transactionId = "";
    for (const tool of buildPublicMcpToolRegistry()) {
      if (deferred.has(tool.name)) continue;
      try {
        const result = await client.callTool({
          name: tool.name,
          arguments: smokeArgs(tool.name, fixtures),
        });
        if (result.isError) {
          failures.push({ toolName: tool.name, message: "Tool returned an error result." });
          continue;
        }
        const structured = (result.structuredContent || {}) as Record<string, unknown>;
        if (structured.confirmationRequired && typeof structured.transactionId === "string") {
          transactionId = structured.transactionId;
        }
      } catch (error) {
        failures.push({
          toolName: tool.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!transactionId) {
      failures.push({
        toolName: "stage_market_buy",
        message: "No staged transaction was created.",
      });
    } else {
      for (const name of ["get_pending_action", "confirm_pending_action"] as const) {
        const result = await client.callTool({ name, arguments: { transactionId } });
        if (result.isError)
          failures.push({ toolName: name, message: "Tool returned an error result." });
      }
    }

    const stagedForCancellation = await client.callTool({
      name: "stage_market_buy",
      arguments: fixtures.stage_market_buy,
    });
    const cancelTransactionId = (stagedForCancellation.structuredContent as Record<string, unknown>)
      ?.transactionId;
    if (typeof cancelTransactionId !== "string") {
      failures.push({
        toolName: "cancel_pending_action",
        message: "Could not create a transaction for cancellation.",
      });
    } else {
      const cancelled = await client.callTool({
        name: "cancel_pending_action",
        arguments: { transactionId: cancelTransactionId },
      });
      if (cancelled.isError) {
        failures.push({
          toolName: "cancel_pending_action",
          message: "Tool returned an error result.",
        });
      }
    }
  } finally {
    await transport.close().catch(() => undefined);
    await server.close();
  }
  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        toolCount: buildPublicMcpToolRegistry().length,
        mlbToolCount: CURATED_MLB_TOOL_NAMES.length,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

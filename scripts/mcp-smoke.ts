import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  buildPublicMcpToolRegistry,
  getPublicMcpToolFixtures,
} from "../server/mcp/public-tool-registry";
import { startMockMcpHttpServer } from "../server/mcp/testing";

type OpenClient = {
  client: Client;
  transport: StreamableHTTPClientTransport;
};

async function connectClient(url: string, authToken: string): Promise<OpenClient> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  });
  const client = new Client({
    name: "sportfolio-mcp-smoke",
    version: "1.0.0",
  });
  await client.connect(transport);
  return { client, transport };
}

async function closeClient(openClient: OpenClient | null) {
  if (openClient) {
    await openClient.transport.close();
  }
}

async function main() {
  const fixtures = getPublicMcpToolFixtures();
  const toolNames = buildPublicMcpToolRegistry().map((tool) => tool.name);
  const failures: Array<{ toolName: string; message: string }> = [];
  const protocolServer = await startMockMcpHttpServer();
  let protocolClient: OpenClient | null = null;

  try {
    protocolClient = await connectClient(protocolServer.url, protocolServer.authToken);
    await protocolClient.client.listTools();
    await protocolClient.client.listPrompts();
    await protocolClient.client.listResources();
    await protocolClient.client.readResource({ uri: "sportfolio://docs/index" });
    await protocolClient.client.getPrompt({ name: "review_setup", arguments: {} });
  } finally {
    await closeClient(protocolClient);
    await protocolServer.close();
  }

  for (const toolName of toolNames) {
    const server = await startMockMcpHttpServer();
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const result = await openClient.client.callTool({
        name: toolName,
        arguments: fixtures[toolName],
      });

      if (result.isError) {
        failures.push({
          toolName,
          message:
            typeof result.content?.[0]?.type === "string" && result.content[0].type === "text"
              ? result.content[0].text
              : "Tool returned an MCP error result.",
        });
      }
    } catch (error) {
      failures.push({
        toolName,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  }

  if (failures.length > 0) {
    console.error("[mcp:smoke] Failures detected:");
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        toolCount: toolNames.length,
      },
      null,
      2,
    ),
  );
}

void main();

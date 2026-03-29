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
    await protocolClient.client.readResource({ uri: "sportfolio://tool-catalog" });
    await protocolClient.client.getPrompt({ name: "review_setup", arguments: {} });
  } finally {
    await closeClient(protocolClient);
    await protocolServer.close();
  }

  const dynamicServer = await startMockMcpHttpServer({
    mlbTools: {
      toolCatalog: [
        {
          toolName: "mlb_mcp__get_schedule",
          category: "read",
          description: "Get the MLB schedule.",
          whenToUse: ["Use when the caller wants probable pitchers or the slate."],
          whenNotToUse: [],
          examplePrompts: ["who are the probable pitchers today?"],
          requiresConfirmation: false,
          riskLevel: "low",
          resultShapeHint: "dates[].games[] with probable pitchers",
          inputSchema: {
            type: "object",
            properties: {
              date: {
                type: "string",
                description: "Target date in YYYY-MM-DD format.",
              },
            },
            required: ["date"],
          },
        },
      ],
    },
  });
  let dynamicClient: OpenClient | null = null;

  try {
    dynamicClient = await connectClient(dynamicServer.url, dynamicServer.authToken);
    const tools = await dynamicClient.client.listTools();
    if (!tools.tools.some((tool) => tool.name === "mlb_mcp__get_schedule")) {
      failures.push({
        toolName: "dynamic_mlb_tool_listing",
        message: "Dynamic MLB MCP tool was not listed on the public MCP surface.",
      });
    }

    const capabilities = await dynamicClient.client.readResource({
      uri: "sportfolio://capabilities",
    });
    const actionSurface = await dynamicClient.client.readResource({
      uri: "sportfolio://action-surface",
    });
    const toolCatalog = await dynamicClient.client.readResource({
      uri: "sportfolio://tool-catalog",
    });
    const dynamicResult = await dynamicClient.client.callTool({
      name: "mlb_mcp__get_schedule",
      arguments: {
        date: "2026-03-28",
      },
    });

    if (dynamicResult.isError) {
      failures.push({
        toolName: "dynamic_mlb_tool_execution",
        message: "Dynamic MLB MCP tool returned an MCP error result during smoke.",
      });
    }

    const capabilityPayload = JSON.parse(String(capabilities.contents[0]?.text)) as {
      included?: Array<Record<string, unknown>>;
    };
    if (
      !Array.isArray(capabilityPayload.included) ||
      !capabilityPayload.included.some((entry) => entry.capabilityId === "mlb_mcp__get_schedule")
    ) {
      failures.push({
        toolName: "dynamic_capabilities_resource",
        message: "Dynamic MLB MCP tool was not included in sportfolio://capabilities.",
      });
    }

    const actionSurfacePayload = JSON.parse(String(actionSurface.contents[0]?.text)) as {
      tools?: Array<Record<string, unknown>>;
    };
    if (
      !Array.isArray(actionSurfacePayload.tools) ||
      !actionSurfacePayload.tools.some((entry) => entry.name === "mlb_mcp__get_schedule")
    ) {
      failures.push({
        toolName: "dynamic_action_surface_resource",
        message: "Dynamic MLB MCP tool was not included in sportfolio://action-surface.",
      });
    }

    const toolCatalogPayload = JSON.parse(String(toolCatalog.contents[0]?.text)) as {
      tools?: Array<Record<string, unknown>>;
    };
    if (
      !Array.isArray(toolCatalogPayload.tools) ||
      !toolCatalogPayload.tools.some(
        (entry) =>
          entry.name === "mlb_mcp__get_schedule" &&
          Array.isArray(entry.examplePrompts) &&
          entry.examplePrompts.includes("who are the probable pitchers today?"),
      )
    ) {
      failures.push({
        toolName: "dynamic_tool_catalog_resource",
        message: "Dynamic MLB MCP tool metadata was not included in sportfolio://tool-catalog.",
      });
    }
  } finally {
    await closeClient(dynamicClient);
    await dynamicServer.close();
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

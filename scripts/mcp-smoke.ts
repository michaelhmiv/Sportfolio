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

type SmokeFailure = {
  toolName: string;
  message: string;
};

const RETIRED_PROMPTS = new Set(["review_setup", "review_idle_cash"]);
const RAW_PROVIDER_PREFIX = "mlb_mcp__";

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

function parseResourcePayload(contents: Array<{ text?: string }>): Record<string, unknown> {
  return JSON.parse(String(contents[0]?.text || "{}")) as Record<string, unknown>;
}

function containsRawProviderEntry(entries: unknown, key: "name" | "capabilityId"): boolean {
  return (
    Array.isArray(entries) &&
    entries.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>)[key] === "string" &&
        String((entry as Record<string, unknown>)[key]).startsWith(RAW_PROVIDER_PREFIX),
    )
  );
}

async function main() {
  const fixtures = getPublicMcpToolFixtures();
  const toolNames = buildPublicMcpToolRegistry().map((tool) => tool.name);
  const failures: SmokeFailure[] = [];
  const protocolServer = await startMockMcpHttpServer();
  let protocolClient: OpenClient | null = null;

  try {
    protocolClient = await connectClient(protocolServer.url, protocolServer.authToken);
    const listedTools = await protocolClient.client.listTools();
    const listedPrompts = await protocolClient.client.listPrompts();
    await protocolClient.client.listResources();
    await protocolClient.client.readResource({ uri: "sportfolio://docs/index" });
    await protocolClient.client.readResource({ uri: "sportfolio://tool-catalog" });

    for (const prompt of listedPrompts.prompts) {
      if (RETIRED_PROMPTS.has(prompt.name)) {
        failures.push({
          toolName: "retired_prompt_listing",
          message: `Retired prompt ${prompt.name} remains publicly listed.`,
        });
      }
    }

    if (!listedPrompts.prompts.some((prompt) => prompt.name === "find_boost_candidates")) {
      failures.push({
        toolName: "approved_prompt_listing",
        message: "Approved find_boost_candidates prompt was not listed.",
      });
    }

    if (listedTools.tools.some((tool) => tool.name.startsWith(RAW_PROVIDER_PREFIX))) {
      failures.push({
        toolName: "raw_provider_listing",
        message: "A raw MLB provider tool was listed on the default public surface.",
      });
    }
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
    if (tools.tools.some((tool) => tool.name.startsWith(RAW_PROVIDER_PREFIX))) {
      failures.push({
        toolName: "dynamic_mlb_tool_listing",
        message: "A configured raw MLB provider tool leaked onto the public MCP surface.",
      });
    }

    const capabilities = parseResourcePayload(
      (await dynamicClient.client.readResource({ uri: "sportfolio://capabilities" })).contents,
    );
    const actionSurface = parseResourcePayload(
      (await dynamicClient.client.readResource({ uri: "sportfolio://action-surface" })).contents,
    );
    const toolCatalog = parseResourcePayload(
      (await dynamicClient.client.readResource({ uri: "sportfolio://tool-catalog" })).contents,
    );

    if (containsRawProviderEntry(capabilities.included, "capabilityId")) {
      failures.push({
        toolName: "dynamic_capabilities_resource",
        message: "A raw MLB provider tool leaked into sportfolio://capabilities.",
      });
    }
    if (containsRawProviderEntry(actionSurface.tools, "name")) {
      failures.push({
        toolName: "dynamic_action_surface_resource",
        message: "A raw MLB provider tool leaked into sportfolio://action-surface.",
      });
    }
    if (containsRawProviderEntry(toolCatalog.tools, "name")) {
      failures.push({
        toolName: "dynamic_tool_catalog_resource",
        message: "A raw MLB provider tool leaked into sportfolio://tool-catalog.",
      });
    }

    try {
      const rawProviderResult = await dynamicClient.client.callTool({
        name: "mlb_mcp__get_schedule",
        arguments: { date: "2026-03-28" },
      });
      if (!rawProviderResult.isError) {
        failures.push({
          toolName: "dynamic_mlb_tool_execution",
          message: "A raw MLB provider tool could still be executed through the public MCP.",
        });
      }
    } catch {
      // Also acceptable: the MCP client rejects the call because the tool is not registered.
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
        rawProviderToolsPublic: false,
        retiredPromptsPublic: false,
      },
      null,
      2,
    ),
  );
}

void main();

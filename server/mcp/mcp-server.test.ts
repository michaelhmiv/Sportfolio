import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import {
  buildPublicMcpToolRegistry,
  evaluateGameplayCapabilityParity,
  getPublicMcpToolFixtures,
} from "./public-tool-registry";
import { startMockMcpHttpServer } from "./testing";

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
    name: "sportfolio-mcp-test-client",
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

describe("sportfolio MCP server", () => {
  it("keeps the public registry aligned with the gameplay capability matrix", () => {
    const parity = evaluateGameplayCapabilityParity();
    expect(parity.ok).toBe(true);
    expect(parity.missingFromRegistry).toEqual([]);
    expect(parity.extraInRegistry).toEqual([]);
    expect(parity.missingPromptNames).toEqual([]);
    expect(parity.extraPromptNames).toEqual([]);
    expect(parity.missingResourceUris).toEqual([]);
    expect(parity.extraResourceUris).toEqual([]);
  });

  it("rejects unauthenticated MCP requests", async () => {
    const server = await startMockMcpHttpServer();
    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "unauthenticated-test",
              version: "1.0.0",
            },
          },
        }),
      });

      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("supports session-backed streamable HTTP clients", async () => {
    const server = await startMockMcpHttpServer();

    try {
      const initializeResponse = await fetch(server.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${server.authToken}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "streamable-http-session-test",
              version: "1.0.0",
            },
          },
        }),
      });

      expect(initializeResponse.status).toBe(200);
      expect(initializeResponse.headers.get("content-type")).toContain("application/json");

      const sessionId = initializeResponse.headers.get("mcp-session-id");
      expect(typeof sessionId).toBe("string");
      expect(sessionId).toBeTruthy();

      const initializePayload = (await initializeResponse.json()) as {
        result?: { serverInfo?: { name?: string } };
      };
      expect(initializePayload.result?.serverInfo?.name).toBe("sportfolio-gameplay-mcp");

      const getResponse = await fetch(server.url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${server.authToken}`,
          accept: "text/event-stream",
          "mcp-protocol-version": "2025-03-26",
          "mcp-session-id": sessionId!,
        },
      });

      expect(getResponse.status).toBe(200);
      expect(getResponse.headers.get("content-type")).toContain("text/event-stream");
      await getResponse.body?.cancel();

      const deleteResponse = await fetch(server.url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${server.authToken}`,
          "mcp-protocol-version": "2025-03-26",
          "mcp-session-id": sessionId!,
        },
      });

      expect(deleteResponse.status).toBe(200);

      const missingSessionResponse = await fetch(server.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${server.authToken}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-03-26",
          "mcp-session-id": sessionId!,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      });

      expect(missingSessionResponse.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("lists tools, prompts, and resources and reads registered resources", async () => {
    const server = await startMockMcpHttpServer();
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);

      const tools = await openClient.client.listTools();
      const prompts = await openClient.client.listPrompts();
      const resources = await openClient.client.listResources();
      const docsIndex = await openClient.client.readResource({
        uri: "sportfolio://docs/index",
      });
      const capabilities = await openClient.client.readResource({
        uri: "sportfolio://capabilities",
      });
      const prompt = await openClient.client.getPrompt({
        name: "review_idle_cash",
        arguments: {},
      });

      expect(tools.tools).toHaveLength(buildPublicMcpToolRegistry().length);
      expect(tools.tools.map((entry) => entry.name)).not.toContain("create_api_token");
      expect(prompts.prompts.map((entry) => entry.name)).toEqual(
        expect.arrayContaining([
          "review_setup",
          "review_idle_cash",
          "find_boost_candidates",
          "stage_trade",
        ]),
      );
      expect(resources.resources.map((entry) => entry.uri)).toEqual(
        expect.arrayContaining([
          "sportfolio://docs/index",
          "sportfolio://capabilities",
          "sportfolio://action-surface",
          "sportfolio://tool-catalog",
          "sportfolio://docs/agent/product-mechanics",
        ]),
      );
      expect(docsIndex.contents[0]?.uri).toBe("sportfolio://docs/index");
      expect(capabilities.contents[0]?.uri).toBe("sportfolio://capabilities");
      expect(prompt.messages[0]?.content.type).toBe("text");
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("lists and executes authenticated MLB MCP tools through the public MCP surface", async () => {
    const server = await startMockMcpHttpServer({
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
            presentationProfile: "schedule",
            primaryEntityType: "game",
            preferredColumns: ["matchup", "status", "startTime", "venue"],
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
        toolResults: {
          mlb_mcp__get_schedule: {
            remoteToolName: "get_schedule",
            content: [
              {
                type: "text",
                text: "Loaded the MLB schedule.",
              },
            ],
            structuredContent: {
              dates: [
                {
                  games: [
                    {
                      gamePk: 12345,
                    },
                  ],
                },
              ],
            },
            replyText: "Loaded the MLB schedule.",
            payloadTruncated: false,
            truncation: null,
          },
        },
      },
    });
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const tools = await openClient.client.listTools();
      expect(tools.tools.map((entry) => entry.name)).toContain("mlb_mcp__get_schedule");
      const capabilities = await openClient.client.readResource({
        uri: "sportfolio://capabilities",
      });
      const actionSurface = await openClient.client.readResource({
        uri: "sportfolio://action-surface",
      });
      const toolCatalog = await openClient.client.readResource({
        uri: "sportfolio://tool-catalog",
      });

      const result = await openClient.client.callTool({
        name: "mlb_mcp__get_schedule",
        arguments: {
          date: "2026-03-28",
        },
      });

      expect(result.isError).not.toBe(true);
      expect((result.structuredContent as Record<string, unknown>).dates).toBeTruthy();
      const capabilityPayload = JSON.parse(String(capabilities.contents[0]?.text)) as {
        included: Array<Record<string, unknown>>;
        dynamicSources: Array<Record<string, unknown>>;
      };
      expect(
        capabilityPayload.included.some((entry) => entry.capabilityId === "mlb_mcp__get_schedule"),
      ).toBe(true);
      expect(capabilityPayload.dynamicSources[0]?.toolCount).toBe(1);

      const actionSurfacePayload = JSON.parse(String(actionSurface.contents[0]?.text)) as {
        tools: Array<Record<string, unknown>>;
      };
      expect(
        actionSurfacePayload.tools.some(
          (entry) =>
            entry.name === "mlb_mcp__get_schedule" &&
            entry.provider === "internal_mlb_mcp" &&
            Array.isArray(entry.inputFieldNames) &&
            entry.inputFieldNames.includes("date"),
        ),
      ).toBe(true);

      const toolCatalogPayload = JSON.parse(String(toolCatalog.contents[0]?.text)) as {
        tools: Array<Record<string, unknown>>;
      };
      expect(
        toolCatalogPayload.tools.some(
          (entry) =>
            entry.name === "mlb_mcp__get_schedule" &&
            entry.resultShapeHint === "dates[].games[] with probable pitchers" &&
            entry.presentationProfile === "schedule" &&
            entry.primaryEntityType === "game" &&
            Array.isArray(entry.examplePrompts) &&
            entry.examplePrompts.includes("who are the probable pitchers today?") &&
            Array.isArray(entry.preferredColumns) &&
            entry.preferredColumns.includes("venue"),
        ),
      ).toBe(true);
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("keeps MLB discovery resources aligned with the session tool snapshot", async () => {
    const mlbTools = {
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
          presentationProfile: "schedule",
          primaryEntityType: "game",
          preferredColumns: ["matchup", "status", "startTime", "venue"],
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
      toolResults: {
        mlb_mcp__get_schedule: {
          remoteToolName: "get_schedule",
          content: [
            {
              type: "text",
              text: "Loaded the MLB schedule.",
            },
          ],
          structuredContent: {
            dates: [],
          },
          replyText: "Loaded the MLB schedule.",
          payloadTruncated: false,
          truncation: null,
        },
      },
    };
    const server = await startMockMcpHttpServer({
      mlbTools,
    });
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);

      const initialTools = await openClient.client.listTools();
      expect(initialTools.tools.map((entry) => entry.name)).toContain("mlb_mcp__get_schedule");

      mlbTools.toolCatalog = [];

      const listedTools = await openClient.client.listTools();
      const capabilities = await openClient.client.readResource({
        uri: "sportfolio://capabilities",
      });
      const actionSurface = await openClient.client.readResource({
        uri: "sportfolio://action-surface",
      });
      const toolCatalog = await openClient.client.readResource({
        uri: "sportfolio://tool-catalog",
      });

      expect(listedTools.tools.map((entry) => entry.name)).toContain("mlb_mcp__get_schedule");

      const capabilityPayload = JSON.parse(String(capabilities.contents[0]?.text)) as {
        included: Array<Record<string, unknown>>;
        dynamicSources: Array<Record<string, unknown>>;
      };
      expect(
        capabilityPayload.included.some((entry) => entry.capabilityId === "mlb_mcp__get_schedule"),
      ).toBe(true);
      expect(capabilityPayload.dynamicSources[0]?.toolCount).toBe(1);

      const actionSurfacePayload = JSON.parse(String(actionSurface.contents[0]?.text)) as {
        tools: Array<Record<string, unknown>>;
      };
      expect(
        actionSurfacePayload.tools.some((entry) => entry.name === "mlb_mcp__get_schedule"),
      ).toBe(true);

      const toolCatalogPayload = JSON.parse(String(toolCatalog.contents[0]?.text)) as {
        tools: Array<Record<string, unknown>>;
      };
      expect(toolCatalogPayload.tools.some((entry) => entry.name === "mlb_mcp__get_schedule")).toBe(
        true,
      );
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("stages and confirms a scout assignment through the public MCP surface", async () => {
    const server = await startMockMcpHttpServer();
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const staged = await openClient.client.callTool({
        name: "stage_scout_assignment",
        arguments: {
          playerId: "player_1",
          targetCount: 3,
        },
      });

      expect(staged.isError).not.toBe(true);
      const stagedContent = (staged.structuredContent || {}) as Record<string, unknown>;
      expect(stagedContent.confirmationRequired).toBe(true);

      const confirmed = await openClient.client.callTool({
        name: "confirm_pending_action",
        arguments: {
          threadId: stagedContent.threadId,
          pendingBundleId: stagedContent.pendingBundleId,
        },
      });

      expect(confirmed.isError).not.toBe(true);
      expect((confirmed.structuredContent as Record<string, unknown>).summary).toBe(
        "Confirmed pending action bundle.",
      );
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("sorts community boost candidates by boost count before applying the limit", async () => {
    const server = await startMockMcpHttpServer();
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const result = await openClient.client.callTool({
        name: "list_community_boost_eligible_players",
        arguments: {
          limit: 2,
        },
      });

      expect(result.isError).not.toBe(true);
      const structuredContent = (result.structuredContent || {}) as Record<string, unknown>;
      const players = Array.isArray(structuredContent.players)
        ? (structuredContent.players as Array<Record<string, unknown>>)
        : [];
      expect(players.map((entry) => entry.playerId)).toEqual(["player_2", "player_1"]);
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("returns a safe error result when bundle identity does not match", async () => {
    const server = await startMockMcpHttpServer();
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const result = await openClient.client.callTool({
        name: "confirm_pending_action",
        arguments: {
          threadId: "thread_1",
          pendingBundleId: "wrong_bundle",
        },
      });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as Record<string, unknown>).code).toBe("bundle_mismatch");
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("handles malformed tool input with an MCP error response", async () => {
    const server = await startMockMcpHttpServer();
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const result = await openClient.client.callTool({
        name: "create_watchlist",
        arguments: {
          name: "",
        },
      });

      expect(result.isError).toBe(true);
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("executes every public MCP tool fixture successfully", async () => {
    const fixtures = getPublicMcpToolFixtures();

    for (const tool of buildPublicMcpToolRegistry()) {
      const server = await startMockMcpHttpServer();
      let openClient: OpenClient | null = null;

      try {
        openClient = await connectClient(server.url, server.authToken);
        const result = await openClient.client.callTool({
          name: tool.name,
          arguments: fixtures[tool.name],
        });

        expect(result.isError, `tool ${tool.name} returned an MCP error`).not.toBe(true);

        const structuredContent = (result.structuredContent || {}) as Record<string, unknown>;
        if (tool.name.startsWith("stage_")) {
          expect(structuredContent.confirmationRequired).toBe(true);
          expect(typeof structuredContent.pendingBundleId).toBe("string");
        }
        if (tool.name === "confirm_pending_action" || tool.name === "cancel_pending_action") {
          expect(structuredContent.pendingBundleId).toBe("bundle_1");
        }
      } finally {
        await closeClient(openClient);
        await server.close();
      }
    }
  }, 60000);
});

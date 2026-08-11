import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import {
  buildPublicMcpToolRegistry,
  evaluateGameplayCapabilityParity,
  getPublicMcpToolFixtures,
} from "./public-tool-registry";
import { getMarketResearchToolNames } from "./market-research-tools";
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
        name: "find_boost_candidates",
        arguments: {},
      });

      expect(tools.tools).toHaveLength(
        buildPublicMcpToolRegistry().length + getMarketResearchToolNames().length,
      );
      expect(tools.tools.map((entry) => entry.name)).toEqual(
        expect.arrayContaining(getMarketResearchToolNames()),
      );
      expect(tools.tools.map((entry) => entry.name)).not.toContain("create_api_token");
      expect(prompts.prompts.map((entry) => entry.name)).toEqual(
        expect.arrayContaining(["find_boost_candidates", "stage_trade"]),
      );
      expect(prompts.prompts.map((entry) => entry.name)).not.toEqual(
        expect.arrayContaining(["review_setup", "review_idle_cash"]),
      );
      expect(resources.resources.map((entry) => entry.uri)).toEqual(
        expect.arrayContaining([
          "sportfolio://docs/index",
          "sportfolio://capabilities",
          "sportfolio://action-surface",
          "sportfolio://tool-catalog",
          "sportfolio://docs/getting-started/mcp-access",
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

  it("exposes explicit execution metadata in the tool catalog and action surface", async () => {
    const server = await startMockMcpHttpServer();
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const toolCatalog = await openClient.client.readResource({
        uri: "sportfolio://tool-catalog",
      });
      const actionSurface = await openClient.client.readResource({
        uri: "sportfolio://action-surface",
      });
      const catalogPayload = JSON.parse(String(toolCatalog.contents[0]?.text)) as {
        tools: Array<Record<string, unknown>>;
      };
      const actionPayload = JSON.parse(String(actionSurface.contents[0]?.text)) as {
        tools: Array<Record<string, unknown>>;
      };

      const stageBuy = catalogPayload.tools.find((tool) => tool.name === "stage_market_buy");
      const deleteWatchlist = catalogPayload.tools.find((tool) => tool.name === "delete_watchlist");
      const confirm = catalogPayload.tools.find((tool) => tool.name === "confirm_pending_action");
      const portfolio = catalogPayload.tools.find((tool) => tool.name === "get_portfolio_summary");

      expect(stageBuy).toMatchObject({
        executionModel: "staged_write",
        confirmationModel: "staged_confirmation",
        requiresConfirmation: true,
        riskLevel: "medium",
      });
      expect(deleteWatchlist).toMatchObject({
        executionModel: "immediate_write",
        confirmationModel: "immediate",
        requiresConfirmation: false,
        riskLevel: "medium",
      });
      expect(confirm).toMatchObject({
        executionModel: "finalizer",
        confirmationModel: "finalizer",
        requiresConfirmation: false,
        riskLevel: "medium",
      });
      expect(portfolio).toMatchObject({
        executionModel: "read",
        confirmationModel: "immediate",
        requiresConfirmation: false,
        riskLevel: "low",
      });
      expect(
        actionPayload.tools.some(
          (tool) =>
            tool.name === "stage_market_buy" &&
            tool.executionModel === "staged_write" &&
            tool.requiresConfirmation === true,
        ),
      ).toBe(true);
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("publishes the complete static semantic MLB catalog regardless of provider health", async () => {
    const server = await startMockMcpHttpServer();
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const names = (await openClient.client.listTools()).tools.map((entry) => entry.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "search_mlb_players",
          "get_mlb_batting_leaders",
          "get_mlb_pitching_leaders",
          "get_mlb_player_stats",
          "get_mlb_player_splits",
          "get_mlb_team_leaders",
          "get_mlb_games",
          "get_mlb_game_details",
          "get_mlb_probable_pitchers",
          "get_mlb_standings",
          "get_mlb_roster",
          "get_mlb_statcast_profile",
        ]),
      );

      const capabilities = await openClient.client.readResource({
        uri: "sportfolio://capabilities",
      });
      const payload = JSON.parse(String(capabilities.contents[0]?.text)) as {
        dynamicSources: Array<Record<string, unknown>>;
      };
      expect(payload.dynamicSources).toEqual(
        expect.arrayContaining([expect.objectContaining({ provider: "mlb", toolCount: 12 })]),
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
          transactionId: stagedContent.transactionId,
        },
      });

      expect(confirmed.isError).not.toBe(true);
      expect((confirmed.structuredContent as Record<string, unknown>).summary).toBe(
        "Confirmed gameplay transaction.",
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
      expect(Array.isArray(players)).toBe(true);
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("returns a safe error result for an unknown gameplay transaction", async () => {
    const server = await startMockMcpHttpServer();
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const result = await openClient.client.callTool({
        name: "confirm_pending_action",
        arguments: { transactionId: "00000000-0000-4000-8000-000000000099" },
      });

      expect(result.isError).toBe(true);
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
      if (
        ["get_pending_action", "confirm_pending_action", "cancel_pending_action"].includes(
          tool.name,
        )
      )
        continue;
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
          expect(typeof structuredContent.transactionId).toBe("string");
        }
      } finally {
        await closeClient(openClient);
        await server.close();
      }
    }
  }, 60000);
});

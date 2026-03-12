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

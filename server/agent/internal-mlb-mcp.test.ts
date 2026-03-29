import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  transportCtor: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    connect = mocks.connect;
    close = mocks.close;
    listTools = mocks.listTools;
    callTool = mocks.callTool;

    constructor(_info: unknown) {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockTransport {
    constructor(url: URL, options: unknown) {
      mocks.transportCtor(url, options);
    }
  },
}));

import {
  getInternalMlbMcpToolCatalog,
  resetInternalMlbMcpCacheForTests,
  resolveInternalMlbMcpConfig,
  runInternalMlbMcpReadTool,
} from "./internal-mlb-mcp";

const originalEnv = {
  enabled: process.env.HERMES_INTERNAL_MLB_MCP_ENABLED,
  endpoint: process.env.HERMES_INTERNAL_MLB_MCP_URL,
  prefix: process.env.HERMES_INTERNAL_MLB_MCP_TOOL_PREFIX,
  cacheTtlMs: process.env.HERMES_INTERNAL_MLB_MCP_TOOL_CACHE_MS,
  nodeEnv: process.env.NODE_ENV,
};

describe("internal-mlb-mcp", () => {
  beforeEach(() => {
    process.env.HERMES_INTERNAL_MLB_MCP_ENABLED = "true";
    process.env.HERMES_INTERNAL_MLB_MCP_URL = "http://mlb-mcp.railway.internal:8080/mcp";
    process.env.HERMES_INTERNAL_MLB_MCP_TOOL_PREFIX = "mlb_mcp__";
    process.env.HERMES_INTERNAL_MLB_MCP_TOOL_CACHE_MS = "60000";

    resetInternalMlbMcpCacheForTests();
    mocks.connect.mockReset();
    mocks.close.mockReset();
    mocks.listTools.mockReset();
    mocks.callTool.mockReset();
    mocks.transportCtor.mockReset();
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);

    mocks.listTools.mockResolvedValue({
      tools: [
        {
          name: "home_run_leaders",
          description: "List league HR leaders for a season.",
          inputSchema: {
            type: "object",
            properties: {
              season: {
                type: "number",
              },
            },
            required: ["season"],
            additionalProperties: false,
          },
        },
      ],
    });
  });

  afterAll(() => {
    if (originalEnv.enabled == null) {
      delete process.env.HERMES_INTERNAL_MLB_MCP_ENABLED;
    } else {
      process.env.HERMES_INTERNAL_MLB_MCP_ENABLED = originalEnv.enabled;
    }

    if (originalEnv.endpoint == null) {
      delete process.env.HERMES_INTERNAL_MLB_MCP_URL;
    } else {
      process.env.HERMES_INTERNAL_MLB_MCP_URL = originalEnv.endpoint;
    }

    if (originalEnv.prefix == null) {
      delete process.env.HERMES_INTERNAL_MLB_MCP_TOOL_PREFIX;
    } else {
      process.env.HERMES_INTERNAL_MLB_MCP_TOOL_PREFIX = originalEnv.prefix;
    }

    if (originalEnv.cacheTtlMs == null) {
      delete process.env.HERMES_INTERNAL_MLB_MCP_TOOL_CACHE_MS;
    } else {
      process.env.HERMES_INTERNAL_MLB_MCP_TOOL_CACHE_MS = originalEnv.cacheTtlMs;
    }

    if (originalEnv.nodeEnv == null) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv.nodeEnv;
    }
  });

  it("defaults to the local vendored MLB MCP endpoint in development when no endpoint is configured", () => {
    delete process.env.HERMES_INTERNAL_MLB_MCP_ENABLED;
    delete process.env.HERMES_INTERNAL_MLB_MCP_URL;
    process.env.NODE_ENV = "development";

    const config = resolveInternalMlbMcpConfig();

    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe("http://127.0.0.1:8081/mcp");
    expect(config.implicitLocalDevFallback).toBe(true);
  });

  it("projects remote MLB MCP tools into Hermes read tools with the configured prefix", async () => {
    const tools = await getInternalMlbMcpToolCatalog();

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      toolName: "mlb_mcp__home_run_leaders",
      category: "read",
      riskLevel: "low",
    });
    expect(mocks.listTools).toHaveBeenCalledTimes(1);
  });

  it("caches discovery failures briefly so repeated catalog reads fail fast", async () => {
    process.env.HERMES_INTERNAL_MLB_MCP_TOOL_CACHE_MS = "5000";
    mocks.listTools.mockRejectedValue(new Error("provider unavailable"));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));

    try {
      await expect(getInternalMlbMcpToolCatalog()).resolves.toEqual([]);
      await expect(getInternalMlbMcpToolCatalog()).resolves.toEqual([]);

      expect(mocks.listTools).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5001);

      await expect(getInternalMlbMcpToolCatalog()).resolves.toEqual([]);
      expect(mocks.listTools).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("invokes the mapped remote tool for a projected Hermes tool name", async () => {
    mocks.callTool.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "Aaron Judge led MLB with 58 home runs in 2025.",
        },
      ],
      structuredContent: {
        leader: "Aaron Judge",
        homeRuns: 58,
        season: 2025,
      },
    });

    const result = (await runInternalMlbMcpReadTool({
      toolName: "mlb_mcp__home_run_leaders",
      args: {
        season: 2025,
      },
    })) as any;

    expect(mocks.callTool).toHaveBeenCalledWith({
      name: "home_run_leaders",
      arguments: {
        season: 2025,
      },
    });
    expect(result.replyText).toContain("Aaron Judge");
    expect(result.context.remoteToolName).toBe("home_run_leaders");
  });

  it("truncates oversized internal MCP payloads before returning them to Hermes", async () => {
    const hugeText = "Aaron Judge ".repeat(1200);
    mocks.callTool.mockResolvedValue({
      content: [
        {
          type: "text",
          text: hugeText,
        },
      ],
      structuredContent: {
        leaderboard: hugeText.repeat(2),
      },
    });

    const result = (await runInternalMlbMcpReadTool({
      toolName: "mlb_mcp__home_run_leaders",
      args: {
        season: 2025,
      },
    })) as any;

    expect(result.replyText).toMatch(/Response truncated/);
    expect(result.replyText.length).toBeLessThanOrEqual(2000);
    expect(result.context.payloadTruncated).toBe(true);
    expect(result.context.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringMatching(/Response truncated/),
      }),
    ]);
    expect(result.context.structuredContent).toMatchObject({
      truncated: true,
      originalCharLength: expect.any(Number),
      preview: expect.stringMatching(/Response truncated/),
    });
    expect(result.context.truncation).toEqual({
      replyTextChars: expect.any(Number),
      structuredContentChars: expect.any(Number),
      contentChars: expect.any(Number),
    });
  });
});

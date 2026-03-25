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
  runInternalMlbMcpReadTool,
} from "./internal-mlb-mcp";

const originalEnv = {
  enabled: process.env.HERMES_INTERNAL_MLB_MCP_ENABLED,
  endpoint: process.env.HERMES_INTERNAL_MLB_MCP_URL,
  prefix: process.env.HERMES_INTERNAL_MLB_MCP_TOOL_PREFIX,
};

describe("internal-mlb-mcp", () => {
  beforeEach(() => {
    process.env.HERMES_INTERNAL_MLB_MCP_ENABLED = "true";
    process.env.HERMES_INTERNAL_MLB_MCP_URL = "http://mlb-mcp.railway.internal:8080/mcp";
    process.env.HERMES_INTERNAL_MLB_MCP_TOOL_PREFIX = "mlb_mcp__";

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
});

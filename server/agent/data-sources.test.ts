import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInternalMlbMcpStatus: vi.fn(),
  listUserMcpSources: vi.fn(),
  getUserMcpSource: vi.fn(),
  updateUserMcpSource: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    update: vi.fn(),
  },
}));

vi.mock("./internal-mlb-mcp", () => ({
  INTERNAL_MLB_MCP_SOURCE_ID: "internal_mlb_mcp",
  getInternalMlbMcpStatus: mocks.getInternalMlbMcpStatus,
}));

vi.mock("./mcp-sources", () => ({
  listUserMcpSources: mocks.listUserMcpSources,
  getUserMcpSource: mocks.getUserMcpSource,
  updateUserMcpSource: mocks.updateUserMcpSource,
}));

import { getAgentDataSourceSummary } from "./data-sources";

describe("agent data-source summary", () => {
  beforeEach(() => {
    mocks.getInternalMlbMcpStatus.mockReset();
    mocks.listUserMcpSources.mockReset();
    mocks.getUserMcpSource.mockReset();
    mocks.updateUserMcpSource.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps built-in capability state when external MCP-source loading fails", async () => {
    mocks.getInternalMlbMcpStatus.mockResolvedValue({
      available: true,
      toolCount: 2,
    });
    mocks.listUserMcpSources.mockRejectedValue(
      new Error('relation "user_mcp_sources" does not exist'),
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const summary = await getAgentDataSourceSummary("user_1", {
      internalMlbMcpEnabled: true,
      createdAt: new Date("2026-04-02T12:00:00.000Z"),
    } as any);

    expect(summary.builtIn).toEqual([
      expect.objectContaining({
        id: "internal_mlb_mcp",
        kind: "built_in",
        enabled: true,
        available: true,
      }),
    ]);
    expect(summary.external).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[Agent Data Sources] External MCP source state unavailable during capability load; continuing without external sources.",
      'relation "user_mcp_sources" does not exist',
    );
  });
});

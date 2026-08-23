import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  buildPublicToolRegistry,
  executePublicTool,
  getPublicToolDefinition,
  validatePublicToolArguments,
} from "./public-tool-registry";
import { normalizePublicError } from "./public-errors";
import { createMockPublicMcpDependencies } from "./testing";

describe("production public MCP tool contracts", () => {
  it("accepts every registered tool's published fixture at the dispatch boundary", () => {
    const tools = buildPublicToolRegistry();
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);

    for (const tool of tools) {
      const parsed = tool.inputSchema
        ? z.object(tool.inputSchema).strict().safeParse(tool.fixtureArgs)
        : { success: true as const };
      expect(parsed.success, `${tool.name} fixture does not satisfy its schema`).toBe(true);
      expect(() => validatePublicToolArguments(tool.name, tool.fixtureArgs)).not.toThrow();
    }
  });

  it("executes every registered fixture through the real handler boundary without invalid input", async () => {
    const harness = createMockPublicMcpDependencies();
    const context = { userId: harness.userId, deps: harness.deps };
    const invalidFixtures: string[] = [];

    for (const tool of buildPublicToolRegistry()) {
      try {
        await executePublicTool(context, tool.name, tool.fixtureArgs);
      } catch (error) {
        const normalized = normalizePublicError(error);
        if (normalized.code === "invalid_input") {
          invalidFixtures.push(`${tool.name}: ${normalized.message}`);
        }
      }
    }

    expect(invalidFixtures).toEqual([]);
  });

  it("publishes the current Daily Boost mechanic and no retired multiplier/Stack tools", () => {
    const names = new Set(buildPublicToolRegistry().map((tool) => tool.name));
    expect(names.has("stage_daily_boost_assign")).toBe(true);
    expect(names.has("stage_stack_shares")).toBe(false);
    expect(names.has("get_holding_multiplier_state")).toBe(false);

    const dailyBoost = getPublicToolDefinition("stage_daily_boost_assign");
    expect(Object.keys(dailyBoost?.inputSchema || {})).toEqual([
      "playerId",
      "slotTier",
      "shares",
      "date",
      "sport",
    ]);
    expect(dailyBoost?.fixtureArgs.shares).toEqual(expect.any(Number));
    expect(
      [2, 3, 5, 7, 10].every((tier) => dailyBoost?.inputSchema?.slotTier.safeParse(tier).success),
    ).toBe(true);
  });

  it("uses one canonical search argument and rejects stale aliases", () => {
    expect(() =>
      validatePublicToolArguments("search_players", { query: "Ryan Blaney" }),
    ).not.toThrow();
    expect(() => validatePublicToolArguments("search_players", { q: "Ryan Blaney" })).toThrow();
    expect(() =>
      validatePublicToolArguments("search_players", { search: "Ryan Blaney" }),
    ).toThrow();
  });

  it("keeps the dashboard renderer's child arguments valid", () => {
    expect(() =>
      validatePublicToolArguments("get_dashboard_overview", { recentLotsLimit: 5 }),
    ).not.toThrow();
    expect(() =>
      validatePublicToolArguments("get_dashboard_overview", { recentLotsLimit: 21 }),
    ).toThrow();
  });
});

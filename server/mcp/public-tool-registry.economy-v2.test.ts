import { describe, expect, it } from "vitest";
import { getPublicToolDefinition } from "./public-tool-registry";

describe("public MCP Economy V2 contracts", () => {
  it("requires a direct positive Singles quantity for Daily Boost assignment", () => {
    const tool = getPublicToolDefinition("stage_daily_boost_assign");

    expect(tool).not.toBeNull();
    expect(Object.keys(tool?.inputSchema ?? {})).toEqual([
      "playerId",
      "slotTier",
      "shares",
      "date",
      "sport",
    ]);
    expect(tool?.fixtureArgs).toMatchObject({ shares: 1, slotTier: 5 });
    expect(tool?.inputSchema?.shares.safeParse(0.5).success).toBe(true);
    expect(tool?.inputSchema?.shares.safeParse(0).success).toBe(false);
  });

  it("accepts only configured Daily Boost slot tiers", () => {
    const tool = getPublicToolDefinition("stage_daily_boost_assign");
    const tierSchema = tool?.inputSchema?.slotTier;

    for (const tier of [2, 3, 5, 7, 10]) {
      expect(tierSchema?.safeParse(tier).success).toBe(true);
    }
    for (const tier of [1, 4, 6, 8, 9, 11]) {
      expect(tierSchema?.safeParse(tier).success).toBe(false);
    }
  });

  it("does not expose a meaningless share quantity when removing a Daily Boost", () => {
    const tool = getPublicToolDefinition("stage_daily_boost_remove");

    expect(tool).not.toBeNull();
    expect(Object.keys(tool?.inputSchema ?? {})).toEqual(["playerId", "slotTier", "date", "sport"]);
    expect(tool?.fixtureArgs).not.toHaveProperty("shares");
  });

  it("keeps retired Stack Shares off the public capability surface", () => {
    expect(getPublicToolDefinition("stage_stack_shares")).toBeNull();
  });
});

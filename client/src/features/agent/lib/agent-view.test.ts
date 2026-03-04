import { describe, expect, it } from "vitest";
import { getActionComparisonRows, getReadableAgentError, getThreadTitle } from "./agent-view";

describe("agent-view", () => {
  it("normalizes structured agent errors into readable text", () => {
    const error = new Error('500: {"error":"The agent timed out"}');

    expect(getReadableAgentError(error, "fallback")).toBe("The agent timed out");
  });

  it("falls back to generated thread titles", () => {
    expect(
      getThreadTitle(
        {
          id: "thread_1",
          title: null,
          channel: "in_app",
          domain: "sportfolio",
          status: "active",
          lastMessageAt: null,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          lastMessagePreview: null,
          pendingActionBundle: null,
        },
        1,
      ),
    ).toBe("Chat 2");
  });

  it("builds comparison rows for staged pool buys", () => {
    const rows = getActionComparisonRows({
      actionType: "pool_buy",
      playerId: "nba_1",
      playerName: "Nikola Jokic",
      reasoning: "The market is underpricing the player relative to tonight's role.",
      confidence: 0.82,
      sbAmount: 100,
      availableBalanceBefore: 245.5,
      availableBalanceAfter: 145.5,
      estimatedSharesOut: 7.25,
      estimatedPricePerShare: 13.79,
      estimatedSlippagePercent: 1.2,
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]?.label).toBe("Available balance");
    expect(rows[1]?.proposed).toContain("7.2500 shares");
    expect(rows[2]?.proposed).toContain("$13.79 per share");
  });
});

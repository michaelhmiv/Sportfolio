import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTONOMOUS_STRATEGY_ACTION_TYPES,
  buildDefaultStrategyGuardrails,
  buildStrategyAutonomyPolicyLines,
  isBroadStrategyMandate,
  validateBroadStrategyActionMix,
} from "./strategy-policy";

describe("strategy-policy", () => {
  it("detects broad recurring mandates", () => {
    expect(isBroadStrategyMandate("Buy the best MLB players throughout this week.")).toBe(true);
    expect(isBroadStrategyMandate("Buy Shohei Ohtani right now.")).toBe(false);
  });

  it("builds manager-style guidance for broad mandates", () => {
    const policy = buildStrategyAutonomyPolicyLines({
      mandateText: "Buy the best MLB players throughout this week.",
      guardrails: buildDefaultStrategyGuardrails(),
      allowedActionTypes: [...DEFAULT_AUTONOMOUS_STRATEGY_ACTION_TYPES],
    });

    expect(policy.broadMandate).toBe(true);
    expect(policy.lines.join(" ")).toContain("portfolio-management tasks");
    expect(policy.lines.join(" ")).toContain("Never use community boosts");
    expect(policy.lines.join(" ")).toContain("Do not buy the same player more than once");
  });

  it("blocks repeated buys into one player for broad mandates", () => {
    expect(() =>
      validateBroadStrategyActionMix({
        strategy: {
          mandateText: "Buy the best MLB players throughout this week.",
          guardrails: buildDefaultStrategyGuardrails(),
        } as any,
        actions: [
          {
            actionType: "pool_buy",
            playerId: "player_1",
            sbAmount: 20,
            maxSlippage: 0.05,
            reasoning: "First buy",
            confidence: 0.8,
          },
          {
            actionType: "pool_buy",
            playerId: "player_1",
            sbAmount: 20,
            maxSlippage: 0.05,
            reasoning: "Second buy",
            confidence: 0.79,
          },
        ],
      }),
    ).toThrow(/same player/i);
  });
});

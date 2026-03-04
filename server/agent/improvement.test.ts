import { describe, expect, it } from "vitest";
import { buildAgentImprovementCandidate, classifyAgentFailure } from "./improvement";

describe("agent improvement signals", () => {
  it("flags unavailable tool selections as wrong tool selection", () => {
    const failureClass = classifyAgentFailure({
      requestMessage: "what should i spend my cash on?",
      outcome: "unsupported",
      assistantText: "",
      summary: "The model selected an unavailable tool.",
      warnings: ["The model selected unavailable tool fake_tool."],
      toolTrace: [],
      toolCallsUsed: [],
      fallbackUsed: false,
    });

    expect(failureClass).toBe("wrong_tool_selected");
  });

  it("flags account-specific direct answers without tools as overeager", () => {
    const candidate = buildAgentImprovementCandidate({
      requestMessage: "what should i spend my cash on?",
      outcome: "advisory",
      assistantText: "You should probably keep your powder dry.",
      summary: "Advisory only.",
      warnings: [],
      toolTrace: [
        {
          toolName: "model_tool_loop",
          phase: "plan",
          status: "ok",
          latencyMs: 18,
          summary: "The model answered directly without needing a tool.",
        },
      ],
      toolCallsUsed: [],
      fallbackUsed: false,
    });

    expect(candidate?.failureClass).toBe("overeager_direct_answer");
    expect(candidate?.recommendedChangeType).toBe("prompt_policy");
  });

  it("flags failed executor traces as tool execution errors", () => {
    const candidate = buildAgentImprovementCandidate({
      requestMessage: "quote a buy for this player",
      outcome: "unsupported",
      assistantText: "",
      summary: "Tool failed.",
      warnings: ["get_amm_trade_quote failed: timeout"],
      toolTrace: [
        {
          toolName: "get_amm_trade_quote",
          phase: "read",
          status: "failed",
          latencyMs: 122,
          summary: "get_amm_trade_quote failed: timeout",
        },
      ],
      toolCallsUsed: ["get_amm_trade_quote"],
      fallbackUsed: false,
    });

    expect(candidate?.failureClass).toBe("tool_execution_error");
    expect(candidate?.affectedTools).toEqual(["get_amm_trade_quote"]);
  });

  it("flags local compatibility fallback as legacy usage", () => {
    const candidate = buildAgentImprovementCandidate({
      requestMessage: "what can you do for me?",
      outcome: "advisory",
      assistantText: "Fallback answer",
      summary: "Used compatibility bridge.",
      warnings: [],
      toolTrace: [
        {
          toolName: "local_compatibility_bridge",
          phase: "plan",
          status: "ok",
          latencyMs: 31,
          summary: "Used compatibility bridge.",
        },
      ],
      toolCallsUsed: [],
      fallbackUsed: false,
    });

    expect(candidate?.failureClass).toBe("legacy_compatibility_used");
    expect(candidate?.recommendedChangeType).toBe("compatibility_isolation");
  });
});

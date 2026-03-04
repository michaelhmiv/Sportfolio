import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiRuntime } from "./pi-provider";
import { sandboxThreadFixture } from "../../tests/fixtures/agent/sandbox-thread";

const completeSimpleMock = vi.fn();

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: completeSimpleMock,
}));

function buildRuntime(): PiRuntime {
  return {
    apiKey: "test-key",
    model: {
      id: "test-model",
      name: "Test Model",
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://example.com/v1",
      reasoning: false,
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 200000,
      maxTokens: 32768,
    },
  };
}

beforeEach(() => {
  completeSimpleMock.mockReset();
});

describe("intent-router", () => {
  it("treats advisory questions as discussion mode", async () => {
    const { resolveAgentRequestMode, resolveAgentRequestModeWithFallback } =
      await import("./intent-router");

    expect(
      resolveAgentRequestMode("What do you think about moving all my scouts to Bob?", null),
    ).toBe("discussion");

    const result = await resolveAgentRequestModeWithFallback({
      runtime: buildRuntime(),
      message: "Should I move all my scouts to Bob?",
      semanticRoute: "top_targets_today",
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("discussion");
    expect(result.source).toBe("heuristic");
  });

  it("supports sandbox fixture phrasing for deterministic advisory mode", async () => {
    const { resolveAgentRequestModeWithFallback } = await import("./intent-router");

    const result = await resolveAgentRequestModeWithFallback({
      runtime: buildRuntime(),
      message: sandboxThreadFixture.messages[0].content,
      semanticRoute: sandboxThreadFixture.metadata.semanticRoute,
    });

    expect(result.mode).toBe("discussion");
    expect(result.source).toBe("heuristic");
  });

  it("treats direct imperatives as commit mode", async () => {
    const { resolveAgentRequestMode, resolveAgentRequestModeWithFallback } =
      await import("./intent-router");

    expect(resolveAgentRequestMode("Move all my scouts to Bob", null)).toBe("commit");
    expect(resolveAgentRequestMode("Can you move all my scouts to Bob?", null)).toBe("commit");

    const result = await resolveAgentRequestModeWithFallback({
      runtime: buildRuntime(),
      message: "Scout the top five players today",
      semanticRoute: "top_targets_today",
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("commit");
    expect(result.source).toBe("heuristic");
  });

  it("uses the model fallback only for ambiguous phrasing", async () => {
    completeSimpleMock.mockResolvedValue({
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "commit" }],
      api: "openai-completions" as const,
      provider: "openrouter",
      model: "test-model",
      usage: {
        input: 3,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 4,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    });

    const { resolveAgentRequestModeWithFallback } = await import("./intent-router");
    const result = await resolveAgentRequestModeWithFallback({
      runtime: buildRuntime(),
      message: "I want to move all my scouts to Bob",
      semanticRoute: null,
      conversationHistory: [
        {
          role: "assistant",
          contentText: "We were talking through concentration risk.",
        },
      ],
    });

    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe("commit");
    expect(result.source).toBe("model");
    expect(result.heuristicMode).toBe("commit");
    expect(result.heuristicConfidence).toBe("low");
    expect(result.classifierLabel).toBe("commit");
  });

  it("keeps reflective intent in discussion mode without paying for the classifier", async () => {
    const { resolveAgentRequestMode, resolveAgentRequestModeWithFallback } =
      await import("./intent-router");

    expect(resolveAgentRequestMode("I'm thinking about moving all my scouts to Bob", null)).toBe(
      "discussion",
    );

    const result = await resolveAgentRequestModeWithFallback({
      runtime: buildRuntime(),
      message: "I'm thinking about moving all my scouts to Bob",
      semanticRoute: null,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("discussion");
    expect(result.source).toBe("heuristic");
  });

  it("falls back to the heuristic mode if the classifier does not return a usable label", async () => {
    completeSimpleMock.mockResolvedValue({
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "unclear" }],
      api: "openai-completions" as const,
      provider: "openrouter",
      model: "test-model",
      usage: {
        input: 3,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 4,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    });

    const { resolveAgentRequestModeWithFallback } = await import("./intent-router");
    const result = await resolveAgentRequestModeWithFallback({
      runtime: buildRuntime(),
      message: "Talk me through moving all my scouts to Bob",
      semanticRoute: null,
    });

    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe("discussion");
    expect(result.source).toBe("fallback");
    expect(result.heuristicMode).toBe("discussion");
    expect(result.classifierLabel).toBeNull();
  });
});

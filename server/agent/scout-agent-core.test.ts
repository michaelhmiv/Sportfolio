import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiRuntime } from "./pi-provider";

const completeSimpleMock = vi.fn();

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: completeSimpleMock,
}));

function buildUsage(input: number, output: number, totalTokens: number) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function buildRuntime(): PiRuntime {
  return {
    apiKey: "test-key",
    model: {
      id: "test-model",
      name: "Test Model",
      api: "openai-completions",
      provider: "chutes",
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
    headers: {
      Authorization: "test-key",
    },
  };
}

function buildContext(overrides: Partial<ReturnType<typeof buildContextBase>> = {}) {
  return {
    ...buildContextBase(),
    ...overrides,
  };
}

function buildContextBase() {
  return {
    generatedAt: new Date().toISOString(),
    analysisWindowMinutes: 60,
    userPromptTemplate: "default",
    maxScouts: 5,
    totalScouts: 0,
    remainingScouts: 5,
    defaultSport: "NBA",
    assignments: [],
    candidates: [
      {
        playerId: "player-1",
        name: "Player One",
        sport: "NBA",
        team: "AAA",
        position: "G",
        currentPrice: "10",
        lastTradePrice: "10",
        volume24h: 10,
        priceChange24h: "0.1",
        marketCap: "100",
        injuryStatus: null,
        avgFantasyPointsPerGame: "35",
        globalScoutCount: 20,
        currentScoutCount: 0,
        upcomingGame: "Tonight",
        hasGameInFocusWindow: true,
        scoutOpportunityScore: 88,
      },
    ],
    selectionWindow: null,
    recommendedTargets: [
      {
        playerId: "player-1",
        name: "Player One",
        score: 88,
        reason: "scheduled in the requested window, lighter scout competition",
      },
    ],
    knowledgeBrief: [
      {
        id: "feature-agent-operator",
        title: "Sportfolio Agent",
        summary: "Canonical agent capability guidance.",
        urlPath: "/wiki/features/agent-operator",
        lastReviewedAt: "2026-03-02",
        notes: ["The agent stages supported actions and still requires confirmation."],
      },
    ],
  };
}

beforeEach(() => {
  completeSimpleMock.mockReset();
});

describe("scout-agent-core", () => {
  it("short-circuits direct current-slate top target requests with a deterministic backend plan", async () => {
    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext(),
      chatRequest: "Scout the top five players today",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.rawTrace.resolution).toBe("deterministic_fast_path");
    expect(result.output.actions).toHaveLength(1);
    expect(result.output.replyText).toContain("backend's top 1 ranked targets");
  });

  it("uses the semantic route hint to hit the fast path for paraphrased slate requests", async () => {
    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext(),
      chatRequest: "Which players should I prioritize on the current slate?",
      semanticRouteHint: "top_targets_today",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.rawTrace.resolution).toBe("deterministic_fast_path");
    expect(result.output.actions).toHaveLength(1);
  });

  it("returns a clean no-op deterministic response when the current scouts already match the target slate", async () => {
    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext({
        totalScouts: 5,
        remainingScouts: 0,
        assignments: [
          {
            playerId: "player-1",
            name: "Player One",
            scoutCount: 5,
            globalScoutCount: 20,
            sport: "NBA",
          },
        ],
        candidates: [
          {
            ...buildContextBase().candidates[0],
            currentScoutCount: 5,
          },
        ],
      }),
      chatRequest: "Scout the top five players today",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.output.actions).toHaveLength(0);
    expect(result.output.replyText).toContain("No changes are needed right now");
  });

  it("short-circuits one-adjustment scout reviews with a deterministic recommendation", async () => {
    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext(),
      chatRequest: "Review my scout setup and suggest one adjustment",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.rawTrace.resolution).toBe("deterministic_fast_path");
    expect(result.output.summary).toContain("Make one scout adjustment");
    expect(result.output.actions).toHaveLength(1);
  });

  it("short-circuits strongest reallocation phrasing into the deterministic one-adjustment path", async () => {
    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext(),
      chatRequest: "What is the strongest reallocation option available right now?",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.rawTrace.resolution).toBe("deterministic_fast_path");
    expect(result.output.actions).toHaveLength(1);
  });

  it("short-circuits open-ended scout setup review questions into a deterministic analysis", async () => {
    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext({
        totalScouts: 5,
        remainingScouts: 0,
        assignments: [
          {
            playerId: "player-1",
            name: "Player One",
            scoutCount: 3,
            globalScoutCount: 20,
            sport: "NBA",
          },
          {
            playerId: "player-2",
            name: "Player Two",
            scoutCount: 2,
            globalScoutCount: 8,
            sport: "NBA",
          },
        ],
        recommendedTargets: [
          ...buildContextBase().recommendedTargets,
          {
            playerId: "player-3",
            name: "Player Three",
            score: 92,
            reason: "lighter competition and stronger recent form",
          },
        ],
      }),
      chatRequest: "What should I know about my current scout setup before I make any changes?",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.rawTrace.resolution).toBe("deterministic_fast_path");
    expect(result.output.actions).toHaveLength(0);
    expect(result.output.replyText).toContain("The read: you are currently using 5/5 scouts.");
    expect(result.output.replyText).toContain("The clearest edge I still see is");
  });

  it("uses a richer analyst-style discussion prompt for advisory turns", async () => {
    let seenSystemPrompt = "";
    let seenUserPrompt = "";

    completeSimpleMock.mockImplementation(async (_model, context) => {
      seenSystemPrompt = context.systemPrompt;
      const lastMessage = context.messages[context.messages.length - 1];
      seenUserPrompt = typeof lastMessage?.content === "string" ? lastMessage.content : "";

      return {
        role: "assistant" as const,
        content: [
          {
            type: "text" as const,
            text: "You are already fairly well covered, but I would stay diversified unless a single player clearly separates from the field.",
          },
        ],
        api: "openai-completions" as const,
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(10, 14, 24),
        stopReason: "stop" as const,
        timestamp: Date.now(),
      };
    });

    const { runScoutDiscussionTurn } = await import("./scout-agent-core");
    const result = await runScoutDiscussionTurn({
      runtime: buildRuntime(),
      context: buildContext({
        totalScouts: 4,
        remainingScouts: 1,
        assignments: [
          {
            playerId: "player-1",
            name: "Player One",
            scoutCount: 3,
            globalScoutCount: 20,
            sport: "NBA",
          },
        ],
      }),
      chatRequest:
        "How do you read momentum versus stability when a slate has mixed injury signals?",
      operatorPlaybook: "default",
      strategyTemplate: "Balance upside against concentration risk.",
      temperature: 0.5,
      maxTokens: 256,
    });

    expect(result.rawTrace.resolution).toBe("model_discussion");
    expect(result.replyText).toContain("stay diversified");
    expect(seenSystemPrompt).toContain(
      "You are Sportfolio Operator, the user's senior account strategist inside Sportfolio.",
    );
    expect(seenSystemPrompt).toContain("Do not ask the user to say 'confirm' in discussion mode");
    expect(seenUserPrompt).toContain("<request_mode>");
    expect(seenUserPrompt).toContain("<canonical_knowledge>");
    expect(seenUserPrompt).toContain("<operator_state>");
    expect(seenUserPrompt).toContain("<analyst_brief>");
    expect(seenUserPrompt).toContain("<recommended_targets>");
    expect(seenUserPrompt).toContain("/wiki/features/agent-operator");
  });

  it("short-circuits semantic general scouting prompts into a deterministic discussion read", async () => {
    const { runScoutDiscussionTurn } = await import("./scout-agent-core");
    const result = await runScoutDiscussionTurn({
      runtime: buildRuntime(),
      context: buildContext({
        totalScouts: 5,
        remainingScouts: 0,
      }),
      chatRequest: "Give me general scouting guidance.",
      semanticRouteHint: "general_scouting",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.5,
      maxTokens: 256,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.rawTrace.resolution).toBe("deterministic_discussion");
    expect(result.replyText).toContain("The read:");
  });

  it("short-circuits scouting philosophy prompts into a tailored deterministic discussion read", async () => {
    const { runScoutDiscussionTurn } = await import("./scout-agent-core");
    const result = await runScoutDiscussionTurn({
      runtime: buildRuntime(),
      context: buildContext({
        totalScouts: 5,
        remainingScouts: 0,
      }),
      chatRequest:
        "Walk me through the scouting philosophy you would use for balancing conviction and patience over the next few slates.",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.5,
      maxTokens: 256,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.rawTrace.resolution).toBe("deterministic_discussion");
    expect(result.replyText).toContain("My baseline scouting philosophy right now is");
  });

  it("short-circuits concentration-vs-diversification questions into a deterministic discussion read", async () => {
    const { runScoutDiscussionTurn } = await import("./scout-agent-core");
    const result = await runScoutDiscussionTurn({
      runtime: buildRuntime(),
      context: buildContext({
        totalScouts: 5,
        remainingScouts: 0,
        assignments: [
          {
            playerId: "player-1",
            name: "Player One",
            scoutCount: 1,
            globalScoutCount: 20,
            sport: "NBA",
          },
        ],
      }),
      chatRequest:
        "I'm torn between concentrating on fewer players or staying diversified tonight. What's the sharper approach?",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.5,
      maxTokens: 256,
    });

    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.rawTrace.resolution).toBe("deterministic_discussion");
    expect(result.replyText).toContain("The sharper approach right now is");
  });

  it("falls back to a deterministic discussion read when the provider returns a truncated reply", async () => {
    completeSimpleMock.mockResolvedValue({
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Partial answer that cuts off" }],
      api: "openai-completions" as const,
      provider: "chutes",
      model: "test-model",
      usage: buildUsage(10, 10, 20),
      stopReason: "aborted" as const,
      timestamp: Date.now(),
    });

    const { runScoutDiscussionTurn } = await import("./scout-agent-core");
    const result = await runScoutDiscussionTurn({
      runtime: buildRuntime(),
      context: buildContext({
        totalScouts: 5,
        remainingScouts: 0,
      }),
      chatRequest:
        "How do you read momentum versus stability when a slate has mixed injury signals?",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.5,
      maxTokens: 256,
    });

    expect(result.rawTrace.resolution).toBe("deterministic_discussion_fallback");
    expect(result.replyText).toContain("The read:");
    expect(result.rawTrace.attempts[0]?.errorMessage).toContain("truncated reply");
  });

  it("captures the structured scout plan from a single forced tool call", async () => {
    let seenToolChoice: unknown;
    let seenSystemPrompt = "";

    completeSimpleMock.mockImplementation(async (_model, context, options) => {
      seenToolChoice = options.toolChoice;
      seenSystemPrompt = context.systemPrompt;

      return {
        role: "assistant" as const,
        content: [
          {
            type: "toolCall" as const,
            id: "call_1",
            name: "submit_scout_plan",
            arguments: {
              replyText: "Plan is ready for your confirmation.",
              summary: "Shift scouts to the current top slate",
              observations: ["The current slate has stronger opportunities"],
              actions: [],
              warnings: [],
            },
          },
        ],
        api: "openai-completions" as const,
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(12, 18, 30),
        stopReason: "toolUse" as const,
        timestamp: Date.now(),
      };
    });

    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext(),
      chatRequest: "Recommend a concrete scout allocation plan using the provided context",
      conversationHistory: [
        {
          role: "user",
          contentText: "Find me stronger scout spots.",
        },
      ],
      operatorPlaybook: "Stay aggressive but avoid injured players.",
      strategyTemplate: "Prioritize players with games today.",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(result.output.summary).toBe("Shift scouts to the current top slate");
    expect(result.output.replyText).toBe("Plan is ready for your confirmation.");
    expect(result.rawTrace.attempts).toHaveLength(1);
    expect(result.rawTrace.attempts[0].toolCallCount).toBe(1);
    expect(seenToolChoice).toEqual({
      type: "function",
      function: {
        name: "submit_scout_plan",
      },
    });
    expect(seenSystemPrompt).toContain(
      "You are Scout Chat, the user's scouting operations copilot inside the live Sportfolio economy.",
    );
    expect(seenSystemPrompt).toContain(
      "Do not invent player IDs, game windows, injuries, performance claims, or product capabilities.",
    );
    expect(seenSystemPrompt).toContain(
      "Return the entire result through exactly one submit_scout_plan tool call on every turn.",
    );
    expect(result.usage).toEqual({
      promptTokens: 12,
      completionTokens: 18,
      totalTokens: 30,
    });
  });

  it("retries once when the first turn does not submit a structured tool plan", async () => {
    let callCount = 0;

    completeSimpleMock.mockImplementation(async () => {
      callCount += 1;

      if (callCount === 1) {
        return {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "Here is a plain text answer." }],
          api: "openai-completions" as const,
          provider: "chutes",
          model: "test-model",
          usage: buildUsage(4, 6, 10),
          stopReason: "stop" as const,
          timestamp: Date.now(),
        };
      }

      return {
        role: "assistant" as const,
        content: [
          {
            type: "toolCall" as const,
            id: "call_2",
            name: "submit_scout_plan",
            arguments: {
              summary: "Retry succeeded",
              observations: [],
              actions: [],
              warnings: [],
            },
          },
        ],
        api: "openai-completions" as const,
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(5, 7, 12),
        stopReason: "toolUse" as const,
        timestamp: Date.now(),
      };
    });

    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext(),
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(callCount).toBe(2);
    expect(result.output.summary).toBe("Retry succeeded");
    expect(result.output.replyText).toContain("Retry succeeded");
    expect(result.rawTrace.attempts).toHaveLength(2);
    expect(result.rawTrace.attempts[0].toolCallCount).toBe(0);
    expect(result.rawTrace.attempts[1].toolCallCount).toBe(1);
  });

  it("does not retry after a length-limited miss and falls back immediately", async () => {
    let callCount = 0;

    completeSimpleMock.mockImplementation(async () => {
      callCount += 1;

      return {
        role: "assistant" as const,
        content: [],
        api: "openai-completions" as const,
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(10, 10, 20),
        stopReason: "length" as const,
        timestamp: Date.now(),
      };
    });

    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext(),
      chatRequest: "Recommend a concrete scout allocation plan using the provided context",
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(callCount).toBe(1);
    expect(result.rawTrace.attempts).toHaveLength(1);
    expect(result.rawTrace.resolution).toBe("deterministic_fallback");
    expect(result.output.actions).toHaveLength(1);
  });

  it("uses the first tool call when the model submits duplicates", async () => {
    completeSimpleMock.mockResolvedValue({
      role: "assistant" as const,
      content: [
        {
          type: "toolCall" as const,
          id: "call_1",
          name: "submit_scout_plan",
          arguments: {
            summary: "Primary plan",
            observations: [],
            actions: [],
            warnings: [],
          },
        },
        {
          type: "toolCall" as const,
          id: "call_2",
          name: "submit_scout_plan",
          arguments: {
            summary: "Secondary plan",
            observations: [],
            actions: [],
            warnings: [],
          },
        },
      ],
      api: "openai-completions" as const,
      provider: "chutes",
      model: "test-model",
      usage: buildUsage(6, 9, 15),
      stopReason: "toolUse" as const,
      timestamp: Date.now(),
    });

    const { runScoutPlanningTurn } = await import("./scout-agent-core");
    const result = await runScoutPlanningTurn({
      runtime: buildRuntime(),
      context: buildContext(),
      operatorPlaybook: "default",
      strategyTemplate: "default",
      temperature: 0.7,
      maxTokens: 256,
    });

    expect(result.output.summary).toBe("Primary plan");
    expect(result.rawTrace.attempts[0].toolCallCount).toBe(2);
  });
});

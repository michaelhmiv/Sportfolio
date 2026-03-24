import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAgentModel: vi.fn(),
  classifyAgentProviderFailure: vi.fn(),
  runHermesReadTool: vi.fn(),
  runHermesScanTool: vi.fn(),
  runHermesActionTool: vi.fn(),
  runHermesMemoryTool: vi.fn(),
}));

vi.mock("./agent-model", () => ({
  callAgentModel: mocks.callAgentModel,
  classifyAgentProviderFailure: mocks.classifyAgentProviderFailure,
  stripHiddenReasoningText: (text: string) =>
    text.replace(/<think>[\s\S]*?<\/think>/gi, " ").trim(),
}));

vi.mock("./hermes-tools", () => ({
  runHermesReadTool: mocks.runHermesReadTool,
  runHermesScanTool: mocks.runHermesScanTool,
  runHermesActionTool: mocks.runHermesActionTool,
  runHermesMemoryTool: mocks.runHermesMemoryTool,
}));

import { runHermesModelToolLoop } from "./model-first-router";

function buildUsage() {
  return {
    input: 10,
    output: 8,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 18,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function buildRequest() {
  return {
    userId: "user_1",
    threadId: "thread_1",
    channel: "in_app",
    message: "What should I spend my cash balance on?",
    requestMode: "discussion",
    orchestrationMode: "hermes_first",
    toolAllowlist: ["get_balance_state", "preview_direct_operation"],
    toolCatalog: [
      {
        toolName: "get_balance_state",
        category: "read",
        description: "Read balance state.",
        whenToUse: ["Use when the user asks about cash."],
        whenNotToUse: [],
        examplePrompts: ["What should I spend my cash on?"],
        requiresConfirmation: false,
        riskLevel: "low",
      },
      {
        toolName: "preview_direct_operation",
        category: "plan",
        description: "Stage one action.",
        whenToUse: ["Use when the user asks for one direct action."],
        whenNotToUse: [],
        examplePrompts: ["Buy $20 of a player."],
        requiresConfirmation: true,
        riskLevel: "medium",
      },
    ],
    availableSkills: [],
    skillPolicy: {
      allowRuntimeSkillCreation: true,
      requireAdminApprovalForGlobalSkills: true,
    },
    memoryMode: "read_write",
    autoExecutionPolicy: {
      allowAdvisoryJobs: true,
      allowRiskyActions: false,
    },
    confirmationPolicy: {
      requireExplicitConfirmation: true,
      preferredChannel: "in_app",
    },
    profile: {
      displayName: "My Agent",
      providerMode: "managed",
      model: "test-model",
      baseUrl: null,
      systemPrompt: "test",
      userPromptTemplate: "test",
      temperature: 0.2,
      maxTokens: 800,
    },
    modelRuntime: {
      providerMode: "managed",
      model: "test-model",
    },
    canonicalState: {
      threadId: "thread_1",
      pendingBundleId: null,
      operatorOverview: {
        availableBalance: 125,
        openDailyBoostSlots: 3,
      },
      capabilities: {
        canUseWebResearch: true,
      },
    },
    memoryContext: {
      profile: [],
      episodic: [],
      semantic: [],
    },
    externalContext: {
      canonicalKnowledge: [],
      research: [],
    },
    conversationHistory: [],
    semanticRouteHint: null,
  } as any;
}

describe("model-first-router", () => {
  beforeEach(() => {
    mocks.callAgentModel.mockReset();
    mocks.classifyAgentProviderFailure.mockReset();
    mocks.runHermesReadTool.mockReset();
    mocks.runHermesScanTool.mockReset();
    mocks.runHermesActionTool.mockReset();
    mocks.runHermesMemoryTool.mockReset();
    mocks.classifyAgentProviderFailure.mockReturnValue("unknown");
  });

  it("returns a direct answer when the model answers without tools", async () => {
    mocks.callAgentModel.mockResolvedValue({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Start with a measured NASCAR position instead of leaving the full cash balance idle.",
        },
      ],
      api: "openai-completions",
      provider: "chutes",
      model: "test-model",
      usage: buildUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    });

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: buildRequest(),
      matchedSkill: null,
    });

    expect(result).toMatchObject({
      outcome: "answer",
      summary: "Model answered directly.",
    });
    expect((result as { replyText: string }).replyText).toContain("NASCAR");
  });

  it("can execute a read tool and then answer on the next model pass", async () => {
    mocks.callAgentModel
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "get_balance_state",
            arguments: {},
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "tool_calls",
        timestamp: Date.now(),
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "You have $125 available, so the next move is a measured market entry instead of leaving everything in cash.",
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });
    mocks.runHermesReadTool.mockResolvedValue({
      availableBalance: 125,
      openDailyBoostSlots: 3,
    });

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: buildRequest(),
      matchedSkill: null,
    });

    expect(result.outcome).toBe("answer");
    expect((result as { replyText: string }).replyText).toContain("$125");
    expect(mocks.runHermesReadTool).toHaveBeenCalledWith({
      toolName: "get_balance_state",
      userId: "user_1",
      threadId: "thread_1",
      args: {
        message: "What should I spend my cash balance on?",
      },
    });
  });

  it("returns a planning tool selection for confirmation-gated operations", async () => {
    mocks.callAgentModel.mockResolvedValue({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_1",
          name: "preview_direct_operation",
          arguments: {},
        },
      ],
      api: "openai-completions",
      provider: "chutes",
      model: "test-model",
      usage: buildUsage(),
      stopReason: "tool_calls",
      timestamp: Date.now(),
    });

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: {
        ...buildRequest(),
        requestMode: "plan",
        message: "Plan a trade for me: buy $20 of a player.",
      },
      matchedSkill: null,
    });

    expect(result).toMatchObject({
      outcome: "tool",
      toolName: "preview_direct_operation",
      toolCategory: "plan",
    });
    expect((result as { toolArgs: Record<string, unknown> }).toolArgs.message).toBe(
      "Plan a trade for me: buy $20 of a player.",
    );
  });

  it("rejects premature planning tool calls for broad advisory asks and reroutes to a non-plan answer", async () => {
    mocks.callAgentModel
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "preview_direct_operation",
            arguments: {},
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "tool_calls",
        timestamp: Date.now(),
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Let's start with an MLB allocation plan before staging any move.",
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: {
        ...buildRequest(),
        message: "I want to develop an MLB strategy with the season starting soon",
        requestMode: "discussion",
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("answer");
    expect(result.warnings.some((entry) => entry.includes("advisory-level"))).toBe(true);
    expect(mocks.runHermesReadTool).not.toHaveBeenCalled();
  });

  it("allows explicit trade-planning requests in auto mode to proceed to plan tools", async () => {
    mocks.callAgentModel.mockResolvedValue({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_1",
          name: "preview_direct_operation",
          arguments: {},
        },
      ],
      api: "openai-completions",
      provider: "chutes",
      model: "test-model",
      usage: buildUsage(),
      stopReason: "tool_calls",
      timestamp: Date.now(),
    });

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: {
        ...buildRequest(),
        requestMode: "auto",
        message: "can you plan a trade for me tonight?",
      },
      matchedSkill: null,
    });

    expect(result).toMatchObject({
      outcome: "tool",
      toolName: "preview_direct_operation",
      toolCategory: "plan",
    });
    expect((result as { toolArgs: Record<string, unknown> }).toolArgs.message).toBe(
      "can you plan a trade for me tonight?",
    );
  });

  it("repairs case-insensitive tool names before execution", async () => {
    mocks.callAgentModel
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "GET_BALANCE_STATE",
            arguments: {},
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "tool_calls",
        timestamp: Date.now(),
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "You have enough balance to make a measured move.",
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });
    mocks.runHermesReadTool.mockResolvedValue({
      availableBalance: 125,
    });

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: buildRequest(),
      matchedSkill: null,
    });

    expect(result.outcome).toBe("answer");
    expect(result.repairAttempts).toBeGreaterThan(0);
    expect(result.toolTrace.some((entry) => entry.summary.includes("Normalized tool name"))).toBe(
      true,
    );
  });

  it("compresses context and retries after a provider overflow", async () => {
    mocks.callAgentModel
      .mockRejectedValueOnce(new Error("413 payload too large"))
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Use the compressed context to keep the next move tight.",
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });
    mocks.classifyAgentProviderFailure.mockReturnValue("context_overflow");

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: {
        ...buildRequest(),
        conversationHistory: Array.from({ length: 10 }, (_, index) => ({
          role: index % 2 === 0 ? "user" : "assistant",
          contentText: `Turn ${index} `.repeat(40),
        })),
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("answer");
    expect(result.compressionApplied).toBe(true);
    expect(result.toolTrace.some((entry) => entry.toolName === "model_context_compression")).toBe(
      true,
    );
  });

  it("strips hidden reasoning blocks from the visible reply text", async () => {
    mocks.callAgentModel.mockResolvedValue({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "<think>internal reasoning</think> Keep your cash flexible for boosts.",
        },
      ],
      api: "openai-completions",
      provider: "chutes",
      model: "test-model",
      usage: buildUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    });

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: buildRequest(),
      matchedSkill: null,
    });

    expect(result.outcome).toBe("answer");
    expect((result as { replyText: string }).replyText).toBe("Keep your cash flexible for boosts.");
  });

  it("classifies repeated empty assistant payloads as malformed provider responses", async () => {
    mocks.callAgentModel
      .mockResolvedValueOnce({
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: buildRequest(),
      matchedSkill: null,
    });

    expect(result.outcome).toBe("unsupported");
    expect(result.terminationReason).toBe("empty_provider_response");
    expect(result.providerFailureClass).toBe("malformed_response");
    expect(result.warnings[0]).toMatch(/neither a visible answer nor a valid tool call/i);
  });

  it("returns the latest successful tool result when the provider goes empty after tool use", async () => {
    mocks.callAgentModel
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "get_balance_state",
            arguments: {},
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "tool_calls",
        timestamp: Date.now(),
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });
    mocks.runHermesReadTool.mockResolvedValue({
      replyText: "You have $125 available and three open boost slots.",
      summary: "Balance state reviewed.",
    });

    const result = await runHermesModelToolLoop({
      profile: {
        displayName: "My Agent",
        providerMode: "managed",
        model: "test-model",
        baseUrl: null,
        systemPrompt: "test",
        userPromptTemplate: "test",
        temperature: "0.2",
        maxTokens: 800,
      } as any,
      secret: undefined,
      request: buildRequest(),
      matchedSkill: null,
    });

    expect(result.outcome).toBe("unsupported");
    expect(result.terminationReason).toBe("empty_provider_response");
    expect((result as { replyText: string | null }).replyText).toBe(
      "You have $125 available and three open boost slots.",
    );
    expect(result.summary).toMatch(/latest get_balance_state result/i);
  });
});

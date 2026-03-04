import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  resolveLocalCompatibilityRuntime: vi.fn(),
  runHermesReadTool: vi.fn(),
  runHermesScanTool: vi.fn(),
  runHermesActionTool: vi.fn(),
  runHermesMemoryTool: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: mocks.completeSimple,
}));

vi.mock("./hermes-local", () => ({
  resolveLocalCompatibilityRuntime: mocks.resolveLocalCompatibilityRuntime,
}));

vi.mock("./hermes-tools", () => ({
  runHermesReadTool: mocks.runHermesReadTool,
  runHermesScanTool: mocks.runHermesScanTool,
  runHermesActionTool: mocks.runHermesActionTool,
  runHermesMemoryTool: mocks.runHermesMemoryTool,
}));

import { runHermesModelToolLoop } from "./model-first-router";

function buildRuntime() {
  return {
    apiKey: "test-key",
    model: {
      api: "openai-completions",
      provider: "chutes",
      id: "test-model",
    },
  };
}

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
    mocks.completeSimple.mockReset();
    mocks.resolveLocalCompatibilityRuntime.mockReset();
    mocks.runHermesReadTool.mockReset();
    mocks.runHermesScanTool.mockReset();
    mocks.runHermesActionTool.mockReset();
    mocks.runHermesMemoryTool.mockReset();
    mocks.resolveLocalCompatibilityRuntime.mockResolvedValue(buildRuntime());
  });

  it("returns a direct answer when the model answers without tools", async () => {
    mocks.completeSimple.mockResolvedValue({
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
    mocks.completeSimple
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
    mocks.completeSimple.mockResolvedValue({
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
      request: buildRequest(),
      matchedSkill: null,
    });

    expect(result).toMatchObject({
      outcome: "tool",
      toolName: "preview_direct_operation",
      toolCategory: "plan",
    });
    expect((result as { toolArgs: Record<string, unknown> }).toolArgs.message).toBe(
      "What should I spend my cash balance on?",
    );
  });
});

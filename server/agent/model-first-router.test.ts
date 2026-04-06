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

  it("chains an internal MLB MCP read before selecting a concrete trade plan tool", async () => {
    mocks.callAgentModel
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "mlb_mcp__home_run_leaders",
            arguments: {
              season: 2025,
            },
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
            type: "toolCall",
            id: "call_2",
            name: "preview_direct_operation",
            arguments: {
              message: "buy 10 shares of Aaron Judge",
            },
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "tool_calls",
        timestamp: Date.now(),
      });
    mocks.runHermesReadTool.mockResolvedValue({
      summary: "Loaded MLB data via home_run_leaders.",
      replyText: "Aaron Judge led MLB in home runs last season.",
      context: {
        provider: "internal_mlb_mcp",
      },
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
        message: "buy 10 shares of the mlb player who had the most home runs last year",
        toolAllowlist: ["mlb_mcp__home_run_leaders", "preview_direct_operation"],
        toolCatalog: [
          {
            toolName: "mlb_mcp__home_run_leaders",
            category: "read",
            description: "Read MLB home run leaders from the internal provider.",
            whenToUse: ["Need home run leaderboard context."],
            whenNotToUse: [],
            examplePrompts: ["who led mlb in home runs last year?"],
            requiresConfirmation: false,
            riskLevel: "low",
            inputSchema: {
              type: "object",
              properties: {
                season: {
                  type: "number",
                },
              },
              required: ["season"],
              additionalProperties: true,
            },
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
      } as any,
      matchedSkill: null,
    });

    expect(result).toMatchObject({
      outcome: "tool",
      toolName: "preview_direct_operation",
      toolCategory: "plan",
    });
    expect(mocks.runHermesReadTool).toHaveBeenCalledWith({
      toolName: "mlb_mcp__home_run_leaders",
      userId: "user_1",
      threadId: "thread_1",
      args: {
        season: 2025,
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

  it("anchors the model loop prompt with the current ET date for relative-time requests", async () => {
    mocks.callAgentModel.mockResolvedValue({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I can pull that leaderboard.",
        },
      ],
      api: "openai-completions",
      provider: "chutes",
      model: "test-model",
      usage: buildUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    });

    await runHermesModelToolLoop({
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
        message: "who are top 5 batters in OPS this season that are playing later today?",
      },
      matchedSkill: null,
    });

    const currentDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const firstCall = mocks.callAgentModel.mock.calls[0]?.[0];
    const promptContent = String(firstCall?.messages?.[0]?.content || "");

    expect(promptContent).toContain("<current_time_context>");
    expect(promptContent).toContain(`Current ET date: ${currentDate}.`);
    expect(promptContent).toContain(
      "Interpret relative time phrases like today, later today, tonight, tomorrow, and this slate using America/New_York",
    );
  });

  it("preserves synthesized ui blocks after a tool-backed answer", async () => {
    mocks.callAgentModel
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "scan_top_market_opportunities",
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
            text: "Aaron Judge and Bobby Witt Jr. are the cleanest current entries.",
          },
        ],
        api: "openai-completions",
        provider: "chutes",
        model: "test-model",
        usage: buildUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });
    mocks.runHermesScanTool.mockResolvedValue({
      summary: "Surfaced 2 market-facing opportunity candidate(s).",
      context: {
        recommendedTargets: [
          {
            playerId: "player_1",
            name: "Aaron Judge",
            team: "NYY",
            price: 71.25,
            reason: "Power bat with strong matchup context.",
          },
          {
            playerId: "player_2",
            name: "Bobby Witt Jr.",
            team: "KC",
            price: 58.1,
            reason: "Momentum and lineup support.",
          },
        ],
      },
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
        message: "who should i buy right now?",
        toolAllowlist: ["scan_top_market_opportunities"],
        toolCatalog: [
          {
            toolName: "scan_top_market_opportunities",
            category: "scan",
            description: "Surface ranked market opportunities.",
            whenToUse: ["Use when the user asks who to buy."],
            whenNotToUse: [],
            examplePrompts: ["who should i buy?"],
            requiresConfirmation: false,
            riskLevel: "low",
            presentationProfile: "leaderboard",
            primaryEntityType: "player",
            preferredColumns: ["player", "team", "price", "signal"],
          },
        ],
      } as any,
      matchedSkill: null,
    });

    expect(result.outcome).toBe("answer");
    expect((result as { uiBlocks?: Array<{ type: string }> }).uiBlocks?.[0]?.type).toBe(
      "entity_table",
    );
  });

  it("returns synthesized schedule ui blocks when the provider falls back to the latest tool result", async () => {
    mocks.callAgentModel
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "mlb_mcp__get_schedule",
            arguments: {
              date: "2026-04-05",
              season: "2026",
            },
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
      summary: "Loaded MLB data via get_schedule.",
      replyText: "Yankees @ Red Sox at 7:10 PM ET.",
      context: {
        structuredContent: {
          result: {
            games: [
              {
                gameId: "game_1",
                awayTeam: "NYY",
                homeTeam: "BOS",
                startTime: "2026-04-05T23:10:00.000Z",
                status: "Scheduled",
                venue: "Fenway Park",
              },
            ],
          },
        },
      },
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
        message: "what mlb games are on tonight?",
        toolAllowlist: ["mlb_mcp__get_schedule"],
        toolCatalog: [
          {
            toolName: "mlb_mcp__get_schedule",
            category: "read",
            description: "Read MLB schedule data from the internal provider.",
            whenToUse: ["Use when the user asks about MLB games."],
            whenNotToUse: [],
            examplePrompts: ["what mlb games are on tonight?"],
            requiresConfirmation: false,
            riskLevel: "low",
            presentationProfile: "schedule",
            preferredColumns: ["matchup", "status", "startTime", "venue"],
          },
        ],
      } as any,
      matchedSkill: null,
    });

    expect(result.outcome).toBe("unsupported");
    expect((result as { uiBlocks?: Array<{ type: string }> }).uiBlocks?.[0]?.type).toBe(
      "schedule_board",
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

  it("uses a final answer-only synthesis pass when the model keeps requesting tools past the budget", async () => {
    for (let index = 0; index < 8; index += 1) {
      mocks.callAgentModel.mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: `call_${index + 1}`,
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
      });
    }

    mocks.callAgentModel.mockResolvedValueOnce({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "You have enough balance and open boost capacity to make a measured MLB move tonight.",
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
      replyText: "Balance remains healthy with three boost slots open.",
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

    expect(result.outcome).toBe("answer");
    expect(result.terminationReason).toBe("answer_only_synthesis");
    expect((result as { replyText: string }).replyText).toContain("measured MLB move");
    expect(result.toolTrace.some((entry) => entry.toolName === "model_answer_synthesis")).toBe(
      true,
    );
  });

  it("uses a final plan-only recovery pass for an explicit staged-action request", async () => {
    for (let index = 0; index < 8; index += 1) {
      mocks.callAgentModel.mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: `call_${index + 1}`,
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
      });
    }

    mocks.callAgentModel.mockResolvedValueOnce({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "plan_call_1",
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

    mocks.runHermesReadTool.mockResolvedValue({
      replyText: "Balance remains healthy with three boost slots open.",
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
      request: {
        ...buildRequest(),
        message: "Buy $25 of Byron Buxton and stage it for confirmation.",
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("tool");
    expect(result.terminationReason).toBe("plan_only_recovery");
    expect((result as { toolName: string }).toolName).toBe("preview_direct_operation");
    expect(result.toolTrace.some((entry) => entry.toolName === "model_plan_recovery")).toBe(true);
  });

  it("recovers a compound staged-action request even when the model answers early in prose", async () => {
    mocks.callAgentModel.mockResolvedValueOnce({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I need the player spelling confirmed before I can finish that bundle.",
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
        message: "Buy $100 of Yendy Gomez and put him in my 4x boost slot tomorrow.",
        toolAllowlist: [
          "get_balance_state",
          "preview_direct_operation",
          "preview_multi_action_bundle",
        ],
        toolCatalog: [
          ...buildRequest().toolCatalog,
          {
            toolName: "preview_multi_action_bundle",
            category: "plan",
            description: "Stage a compound action bundle.",
            whenToUse: ["Use when the user asks for multiple linked actions."],
            whenNotToUse: [],
            examplePrompts: ["Buy a player and boost him tomorrow."],
            requiresConfirmation: true,
            riskLevel: "medium",
          },
        ],
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("tool");
    expect(result.terminationReason).toBe("plan_only_recovery");
    expect((result as { toolName: string }).toolName).toBe("preview_multi_action_bundle");
    expect(result.toolTrace.some((entry) => entry.toolName === "model_plan_recovery")).toBe(true);
  });

  it("recovers a community-boost creation request into direct planning even when the model answers in prose", async () => {
    mocks.callAgentModel.mockResolvedValueOnce({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "The best community boost look right now is Byron Buxton.",
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
        message: "create a community boost for Byron Buxton tomorrow",
        toolAllowlist: ["scan_community_boost_candidates", "preview_direct_operation"],
        toolCatalog: [
          {
            toolName: "scan_community_boost_candidates",
            category: "scan",
            description: "Scan community boost candidates.",
            whenToUse: ["Use for advisory community boost questions."],
            whenNotToUse: [],
            examplePrompts: ["who should get my community boost today?"],
            requiresConfirmation: false,
            riskLevel: "low",
          },
          {
            toolName: "preview_direct_operation",
            category: "plan",
            description: "Stage one action.",
            whenToUse: ["Use when the user asks for one direct action."],
            whenNotToUse: [],
            examplePrompts: ["Create a community boost for Byron Buxton tomorrow."],
            requiresConfirmation: true,
            riskLevel: "medium",
          },
        ],
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("tool");
    expect(result.terminationReason).toBe("plan_only_recovery");
    expect((result as { toolName: string }).toolName).toBe("preview_direct_operation");
    expect(result.toolTrace.some((entry) => entry.toolName === "model_plan_recovery")).toBe(true);
  });

  it("recovers a bare scout request into direct planning even when the model answers in prose", async () => {
    mocks.callAgentModel.mockResolvedValueOnce({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "You have several strong scout targets today, including Aaron Judge.",
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
        message: "scout Aaron Judge",
        toolAllowlist: ["preview_direct_operation"],
        toolCatalog: [
          {
            toolName: "preview_direct_operation",
            category: "plan",
            description: "Stage one action.",
            whenToUse: ["Use when the user asks for one direct action."],
            whenNotToUse: [],
            examplePrompts: ["Scout Aaron Judge."],
            requiresConfirmation: true,
            riskLevel: "medium",
          },
        ],
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("tool");
    expect(result.terminationReason).toBe("plan_only_recovery");
    expect((result as { toolName: string }).toolName).toBe("preview_direct_operation");
    expect(result.toolTrace.some((entry) => entry.toolName === "model_plan_recovery")).toBe(true);
  });

  it("recovers a direct boost-slot assignment request instead of falling back to advisory scanning", async () => {
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
      request: {
        ...buildRequest(),
        message: "put Byron Buxton in my 5x boost slot tomorrow",
        toolAllowlist: ["scan_daily_boost_candidates", "preview_direct_operation"],
        toolCatalog: [
          {
            toolName: "scan_daily_boost_candidates",
            category: "scan",
            description: "Scan daily boost candidates.",
            whenToUse: ["Use for advisory boost questions."],
            whenNotToUse: [],
            examplePrompts: ["who can I boost today?"],
            requiresConfirmation: false,
            riskLevel: "low",
          },
          {
            toolName: "preview_direct_operation",
            category: "plan",
            description: "Stage one action.",
            whenToUse: ["Use when the user asks for one direct action."],
            whenNotToUse: [],
            examplePrompts: ["Put Byron Buxton in my 5x boost slot tomorrow."],
            requiresConfirmation: true,
            riskLevel: "medium",
          },
        ],
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("tool");
    expect(result.terminationReason).toBe("plan_only_recovery");
    expect((result as { toolName: string }).toolName).toBe("preview_direct_operation");
    expect(result.toolTrace.some((entry) => entry.toolName === "tool_first_router")).toBe(false);
  });

  it("recovers a bare buy request after two empty provider turns", async () => {
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
      request: {
        ...buildRequest(),
        message: "buy Aaron Judge shares",
        toolAllowlist: ["preview_direct_operation"],
        toolCatalog: [
          {
            toolName: "preview_direct_operation",
            category: "plan",
            description: "Stage one action.",
            whenToUse: ["Use when the user asks for one direct action."],
            whenNotToUse: [],
            examplePrompts: ["Buy Aaron Judge."],
            requiresConfirmation: true,
            riskLevel: "medium",
          },
        ],
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("tool");
    expect(result.terminationReason).toBe("plan_only_recovery");
    expect((result as { toolName: string }).toolName).toBe("preview_direct_operation");
    expect(result.toolTrace.some((entry) => entry.toolName === "model_plan_recovery")).toBe(true);
  });

  it("recovers an explicit compound staged-action request after two empty provider turns", async () => {
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
      request: {
        ...buildRequest(),
        message: "Stack 20 shares of Byron Buxton and put him in my 5x boost slot tomorrow.",
        toolAllowlist: [
          "get_balance_state",
          "preview_direct_operation",
          "preview_multi_action_bundle",
        ],
        toolCatalog: [
          ...buildRequest().toolCatalog,
          {
            toolName: "preview_multi_action_bundle",
            category: "plan",
            description: "Stage a compound action bundle.",
            whenToUse: ["Use when the user asks for multiple linked actions."],
            whenNotToUse: [],
            examplePrompts: ["Stack a player and boost him tomorrow."],
            requiresConfirmation: true,
            riskLevel: "medium",
          },
        ],
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("tool");
    expect(result.terminationReason).toBe("plan_only_recovery");
    expect((result as { toolName: string }).toolName).toBe("preview_multi_action_bundle");
    expect(result.toolTrace.some((entry) => entry.toolName === "model_plan_recovery")).toBe(true);
  });

  it("recovers a setup review through deterministic advisory fallback after empty provider turns", async () => {
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
    mocks.runHermesReadTool.mockResolvedValue({
      availableBalance: 125,
      openDailyBoostSlots: 3,
      communitySharesAvailable: 1,
      stackReadyHoldingRows: 2,
      nextBestLevers: ["deploy idle balance", "fill an open boost slot"],
      topHoldings: [{ name: "Byron Buxton" }],
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
        message: "review my setup",
        toolAllowlist: ["get_operator_overview", "preview_direct_operation"],
        toolCatalog: [
          {
            toolName: "get_operator_overview",
            category: "read",
            description: "Read the main account overview.",
            whenToUse: ["Use for setup reviews."],
            whenNotToUse: [],
            examplePrompts: ["review my setup"],
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
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("answer");
    expect((result as { replyText: string }).replyText).toContain("Setup review");
    expect(mocks.runHermesReadTool).toHaveBeenCalledWith({
      toolName: "get_operator_overview",
      userId: "user_1",
      threadId: "thread_1",
      args: { message: "review my setup" },
    });
    expect(result.toolTrace.some((entry) => entry.toolName === "tool_first_router")).toBe(true);
  });

  it("recovers an MLB stat gameplan through deterministic advisory fallback after empty provider turns", async () => {
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
    mocks.runHermesScanTool.mockResolvedValue({
      replyText:
        "For tomorrow's MLB hitting gameplan, start here:\n1. Aaron Judge (NYY) - OBP #1, OPS #1",
      summary: "Built an MLB hitting gameplan for tomorrow from OBP + OPS leaderboard data.",
      observations: [],
      warnings: [],
      context: {},
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
        message: "based on OBP and OPS, build me an MLB gameplan for tomorrow",
        toolAllowlist: ["scan_mlb_stat_gameplan", "preview_direct_operation"],
        toolCatalog: [
          {
            toolName: "scan_mlb_stat_gameplan",
            category: "scan",
            description: "Build an MLB stat gameplan.",
            whenToUse: ["Use for MLB stat gameplans."],
            whenNotToUse: [],
            examplePrompts: ["based on OBP and OPS, build me an MLB gameplan for tomorrow"],
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
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("answer");
    expect((result as { replyText: string }).replyText).toContain("Aaron Judge");
    expect(mocks.runHermesScanTool).toHaveBeenCalledWith({
      toolName: "scan_mlb_stat_gameplan",
      userId: "user_1",
      args: { message: "based on OBP and OPS, build me an MLB gameplan for tomorrow" },
    });
    expect(result.toolTrace.some((entry) => entry.toolName === "tool_first_router")).toBe(true);
  });

  it("does not force plan recovery for advisory buy-or-avoid gameplan prompts", async () => {
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
            text: "Start with Judge and Rice, and avoid stretching into thin depth names tonight.",
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
      replyText: "Balance remains healthy with three boost slots open.",
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
      request: {
        ...buildRequest(),
        requestMode: "discussion",
        message:
          "Compare Yankees hitters tonight by OBP and OPS and give me a gameplan for who I should buy or avoid.",
      },
      matchedSkill: null,
    });

    expect(result.outcome).toBe("answer");
    expect((result as { replyText: string }).replyText).toContain("Judge and Rice");
    expect(result.toolTrace.some((entry) => entry.toolName === "model_plan_recovery")).toBe(false);
  });
});

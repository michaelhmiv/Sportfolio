import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runHermesPlanTool: vi.fn(),
  runHermesModelToolLoop: vi.fn(),
  runLocalHermesCompatibilityTurn: vi.fn(),
  inferMemoryWritesFromMessage: vi.fn(),
  matchAgentSkill: vi.fn(),
  createOrUpdateUserSkill: vi.fn(),
  proposeGlobalSkillCandidate: vi.fn(),
}));

vi.mock("./hermes-tools", () => ({
  runHermesPlanTool: mocks.runHermesPlanTool,
}));

vi.mock("./model-first-router", () => ({
  runHermesModelToolLoop: mocks.runHermesModelToolLoop,
}));

vi.mock("./hermes-local", () => ({
  runLocalHermesCompatibilityTurn: mocks.runLocalHermesCompatibilityTurn,
}));

vi.mock("./memory", () => ({
  inferMemoryWritesFromMessage: mocks.inferMemoryWritesFromMessage,
}));

vi.mock("./skills", () => ({
  matchAgentSkill: mocks.matchAgentSkill,
  createOrUpdateUserSkill: mocks.createOrUpdateUserSkill,
  proposeGlobalSkillCandidate: mocks.proposeGlobalSkillCandidate,
}));

import { runHermesOrchestrationTurn } from "./hermes-orchestrator";

describe("hermes-orchestrator", () => {
  beforeEach(() => {
    delete process.env.HERMES_ENABLE_COMPATIBILITY_FALLBACK;
    mocks.runHermesPlanTool.mockReset();
    mocks.runHermesModelToolLoop.mockReset();
    mocks.runLocalHermesCompatibilityTurn.mockReset();
    mocks.inferMemoryWritesFromMessage.mockReset();
    mocks.matchAgentSkill.mockReset();
    mocks.createOrUpdateUserSkill.mockReset();
    mocks.proposeGlobalSkillCandidate.mockReset();
    mocks.inferMemoryWritesFromMessage.mockReturnValue([]);
    mocks.matchAgentSkill.mockReturnValue(null);
    mocks.createOrUpdateUserSkill.mockResolvedValue(null);
    mocks.proposeGlobalSkillCandidate.mockResolvedValue(null);
  });

  const baseInput = {
    userId: "user_1",
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
    context: {
      remainingScouts: 3,
      operatorOverview: {
        availableBalance: 125,
        portfolioPlayerCount: 3,
        totalPlayerShares: 12,
        stackedHoldingRows: 1,
        stackReadyHoldingRows: 1,
        watchlistCount: 1,
        watchlistEntryCount: 4,
        communitySharesAvailable: 2,
        activeDailyBoostSlots: 1,
        openDailyBoostSlots: 3,
        topHoldings: [],
        nextBestLevers: ["rotate one boost slot"],
      },
      knowledgeBrief: [],
    } as any,
    request: {
      userId: "user_1",
      threadId: "thread_1",
      channel: "in_app",
      message: "buy $25 of Jalen Brunson",
      requestMode: "plan",
      orchestrationMode: "hermes_first",
      toolAllowlist: ["preview_direct_operation"],
      toolCatalog: [],
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
    } as any,
  };

  it("returns an advisory reply from the direct Hermes tool loop", async () => {
    mocks.runHermesModelToolLoop.mockResolvedValue({
      outcome: "answer",
      replyText:
        "The cleanest next step is a measured NASCAR entry and keeping some cash for boosts.",
      summary: "Model answered after tool use.",
      warnings: [],
      citations: [],
      toolTrace: [
        {
          toolName: "get_balance_state",
          phase: "read",
          status: "ok",
          latencyMs: 3,
          summary: "Executed get_balance_state in the model tool loop.",
        },
      ],
    });

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "what nascar drivers should i spend my cash on?",
        requestMode: "discussion",
      },
    });

    expect(result.outcome).toBe("advisory");
    expect(result.assistantText).toContain("NASCAR");
    expect(result.toolCallsUsed).toContain("get_balance_state");
    expect(result.memoryInfluences).toEqual([]);
    expect(mocks.runLocalHermesCompatibilityTurn).not.toHaveBeenCalled();
  });

  it("routes follow-up explanation prompts through the model loop instead of a canned explanation shortcut", async () => {
    mocks.runHermesModelToolLoop.mockResolvedValue({
      outcome: "answer",
      replyText: "I meant your open boost slot is still unused and worth filling before lock.",
      summary: "Model answered after tool use.",
      warnings: [],
      citations: [],
      toolTrace: [],
    });

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "what do you mean?",
        requestMode: "discussion",
        conversationHistory: [
          {
            role: "assistant",
            contentText: "The cleanest next lever is to fill a daily boost slot before lock.",
          },
        ],
      },
    });

    expect(result.outcome).toBe("advisory");
    expect(result.assistantText).toContain("unused");
    expect(mocks.runHermesModelToolLoop).toHaveBeenCalledTimes(1);
    expect(result.toolCallsUsed).not.toContain("explain_previous_guidance");
  });

  it("runs the selected planning tool when the direct loop escalates to a plan tool", async () => {
    mocks.runHermesModelToolLoop.mockResolvedValue({
      outcome: "tool",
      toolName: "preview_direct_operation",
      toolCategory: "plan",
      toolArgs: {
        message: "buy $25 of Jalen Brunson",
      },
      summary: "The model selected preview_direct_operation.",
      warnings: [],
      citations: [],
      toolTrace: [
        {
          toolName: "model_tool_loop",
          phase: "plan",
          status: "ok",
          latencyMs: 4,
          summary: "The model selected preview_direct_operation for confirmation-gated planning.",
        },
      ],
    });
    mocks.runHermesPlanTool.mockResolvedValue({
      replyText: "I can stage that buy.",
      summary: "Buy $25 of Jalen Brunson",
      warnings: [],
      actions: [
        {
          actionType: "pool_buy",
          playerId: "nba_1",
          playerName: "Jalen Brunson",
          sbAmount: 25,
          availableBalanceBefore: 125,
          availableBalanceAfter: 100,
          reasoning: "Stage a buy.",
          confidence: 0.9,
        },
      ],
    });

    const result = await runHermesOrchestrationTurn(baseInput);

    expect(result.outcome).toBe("staged_plan");
    expect(result.requiresConfirmation).toBe(true);
    expect(result.confirmationPreview?.actionSummary).toContain("Buy");
    expect(mocks.runHermesPlanTool).toHaveBeenCalledWith({
      toolName: "preview_direct_operation",
      userId: "user_1",
      args: {
        message: "buy $25 of Jalen Brunson",
      },
    });
  });

  it("keeps runtime skill creation for successful multi-action bundle previews", async () => {
    mocks.runHermesModelToolLoop.mockResolvedValue({
      outcome: "tool",
      toolName: "preview_multi_action_bundle",
      toolCategory: "plan",
      toolArgs: {
        message: "buy, stack shares, then boost this player",
      },
      summary: "The model selected preview_multi_action_bundle.",
      warnings: [],
      citations: [],
      toolTrace: [
        {
          toolName: "model_tool_loop",
          phase: "plan",
          status: "ok",
          latencyMs: 4,
          summary:
            "The model selected preview_multi_action_bundle for confirmation-gated planning.",
        },
      ],
    });
    mocks.runHermesPlanTool.mockResolvedValue({
      replyText: "I can stage that compound workflow.",
      summary: "Compound boost workflow",
      warnings: [],
      actions: [
        {
          actionType: "holdings_stack_shares",
          playerId: "nba_1",
          playerName: "Amen Thompson",
          sharesToStack: 2,
          expectedMultiplierGained: 1,
          availableSharesBefore: 4,
          availableSharesAfter: 2,
          reasoning: "Stack Shares before boosting",
        },
      ],
    });
    mocks.createOrUpdateUserSkill.mockResolvedValue({
      id: "skill_user_1",
      constraints: { signature: "sig" },
      triggerExamples: [],
      toolSequence: [],
      clarificationStrategy: {},
      confidence: 0.8,
      sourceThreadId: "thread_1",
      scope: "user",
      status: "active",
      userId: "user_1",
      name: "compound operation bundle",
      description: "skill",
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    });
    mocks.proposeGlobalSkillCandidate.mockResolvedValue({
      id: "skill_global_candidate_1",
    });

    const result = await runHermesOrchestrationTurn(baseInput);

    expect(result.outcome).toBe("staged_plan");
    expect(result.createdSkillCandidates).toEqual(["skill_user_1", "skill_global_candidate_1"]);
  });

  it("uses an unsupported direct-loop reply when the model provides one", async () => {
    mocks.runHermesModelToolLoop.mockResolvedValue({
      outcome: "unsupported",
      replyText: "I need a player name before I can narrow this down.",
      summary: "Need a narrower target.",
      warnings: ["The prompt was too broad for a concrete recommendation."],
      citations: [],
      toolTrace: [],
    });

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "which one?",
        requestMode: "discussion",
      },
    });

    expect(result.outcome).toBe("advisory");
    expect(result.assistantText).toContain("player name");
    expect(result.warnings).toContain("The prompt was too broad for a concrete recommendation.");
  });

  it("falls back to a transparent advisory when the direct loop returns nothing usable", async () => {
    mocks.runHermesModelToolLoop.mockResolvedValue({
      outcome: "unsupported",
      replyText: null,
      summary: "No usable answer.",
      warnings: ["The direct Hermes tool loop did not return a usable answer."],
      citations: [],
      toolTrace: [],
    });

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "talk me through tonight's setup",
        requestMode: "discussion",
      },
    });

    expect(result.outcome).toBe("advisory");
    expect(result.assistantText).toContain("direct tool loop");
    expect(result.toolCallsUsed).toContain("model_first_fallback");
  });

  it("surfaces empty provider responses instead of hiding them behind a generic fallback", async () => {
    mocks.runHermesModelToolLoop.mockResolvedValue({
      outcome: "unsupported",
      replyText: null,
      summary: "The model returned an empty response twice.",
      warnings: [
        "The provider returned neither a visible answer nor a valid tool call after one repair retry.",
      ],
      citations: [],
      toolTrace: [],
      terminationReason: "empty_provider_response",
      providerFailureClass: "malformed_response",
    });

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "i want you to invest in the best mlb players throughout this week",
        requestMode: "discussion",
      },
    });

    expect(result.outcome).toBe("advisory");
    expect(result.assistantText).toContain("empty turn");
    expect(result.warnings[0]).toMatch(/visible answer nor a valid tool call/i);
    expect(result.toolCallsUsed).toContain("model_first_fallback");
  });

  it("returns a local orchestrator error when compatibility fallback is disabled", async () => {
    mocks.matchAgentSkill.mockImplementation(() => {
      throw new Error("skill matcher failed");
    });

    const result = await runHermesOrchestrationTurn(baseInput);

    expect(result.outcome).toBe("error");
    expect(result.assistantText).toBe("skill matcher failed");
    expect(mocks.runLocalHermesCompatibilityTurn).not.toHaveBeenCalled();
    expect(result.toolCallsUsed).toContain("hermes_orchestration");
  });

  it("uses the compatibility bridge only when explicitly enabled", async () => {
    process.env.HERMES_ENABLE_COMPATIBILITY_FALLBACK = "true";
    mocks.matchAgentSkill.mockImplementation(() => {
      throw new Error("skill matcher failed");
    });
    mocks.runLocalHermesCompatibilityTurn.mockResolvedValue({
      outcome: "advisory",
      assistantText: "Fallback reply.",
      summary: null,
      warnings: [],
      proposedActions: [],
      pendingClarification: null,
      citations: [],
      proposedMemoryWrites: [],
      toolTrace: [],
      toolCallsUsed: [],
      requiresConfirmation: false,
      confirmationPreview: null,
    });

    const result = await runHermesOrchestrationTurn(baseInput);

    expect(result.assistantText).toBe("Fallback reply.");
    expect(result.fallbackUsed).toBe(true);
    expect(mocks.runLocalHermesCompatibilityTurn).toHaveBeenCalledTimes(1);
  });
});

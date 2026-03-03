import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runHermesPlanTool: vi.fn(),
  runHermesReadTool: vi.fn(),
  runLocalHermesCompatibilityTurn: vi.fn(),
  runHermesScanTool: vi.fn(),
  inferMemoryWritesFromMessage: vi.fn(),
  matchAgentSkill: vi.fn(),
  createOrUpdateUserSkill: vi.fn(),
  proposeGlobalSkillCandidate: vi.fn(),
}));

vi.mock("./hermes-tools", () => ({
  runHermesPlanTool: mocks.runHermesPlanTool,
  runHermesReadTool: mocks.runHermesReadTool,
  runHermesScanTool: mocks.runHermesScanTool,
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
    mocks.runHermesPlanTool.mockReset();
    mocks.runHermesReadTool.mockReset();
    mocks.runLocalHermesCompatibilityTurn.mockReset();
    mocks.runHermesScanTool.mockReset();
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
      operatorOverview: {
        availableBalance: 125,
        portfolioPlayerCount: 3,
        totalPlayerShares: 12,
        poweredHoldingRows: 1,
        powerReadyHoldingRows: 1,
        watchlistCount: 1,
        watchlistEntryCount: 4,
        communitySharesAvailable: 2,
        activeDailyBoostSlots: 1,
        openDailyBoostSlots: 3,
        claimableVestingShares: 2,
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

  it("returns a staged plan with confirmation metadata when the direct planner matches", async () => {
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
    expect(result.toolCallsUsed).toContain("preview_direct_operation");
    expect(mocks.runHermesPlanTool).toHaveBeenCalledWith({
      toolName: "preview_direct_operation",
      userId: "user_1",
      args: {
        message: "buy $25 of Jalen Brunson",
      },
    });
    expect(mocks.runLocalHermesCompatibilityTurn).not.toHaveBeenCalled();
  });

  it("uses the model-backed operator turn before falling back to static advisory text", async () => {
    mocks.runHermesPlanTool.mockRejectedValue(new Error("No direct plan"));
    mocks.runHermesReadTool.mockResolvedValue(null);
    mocks.runLocalHermesCompatibilityTurn.mockResolvedValue({
      outcome: "advisory",
      assistantText:
        "The main read is that your current setup is solid, but you should tighten one boost slot before lock.",
      summary: "Model-backed operator read.",
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

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "talk me through tonight's setup",
        requestMode: "discussion",
        toolAllowlist: [],
      },
    });

    expect(result.outcome).toBe("advisory");
    expect(result.assistantText).toContain("tighten one boost slot before lock");
    expect(result.requiresConfirmation).toBe(false);
    expect(mocks.runLocalHermesCompatibilityTurn).toHaveBeenCalledTimes(1);
    expect(result.toolCallsUsed).toContain("respond_to_user_turn");
  });

  it("routes ambiguous boost-slot questions through the boost scan before the scout fallback", async () => {
    mocks.runHermesPlanTool.mockRejectedValue(new Error("No explicit plan"));
    mocks.runHermesReadTool.mockResolvedValue(null);
    mocks.runHermesScanTool.mockResolvedValue({
      toolName: "scan_daily_boost_candidates",
      domain: "daily_boosts",
      summary: "Scanned boost eligibility.",
      replyText:
        "You have 3 open daily boost slots. The best candidates right now are Jalen Brunson and Anthony Edwards.",
      observations: [],
      warnings: [],
      context: {},
    });

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "who can i put in my boost slots for tonight?",
        requestMode: "discussion",
        toolAllowlist: [],
      },
    });

    expect(result.outcome).toBe("advisory");
    expect(result.assistantText).toContain("open daily boost slots");
    expect(result.toolCallsUsed).toContain("scan_daily_boost_candidates");
    expect(mocks.runLocalHermesCompatibilityTurn).not.toHaveBeenCalled();
  });

  it("uses the multi-action bundle planner for compound operational turns", async () => {
    mocks.runHermesPlanTool.mockResolvedValue({
      replyText: "I can stage that compound workflow.",
      summary: "Compound boost workflow",
      warnings: [],
      actions: [
        {
          actionType: "holdings_condense",
          playerId: "nba_1",
          playerName: "Amen Thompson",
          sharesToCondense: 2,
          expectedPowerGained: 1,
          availableSharesBefore: 4,
          availableSharesAfter: 2,
          reasoning: "Condense before boosting",
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

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message:
          "can you power up amen and then put him at 4x and condense jokic and put him at 5x?",
        requestMode: "plan",
        toolAllowlist: ["preview_multi_action_bundle"],
      },
    });

    expect(mocks.runHermesPlanTool).toHaveBeenCalledWith({
      toolName: "preview_multi_action_bundle",
      userId: "user_1",
      args: {
        message:
          "can you power up amen and then put him at 4x and condense jokic and put him at 5x?",
      },
    });
    expect(result.outcome).toBe("staged_plan");
    expect(result.createdSkillCandidates).toEqual(["skill_user_1", "skill_global_candidate_1"]);
  });

  it("keeps a valid compound plan when runtime skill persistence fails", async () => {
    mocks.runHermesPlanTool.mockResolvedValue({
      replyText: "I can stage that compound workflow.",
      summary: "Compound boost workflow",
      warnings: [],
      actions: [
        {
          actionType: "holdings_condense",
          playerId: "nba_1",
          playerName: "Amen Thompson",
          sharesToCondense: 2,
          expectedPowerGained: 1,
          availableSharesBefore: 4,
          availableSharesAfter: 2,
          reasoning: "Condense before boosting",
        },
      ],
    });
    mocks.createOrUpdateUserSkill.mockRejectedValue(new Error("db write failed"));

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "power up amen and then put him at 4x",
        requestMode: "plan",
        toolAllowlist: ["preview_multi_action_bundle"],
      },
    });

    expect(result.outcome).toBe("staged_plan");
    expect(result.createdSkillCandidates).toEqual([]);
    expect(result.toolTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "create_runtime_skill",
          phase: "memory",
          status: "failed",
        }),
      ]),
    );
    expect(mocks.runLocalHermesCompatibilityTurn).not.toHaveBeenCalled();
  });

  it("uses a matched runtime skill before generic model fallback", async () => {
    mocks.matchAgentSkill.mockReturnValue({
      matched: true,
      skillId: "skill_user_1",
      confidence: 0.9,
      reason: "Matched a prior boost workflow",
    });
    mocks.runHermesPlanTool.mockResolvedValue({
      replyText: "I can stage that from the saved workflow.",
      summary: "Saved boost workflow",
      warnings: [],
      actions: [],
    });

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "run that same boost workflow again",
        requestMode: "plan",
        availableSkills: [
          {
            id: "skill_user_1",
            scope: "user",
            status: "active",
            userId: "user_1",
            name: "repeat boost workflow",
            description: "reuses the multi-action boost planner",
            triggerExamples: ["run that same boost workflow again"],
            toolSequence: [
              {
                stepType: "tool_call",
                toolCategory: "plan",
                toolName: "preview_multi_action_bundle",
                argumentTemplate: {},
              },
            ],
            clarificationStrategy: {},
            constraints: { signature: "sig" },
            confidence: 0.9,
            sourceThreadId: "thread_1",
            createdAt: new Date(),
            updatedAt: new Date(),
            archivedAt: null,
          },
        ],
      },
    });

    expect(result.skillsUsed).toEqual(["skill_user_1"]);
    expect(result.skillMatchRationale).toContain("Matched");
    expect(mocks.runLocalHermesCompatibilityTurn).not.toHaveBeenCalled();
  });

  it("explains the previous recommendation on a conversational follow-up", async () => {
    mocks.runHermesPlanTool.mockRejectedValue(new Error("No explicit plan"));
    mocks.runHermesReadTool.mockResolvedValue(null);

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      context: {
        ...baseInput.context,
        remainingScouts: 5,
        operatorOverview: {
          ...baseInput.context.operatorOverview,
          openDailyBoostSlots: 4,
          nextBestLevers: ["fill a daily boost slot before lock", "deploy the 5 unassigned scouts"],
        },
      } as any,
      request: {
        ...baseInput.request,
        message: "what you mean?",
        requestMode: "discussion",
        toolAllowlist: [],
        conversationHistory: [
          {
            role: "assistant",
            contentText:
              "You have $125.00 available. Right now the cleanest next lever is fill a daily boost slot before lock then deploy the 5 unassigned scouts.",
          },
        ],
      },
    });

    expect(result.outcome).toBe("advisory");
    expect(result.summary).toBe("Explained the previous guidance.");
    expect(result.assistantText).toContain("The two levers I was pointing at are");
    expect(result.assistantText).toContain("leaving a payout multiplier unused");
    expect(result.assistantText).toContain("passive share generation back to work");
    expect(mocks.runLocalHermesCompatibilityTurn).not.toHaveBeenCalled();
  });

  it("falls back to a deterministic operator advisory when the model-backed turn is unusable", async () => {
    mocks.runHermesPlanTool.mockRejectedValue(new Error("No explicit plan"));
    mocks.runHermesReadTool.mockResolvedValue(null);
    mocks.runLocalHermesCompatibilityTurn.mockResolvedValue({
      outcome: "unsupported",
      assistantText: "I could not complete that request.",
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

    const result = await runHermesOrchestrationTurn({
      ...baseInput,
      request: {
        ...baseInput.request,
        message: "talk me through tonight's setup",
        requestMode: "discussion",
        toolAllowlist: ["respond_to_user_turn"],
      },
    });

    expect(result.outcome).toBe("advisory");
    expect(result.assistantText).toContain("You have $125.00 available");
    expect(result.toolCallsUsed).toContain("respond_to_user_turn");
  });

  it("falls back to the legacy compatibility bridge if orchestration throws", async () => {
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
    expect(mocks.runLocalHermesCompatibilityTurn).toHaveBeenCalledTimes(1);
    expect(result.toolCallsUsed).toContain("hermes_orchestration");
  });
});

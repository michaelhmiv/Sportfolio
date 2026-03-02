import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  planDirectAgentOperation: vi.fn(),
  planHostedWebResearch: vi.fn(),
  runLocalHermesCompatibilityTurn: vi.fn(),
  inferMemoryWritesFromMessage: vi.fn(),
}));

vi.mock("./operations-planner", () => ({
  planDirectAgentOperation: mocks.planDirectAgentOperation,
}));

vi.mock("./research", () => ({
  planHostedWebResearch: mocks.planHostedWebResearch,
}));

vi.mock("./hermes-local", () => ({
  runLocalHermesCompatibilityTurn: mocks.runLocalHermesCompatibilityTurn,
}));

vi.mock("./memory", () => ({
  inferMemoryWritesFromMessage: mocks.inferMemoryWritesFromMessage,
}));

import { runHermesOrchestrationTurn } from "./hermes-orchestrator";

describe("hermes-orchestrator", () => {
  beforeEach(() => {
    mocks.planDirectAgentOperation.mockReset();
    mocks.planHostedWebResearch.mockReset();
    mocks.runLocalHermesCompatibilityTurn.mockReset();
    mocks.inferMemoryWritesFromMessage.mockReset();
    mocks.inferMemoryWritesFromMessage.mockReturnValue([]);
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
      toolAllowlist: ["preview_direct_operation"],
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
    mocks.planDirectAgentOperation.mockResolvedValue({
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
    expect(mocks.runLocalHermesCompatibilityTurn).not.toHaveBeenCalled();
  });

  it("builds an operator advisory when no deterministic tool route matches", async () => {
    mocks.planDirectAgentOperation.mockResolvedValue(null);
    mocks.planHostedWebResearch.mockResolvedValue(null);

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
    expect(result.assistantText).toContain("You have $125.00 available");
    expect(result.requiresConfirmation).toBe(false);
  });

  it("falls back to the legacy compatibility bridge if orchestration throws", async () => {
    mocks.planDirectAgentOperation.mockRejectedValue(new Error("planner failed"));
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

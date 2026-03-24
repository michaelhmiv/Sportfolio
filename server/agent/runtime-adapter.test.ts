import { describe, expect, it } from "vitest";
import { buildHermesTurnRequest } from "./runtime-adapter";

describe("runtime-adapter", () => {
  it("builds a canonical Hermes request with the visible tool allowlist by default", async () => {
    const request = await buildHermesTurnRequest({
      userId: "user_1",
      threadId: "thread_1",
      channel: "in_app",
      message: "Review my setup.",
      requestMode: "discussion",
      profile: {
        id: "profile_1",
        userId: "user_1",
        enabled: true,
        displayName: "Hermes",
        providerMode: "managed",
        providerType: "openai_compatible",
        runtime: "hermes",
        model: "kimi",
        baseUrl: null,
        systemPrompt: "You are Hermes.",
        userPromptTemplate: "Operate on my portfolio.",
        temperature: "0.20",
        maxTokens: 1200,
        analysisWindowMinutes: 1440,
        defaultSport: "NBA",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      context: {
        generatedAt: new Date().toISOString(),
        analysisWindowMinutes: 1440,
        userPromptTemplate: "Operate on my portfolio.",
        maxScouts: 5,
        totalScouts: 2,
        remainingScouts: 3,
        defaultSport: "NBA",
        assignments: [],
        candidates: [],
        selectionWindow: null,
        recommendedTargets: [],
        operatorOverview: {
          availableBalance: 150,
          portfolioPlayerCount: 3,
          totalPlayerShares: 10,
          stackedHoldingRows: 0,
          stackReadyHoldingRows: 0,
          watchlistCount: 1,
          watchlistEntryCount: 3,
          communitySharesAvailable: 0,
          activeDailyBoostSlots: 0,
          openDailyBoostSlots: 4,
          topHoldings: [],
          nextBestLevers: [],
        },
        knowledgeBrief: [],
      },
      capabilities: {
        domains: ["sportfolio"],
        actionTypes: ["pool_buy"],
        canAnalyze: true,
        canAutoExecute: false,
        canUseWebResearch: true,
        runtime: "hermes",
        hasDurableMemory: true,
        canScheduleAdvisories: true,
      },
      memoryContext: {
        profile: [],
        episodic: [],
        semantic: [],
      },
      availableSkills: [],
      toolCatalog: [
        {
          toolName: "get_balance_state",
          category: "read",
          description: "Read balance state.",
          whenToUse: [],
          whenNotToUse: [],
          examplePrompts: [],
          requiresConfirmation: false,
          riskLevel: "low",
        },
        {
          toolName: "preview_direct_operation",
          category: "plan",
          description: "Preview a plan.",
          whenToUse: [],
          whenNotToUse: [],
          examplePrompts: [],
          requiresConfirmation: true,
          riskLevel: "medium",
          exposure: "advanced",
        },
        {
          toolName: "internal_repair",
          category: "memory",
          description: "Repair internal state.",
          whenToUse: [],
          whenNotToUse: [],
          examplePrompts: [],
          requiresConfirmation: false,
          riskLevel: "low",
          exposure: "internal_only",
        },
      ],
      modelRuntime: {
        providerMode: "managed",
        model: "kimi",
      },
    });

    expect(request.toolAllowlist).toEqual(["get_balance_state", "preview_direct_operation"]);
    expect(request.canonicalState.operatorOverview.availableBalance).toBe(150);
    expect(request.profile.temperature).toBe(0.2);
    expect(request.externalContext.canonicalKnowledge).toEqual([]);
    expect(request.continuityState).toBeNull();
    expect(request.triggerContext).toBeNull();
    expect(request.strategyContext).toBeNull();
    expect(request.executionContext).toBeNull();
  });

  it("carries explicit strategy, trigger, and execution context into the canonical Hermes request", async () => {
    const request = await buildHermesTurnRequest({
      userId: "user_1",
      threadId: "thread_1",
      channel: "in_app",
      message: "Run the saved daily movers strategy.",
      requestMode: "plan",
      profile: {
        id: "profile_1",
        userId: "user_1",
        enabled: true,
        displayName: "Hermes",
        providerMode: "managed",
        providerType: "openai_compatible",
        runtime: "hermes",
        model: "kimi",
        baseUrl: null,
        systemPrompt: "You are Hermes.",
        userPromptTemplate: "Operate on my portfolio.",
        temperature: "0.20",
        maxTokens: 1200,
        analysisWindowMinutes: 1440,
        defaultSport: "NBA",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      context: {
        generatedAt: new Date().toISOString(),
        analysisWindowMinutes: 1440,
        userPromptTemplate: "Operate on my portfolio.",
        maxScouts: 5,
        totalScouts: 2,
        remainingScouts: 3,
        defaultSport: "NBA",
        assignments: [],
        candidates: [],
        selectionWindow: null,
        recommendedTargets: [],
        operatorOverview: {
          availableBalance: 150,
          portfolioPlayerCount: 3,
          totalPlayerShares: 10,
          stackedHoldingRows: 0,
          stackReadyHoldingRows: 0,
          watchlistCount: 1,
          watchlistEntryCount: 3,
          communitySharesAvailable: 0,
          activeDailyBoostSlots: 0,
          openDailyBoostSlots: 4,
          topHoldings: [],
          nextBestLevers: [],
        },
        knowledgeBrief: [],
      },
      capabilities: {
        domains: ["sportfolio"],
        actionTypes: ["pool_buy"],
        canAnalyze: true,
        canAutoExecute: false,
        canUseWebResearch: true,
        runtime: "hermes",
        hasDurableMemory: true,
        canScheduleAdvisories: true,
      },
      memoryContext: {
        profile: [],
        episodic: [],
        semantic: [],
      },
      continuityState: {
        headline: "Hermes has recent activity and scheduled follow-up work.",
        summary:
          "Hermes should reason from ongoing operator state: 1 active strategy context, 0 waiting items, 1 scheduled follow-up.",
        recentActions: [
          {
            id: "run_1:pool_buy:player_1",
            title: "Bought Player One",
            summary: "Deployed $10.00 into Player One.",
            createdAt: new Date("2026-03-18T12:15:00.000Z"),
            source: "strategy_run",
          },
        ],
        openLoops: [],
        activeStrategies: [
          {
            strategyId: "strategy_1",
            name: "Daily movers",
            status: "live",
            nextRunAt: new Date("2026-03-18T13:00:00.000Z"),
            lastOutcomeSummary: "Hermes is pacing deployment through the week.",
          },
        ],
        evidenceUpdates: [],
      },
      availableSkills: [],
      toolCatalog: [],
      modelRuntime: {
        providerMode: "managed",
        model: "kimi",
      },
      strategyContext: {
        strategyId: "strategy_1",
        sourceThreadId: "thread_1",
        status: "live",
        mandate: "Buy the strongest daily movers each morning.",
        normalizedRuleSheet: {
          cadence: "daily",
        },
        guardrails: {
          maxActionsPerRun: 1,
        },
      },
      triggerContext: {
        source: "strategy_schedule",
        label: "daily_open",
        requestedAt: "2026-03-18T12:00:00.000Z",
      },
      executionContext: {
        kind: "strategy_run",
        allowAutoExecution: true,
        requiresExplicitConfirmation: false,
      },
      conversationMode: "strategy_review",
    });

    expect(request.strategyContext).toMatchObject({
      strategyId: "strategy_1",
      status: "live",
      mandate: "Buy the strongest daily movers each morning.",
    });
    expect(request.triggerContext).toMatchObject({
      source: "strategy_schedule",
      label: "daily_open",
    });
    expect(request.executionContext).toEqual({
      kind: "strategy_run",
      allowAutoExecution: true,
      requiresExplicitConfirmation: false,
    });
    expect(request.continuityState).toMatchObject({
      headline: "Hermes has recent activity and scheduled follow-up work.",
    });
    expect(request.conversationMode).toBe("strategy_review");
  });
});

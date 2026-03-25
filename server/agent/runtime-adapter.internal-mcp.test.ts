import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentRuntimeToolCatalog: vi.fn(),
}));

vi.mock("./hermes-tools", () => ({
  getAgentRuntimeToolCatalog: mocks.getAgentRuntimeToolCatalog,
}));

import { buildHermesTurnRequest } from "./runtime-adapter";

describe("runtime-adapter internal mcp merge", () => {
  it("loads the runtime tool catalog when no explicit catalog is supplied", async () => {
    mocks.getAgentRuntimeToolCatalog.mockResolvedValue([
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
        toolName: "mlb_mcp__home_run_leaders",
        category: "read",
        description: "Internal MLB MCP leaderboard tool.",
        whenToUse: [],
        whenNotToUse: [],
        examplePrompts: [],
        requiresConfirmation: false,
        riskLevel: "low",
      },
    ]);

    const request = await buildHermesTurnRequest({
      userId: "user_1",
      threadId: "thread_1",
      channel: "in_app",
      message: "find me the top MLB home run hitter from last year",
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
        defaultSport: "MLB",
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
        defaultSport: "MLB",
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
      modelRuntime: {
        providerMode: "managed",
        model: "kimi",
      },
    });

    expect(mocks.getAgentRuntimeToolCatalog).toHaveBeenCalledTimes(1);
    expect(request.toolCatalog.map((entry) => entry.toolName)).toEqual([
      "get_balance_state",
      "mlb_mcp__home_run_leaders",
    ]);
    expect(request.toolAllowlist).toEqual(["get_balance_state", "mlb_mcp__home_run_leaders"]);
  });
});

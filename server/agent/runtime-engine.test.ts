import { afterEach, describe, expect, it, vi } from "vitest";

const { logHermesRuntimeSessionMock } = vi.hoisted(() => ({
  logHermesRuntimeSessionMock: vi.fn(async (input: any) => ({
    sessionId: "runtime-session-1",
    transport: input.transport,
    endpoint: input.endpoint || null,
    executionKind: input.executionKind || null,
    triggerSource: input.triggerSource || null,
    strategyId: input.strategyId || null,
    correlationId: input.correlationId || null,
  })),
}));

vi.mock("./runtime-session-logger", () => ({
  logHermesRuntimeSession: logHermesRuntimeSessionMock,
}));

import { __runtimeEngine, runHermesRuntimeTurn } from "./runtime-engine";

const originalHermesAgentUrl = process.env.HERMES_AGENT_URL;
const originalHermesInternalKey = process.env.HERMES_INTERNAL_KEY;
const originalHermesRuntimeMode = process.env.HERMES_RUNTIME_MODE;
const originalServiceRole = process.env.SPORTFOLIO_SERVICE_ROLE;

function buildRuntimeInput() {
  return {
    userId: "user_1",
    threadId: "thread_1",
    channel: "in_app" as const,
    message: "Check my current setup.",
    requestMode: "discussion" as const,
    profile: {
      id: "profile_1",
      userId: "user_1",
      enabled: true,
      displayName: "Hermes",
      providerMode: "managed" as const,
      providerType: "openai_compatible" as const,
      runtime: "hermes" as const,
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
      domains: ["sportfolio"] as const,
      actionTypes: ["pool_buy"] as const,
      canAnalyze: true,
      canAutoExecute: false,
      canUseWebResearch: true,
      runtime: "hermes" as const,
      hasDurableMemory: true,
      canScheduleAdvisories: true,
    },
    memoryContext: {
      profile: [],
      episodic: [],
      semantic: [],
    },
    availableSkills: [],
    toolCatalog: [],
    modelRuntime: {
      providerMode: "managed" as const,
      model: "kimi",
    },
  };
}

afterEach(() => {
  if (typeof originalHermesAgentUrl === "string") {
    process.env.HERMES_AGENT_URL = originalHermesAgentUrl;
  } else {
    delete process.env.HERMES_AGENT_URL;
  }

  if (typeof originalHermesInternalKey === "string") {
    process.env.HERMES_INTERNAL_KEY = originalHermesInternalKey;
  } else {
    delete process.env.HERMES_INTERNAL_KEY;
  }

  if (typeof originalHermesRuntimeMode === "string") {
    process.env.HERMES_RUNTIME_MODE = originalHermesRuntimeMode;
  } else {
    delete process.env.HERMES_RUNTIME_MODE;
  }

  if (typeof originalServiceRole === "string") {
    process.env.SPORTFOLIO_SERVICE_ROLE = originalServiceRole;
  } else {
    delete process.env.SPORTFOLIO_SERVICE_ROLE;
  }

  vi.restoreAllMocks();
  logHermesRuntimeSessionMock.mockClear();
});

describe("runtime-engine", () => {
  it("chooses the sidecar transport only when an external sidecar url is configured", () => {
    delete process.env.SPORTFOLIO_SERVICE_ROLE;
    delete process.env.HERMES_RUNTIME_MODE;
    delete process.env.HERMES_AGENT_URL;
    expect(__runtimeEngine.resolveHermesRuntimeTransport()).toBe("local");

    process.env.HERMES_AGENT_URL = "http://127.0.0.1:5050";
    expect(__runtimeEngine.resolveHermesRuntimeTransport()).toBe("sidecar");

    process.env.SPORTFOLIO_SERVICE_ROLE = "hermes-sidecar";
    expect(__runtimeEngine.resolveHermesRuntimeTransport()).toBe("local");
  });

  it("fails closed when sidecar mode is required but no sidecar url is configured", async () => {
    process.env.HERMES_RUNTIME_MODE = "sidecar_required";
    delete process.env.HERMES_AGENT_URL;
    delete process.env.SPORTFOLIO_SERVICE_ROLE;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runHermesRuntimeTurn(buildRuntimeInput());

    expect(result.outcome).toBe("error");
    expect(result.assistantText).toMatch(/sidecar mode is required/i);
    expect(result.runtimeMetadata?.transport).toBe("sidecar");
  });

  it("executes a sidecar-backed turn through the documented internal endpoint", async () => {
    process.env.HERMES_AGENT_URL = "http://127.0.0.1:5050";
    process.env.HERMES_INTERNAL_KEY = "test-internal-key";
    delete process.env.SPORTFOLIO_SERVICE_ROLE;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "x-hermes-correlation-id" ? "corr-sidecar-1" : null,
      },
      text: async () =>
        JSON.stringify({
          outcome: "advisory",
          assistantText: "Here is the latest setup review.",
          summary: "Sidecar advisory",
          warnings: [],
          proposedActions: [],
          pendingClarification: null,
          citations: [],
          proposedMemoryWrites: [],
          toolTrace: [],
          toolCallsUsed: [],
          skillsUsed: [],
          createdSkillCandidates: [],
          skillMatchRationale: null,
          fallbackUsed: false,
          terminationReason: "answer",
          compressionApplied: false,
          repairAttempts: 0,
          providerFailureClass: null,
          memoryInfluences: [],
          requiresConfirmation: false,
          confirmationPreview: null,
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runHermesRuntimeTurn({
      ...buildRuntimeInput(),
      triggerContext: {
        source: "schedule",
        label: "daily_setup_review",
        jobType: "daily_setup_review",
        requestedAt: "2026-03-18T12:00:00.000Z",
      },
      executionContext: {
        kind: "scheduled_advisory",
        allowAutoExecution: false,
        requiresExplicitConfirmation: true,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:5050/internal/hermes/respond");
    expect(result.outcome).toBe("advisory");
    expect(result.toolTrace[0]?.toolName).toBe("hermes_orchestrator_sidecar");
    expect(result.toolTrace[0]?.summary).toMatch(/configured sidecar transport/i);
    expect(result.runtimeMetadata).toMatchObject({
      transport: "sidecar",
      endpoint: "http://127.0.0.1:5050/internal/hermes/respond",
      correlationId: "corr-sidecar-1",
      executionKind: "scheduled_advisory",
      triggerSource: "schedule",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || "{}"));
    expect(requestBody.triggerContext).toMatchObject({
      source: "schedule",
      jobType: "daily_setup_review",
    });
    expect(requestBody.executionContext).toEqual({
      kind: "scheduled_advisory",
      allowAutoExecution: false,
      requiresExplicitConfirmation: true,
    });
  });

  it("returns a classified sidecar failure without falling back locally when the sidecar request errors", async () => {
    process.env.HERMES_AGENT_URL = "http://127.0.0.1:5050";
    process.env.HERMES_INTERNAL_KEY = "test-internal-key";
    delete process.env.SPORTFOLIO_SERVICE_ROLE;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));

    const result = await runHermesRuntimeTurn(buildRuntimeInput());

    expect(result.outcome).toBe("error");
    expect(result.assistantText).toMatch(/connection reset/i);
    expect(result.terminationReason).toBe("sidecar_exception");
    expect(result.runtimeMetadata?.transport).toBe("sidecar");
  });
});

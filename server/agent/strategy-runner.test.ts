import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  insertQueue,
  updateQueue,
  dbMock,
  analyzePortfolioAgentMock,
  executeAgentActionsMock,
  ensureUserAgentStrategySchemaMock,
  recordUserAgentStrategyEventMock,
  listAgentThreadMessagesMock,
  listAgentThreadResearchSourcesMock,
  computeStrategyNextRunAtMock,
  getStrategyStageEventTriggerMock,
  buildStrategyStagePromptMock,
  getStageOutcomesMock,
  getActiveStrategyStageMock,
} = vi.hoisted(() => {
  const localSelectQueue: any[] = [];
  const localInsertQueue: any[] = [];
  const localUpdateQueue: any[] = [];

  function createQueryChain(result: any) {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(result)),
      values: vi.fn(() => chain),
      set: vi.fn(() => chain),
      returning: vi.fn(() => Promise.resolve(result)),
      then: (resolve: (value: any) => any, reject?: (reason: unknown) => any) =>
        Promise.resolve(result).then(resolve, reject),
    };

    return chain;
  }

  return {
    selectQueue: localSelectQueue,
    insertQueue: localInsertQueue,
    updateQueue: localUpdateQueue,
    dbMock: {
      select: vi.fn(() => createQueryChain(localSelectQueue.shift() ?? [])),
      insert: vi.fn(() => createQueryChain(localInsertQueue.shift() ?? [])),
      update: vi.fn(() => createQueryChain(localUpdateQueue.shift() ?? [])),
    },
    analyzePortfolioAgentMock: vi.fn(),
    executeAgentActionsMock: vi.fn(),
    ensureUserAgentStrategySchemaMock: vi.fn(async () => undefined),
    recordUserAgentStrategyEventMock: vi.fn(async () => ({
      id: "event_1",
      strategyId: "strategy_1",
      userId: "user_1",
      strategyRunId: null,
      eventType: "run_completed",
      status: "success",
      title: "Recorded",
      summary: null,
      eventKey: null,
      metadata: {},
      createdAt: new Date("2026-03-18T12:00:00.000Z"),
    })),
    listAgentThreadMessagesMock: vi.fn(),
    listAgentThreadResearchSourcesMock: vi.fn(async () => []),
    computeStrategyNextRunAtMock: vi.fn(() => new Date("2026-03-19T13:00:00.000Z")),
    getStrategyStageEventTriggerMock: vi.fn(async () => null),
    buildStrategyStagePromptMock: vi.fn(() => "Run the active strategy stage"),
    getStageOutcomesMock: vi.fn(() => []),
    getActiveStrategyStageMock: vi.fn(() => ({
      id: "stage_1",
      title: "Active Stage",
      triggerPolicy: { kind: "recurring_cron" },
      actionScope: [],
    })),
  };
});

vi.mock("../db", () => ({
  db: dbMock,
}));

vi.mock("./service", () => ({
  analyzePortfolioAgent: analyzePortfolioAgentMock,
}));

vi.mock("./executor", () => ({
  executeAgentActions: executeAgentActionsMock,
}));

vi.mock("./strategies", () => ({
  ensureUserAgentStrategySchema: ensureUserAgentStrategySchemaMock,
  recordUserAgentStrategyEvent: recordUserAgentStrategyEventMock,
}));

vi.mock("./thread-service", () => ({
  listAgentThreadMessages: listAgentThreadMessagesMock,
  listAgentThreadResearchSources: listAgentThreadResearchSourcesMock,
}));

vi.mock("./strategy-timeline", () => ({
  buildStrategyStagePrompt: buildStrategyStagePromptMock,
  computeStrategyNextRunAt: computeStrategyNextRunAtMock,
  getStrategyStageEventTrigger: getStrategyStageEventTriggerMock,
  getStageOutcomes: getStageOutcomesMock,
  getActiveStrategyStage: getActiveStrategyStageMock,
}));

import {
  __strategyRunner,
  runTriggeredUserAgentStrategies,
  runUserAgentStrategy,
} from "./strategy-runner";

function buildStrategyRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: "strategy_1",
    userId: "user_1",
    sourceThreadId: "thread_1",
    name: "Daily Movers",
    summary: "Track the strongest daily movers.",
    mandateText: "Buy the top movers every morning.",
    normalizedRuleSheet: {},
    timeline: {
      objective: "Track the strongest daily movers.",
      currentStageId: "stage_1",
      stages: [
        {
          id: "stage_1",
          title: "Morning review",
          summary: "Check the strongest movers each morning.",
          status: "active",
          actionScope: ["pool_buy", "pool_sell"],
          triggerPolicy: {
            kind: "recurring_cron",
            anchor: "daily_at_time",
            scheduleCron: "0 8 * * *",
            timezone: "America/New_York",
          },
        },
      ],
    },
    status: "live",
    scheduleCron: "0 8 * * *",
    eventSubscriptions: ["schedule"],
    allowedActionTypes: ["pool_buy", "pool_sell"],
    guardrails: {
      maxActionsPerRun: 1,
      maxActionsPerDay: 3,
    },
    reviewState: {
      status: "approved",
      reviewedAt: new Date("2026-03-18T11:45:00.000Z"),
      lastMaterialUpdateAt: new Date("2026-03-18T11:40:00.000Z"),
      summary: "The saved playbook is approved.",
    },
    requiresReview: false,
    linkedSkillId: null,
    lastOutcomeSummary: null,
    lastRunAt: null,
    nextRunAt: new Date("2026-03-18T13:00:00.000Z"),
    activatedAt: new Date("2026-03-18T12:00:00.000Z"),
    pausedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-03-18T11:00:00.000Z"),
    updatedAt: new Date("2026-03-18T11:30:00.000Z"),
    ...overrides,
  };
}

function buildPendingRunRow() {
  return {
    id: "strategy_run_pending",
    strategyId: "strategy_1",
    userId: "user_1",
    threadId: "thread_1",
    hermesRunId: null,
    runtimeSessionId: null,
    runtimeTransport: null,
    runtimeEndpoint: null,
    runtimeCorrelationId: null,
    triggerSource: "manual_retry",
    status: "running",
    outcomeSummary: null,
    toolTrace: [],
    appliedActions: [],
    adaptationNotes: null,
    failureReason: null,
    createdAt: new Date("2026-03-18T12:00:00.000Z"),
    completedAt: null,
  };
}

function buildCompletedRunRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    ...buildPendingRunRow(),
    id: "strategy_run_1",
    hermesRunId: "hermes_run_1",
    runtimeSessionId: "runtime_session_1",
    runtimeTransport: "sidecar",
    runtimeEndpoint: "http://127.0.0.1:5050/internal/hermes/respond",
    runtimeCorrelationId: "corr-1",
    status: "applied",
    outcomeSummary: "Bought the strongest mover.",
    toolTrace: [],
    appliedActions: [
      {
        actionType: "pool_buy",
        playerId: "player_1",
        sbAmount: 25,
        maxSlippage: 0.05,
        reasoning: "Momentum stayed intact.",
        confidence: 0.82,
      },
    ],
    completedAt: new Date("2026-03-18T12:05:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  selectQueue.length = 0;
  insertQueue.length = 0;
  updateQueue.length = 0;
  dbMock.select.mockClear();
  dbMock.insert.mockClear();
  dbMock.update.mockClear();
  analyzePortfolioAgentMock.mockReset();
  executeAgentActionsMock.mockReset();
  ensureUserAgentStrategySchemaMock.mockClear();
  recordUserAgentStrategyEventMock.mockClear();
  listAgentThreadMessagesMock.mockReset();
  listAgentThreadResearchSourcesMock.mockReset();
  computeStrategyNextRunAtMock.mockClear();
  getStrategyStageEventTriggerMock.mockReset();
  buildStrategyStagePromptMock.mockClear();
  __strategyRunner.resetTriggeredWakeCursor();
  listAgentThreadMessagesMock.mockResolvedValue([
    {
      role: "user",
      contentText: "Keep buying the strongest movers every morning.",
    },
    {
      role: "assistant",
      contentText: "I will track the movers board and wait for the next trigger.",
    },
  ]);
});

describe("strategy-runner", () => {
  it("routes a manual strategy run through Hermes, executes the approved action, and preserves sidecar provenance", async () => {
    selectQueue.push([buildStrategyRow()], []);
    insertQueue.push([buildPendingRunRow()], [{ createdAt: new Date("2026-03-18T12:06:00.000Z") }]);
    updateQueue.push([buildCompletedRunRow()], [], []);
    analyzePortfolioAgentMock.mockResolvedValue({
      runId: "hermes_run_1",
      status: "completed",
      domain: "sportfolio",
      requestMessage: "Run the strategy",
      replyText: "The top mover still has enough momentum to buy.",
      summary: "Bought the strongest mover.",
      observations: [],
      warnings: [],
      actions: [
        {
          actionType: "pool_buy",
          playerId: "player_1",
          sbAmount: 25,
          maxSlippage: 0.05,
          reasoning: "Momentum stayed intact.",
          confidence: 0.82,
        },
      ],
      citations: [],
      pendingClarification: null,
      proposedMemoryWrites: [],
      toolTrace: [],
      skillsUsed: ["daily_movers_skill"],
      createdSkillCandidates: [],
      memoryInfluences: ["Prefers morning action windows."],
      confirmationPreview: null,
      runtimeMetadata: {
        sessionId: "runtime_session_1",
        transport: "sidecar",
        endpoint: "http://127.0.0.1:5050/internal/hermes/respond",
        executionKind: "strategy_run",
        triggerSource: "manual_retry",
        strategyId: "strategy_1",
        correlationId: "corr-1",
      },
    });

    const result = await runUserAgentStrategy({
      userId: "user_1",
      strategyId: "strategy_1",
      triggerSource: "manual_retry",
    });

    expect(ensureUserAgentStrategySchemaMock).toHaveBeenCalled();
    expect(analyzePortfolioAgentMock).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        threadId: "thread_1",
        mode: "commit",
        executionContext: expect.objectContaining({
          kind: "strategy_run",
          allowAutoExecution: true,
          requiresExplicitConfirmation: false,
        }),
        triggerContext: expect.objectContaining({
          source: "manual_retry",
        }),
        strategyContext: expect.objectContaining({
          strategyId: "strategy_1",
        }),
      }),
    );
    expect(executeAgentActionsMock).toHaveBeenCalledWith("user_1", [
      expect.objectContaining({
        actionType: "pool_buy",
        playerId: "player_1",
      }),
    ]);
    expect(result.run.runtimeTransport).toBe("sidecar");
    expect(result.run.runtimeSessionId).toBe("runtime_session_1");
    expect(result.run.status).toBe("applied");
  });

  it("auto-executes broader gameplay-safe actions like adding liquidity", async () => {
    selectQueue.push(
      [
        buildStrategyRow({
          allowedActionTypes: ["pool_add_liquidity"],
        }),
      ],
      [],
    );
    insertQueue.push([buildPendingRunRow()], [{ createdAt: new Date("2026-03-18T12:07:00.000Z") }]);
    updateQueue.push(
      [
        buildCompletedRunRow({
          appliedActions: [
            {
              actionType: "pool_add_liquidity",
              playerId: "player_2",
              shares: 1,
              playMoney: 10,
              reasoning: "Pool depth is attractive.",
              confidence: 0.74,
            },
          ],
          outcomeSummary: "Add liquidity to the active winner.",
        }),
      ],
      [],
      [],
    );
    analyzePortfolioAgentMock.mockResolvedValue({
      runId: "hermes_run_2",
      status: "completed",
      domain: "sportfolio",
      requestMessage: "Run the strategy",
      replyText: "Add more liquidity to the pool.",
      summary: "Add liquidity to the active winner.",
      observations: [],
      warnings: [],
      actions: [
        {
          actionType: "pool_add_liquidity",
          playerId: "player_2",
          shares: 1,
          playMoney: 10,
          reasoning: "Pool depth is attractive.",
          confidence: 0.74,
        },
      ],
      citations: [],
      pendingClarification: null,
      proposedMemoryWrites: [],
      toolTrace: [],
      skillsUsed: [],
      createdSkillCandidates: [],
      memoryInfluences: [],
      confirmationPreview: null,
      runtimeMetadata: {
        sessionId: "runtime_session_2",
        transport: "sidecar",
        endpoint: "http://127.0.0.1:5050/internal/hermes/respond",
        executionKind: "strategy_run",
        triggerSource: "manual_retry",
        strategyId: "strategy_1",
        correlationId: "corr-2",
      },
    });

    const result = await runUserAgentStrategy({
      userId: "user_1",
      strategyId: "strategy_1",
      triggerSource: "manual_retry",
    });

    expect(executeAgentActionsMock).toHaveBeenCalledWith("user_1", [
      expect.objectContaining({
        actionType: "pool_add_liquidity",
        playerId: "player_2",
      }),
    ]);
    expect(result.run.status).toBe("applied");
    expect(result.run.runtimeTransport).toBe("sidecar");
  });

  it("blocks any payment-like action types even if they somehow appear in runtime output", () => {
    expect(() =>
      __strategyRunner.validateStrategyActions({
        strategy: buildStrategyRow() as any,
        actions: [
          {
            actionType: "whop_checkout",
            playerId: "player_1",
            reasoning: "not allowed",
            confidence: 1,
          } as any,
        ],
        appliedActionCountToday: 0,
      }),
    ).toThrow(/never process payments/i);
  });

  it("blocks community boost creation from autonomous strategy execution", () => {
    expect(() =>
      __strategyRunner.validateStrategyActions({
        strategy: buildStrategyRow({
          allowedActionTypes: ["community_boost_create"],
        }) as any,
        actions: [
          {
            actionType: "community_boost_create",
            playerId: "player_1",
            sport: "MLB",
            boostDate: "2026-03-18",
            gameId: "game_1",
            reasoning: "not allowed",
            confidence: 0.9,
          } as any,
        ],
        appliedActionCountToday: 0,
      }),
    ).toThrow(/allowlist/i);
  });

  it("enforces the saved per-run action cap before execution", () => {
    expect(() =>
      __strategyRunner.validateStrategyActions({
        strategy: {
          id: "strategy_1",
          userId: "user_1",
          sourceThreadId: "thread_1",
          name: "Daily Movers",
          summary: "Track movers",
          mandateText: "Track movers",
          normalizedRuleSheet: {},
          timeline: {
            objective: "Track movers",
            currentStageId: "stage_1",
            stages: [
              {
                id: "stage_1",
                title: "Morning review",
                status: "active",
                actionScope: ["pool_buy"],
                triggerPolicy: {
                  kind: "recurring_cron",
                  anchor: "daily_at_time",
                  scheduleCron: "0 8 * * *",
                  timezone: "America/New_York",
                },
              },
            ],
          },
          status: "live",
          scheduleCron: "0 8 * * *",
          eventSubscriptions: ["schedule"],
          allowedActionTypes: ["pool_buy"],
          guardrails: { maxActionsPerRun: 1, maxActionsPerDay: 3 },
          reviewState: {
            status: "approved",
            reviewedAt: new Date(),
            lastMaterialUpdateAt: new Date(),
            summary: "Approved",
          },
          requiresReview: false,
          linkedSkillId: null,
          lastOutcomeSummary: null,
          lastRunAt: null,
          nextRunAt: null,
          activatedAt: null,
          pausedAt: null,
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        actions: [
          {
            actionType: "pool_buy",
            playerId: "player_1",
            sbAmount: 25,
            maxSlippage: 0.05,
            reasoning: "First mover",
            confidence: 0.8,
          },
          {
            actionType: "pool_buy",
            playerId: "player_2",
            sbAmount: 25,
            maxSlippage: 0.05,
            reasoning: "Second mover",
            confidence: 0.78,
          },
        ],
        appliedActionCountToday: 0,
      }),
    ).toThrow(/per run/i);
  });

  it("routes gameplay wakeups through Hermes strategy mode instead of local heuristics", async () => {
    selectQueue.push([buildStrategyRow()]);
    selectQueue.push([]);
    selectQueue.push([buildStrategyRow()]);
    selectQueue.push([]);
    insertQueue.push([buildPendingRunRow()], [{ createdAt: new Date("2026-03-18T12:06:00.000Z") }]);
    updateQueue.push(
      [
        buildCompletedRunRow({
          status: "completed",
          appliedActions: [],
          outcomeSummary: "Checked the mandate and held.",
        }),
      ],
      [],
      [],
    );
    analyzePortfolioAgentMock.mockResolvedValue({
      runId: "hermes_run_3",
      status: "completed",
      domain: "sportfolio",
      requestMessage: "Run the strategy",
      replyText: "The mandate still points to observation only right now.",
      summary: "Checked the mandate and held.",
      observations: [],
      warnings: [],
      actions: [],
      citations: [],
      pendingClarification: null,
      proposedMemoryWrites: [],
      toolTrace: [],
      skillsUsed: [],
      createdSkillCandidates: [],
      memoryInfluences: [],
      confirmationPreview: null,
      runtimeMetadata: {
        sessionId: "runtime_session_3",
        transport: "sidecar",
        endpoint: "http://127.0.0.1:5050/internal/hermes/respond",
        executionKind: "strategy_run",
        triggerSource: "strategy_event",
        strategyId: "strategy_1",
        correlationId: "corr-3",
      },
    });
    getStrategyStageEventTriggerMock.mockResolvedValue({
      eventType: "day_close",
      title: "Day close reached",
      summary: "The active stage can wake after all games finish.",
      eventKey: "day_close:strategy_1:2026-03-18:stage_1",
    });

    const result = await runTriggeredUserAgentStrategies();

    expect(result.requestCount).toBe(1);
    expect(result.recordsProcessed).toBe(1);
    expect(analyzePortfolioAgentMock).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        executionContext: expect.objectContaining({
          kind: "strategy_run",
        }),
        triggerContext: expect.objectContaining({
          source: "strategy_event",
          eventType: "day_close",
        }),
      }),
    );
  });

  it("rejects a run claim when the strategy already has an active running record", async () => {
    selectQueue.push([buildStrategyRow()]);
    const runningConstraintError = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      {
        code: "23505",
        constraint: "user_agent_strategy_runs_active_strategy_unique_idx",
      },
    );
    dbMock.insert.mockImplementationOnce(() => ({
      values: () => ({
        returning: () => Promise.reject(runningConstraintError),
      }),
    }));

    await expect(
      runUserAgentStrategy({
        userId: "user_1",
        strategyId: "strategy_1",
        triggerSource: "manual_retry",
      }),
    ).rejects.toThrow(/already has an active run in progress/i);
  });

  it("rotates event wake scans so unchanged rows do not starve the rest of the live set", async () => {
    const first = buildStrategyRow({
      id: "strategy_1",
      updatedAt: new Date("2026-03-18T11:30:00.000Z"),
    });
    const second = buildStrategyRow({
      id: "strategy_2",
      updatedAt: new Date("2026-03-18T11:31:00.000Z"),
    });
    const third = buildStrategyRow({
      id: "strategy_3",
      updatedAt: new Date("2026-03-18T11:32:00.000Z"),
    });

    selectQueue.push([first, second], [third], [first]);
    const firstPass = await runTriggeredUserAgentStrategies(2);
    const secondPass = await runTriggeredUserAgentStrategies(2);

    expect(firstPass.requestCount).toBe(2);
    expect(secondPass.requestCount).toBe(2);
    expect(dbMock.select).toHaveBeenCalledTimes(3);
  });
});

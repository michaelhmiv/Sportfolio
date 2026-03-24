import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  storageMock,
  computeNextScheduledRunAtMock,
  getTodayETMock,
  getETDayBoundariesMock,
} = vi.hoisted(() => {
  const localSelectQueue: any[] = [];

  function createQueryChain(result: any) {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => Promise.resolve(result)),
      limit: vi.fn(() => Promise.resolve(result)),
      then: (resolve: (value: any) => any, reject?: (reason: unknown) => any) =>
        Promise.resolve(result).then(resolve, reject),
    };

    return chain;
  }

  return {
    selectQueue: localSelectQueue,
    storageMock: {
      getDailyBoostsAllSports: vi.fn(),
    },
    computeNextScheduledRunAtMock: vi.fn(() => new Date("2026-03-19T12:00:00.000Z")),
    getTodayETMock: vi.fn(() => "2026-03-18"),
    getETDayBoundariesMock: vi.fn(() => ({
      startOfDay: new Date("2026-03-18T04:00:00.000Z"),
      endOfDay: new Date("2026-03-19T03:59:59.999Z"),
    })),
    dbMock: {
      select: vi.fn(() => createQueryChain(localSelectQueue.shift() ?? [])),
    },
  };
});

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => {
      const result = selectQueue.shift() ?? [];
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => Promise.resolve(result)),
        limit: vi.fn(() => Promise.resolve(result)),
        then: (resolve: (value: any) => any, reject?: (reason: unknown) => any) =>
          Promise.resolve(result).then(resolve, reject),
      };

      return chain;
    }),
  },
}));

vi.mock("../storage", () => ({
  storage: storageMock,
}));

vi.mock("./schedules", () => ({
  computeNextScheduledRunAt: computeNextScheduledRunAtMock,
}));

vi.mock("../lib/time", () => ({
  getTodayET: getTodayETMock,
  getETDayBoundaries: getETDayBoundariesMock,
}));

import {
  advanceStrategyTimelineAfterRun,
  computeStrategyNextRunAt,
  getStrategyStageEventTrigger,
} from "./strategy-timeline";
import type { AgentStrategyRecord } from "./types";

function buildStrategy(overrides: Partial<AgentStrategyRecord> = {}): AgentStrategyRecord {
  return {
    id: "strategy_1",
    userId: "user_1",
    sourceThreadId: "thread_1",
    conversationThreadId: "thread_1",
    name: "Pitcher prep",
    summary: "Research tomorrow's pitchers and act around lock.",
    mandateText: "Research pitchers, scout the best options, then prep boosts before lock.",
    normalizedRuleSheet: {
      timeline: {
        objective: "Research tomorrow's pitchers and act around lock.",
        currentStageId: "stage_1",
        stages: [
          {
            id: "stage_1",
            title: "Morning research",
            status: "active",
            actionScope: ["watchlist_add_player"],
            triggerPolicy: {
              kind: "recurring_cron",
              anchor: "daily_at_time",
              scheduleCron: "0 8 * * *",
              timezone: "America/New_York",
            },
          },
          {
            id: "stage_2",
            title: "Day close review",
            status: "pending",
            actionScope: ["scout_set_count"],
            triggerPolicy: {
              kind: "event_window",
              anchor: "day_close",
              timezone: "America/New_York",
            },
          },
        ],
      },
    },
    timeline: {
      objective: "Research tomorrow's pitchers and act around lock.",
      currentStageId: "stage_1",
      stages: [
        {
          id: "stage_1",
          title: "Morning research",
          status: "active",
          actionScope: ["watchlist_add_player"],
          triggerPolicy: {
            kind: "recurring_cron",
            anchor: "daily_at_time",
            scheduleCron: "0 8 * * *",
            timezone: "America/New_York",
          },
        },
        {
          id: "stage_2",
          title: "Day close review",
          status: "pending",
          actionScope: ["scout_set_count"],
          triggerPolicy: {
            kind: "event_window",
            anchor: "day_close",
            timezone: "America/New_York",
          },
        },
      ],
    },
    status: "live",
    scheduleCron: "0 8 * * *",
    eventSubscriptions: ["schedule", "gameplay_event"],
    allowedActionTypes: ["watchlist_add_player", "scout_set_count"],
    guardrails: {},
    linkedSkillId: null,
    lastOutcomeSummary: null,
    lastRunAt: null,
    nextRunAt: null,
    activatedAt: null,
    pausedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-03-18T12:00:00.000Z"),
    updatedAt: new Date("2026-03-18T12:00:00.000Z"),
    ...overrides,
  };
}

describe("strategy-timeline", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    storageMock.getDailyBoostsAllSports.mockReset();
    computeNextScheduledRunAtMock.mockClear();
    getTodayETMock.mockClear();
    getETDayBoundariesMock.mockClear();
  });

  it("computes the next run for recurring and one-time stages", () => {
    const recurring = buildStrategy();
    const recurringNext = computeStrategyNextRunAt(recurring, new Date("2026-03-18T12:00:00.000Z"));
    expect(recurringNext?.toISOString()).toBe("2026-03-19T12:00:00.000Z");

    const oneTime = buildStrategy({
      timeline: {
        objective: "Start in one week",
        currentStageId: "stage_1",
        stages: [
          {
            id: "stage_1",
            title: "Go live next week",
            status: "active",
            actionScope: ["pool_buy"],
            triggerPolicy: {
              kind: "one_time_at",
              anchor: "once_at_datetime",
              runAt: "2026-03-25T12:00:00.000Z",
              timezone: "America/New_York",
            },
          },
        ],
      },
    });

    const oneTimeNext = computeStrategyNextRunAt(oneTime, new Date("2026-03-18T12:00:00.000Z"));
    expect(oneTimeNext?.toISOString()).toBe("2026-03-25T12:00:00.000Z");
  });

  it("advances to the next stage after a successful run and resets to the first recurring stage after the final event stage", () => {
    const advanced = advanceStrategyTimelineAfterRun(buildStrategy());
    expect(advanced.currentStageId).toBe("stage_2");
    expect(advanced.stages[0]?.status).toBe("completed");
    expect(advanced.stages[1]?.status).toBe("active");

    const reset = advanceStrategyTimelineAfterRun(
      buildStrategy({
        timeline: {
          objective: "Research tomorrow's pitchers and act around lock.",
          currentStageId: "stage_2",
          stages: [
            {
              id: "stage_1",
              title: "Morning research",
              status: "completed",
              actionScope: ["watchlist_add_player"],
              triggerPolicy: {
                kind: "recurring_cron",
                anchor: "daily_at_time",
                scheduleCron: "0 8 * * *",
                timezone: "America/New_York",
              },
            },
            {
              id: "stage_2",
              title: "Day close review",
              status: "active",
              actionScope: ["scout_set_count"],
              triggerPolicy: {
                kind: "event_window",
                anchor: "day_close",
                timezone: "America/New_York",
              },
            },
          ],
        },
      }),
    );

    expect(reset.currentStageId).toBe("stage_1");
    expect(reset.stages[0]?.status).toBe("active");
    expect(reset.stages[1]?.status).toBe("pending");
  });

  it("fires day-close and pre-lock anchors only when the underlying game window is eligible", async () => {
    selectQueue.push([
      {
        gameId: "game_1",
        sport: "MLB",
        status: "final",
        startTime: new Date("2026-03-18T17:00:00.000Z"),
      },
    ]);

    const dayCloseTrigger = await getStrategyStageEventTrigger({
      strategy: buildStrategy({
        timeline: {
          objective: "Research tomorrow's pitchers and act around lock.",
          currentStageId: "stage_2",
          stages: [
            {
              id: "stage_2",
              title: "Day close review",
              status: "active",
              actionScope: ["scout_set_count"],
              triggerPolicy: {
                kind: "event_window",
                anchor: "day_close",
                timezone: "America/New_York",
              },
            },
          ],
        },
      }),
    });

    expect(dayCloseTrigger?.eventType).toBe("day_close");

    selectQueue.push([
      {
        gameId: "game_2",
        sport: "MLB",
        status: "scheduled",
        startTime: new Date("2026-03-18T12:10:00.000Z"),
      },
    ]);

    const preLockTrigger = await getStrategyStageEventTrigger({
      strategy: buildStrategy({
        timeline: {
          objective: "Research tomorrow's pitchers and act around lock.",
          currentStageId: "stage_3",
          stages: [
            {
              id: "stage_3",
              title: "Pre-lock stack",
              status: "active",
              actionScope: ["holdings_stack_shares", "daily_boost_assign"],
              triggerPolicy: {
                kind: "event_window",
                anchor: "pre_lock",
                offsetMinutes: 15,
                timezone: "America/New_York",
              },
            },
          ],
        },
      }),
      now: new Date("2026-03-18T12:00:00.000Z"),
    });

    expect(preLockTrigger?.eventType).toBe("pre_lock");
  });

  it("fires post-settlement and research-refresh anchors when fresh state exists", async () => {
    storageMock.getDailyBoostsAllSports.mockResolvedValue([
      {
        status: "processed",
        processedAt: "2026-03-18T13:00:00.000Z",
      },
    ]);

    const postSettlementTrigger = await getStrategyStageEventTrigger({
      strategy: buildStrategy({
        timeline: {
          objective: "Research tomorrow's pitchers and act around lock.",
          currentStageId: "stage_4",
          stages: [
            {
              id: "stage_4",
              title: "Post-settlement rebalance",
              status: "active",
              actionScope: ["pool_buy"],
              triggerPolicy: {
                kind: "event_window",
                anchor: "post_settlement",
                timezone: "America/New_York",
              },
            },
          ],
        },
      }),
    });

    expect(postSettlementTrigger?.eventType).toBe("post_settlement");

    const researchRefreshTrigger = await getStrategyStageEventTrigger({
      strategy: buildStrategy({
        timeline: {
          objective: "Research tomorrow's pitchers and act around lock.",
          currentStageId: "stage_5",
          stages: [
            {
              id: "stage_5",
              title: "Research refresh review",
              status: "active",
              actionScope: ["watchlist_add_player"],
              triggerPolicy: {
                kind: "event_window",
                anchor: "research_refresh",
                timezone: "America/New_York",
              },
            },
          ],
        },
      }),
    });

    expect(researchRefreshTrigger?.eventType).toBe("research_refresh");
  });
});

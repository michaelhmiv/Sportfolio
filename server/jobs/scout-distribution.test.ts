import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  creditScoutShares: vi.fn(),
  createScoutDistribution: vi.fn(),
  getTotalScoutsForUser: vi.fn(),
}));

const websocketMocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  broadcastToUser: vi.fn(),
}));

const pushMocks = vi.hoisted(() => ({
  notifyScoutCapacityAvailablePush: vi.fn().mockResolvedValue(undefined),
}));

const entitlementsMocks = vi.hoisted(() => ({
  loadUserEntitlements: vi.fn(),
}));

vi.mock("../db", () => ({
  db: dbMocks,
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../websocket", () => ({
  broadcast: websocketMocks.broadcast,
  broadcastToUser: websocketMocks.broadcastToUser,
}));

vi.mock("../services/push-notification-events", () => ({
  notifyScoutCapacityAvailablePush: pushMocks.notifyScoutCapacityAvailablePush,
}));

vi.mock("../services/user-entitlements", () => ({
  loadUserEntitlements: entitlementsMocks.loadUserEntitlements,
}));

describe("distributeScoutShares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T15:15:00.000Z"));

    let selectCall = 0;
    dbMocks.select.mockImplementation(() => {
      selectCall += 1;

      if (selectCall === 1) {
        return {
          from: () => ({
            innerJoin: () => ({
              where: () => ({
                groupBy: () => Promise.resolve([{ id: "user-1" }]),
              }),
            }),
          }),
        };
      }

      if (selectCall === 2) {
        return {
          from: () => Promise.resolve([]),
        };
      }

      if (selectCall === 3) {
        return {
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        };
      }

      throw new Error(`Unexpected select call ${selectCall}`);
    });

    dbMocks.update.mockReturnValue({
      set: () => ({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    dbMocks.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    dbMocks.insert.mockReturnValue({
      values: () => Promise.resolve(undefined),
    });

    dbMocks.execute.mockResolvedValue({ rows: [] });

    entitlementsMocks.loadUserEntitlements.mockResolvedValue({
      entitlements: {
        maxScouts: 5,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies users when inactivity cleanup pauses their scouts", async () => {
    const { distributeScoutShares } = await import("./scout-distribution");

    const result = await distributeScoutShares();

    expect(result.recordsProcessed).toBe(0);
    expect(pushMocks.notifyScoutCapacityAvailablePush).toHaveBeenCalledTimes(1);
    expect(pushMocks.notifyScoutCapacityAvailablePush).toHaveBeenCalledWith({
      userId: "user-1",
      dateKey: expect.any(String),
      remainingScouts: 5,
      maxScouts: 5,
    });
    expect(websocketMocks.broadcastToUser).not.toHaveBeenCalled();
  }, 15_000);
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const dbMocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  creditScoutDistribution: vi.fn(),
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
    dbMocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        select: dbMocks.select,
        execute: async (query: unknown) => {
          const statement = new PgDialect().sqlToQuery(query as any).sql;
          if (/^LOCK TABLE player_id_aliases/i.test(statement)) return { rows: [] };
          return dbMocks.execute(query);
        },
      }),
    );

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

  it("does not count or broadcast a distribution whose event claim already exists", async () => {
    let selectCall = 0;
    dbMocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return {
          from: () => ({
            innerJoin: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }),
          }),
        };
      }
      if (selectCall === 2) return { from: () => Promise.resolve([]) };
      if (selectCall === 3) return { from: () => ({ where: () => Promise.resolve([]) }) };
      if (selectCall === 4) {
        return {
          from: () => ({
            where: () =>
              Promise.resolve([
                {
                  id: "player-1",
                  firstName: "Test",
                  lastName: "Player",
                  team: "TST",
                  position: "G",
                  sport: "NBA",
                },
              ]),
          }),
        };
      }
      throw new Error(`Unexpected select call ${selectCall}`);
    });
    dbMocks.execute.mockResolvedValue({
      rows: [
        {
          userId: "user-1",
          playerId: "player-1",
          userScoutMinutes: "60",
          globalScoutMinutes: "60",
          sharesEarned: "60.00",
        },
      ],
    });
    storageMocks.creditScoutDistribution.mockResolvedValue(false);
    const { distributeScoutShares } = await import("./scout-distribution");

    const result = await distributeScoutShares();

    expect(storageMocks.creditScoutDistribution).toHaveBeenCalledWith({
      hourTimestamp: new Date("2026-06-03T15:00:00.000Z"),
      playerId: "player-1",
      userId: "user-1",
      userScoutMinutes: 60,
      globalScoutMinutes: 60,
      sharesEarned: "60.00",
    });
    expect(result.recordsProcessed).toBe(0);
    expect(websocketMocks.broadcastToUser).not.toHaveBeenCalled();
    expect(websocketMocks.broadcast).not.toHaveBeenCalled();
  });

  it("collapses alias and canonical scout minutes into one canonical same-hour payout", async () => {
    let selectCall = 0;
    dbMocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return {
          from: () => ({
            innerJoin: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }),
          }),
        };
      }
      if (selectCall === 2) return { from: () => Promise.resolve([]) };
      if (selectCall === 3) return { from: () => ({ where: () => Promise.resolve([]) }) };
      if (selectCall === 4) {
        return {
          from: () => ({
            where: () =>
              Promise.resolve([
                {
                  id: "canonical-player",
                  firstName: "Canonical",
                  lastName: "Player",
                  team: "TST",
                  position: "G",
                  sport: "NBA",
                },
              ]),
          }),
        };
      }
      throw new Error(`Unexpected select call ${selectCall}`);
    });
    dbMocks.execute.mockResolvedValue({
      rows: [
        {
          userId: "user-1",
          playerId: "canonical-player",
          userScoutMinutes: "90",
          globalScoutMinutes: "120",
          sharesEarned: "45.00",
        },
      ],
    });
    storageMocks.creditScoutDistribution.mockResolvedValue(true);
    const { distributeScoutShares } = await import("./scout-distribution");

    const result = await distributeScoutShares();

    const distributionSql = new PgDialect().sqlToQuery(dbMocks.execute.mock.calls[0]?.[0]).sql;
    expect(distributionSql).toMatch(/WITH RECURSIVE\s+alias_paths/i);
    expect(distributionSql).toMatch(/COALESCE\([^)]*canonical_player_id[^)]*,\s*sh\.player_id\)/i);
    expect(distributionSql).toMatch(/GROUP BY\s+user_id,\s*player_id/i);
    expect(storageMocks.creditScoutDistribution).toHaveBeenCalledTimes(1);
    expect(storageMocks.creditScoutDistribution).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: "canonical-player",
        userScoutMinutes: 90,
        globalScoutMinutes: 120,
        sharesEarned: "45.00",
      }),
    );
    expect(websocketMocks.broadcastToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        data: expect.objectContaining({
          totalPlayers: 1,
          distributions: [expect.objectContaining({ playerId: "canonical-player" })],
        }),
      }),
    );
    expect(result.recordsProcessed).toBe(1);
  });
});

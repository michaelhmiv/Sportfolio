import { beforeEach, describe, expect, it, vi } from "vitest";
import { holdings, players, scoutDistributionClaims, scoutDistributions } from "@shared/schema";

const state = vi.hoisted(() => ({
  claimCreated: true,
  player: { id: "player-1" } as { id: string } | undefined,
  holding: undefined as { id: string; quantity: string; totalCostBasis: string | null } | undefined,
  inserts: [] as Array<{ table: unknown; values: unknown }>,
  updates: [] as Array<{ table: unknown; values: unknown }>,
}));

const dbMock = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("./db", () => ({ db: dbMock }));
vi.mock("./player-identity", () => ({
  holdingReservationDomain: vi.fn(),
  loadPlayerIdentityContext: vi.fn(async (_executor: unknown, playerId: string) => ({
    requestedId: playerId,
    canonicalId: playerId,
    aliasIds: [],
    allIds: [playerId],
  })),
  loadPlayerIdentityContexts: vi.fn(),
}));

function createTransaction() {
  return {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        state.inserts.push({ table, values });
        if (table === scoutDistributionClaims) {
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue(state.claimCreated ? [{ id: "claim-1" }] : []),
            })),
          };
        }
        return Promise.resolve(undefined);
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          if (table === players) {
            return { for: vi.fn().mockResolvedValue(state.player ? [state.player] : []) };
          }
          return {
            orderBy: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue(state.holding ? [state.holding] : []),
            })),
          };
        }),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: unknown) => {
        state.updates.push({ table, values });
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  };
}

const distribution = {
  hourTimestamp: new Date("2026-06-03T15:00:00.000Z"),
  playerId: "player-1",
  userId: "user-1",
  userScoutMinutes: 45,
  globalScoutMinutes: 90,
  sharesEarned: "30.00",
};

describe("DatabaseStorage.creditScoutDistribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.claimCreated = true;
    state.player = { id: "player-1" };
    state.holding = undefined;
    state.inserts = [];
    state.updates = [];
    dbMock.transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback(createTransaction()),
    );
  });

  it("skips every credit side effect when another runner owns the event claim", async () => {
    state.claimCreated = false;
    const { DatabaseStorage } = await import("./storage");

    await expect(new DatabaseStorage().creditScoutDistribution(distribution)).resolves.toBe(false);

    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe(scoutDistributionClaims);
    expect(state.updates).toHaveLength(0);
  });

  it("credits the holding and player and writes the ledger after claiming the event", async () => {
    state.holding = { id: "holding-1", quantity: "10.0000", totalCostBasis: "25.00" };
    const { DatabaseStorage } = await import("./storage");

    await expect(new DatabaseStorage().creditScoutDistribution(distribution)).resolves.toBe(true);

    expect(state.updates.map(({ table }) => table)).toEqual([holdings, players]);
    expect(state.updates[0]?.values).toMatchObject({ quantity: "40", avgCostBasis: "0.6250" });
    expect(state.inserts.map(({ table }) => table)).toEqual([
      scoutDistributionClaims,
      scoutDistributions,
    ]);
    expect(state.inserts[1]?.values).toMatchObject(distribution);
  });
});

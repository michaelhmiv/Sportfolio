import { beforeEach, describe, expect, it, vi } from "vitest";
import { holdings, players, scoutDistributionClaims, scoutDistributions } from "@shared/schema";

const state = vi.hoisted(() => ({
  claimCreated: true,
  canonicalId: "player-1",
  allIds: ["player-1"],
  player: { id: "player-1", isActive: true } as { id: string; isActive: boolean } | undefined,
  holding: undefined as
    | { id: string; assetId: string; quantity: string; totalCostBasis: string | null }
    | undefined,
  inserts: [] as Array<{ table: unknown; values: any }>,
  updates: [] as Array<{ table: unknown; values: any }>,
  executions: [] as unknown[],
  holdingRowsLocked: false,
}));

const dbMock = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("./db", () => ({ db: dbMock }));
vi.mock("./player-identity", () => ({
  holdingReservationDomain: vi.fn(
    (userId: string, assetType: string, identityIds: string[]) =>
      `${userId}:${assetType}:${identityIds.join(":")}`,
  ),
  loadPlayerIdentityContext: vi.fn(async (_executor: unknown, playerId: string) => ({
    requestedId: playerId,
    canonicalId: state.canonicalId,
    aliasIds: state.allIds.filter((id) => id !== state.canonicalId),
    allIds: state.allIds,
  })),
  loadPlayerIdentityContexts: vi.fn(),
}));

function createTransaction() {
  return {
    execute: vi.fn((query: unknown) => {
      state.executions.push(query);
      return Promise.resolve({ rows: [] });
    }),
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
              for: vi.fn(() => {
                state.holdingRowsLocked = true;
                return Promise.resolve(state.holding ? [state.holding] : []);
              }),
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
    state.canonicalId = "player-1";
    state.allIds = ["player-1"];
    state.player = { id: "player-1", isActive: true };
    state.holding = undefined;
    state.inserts = [];
    state.updates = [];
    state.executions = [];
    state.holdingRowsLocked = false;
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
    state.holding = {
      id: "holding-1",
      assetId: "player-1",
      quantity: "10.0000",
      totalCostBasis: "25.00",
    };
    const { DatabaseStorage } = await import("./storage");

    await expect(new DatabaseStorage().creditScoutDistribution(distribution)).resolves.toBe(true);

    expect(state.updates.map(({ table }) => table)).toEqual([holdings, players]);
    expect(state.inserts.map(({ table }) => table)).toEqual([
      scoutDistributionClaims,
      scoutDistributions,
    ]);
    expect(state.inserts[1]?.values).toMatchObject(distribution);
  });

  it("canonicalizes the event identity before claiming and crediting every side effect", async () => {
    state.canonicalId = "canonical-player";
    state.allIds = ["alias-player", "canonical-player"];
    state.player = { id: "canonical-player", isActive: true };
    const { DatabaseStorage } = await import("./storage");

    await expect(
      new DatabaseStorage().creditScoutDistribution({
        ...distribution,
        playerId: "alias-player",
      }),
    ).resolves.toBe(true);

    expect(state.inserts[0]?.values).toMatchObject({ playerId: "canonical-player" });
    expect(state.inserts.find(({ table }) => table === holdings)?.values).toMatchObject({
      assetId: "canonical-player",
    });
    expect(state.inserts.find(({ table }) => table === scoutDistributions)?.values).toMatchObject({
      playerId: "canonical-player",
    });
  });

  it("takes the shared reservation lock and row-locks identity holdings before mutation", async () => {
    state.holding = {
      id: "holding-1",
      assetId: "player-1",
      quantity: "10.0000",
      totalCostBasis: "25.00",
    };
    const { DatabaseStorage } = await import("./storage");

    await new DatabaseStorage().creditScoutDistribution(distribution);

    expect(state.executions).toHaveLength(2);
    expect(state.holdingRowsLocked).toBe(true);
  });

  it("refuses to credit a stale distribution after the player becomes inactive", async () => {
    state.player = { id: "player-1", isActive: false };
    const { DatabaseStorage } = await import("./storage");

    await expect(new DatabaseStorage().creditScoutDistribution(distribution)).rejects.toThrow(
      "Inactive players cannot be scouted",
    );
  });
});

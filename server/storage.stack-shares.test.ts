import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  holdings,
  holdingsLocks,
  playerMultiplierEvents,
  playerMultipliers,
  players,
} from "@shared/schema";

interface MockState {
  regularHolding: {
    id: string;
    quantity: string;
    avgCostBasis: string;
    totalCostBasis: string;
  } | null;
  lockedShares: number;
  multiplierRow: {
    id: string;
    multiplier: number;
    avgCostBasis: string;
    totalCostBasis: string;
  } | null;
  operations: Array<{ op: "insert" | "update" | "delete"; table: unknown; values?: unknown }>;
}

const mockState = vi.hoisted(
  (): MockState => ({
    regularHolding: null,
    lockedShares: 0,
    multiplierRow: null,
    operations: [],
  }),
);

function getSelectResult(table: unknown): unknown[] {
  if (table === holdings) {
    return mockState.regularHolding ? [{ ...mockState.regularHolding }] : [];
  }

  if (table === holdingsLocks) {
    return [{ total: mockState.lockedShares }];
  }

  if (table === playerMultipliers) {
    return mockState.multiplierRow ? [{ ...mockState.multiplierRow }] : [];
  }

  return [];
}

function makeWhereResult(result: unknown[]) {
  const query = {
    for: async () => result,
    orderBy: () => query,
    limit: async (count: number) => result.slice(0, count),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

function makeTx() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => makeWhereResult(getSelectResult(table)),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mockState.operations.push({ op: "update", table, values });

          if (table === holdings && mockState.regularHolding) {
            mockState.regularHolding = {
              ...mockState.regularHolding,
              quantity: String(values.quantity ?? mockState.regularHolding.quantity),
              totalCostBasis: String(
                values.totalCostBasis ?? mockState.regularHolding.totalCostBasis,
              ),
            };
            return [{ ...mockState.regularHolding }];
          }

          if (table === playerMultipliers && mockState.multiplierRow) {
            mockState.multiplierRow = {
              ...mockState.multiplierRow,
              multiplier: Number(values.multiplier ?? mockState.multiplierRow.multiplier),
              avgCostBasis: String(values.avgCostBasis ?? mockState.multiplierRow.avgCostBasis),
              totalCostBasis: String(
                values.totalCostBasis ?? mockState.multiplierRow.totalCostBasis,
              ),
            };
            return [{ ...mockState.multiplierRow }];
          }

          return [];
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        mockState.operations.push({ op: "delete", table });
        if (table === holdings) {
          mockState.regularHolding = null;
        }
        return [];
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        mockState.operations.push({ op: "insert", table, values });

        if (table === playerMultipliers) {
          mockState.multiplierRow = {
            id: mockState.multiplierRow?.id ?? "mult_1",
            multiplier: Number(values.multiplier ?? 0),
            avgCostBasis: String(values.avgCostBasis ?? "0"),
            totalCostBasis: String(values.totalCostBasis ?? "0"),
          };
          return [{ ...mockState.multiplierRow }];
        }

        if (table === playerMultiplierEvents || table === players) {
          return [];
        }

        return [];
      },
    }),
  };
}

const transactionMock = vi.hoisted(() =>
  vi.fn(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
    callback(makeTx()),
  ),
);

vi.mock("./db", () => ({
  db: {
    transaction: transactionMock,
  },
}));

describe("DatabaseStorage.stackShares", () => {
  beforeEach(() => {
    transactionMock.mockClear();
    mockState.regularHolding = {
      id: "holding_1",
      quantity: "20",
      avgCostBasis: "10.0000",
      totalCostBasis: "200.00",
    };
    mockState.lockedShares = 0;
    mockState.multiplierRow = null;
    mockState.operations = [];
  });

  it("preserves one stack record and increases stack power across repeated stacking", async () => {
    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();

    const first = await storage.stackShares("user_1", "player_1", 8);
    const second = await storage.stackShares("user_1", "player_1", 4);

    expect(first).toMatchObject({
      sharesStacked: 8,
      newMultiplier: "4.00",
      multiplier: "4.00",
      effectiveSharesBurned: 4,
    });
    expect(second).toMatchObject({
      sharesStacked: 4,
      newMultiplier: "6.00",
      multiplier: "6.00",
      effectiveSharesBurned: 2,
    });

    const multiplierInserts = mockState.operations.filter(
      (operation) => operation.op === "insert" && operation.table === playerMultipliers,
    );
    const multiplierUpdates = mockState.operations.filter(
      (operation) => operation.op === "update" && operation.table === playerMultipliers,
    );
    const multiplierEvents = mockState.operations.filter(
      (operation) => operation.op === "insert" && operation.table === playerMultiplierEvents,
    );

    expect(multiplierInserts).toHaveLength(1);
    expect(multiplierUpdates).toHaveLength(1);
    expect(multiplierEvents).toHaveLength(2);
    expect(mockState.multiplierRow?.multiplier).toBe(6);
    expect(mockState.regularHolding?.quantity).toBe("8");
  });
});

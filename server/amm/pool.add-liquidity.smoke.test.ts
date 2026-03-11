import { beforeEach, describe, expect, it, vi } from "vitest";

import { holdings } from "@shared/schema";
import { addLiquidity, addLiquidityOptimal } from "./pool";
import { db } from "../db";

vi.mock("../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("../websocket", () => ({
  broadcast: vi.fn(),
}));

type RecordedUpdate = {
  table: unknown;
  values: Record<string, unknown>;
};

type FakeTx = {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  updates: RecordedUpdate[];
};

function makeAwaitable(result: unknown) {
  const promise = Promise.resolve(result) as Promise<unknown> & {
    for: (mode: string) => Promise<unknown>;
  };
  promise.for = () => Promise.resolve(result);
  return promise;
}

function buildTx(selectResults: unknown[]): FakeTx {
  const queue = [...selectResults];
  const updates: RecordedUpdate[] = [];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => makeAwaitable(queue.shift() ?? [])),
    })),
  }));

  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: Record<string, unknown>) => {
      updates.push({ table, values });
      return {
        where: vi.fn(async () => []),
      };
    }),
  }));

  const insert = vi.fn(() => ({
    values: vi.fn(async () => []),
  }));

  const del = vi.fn(() => ({
    where: vi.fn(async () => []),
  }));

  return {
    select,
    update,
    insert,
    delete: del,
    updates,
  };
}

describe("add-liquidity smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows addLiquidity when shares are available and preserves fractional precision", async () => {
    const tx = buildTx([
      [
        {
          playerId: "player-1",
          shares: "1000.00",
          playMoney: "10000.00",
          k: "10000000.00",
          lpSharesTotal: "1000.00",
          feesAccumulated: "0",
          feeGrowthPerLpShare: "0",
          totalVolume: "0",
          totalTrades: 0,
        },
      ],
      [
        {
          id: "holding-1",
          quantity: "5.5000",
        },
      ],
      [{ total: 0 }],
      [{ id: "user-1", balance: "500.00" }],
      [],
    ]);

    vi.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx));

    const result = await addLiquidity("player-1", "user-1", 1.25, 12.5);

    expect(result.success).toBe(true);
    expect(result.sharesDeposited).toBe(1.25);

    const holdingsUpdate = tx.updates.find((entry) => entry.table === holdings);
    expect(holdingsUpdate?.values.quantity).toBe("4.2500");
  });

  it("blocks addLiquidityOptimal when locked shares reduce available amount", async () => {
    const tx = buildTx([
      [
        {
          playerId: "player-1",
          shares: "1000.00",
          playMoney: "10000.00",
          k: "10000000.00",
          lpSharesTotal: "1000.00",
          feesAccumulated: "0",
          feeGrowthPerLpShare: "0",
          totalVolume: "0",
          totalTrades: 0,
        },
      ],
      [
        {
          id: "holding-1",
          quantity: "5.0000",
        },
      ],
      [{ total: 3 }],
    ]);

    vi.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx));

    const result = await addLiquidityOptimal("player-1", "user-1", 5, 50);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient available shares");
    expect(result.error).toContain("2.0000");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { holdings, trades } from "@shared/schema";
import { calculateSellShares, executeSell } from "./pool";
import { db } from "../db";

vi.mock("../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("../websocket", () => ({
  broadcast: vi.fn(),
}));

vi.mock("../services/notification-dispatcher", () => ({
  sendCategoryBroadcastNotification: vi.fn().mockResolvedValue(undefined),
  sendUserNotification: vi.fn().mockResolvedValue(undefined),
}));

type RecordedUpdate = {
  table: unknown;
  values: Record<string, unknown>;
};

type RecordedInsert = {
  table: unknown;
  values: Record<string, unknown>;
};

type FakeTx = {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  updates: RecordedUpdate[];
  inserts: RecordedInsert[];
};

function makeAwaitable(result: unknown) {
  const promise = Promise.resolve(result) as Promise<unknown> & {
    for: (mode: string) => Promise<unknown>;
  };
  promise.for = () => Promise.resolve(result);
  return promise;
}

function buildTx(
  selectResults: unknown[],
  insertReturningResults: Map<unknown, unknown[]>,
): FakeTx {
  const queue = [...selectResults];
  const updates: RecordedUpdate[] = [];
  const inserts: RecordedInsert[] = [];

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

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return {
        returning: vi.fn(async () => insertReturningResults.get(table) ?? []),
      };
    }),
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
    inserts,
  };
}

const basePoolRow = {
  playerId: "player-1",
  shares: "1000.00",
  playMoney: "10000.00",
  k: "10000000.00",
  lpSharesTotal: "1000.00",
  feesAccumulated: "0",
  feeGrowthPerLpShare: "0",
  totalVolume: "0",
  totalTrades: 0,
};

describe("executeSell smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks sell when locked shares reduce available amount", async () => {
    const tx = buildTx(
      [[basePoolRow], [{ id: "holding-1", quantity: "5.5000" }], [{ total: 2 }]],
      new Map(),
    );

    vi.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx));

    const result = await executeSell("player-1", "user-1", 4);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient available shares");
    expect(result.error).toContain("3.5000");
  });

  it("preserves fractional holding precision when sell executes", async () => {
    const tx = buildTx(
      [
        [basePoolRow],
        [{ id: "holding-1", quantity: "5.5000" }],
        [{ total: 0 }],
        [{ id: "user-1", balance: "100.00" }],
      ],
      new Map([[trades, [{ id: "trade-1" }]]]),
    );

    vi.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx));

    const result = await executeSell("player-1", "user-1", 1);

    expect(result.success).toBe(true);

    const holdingsUpdate = tx.updates.find((entry) => entry.table === holdings);
    expect(holdingsUpdate?.values.quantity).toBe("4.5000");

    const tradeInsert = tx.inserts.find((entry) => entry.table === trades);
    expect(tradeInsert?.values.quantity).toBe("1.0000");
  });

  it("settles fractional sells and returns the seller's net proceeds", async () => {
    const tx = buildTx(
      [
        [basePoolRow],
        [{ id: "holding-1", quantity: "5.5000" }],
        [{ total: 0 }],
        [{ id: "user-1", balance: "100.00" }],
      ],
      new Map([[trades, [{ id: "trade-2" }]]]),
    );

    vi.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx));

    const result = await executeSell("player-1", "user-1", 0.6985, 0.5);
    const expectedQuote = calculateSellShares(
      {
        playerId: basePoolRow.playerId,
        shares: Number(basePoolRow.shares),
        playMoney: Number(basePoolRow.playMoney),
        k: Number(basePoolRow.k),
        lpSharesTotal: Number(basePoolRow.lpSharesTotal),
        feesAccumulated: Number(basePoolRow.feesAccumulated),
        feeGrowthPerLpShare: Number(basePoolRow.feeGrowthPerLpShare),
        totalVolume: Number(basePoolRow.totalVolume),
        totalTrades: basePoolRow.totalTrades,
        currentPrice: Number(basePoolRow.playMoney) / Number(basePoolRow.shares),
      },
      0.6985,
    );

    expect(result.success).toBe(true);
    expect(result.sharesTraded).toBe(0.6985);
    expect(result.totalValue).toBeCloseTo(expectedQuote.sellerReceives, 8);

    const holdingsUpdate = tx.updates.find((entry) => entry.table === holdings);
    expect(holdingsUpdate?.values.quantity).toBe("4.8015");

    const tradeInsert = tx.inserts.find((entry) => entry.table === trades);
    expect(tradeInsert?.values.quantity).toBe("0.6985");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { holdings, playerPools, trades } from "@shared/schema";
import { calculateBuyShares, executeBuy } from "./pool";
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

function buildTx(selectResults: unknown[]): FakeTx {
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
      return { where: vi.fn(async () => []) };
    }),
  }));

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return {
        onConflictDoUpdate: vi.fn(async () => []),
        returning: vi.fn(async () => (table === trades ? [{ id: "trade-1" }] : [])),
      };
    }),
  }));

  const del = vi.fn(() => ({ where: vi.fn(async () => []) }));

  return { select, update, insert, delete: del, updates, inserts };
}

const basePoolRow = {
  playerId: "mlb_676106",
  shares: "30.00",
  playMoney: "418.40",
  k: "12552.12",
  lpSharesTotal: "35.43",
  feesAccumulated: "0.59",
  feeGrowthPerLpShare: "0.017914783741",
  totalVolume: "58.85",
  totalTrades: 5,
};

describe("executeBuy smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("settles a fractional buy instead of rejecting every quote below one share", async () => {
    const tx = buildTx([[basePoolRow], [{ id: "user-1", balance: "100.00" }]]);
    vi.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx));

    const pool = {
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
    };
    const rawQuote = calculateBuyShares(pool, 9.88);

    expect(rawQuote.sharesOut).toBeGreaterThan(0);
    expect(rawQuote.sharesOut).toBeLessThan(1);

    const result = await executeBuy("mlb_676106", "user-1", 9.88, 0.5);

    expect(result.success).toBe(true);
    expect(result.sharesTraded).toBeCloseTo(0.6985, 4);

    const poolUpdate = tx.updates.find((entry) => entry.table === playerPools);
    expect(poolUpdate?.values.shares).toBe("29.3015");

    const holdingInsert = tx.inserts.find((entry) => entry.table === holdings);
    expect(holdingInsert?.values.quantity).toBe("0.6985");

    const tradeInsert = tx.inserts.find((entry) => entry.table === trades);
    expect(tradeInsert?.values.quantity).toBe("0.6985");
  });

  it("rejects only trades that cannot produce the minimum ledger increment", async () => {
    const tx = buildTx([[{ ...basePoolRow, k: "12552.00" }]]);
    vi.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx));

    const result = await executeBuy("mlb_676106", "user-1", 0.001, 0.5);

    expect(result.success).toBe(false);
    expect(result.error).toContain("0.0001 shares");
    expect(tx.select).toHaveBeenCalledTimes(1);
  });
});

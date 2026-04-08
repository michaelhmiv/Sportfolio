import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  db: {
    execute: executeMock,
  },
}));

describe("DatabaseStorage.createSharePayoutSnapshotsForGame", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ rowCount: 2 });
  });

  it("snapshots earning units from stacked multipliers only", async () => {
    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();

    const created = await storage.createSharePayoutSnapshotsForGame(
      {
        gameId: "game_1",
        sport: "NBA",
        homeTeam: "BOS",
        awayTeam: "NYK",
      },
      "2.0000",
    );

    expect(created).toBe(2);
    expect(executeMock).toHaveBeenCalledTimes(1);

    const query = executeMock.mock.calls[0]?.[0];
    const sqlText = new PgDialect().sqlToQuery(query).sql;

    expect(sqlText).toMatch(/FROM\s+"player_multipliers"/i);
    expect(sqlText).not.toMatch(/FROM\s+"holdings"/i);
  }, 15000);
});

describe("DatabaseStorage.refreshPlayerVolume24h", () => {
  it("updates and zeroes player volume without relying on a broken table alias", async () => {
    const { DatabaseStorage } = await import("./storage");
    executeMock.mockReset();
    executeMock.mockResolvedValueOnce({ rowCount: 3 }).mockResolvedValueOnce({ rowCount: 5 });
    const storage = new DatabaseStorage();

    const updated = await storage.refreshPlayerVolume24h();

    expect(updated).toBe(8);
    expect(executeMock).toHaveBeenCalledTimes(2);

    const firstSql = new PgDialect().sqlToQuery(executeMock.mock.calls[0]?.[0]).sql;
    const secondSql = new PgDialect().sqlToQuery(executeMock.mock.calls[1]?.[0]).sql;

    expect(firstSql).toMatch(/UPDATE\s+"players"\s+AS\s+p/i);
    expect(firstSql).toMatch(/SET\s+"volume_24h"\s*=\s*v(?:\."vol"|\.vol)/i);
    expect(firstSql).not.toMatch(/SET\s+"players"\./i);
    expect(firstSql).toMatch(/WHERE\s+p\."id"\s*=\s*v\."player_id"/i);

    expect(secondSql).toMatch(/UPDATE\s+"players"\s+AS\s+p/i);
    expect(secondSql).toMatch(/SET\s+"volume_24h"\s*=\s*0/i);
    expect(secondSql).not.toMatch(/SET\s+"players"\./i);
    expect(secondSql).toMatch(/FROM\s+"trades"\s+AS\s+t/i);
    expect(secondSql).toMatch(/t\."player_id"\s*=\s*p\."id"/i);
  });
});

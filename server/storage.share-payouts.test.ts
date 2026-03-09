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
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const whereMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  db: {
    select: selectMock,
  },
}));

function queueSelectResult(rows: unknown[]) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  whereMock.mockImplementationOnce(() => ({
    limit: limitMock,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  }));
}

describe("DatabaseStorage.getPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockImplementation(() => ({
      where: whereMock,
    }));
    selectMock.mockImplementation(() => ({
      from: fromMock,
    }));
  });

  it("normalizes ids to lowercase before direct lookup and canonical resolution", async () => {
    const { DatabaseStorage } = await import("./storage");
    const storage = new DatabaseStorage();
    const getCanonicalPlayerIdSpy = vi
      .spyOn(storage, "getCanonicalPlayerId")
      .mockResolvedValue("mlb_555_canonical");

    queueSelectResult([]);
    queueSelectResult([{ id: "mlb_555_canonical", firstName: "Garrett", lastName: "Crochet" }]);

    const player = await storage.getPlayer("  MLB_555  ");

    expect(player).toMatchObject({ id: "mlb_555_canonical" });
    expect(getCanonicalPlayerIdSpy).toHaveBeenCalledWith("mlb_555");
  });
});

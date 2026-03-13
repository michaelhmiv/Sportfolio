import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPlayersBySport: vi.fn(),
  updatePlayer: vi.fn(),
  upsertPlayer: vi.fn(),
}));

const nflApiMocks = vi.hoisted(() => ({
  fetchActivePlayers: vi.fn(),
  fetchInjuries: vi.fn(),
  createNFLPlayerId: vi.fn(),
  normalizePosition: vi.fn(),
  isNFLApiConfigured: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../balldontlie-nfl", () => ({
  fetchActivePlayers: nflApiMocks.fetchActivePlayers,
  fetchInjuries: nflApiMocks.fetchInjuries,
  createNFLPlayerId: nflApiMocks.createNFLPlayerId,
  normalizePosition: nflApiMocks.normalizePosition,
  isNFLApiConfigured: nflApiMocks.isNFLApiConfigured,
  getCurrentNFLSeason: vi.fn(),
}));

describe("syncNFLRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    nflApiMocks.isNFLApiConfigured.mockReturnValue(true);
    nflApiMocks.fetchActivePlayers.mockResolvedValue([
      {
        id: 500,
        first_name: "Player",
        last_name: "Shifted",
        team: { abbreviation: "BUF" },
        position: "WR",
        position_abbreviation: "WR",
        jersey_number: "10",
      },
    ]);
    nflApiMocks.fetchInjuries.mockResolvedValue([]);
    nflApiMocks.createNFLPlayerId.mockReturnValue("nfl_new");
    nflApiMocks.normalizePosition.mockReturnValue("WR");
    storageMocks.getPlayersBySport.mockResolvedValue([
      {
        id: "nfl_old",
        isActive: true,
      },
    ]);
    storageMocks.upsertPlayer.mockResolvedValue({ id: "nfl_old" });
    storageMocks.updatePlayer.mockResolvedValue(undefined);
  });

  it("tracks the canonical post-upsert id so preserved rows are not deactivated", async () => {
    const { syncNFLRoster } = await import("./sync-nfl-roster");
    const result = await syncNFLRoster();

    expect(storageMocks.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "nfl_new",
        sport: "NFL",
      }),
    );
    expect(storageMocks.updatePlayer).not.toHaveBeenCalledWith(
      "nfl_old",
      expect.objectContaining({ isActive: false }),
    );
    expect(result.playersAdded).toBe(1);
    expect(result.playersDeactivated).toBe(0);
  });
});

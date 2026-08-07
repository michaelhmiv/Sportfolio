import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPlayersByIds: vi.fn(),
  upsertPlayer: vi.fn(),
  updatePlayer: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

describe("ensureNBAPlayerFromStat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an existing active player without recreating it", async () => {
    storageMocks.getPlayersByIds.mockResolvedValue([{ id: "nba_1", isActive: true }]);

    const { ensureNBAPlayerFromStat } = await import("./nba-player-utils");
    const player = await ensureNBAPlayerFromStat({
      player: {
        id: 1,
        first_name: "Jalen",
        last_name: "Brunson",
        position: "G",
        jersey_number: "11",
        team: { abbreviation: "NYK" },
      },
      team: { abbreviation: "NYK" },
    } as any);

    expect(player).toEqual({ id: "nba_1", isActive: true });
    expect(storageMocks.upsertPlayer).not.toHaveBeenCalled();
    expect(storageMocks.updatePlayer).not.toHaveBeenCalled();
  }, 10000);

  it("admits a missing player from a current team stat payload", async () => {
    storageMocks.getPlayersByIds.mockResolvedValue([]);
    storageMocks.upsertPlayer.mockResolvedValue({ id: "nba_2" });

    const { ensureNBAPlayerFromStat } = await import("./nba-player-utils");
    const player = await ensureNBAPlayerFromStat({
      player: {
        id: 2,
        first_name: "Jalen",
        last_name: "Brunson",
        position: "G",
        jersey_number: "11",
        team: { abbreviation: "NYK" },
      },
      team: { abbreviation: "NYK" },
    } as any);

    expect(storageMocks.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "nba_2",
        sport: "NBA",
        firstName: "Jalen",
        lastName: "Brunson",
        team: "NYK",
        position: "G",
        jerseyNumber: "11",
        isActive: true,
        isEligibleForVesting: true,
      }),
    );
    expect(player).toEqual({ id: "nba_2" });
  }, 10000);

  it("does not admit a never-seen free agent or teamless historical row", async () => {
    storageMocks.getPlayersByIds.mockResolvedValue([]);

    const { ensureNBAPlayerFromStat } = await import("./nba-player-utils");
    const player = await ensureNBAPlayerFromStat({
      player: {
        id: 3,
        first_name: "Former",
        last_name: "Player",
        position: "G",
        team: { abbreviation: "FA" },
      },
    } as any);

    expect(player).toBeNull();
    expect(storageMocks.upsertPlayer).not.toHaveBeenCalled();
  }, 10000);

  it("reactivates a previously admitted player when current participation returns", async () => {
    storageMocks.getPlayersByIds.mockResolvedValue([
      {
        id: "nba_4",
        isActive: false,
        position: "G",
        jerseyNumber: "7",
      },
    ]);

    const { ensureNBAPlayerFromStat } = await import("./nba-player-utils");
    await ensureNBAPlayerFromStat({
      player: {
        id: 4,
        first_name: "Returning",
        last_name: "Player",
        position: "G",
        jersey_number: "8",
      },
      team: { abbreviation: "BOS" },
    } as any);

    expect(storageMocks.updatePlayer).toHaveBeenCalledWith(
      "nba_4",
      expect.objectContaining({
        team: "BOS",
        isActive: true,
        isEligibleForVesting: true,
      }),
    );
    expect(storageMocks.upsertPlayer).not.toHaveBeenCalled();
  }, 10000);
});

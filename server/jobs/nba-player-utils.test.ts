import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPlayersByIds: vi.fn(),
  upsertPlayer: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

describe("ensureNBAPlayerFromStat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing player when the roster already has it", async () => {
    storageMocks.getPlayersByIds.mockResolvedValue([{ id: "nba_1" }]);

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

    expect(player).toEqual({ id: "nba_1" });
    expect(storageMocks.upsertPlayer).not.toHaveBeenCalled();
  }, 10000);

  it("upserts a missing player from the stat payload", async () => {
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
});

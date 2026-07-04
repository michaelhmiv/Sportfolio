import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPlayersBySport: vi.fn(),
  updatePlayer: vi.fn(),
  upsertPlayer: vi.fn(),
}));

const mlbApiMocks = vi.hoisted(() => ({
  fetchAllPlayers: vi.fn(),
  fetchTeams: vi.fn(),
  fetchTeamRoster: vi.fn(),
  createPlayerId: vi.fn(),
  normalizePosition: vi.fn(),
  getCurrentSeason: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../mlb-statsapi", () => ({
  fetchAllPlayers: mlbApiMocks.fetchAllPlayers,
  fetchTeams: mlbApiMocks.fetchTeams,
  fetchTeamRoster: mlbApiMocks.fetchTeamRoster,
  createPlayerId: mlbApiMocks.createPlayerId,
  normalizePosition: mlbApiMocks.normalizePosition,
  getCurrentSeason: mlbApiMocks.getCurrentSeason,
}));

describe("syncMLBRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mlbApiMocks.getCurrentSeason.mockReturnValue(2026);
    mlbApiMocks.fetchAllPlayers.mockResolvedValue([
      {
        id: 700,
        fullName: "Slugger Shifted",
        firstName: "Slugger",
        lastName: "Shifted",
        active: true,
        currentTeam: { id: 147, name: "New York Yankees", abbreviation: "NYY" },
        primaryPosition: { abbreviation: "OF" },
        primaryNumber: "27",
      },
    ]);
    mlbApiMocks.fetchTeams.mockResolvedValue([
      { id: 147, name: "New York Yankees", abbreviation: "NYY" },
    ]);
    mlbApiMocks.fetchTeamRoster.mockResolvedValue([
      {
        person: { id: 700, fullName: "Slugger Shifted" },
        jerseyNumber: "27",
        position: { abbreviation: "OF" },
      },
    ]);
    mlbApiMocks.createPlayerId.mockImplementation((id: number) => `mlb_${id}`);
    mlbApiMocks.normalizePosition.mockReturnValue("OF");
    storageMocks.getPlayersBySport.mockResolvedValue([
      {
        id: "mlb_old",
        isActive: true,
      },
    ]);
    storageMocks.upsertPlayer.mockResolvedValue({ id: "mlb_old" });
    storageMocks.updatePlayer.mockResolvedValue(undefined);
  });

  it("uses the canonical upserted id when building the active roster set", async () => {
    const { syncMLBRoster } = await import("./sync-mlb-roster");
    const result = await syncMLBRoster();

    expect(storageMocks.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mlb_700",
        sport: "MLB",
      }),
    );
    expect(storageMocks.updatePlayer).not.toHaveBeenCalledWith(
      "mlb_old",
      expect.objectContaining({ isActive: false }),
    );
    expect(result.playersAdded).toBe(1);
    expect(result.playersDeactivated).toBe(0);
  });

  it("does not deactivate an active provider id when the update write fails", async () => {
    storageMocks.getPlayersBySport.mockResolvedValue([
      {
        id: "mlb_700",
        isActive: true,
      },
    ]);
    storageMocks.updatePlayer.mockRejectedValueOnce(new Error("transient write failure"));

    const { syncMLBRoster } = await import("./sync-mlb-roster");
    const result = await syncMLBRoster();

    expect(storageMocks.updatePlayer).toHaveBeenCalledTimes(1);
    expect(storageMocks.updatePlayer).not.toHaveBeenCalledWith(
      "mlb_700",
      expect.objectContaining({ isActive: false }),
    );
    expect(result.playersUpdated).toBe(0);
    expect(result.playersDeactivated).toBe(0);
    expect(result.errors).toContain("Failed to sync player mlb_700: transient write failure");
  });
});

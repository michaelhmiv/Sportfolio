import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPlayersBySport: vi.fn(),
  updatePlayer: vi.fn(),
  upsertPlayer: vi.fn(),
}));

const mlbApiMocks = vi.hoisted(() => ({
  fetchActivePlayers: vi.fn(),
  fetchInjuries: vi.fn(),
  createMLBPlayerId: vi.fn(),
  normalizePosition: vi.fn(),
  isMLBApiConfigured: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

vi.mock("../balldontlie-mlb", () => ({
  fetchActivePlayers: mlbApiMocks.fetchActivePlayers,
  fetchInjuries: mlbApiMocks.fetchInjuries,
  createMLBPlayerId: mlbApiMocks.createMLBPlayerId,
  normalizePosition: mlbApiMocks.normalizePosition,
  isMLBApiConfigured: mlbApiMocks.isMLBApiConfigured,
}));

describe("syncMLBRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mlbApiMocks.isMLBApiConfigured.mockReturnValue(true);
    mlbApiMocks.fetchActivePlayers.mockResolvedValue([
      {
        id: 700,
        first_name: "Slugger",
        last_name: "Shifted",
        team: { abbreviation: "NYY" },
        position: "OF",
        position_abbreviation: "OF",
        jersey_number: "27",
      },
    ]);
    mlbApiMocks.fetchInjuries.mockResolvedValue([]);
    mlbApiMocks.createMLBPlayerId.mockReturnValue("mlb_new");
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
        id: "mlb_new",
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
});

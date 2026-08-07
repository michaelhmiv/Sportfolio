import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getPlayersBySport: vi.fn(),
  upsertPlayer: vi.fn(),
  updatePlayer: vi.fn(),
  upsertPlayerIdAlias: vi.fn(),
}));
const espnNfl = vi.hoisted(() => ({
  getTeams: vi.fn(),
  getTeamRoster: vi.fn(),
}));
const nflverse = vi.hoisted(() => ({ getPlayers: vi.fn() }));
const identityMap = vi.hoisted(() => new Map<string, any>());

vi.mock("../storage", () => ({ storage }));
vi.mock("../nfl/espn-client", () => ({
  NFL_ELIGIBLE_POSITIONS: new Set(["QB", "RB", "WR", "TE", "K"]),
  espnNfl,
}));
vi.mock("../nfl/nflverse", () => ({ nflverse }));
vi.mock("../nfl/identity", () => ({
  buildNflIdentityMaps: () => ({ byEspnId: identityMap }),
  createNflEspnAlias: (id: string) => `nfl_espn_${id}`,
  createNflPlayerId: (id: string) => `nfl_${id}`,
  splitNflDisplayName: (name: string) => {
    const [firstName = "Unknown", ...rest] = name.split(" ");
    return { firstName, lastName: rest.join(" ") || "Player" };
  },
  normalizeNflTeamAbbreviation: (team: string | null | undefined) =>
    String(team || "")
      .trim()
      .toUpperCase(),
}));

import { syncNFLRoster } from "./sync-nfl-roster";

const qb = (espnId: string, name = "Test Quarterback") => ({
  espnId,
  displayName: name,
  position: "QB",
  team: "CIN",
  jersey: "9",
  active: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  identityMap.clear();
  nflverse.getPlayers.mockResolvedValue([]);
  espnNfl.getTeams.mockResolvedValue([{ id: "cin", abbreviation: "CIN", name: "Cincinnati" }]);
  storage.getPlayersBySport.mockResolvedValue([]);
  storage.upsertPlayer.mockResolvedValue(undefined);
  storage.updatePlayer.mockResolvedValue(undefined);
  storage.upsertPlayerIdAlias.mockResolvedValue(undefined);
});

describe("syncNFLRoster player lifecycle", () => {
  it("does not deactivate an admitted player when its team roster fetch fails", async () => {
    storage.getPlayersBySport.mockResolvedValue([{ id: "nfl_G1", team: "CIN", isActive: true }]);
    espnNfl.getTeamRoster.mockRejectedValue(new Error("provider unavailable"));

    const result = await syncNFLRoster();

    expect(result.errors).toHaveLength(1);
    expect(storage.updatePlayer).not.toHaveBeenCalled();
  });

  it("deactivates an admitted player only after an authoritative team roster omits them", async () => {
    storage.getPlayersBySport.mockResolvedValue([{ id: "nfl_G1", team: "CIN", isActive: true }]);
    identityMap.set("2", { gsisId: "G2", displayName: "Other Quarterback" });
    espnNfl.getTeamRoster.mockResolvedValue([qb("2", "Other Quarterback")]);

    const result = await syncNFLRoster();

    expect(result.playersDeactivated).toBe(1);
    expect(storage.updatePlayer).toHaveBeenCalledWith(
      "nfl_G1",
      expect.objectContaining({ isActive: false }),
    );
  });

  it("reactivates a returning player using the same permanent canonical id", async () => {
    storage.getPlayersBySport.mockResolvedValue([{ id: "nfl_G1", team: "CIN", isActive: false }]);
    identityMap.set("1", { gsisId: "G1", displayName: "Joe Example" });
    espnNfl.getTeamRoster.mockResolvedValue([qb("1", "Joe Example")]);

    const result = await syncNFLRoster();

    expect(result.playersUpdated).toBe(1);
    expect(storage.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nfl_G1", isActive: true }),
    );
    expect(storage.updatePlayer).not.toHaveBeenCalledWith(
      "nfl_G1",
      expect.objectContaining({ isActive: false }),
    );
  });

  it("treats an empty eligible roster as non-authoritative", async () => {
    storage.getPlayersBySport.mockResolvedValue([{ id: "nfl_G1", team: "CIN", isActive: true }]);
    espnNfl.getTeamRoster.mockResolvedValue([]);

    const result = await syncNFLRoster();

    expect(result.errors[0]).toContain("empty eligible roster");
    expect(storage.updatePlayer).not.toHaveBeenCalled();
  });
});

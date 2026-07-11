import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  getPlayersBySport: vi.fn(),
  updatePlayer: vi.fn(),
  upsertPlayer: vi.fn(),
  getDailyGamesBySport: vi.fn(),
  getDailyGameByGameId: vi.fn(),
  updateDailyGame: vi.fn(),
  upsertPlayerGameStats: vi.fn(),
  getPlayersByIds: vi.fn(),
};
const nhlApi = {
  getSeasons: vi.fn(),
  getStandings: vi.fn(),
  getRoster: vi.fn(),
  getScore: vi.fn(),
  getBoxscore: vi.fn(),
  getSchedule: vi.fn(),
};

vi.mock("../storage", () => ({ storage }));
vi.mock("../nhl-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nhl-api")>();
  return { ...actual, nhlApi };
});

import { syncNhlRoster } from "./sync-nhl-roster";
import { syncNhlSchedule } from "./sync-nhl-schedule";
import { syncNhlStats } from "./sync-nhl-stats";

const rosterPlayer = (id: number, positionCode = "C") => ({
  id,
  firstName: { default: "First" },
  lastName: { default: String(id) },
  positionCode,
});
const game = (id: number, state = "LIVE") => ({
  id,
  gameState: state,
  startTimeUTC: "2026-01-02T04:00:00Z",
  homeTeam: { abbrev: "BOS", score: 1 },
  awayTeam: { abbrev: "NYR", score: 0 },
});

beforeEach(() => {
  vi.clearAllMocks();
  nhlApi.getSeasons.mockResolvedValue([{ id: 20252026, standingsStart: "2025-10-01", standingsEnd: "2026-06-30" }]);
});

describe("syncNhlRoster", () => {
  it("reconciles a transfer globally regardless of team iteration order", async () => {
    storage.getPlayersBySport.mockResolvedValue([
      { id: "nhl_9", team: "AAA", isActive: true },
      { id: "nhl_10", team: "AAA", isActive: true },
    ]);
    nhlApi.getStandings.mockResolvedValue({ standings: [{ abbrev: "BBB" }, { abbrev: "AAA" }] });
    nhlApi.getRoster.mockImplementation((team: string) =>
      Promise.resolve(team === "AAA"
        ? { forwards: [rosterPlayer(10)], defensemen: [], goalies: [] }
        : { forwards: [rosterPlayer(9)], defensemen: [], goalies: [] }),
    );

    const result = await syncNhlRoster();

    expect(result.errors).toEqual([]);
    expect(storage.upsertPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: "nhl_9", team: "BBB", isActive: true }));
    expect(storage.updatePlayer).not.toHaveBeenCalledWith("nhl_9", expect.objectContaining({ isActive: false }));
    expect(storage.upsertPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: "nhl_10", team: "AAA", isActive: true }));
  });

  it("retains last-known players for failed or empty team rosters", async () => {
    storage.getPlayersBySport.mockResolvedValue([{ id: "nhl_9", team: "AAA", isActive: true }]);
    nhlApi.getStandings.mockResolvedValue({ standings: [{ abbrev: "AAA" }] });
    nhlApi.getRoster.mockResolvedValue({ forwards: [], defensemen: [], goalies: [] });

    const result = await syncNhlRoster();

    expect(result.errors).toHaveLength(1);
    expect(storage.updatePlayer).not.toHaveBeenCalledWith("nhl_9", expect.objectContaining({ isActive: false }));
  });
});

describe("syncNhlSchedule", () => {
  it("writes a game only once when official gameWeek envelopes overlap", async () => {
    nhlApi.getSchedule.mockResolvedValue({ gameWeek: [{ games: [game(1)] }] });
    storage.getDailyGameByGameId.mockResolvedValue(undefined);

    const result = await syncNhlSchedule(new Date("2026-01-02T12:00:00Z"));

    expect(result.recordsProcessed).toBe(1);
    expect(storage.createDailyGame).toHaveBeenCalledTimes(1);
  });
});

describe("syncNhlStats", () => {
  it("reconciles yesterday's final once and creates an unknown call-up before persisting stats", async () => {
    nhlApi.getScore.mockResolvedValue({ games: [game(1, "OFF")] });
    storage.getDailyGamesBySport.mockResolvedValue([]);
    storage.getDailyGameByGameId.mockResolvedValue({ id: "row-1", gameId: "nhl_1", status: "inprogress" });
    storage.getPlayersByIds.mockResolvedValue([]);
    nhlApi.getBoxscore.mockResolvedValue({
      playerByGameStats: {
        homeTeam: { forwards: [{ playerId: 77, name: { default: "Call Up" }, position: "C", goals: 1, assists: 0, points: 1 }], defense: [], goalies: [] },
        awayTeam: { forwards: [], defense: [], goalies: [] },
      },
    });

    const result = await syncNhlStats(new Date("2026-01-02T12:00:00Z"));

    expect(storage.upsertPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: "nhl_77", team: "BOS", isActive: true }));
    expect(storage.upsertPlayerGameStats).toHaveBeenCalledWith(expect.objectContaining({ playerId: "nhl_77", season: "20252026" }));
    expect(result.recordsProcessed).toBe(1);
  });
});

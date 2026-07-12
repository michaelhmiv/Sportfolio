import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, nhlApi } = vi.hoisted(() => ({
  storage: {
    getPlayersBySport: vi.fn(),
    updatePlayer: vi.fn(),
    upsertPlayer: vi.fn(),
    getDailyGamesBySport: vi.fn(),
    getDailyGameByGameId: vi.fn(),
    getGameStatsByGameId: vi.fn(),
    createDailyGame: vi.fn(),
    updateDailyGame: vi.fn(),
    upsertPlayerGameStats: vi.fn(),
    getPlayersByIds: vi.fn(),
  },
  nhlApi: {
    getSeasons: vi.fn(),
    getStandings: vi.fn(),
    getRoster: vi.fn(),
    getScore: vi.fn(),
    getBoxscore: vi.fn(),
    getSchedule: vi.fn(),
  },
}));

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
const completeRoster = (seed: number, included: Array<ReturnType<typeof rosterPlayer>> = []) => ({
  forwards: [
    ...included,
    ...Array.from({ length: 12 - included.length }, (_, index) => rosterPlayer(seed + index)),
  ],
  defensemen: Array.from({ length: 6 }, (_, index) => rosterPlayer(seed + 100 + index, "D")),
  goalies: [rosterPlayer(seed + 200, "G"), rosterPlayer(seed + 201, "G")],
});
const game = (id: number, state = "LIVE") => ({
  id,
  gameState: state,
  startTimeUTC: "2026-01-02T04:00:00Z",
  homeTeam: { abbrev: "BOS", score: 1 },
  awayTeam: { abbrev: "NYR", score: 0 },
});
const finalBoxscore = (playerId = 77) => ({
  playerByGameStats: {
    homeTeam: {
      forwards: [
        { playerId, name: { default: "Call Up" }, position: "C", goals: 1, assists: 0, points: 1 },
      ],
      defense: [],
      goalies: [],
    },
    awayTeam: { forwards: [], defense: [], goalies: [] },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  nhlApi.getSeasons.mockResolvedValue([
    { id: 20252026, standingsStart: "2025-10-01", standingsEnd: "2026-06-30" },
  ]);
});

describe("syncNhlRoster", () => {
  it("reconciles a transfer globally regardless of team iteration order", async () => {
    storage.getPlayersBySport.mockResolvedValue([
      { id: "nhl_9", team: "AAA", isActive: true },
      { id: "nhl_10", team: "AAA", isActive: true },
    ]);
    nhlApi.getStandings.mockResolvedValue({ standings: [{ abbrev: "BBB" }, { abbrev: "AAA" }] });
    nhlApi.getRoster.mockImplementation((team: string) =>
      Promise.resolve(
        team === "AAA"
          ? completeRoster(1000, [rosterPlayer(10)])
          : completeRoster(2000, [rosterPlayer(9)]),
      ),
    );

    const result = await syncNhlRoster();

    expect(result.errors).toEqual([]);
    expect(storage.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nhl_9", team: "BBB", isActive: true }),
    );
    expect(storage.updatePlayer).not.toHaveBeenCalledWith(
      "nhl_9",
      expect.objectContaining({ isActive: false }),
    );
    expect(storage.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nhl_10", team: "AAA", isActive: true }),
    );
  });

  it("retains last-known players for failed or empty team rosters", async () => {
    storage.getPlayersBySport.mockResolvedValue([{ id: "nhl_9", team: "AAA", isActive: true }]);
    nhlApi.getStandings.mockResolvedValue({ standings: [{ abbrev: "AAA" }] });
    nhlApi.getRoster.mockResolvedValue({ forwards: [], defensemen: [], goalies: [] });

    const result = await syncNhlRoster();

    expect(result.errors).toHaveLength(1);
    expect(storage.updatePlayer).not.toHaveBeenCalledWith(
      "nhl_9",
      expect.objectContaining({ isActive: false }),
    );
  });

  it("rejects a one-player nonempty roster and never mass-deactivates the team", async () => {
    storage.getPlayersBySport.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        id: `nhl_${index + 1}`,
        team: "AAA",
        isActive: true,
      })),
    );
    nhlApi.getStandings.mockResolvedValue({ standings: [{ abbrev: "AAA" }] });
    nhlApi.getRoster.mockResolvedValue({
      forwards: [rosterPlayer(1)],
      defensemen: [],
      goalies: [],
    });

    const result = await syncNhlRoster();

    expect(result.successfulTeams).toBe(0);
    expect(result.playersDeactivated).toBe(0);
    expect(storage.updatePlayer).not.toHaveBeenCalled();
  });

  it("makes both teams non-authoritative when a player appears on both rosters", async () => {
    storage.getPlayersBySport.mockResolvedValue([
      { id: "nhl_9", team: "AAA", isActive: true },
      { id: "nhl_10", team: "AAA", isActive: true },
      { id: "nhl_11", team: "BBB", isActive: true },
    ]);
    nhlApi.getStandings.mockResolvedValue({ standings: [{ abbrev: "AAA" }, { abbrev: "BBB" }] });
    nhlApi.getRoster.mockImplementation((team: string) =>
      Promise.resolve(completeRoster(team === "AAA" ? 1000 : 2000, [rosterPlayer(9)])),
    );

    const result = await syncNhlRoster();

    expect(result.successfulTeams).toBe(0);
    expect(
      result.errors.some((message) => message.includes("both teams retained non-authoritatively")),
    ).toBe(true);
    expect(storage.updatePlayer).not.toHaveBeenCalled();
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
  it("reconciles a final and creates an unknown call-up before persisting stats", async () => {
    nhlApi.getScore.mockResolvedValue({ games: [game(1, "OFF")] });
    storage.getDailyGamesBySport.mockResolvedValue([]);
    storage.getDailyGameByGameId.mockResolvedValue({
      id: "row-1",
      gameId: "nhl_1",
      status: "inprogress",
    });
    storage.getGameStatsByGameId.mockResolvedValue([]);
    storage.getPlayersByIds.mockResolvedValue([]);
    nhlApi.getBoxscore.mockResolvedValue(finalBoxscore());

    const result = await syncNhlStats(new Date("2026-01-02T12:00:00Z"));

    expect(storage.getPlayersByIds).toHaveBeenCalledTimes(1);
    expect(storage.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nhl_77", team: "BOS", isActive: true }),
    );
    expect(storage.upsertPlayerGameStats).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: "nhl_77", season: "20252026" }),
    );
    expect(result.recordsProcessed).toBe(1);
  });

  it("skips a completed game on a second execution after durable final reconciliation", async () => {
    nhlApi.getScore.mockResolvedValue({ games: [game(1, "OFF")] });
    storage.getDailyGamesBySport.mockResolvedValue([]);
    storage.getDailyGameByGameId.mockResolvedValue({
      id: "row-1",
      gameId: "nhl_1",
      status: "completed",
    });
    storage.getPlayersByIds.mockResolvedValue([{ id: "nhl_77" }]);
    nhlApi.getBoxscore.mockResolvedValue(finalBoxscore());
    storage.getGameStatsByGameId
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { statsJson: { finalReconciliation: { status: "complete", expectedPlayerCount: 1 } } },
      ]);

    await syncNhlStats(new Date("2026-01-02T12:00:00Z"));
    await syncNhlStats(new Date("2026-01-02T12:05:00Z"));

    expect(nhlApi.getBoxscore).toHaveBeenCalledTimes(1);
    expect(storage.upsertPlayerGameStats).toHaveBeenCalledTimes(1);
  });

  it("reopens final reconciliation when the durable marker proves the prior write is incomplete", async () => {
    nhlApi.getScore.mockResolvedValue({ games: [game(1, "OFF")] });
    storage.getDailyGamesBySport.mockResolvedValue([]);
    storage.getDailyGameByGameId.mockResolvedValue({
      id: "row-1",
      gameId: "nhl_1",
      status: "completed",
    });
    storage.getGameStatsByGameId.mockResolvedValue([
      { statsJson: { finalReconciliation: { status: "complete", expectedPlayerCount: 2 } } },
    ]);
    storage.getPlayersByIds.mockResolvedValue([{ id: "nhl_77" }]);
    nhlApi.getBoxscore.mockResolvedValue(finalBoxscore());

    await syncNhlStats(new Date("2026-01-02T12:00:00Z"));

    expect(nhlApi.getBoxscore).toHaveBeenCalledTimes(1);
    expect(storage.upsertPlayerGameStats).toHaveBeenCalledTimes(1);
  });
});

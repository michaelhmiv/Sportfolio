import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getDailyGameByGameId: vi.fn(),
    createDailyGame: vi.fn(),
    updateDailyGame: vi.fn(),
  },
}));

import { storage } from "../storage";
import { espnNfl, type EspnNflGame } from "../nfl/espn-client";
import { syncNFLSchedule } from "./sync-nfl-schedule";

function game(input: {
  id: string;
  seasonType: "preseason" | "regular" | "postseason";
  week: number;
  startsAt: string;
  home?: string;
  away?: string;
}): EspnNflGame {
  return {
    espnId: input.id,
    season: 2024,
    seasonType: input.seasonType,
    week: input.week,
    startsAt: new Date(input.startsAt),
    status: "completed",
    sourceStatus: "STATUS_FINAL",
    homeTeam: input.home || "KC",
    awayTeam: input.away || "BUF",
    homeScore: 24,
    awayScore: 20,
    venue: "Example Stadium",
    period: 4,
    clock: "0:00",
  };
}

describe("NFL full-season schedule sync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(storage.getDailyGameByGameId)
      .mockReset()
      .mockResolvedValue(undefined as never);
    vi.mocked(storage.createDailyGame)
      .mockReset()
      .mockResolvedValue(undefined as never);
    vi.mocked(storage.updateDailyGame)
      .mockReset()
      .mockResolvedValue(undefined as never);
  });

  it("loads Week 18 and playoffs from the following calendar year while excluding the Pro Bowl", async () => {
    const preseason = game({
      id: "pre",
      seasonType: "preseason",
      week: 1,
      startsAt: "2024-08-01T00:00:00Z",
    });
    const week18 = game({
      id: "week18",
      seasonType: "regular",
      week: 18,
      startsAt: "2025-01-05T18:00:00Z",
      home: "NYJ",
      away: "MIA",
    });
    const wildCard = game({
      id: "wildcard",
      seasonType: "postseason",
      week: 1,
      startsAt: "2025-01-12T18:00:00Z",
      home: "BUF",
      away: "DEN",
    });
    const proBowl = game({
      id: "probowl",
      seasonType: "postseason",
      week: 4,
      startsAt: "2025-02-02T20:00:00Z",
      home: "NFC",
      away: "AFC",
    });

    const getGames = vi.spyOn(espnNfl, "getGames").mockImplementation(async (options = {}) => {
      if (options.dates === "2024" && options.seasonType === "preseason") return [preseason];
      if (options.dates === "2025" && options.seasonType === "regular") return [week18];
      if (options.dates === "2025" && options.seasonType === "postseason") {
        return [wildCard, proBowl];
      }
      return [];
    });

    const result = await syncNFLSchedule({ season: 2024, fullSeason: true });

    expect(result.errors).toEqual([]);
    expect(result.requestCount).toBe(6);
    expect(result.gamesProcessed).toBe(3);
    expect(getGames).toHaveBeenCalledWith(
      expect.objectContaining({ dates: "2025", seasonType: "regular", limit: 1000 }),
    );
    expect(getGames).toHaveBeenCalledWith(
      expect.objectContaining({ dates: "2025", seasonType: "postseason", limit: 1000 }),
    );
    expect(storage.createDailyGame).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: "nfl_week18",
        season: 2024,
        seasonType: "regular",
        week: 18,
      }),
    );
    expect(storage.createDailyGame).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: "nfl_wildcard",
        season: 2024,
        seasonType: "postseason",
        week: 1,
      }),
    );
    expect(storage.createDailyGame).not.toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "nfl_probowl" }),
    );
  });
});

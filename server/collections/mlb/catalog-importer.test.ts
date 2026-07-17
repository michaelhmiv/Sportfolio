import { describe, expect, it, vi } from "vitest";
import {
  importCollectionMembers,
  type MlbCollectionSource,
  type MlbSeasonStatSplit,
} from "./catalog-importer";

function split(playerId: number, value: number, rank = 1): MlbSeasonStatSplit {
  return {
    season: "2025",
    player: { id: playerId, fullName: `Player ${playerId}` },
    rank,
    stat: { homeRuns: value, era: String(value) },
    position: { abbreviation: "P" },
  };
}

function source(overrides: Partial<MlbCollectionSource> = {}): MlbCollectionSource {
  return {
    fetchSeasonStats: vi.fn(async () => []),
    fetchAwardRecipients: vi.fn(async () => []),
    ...overrides,
  };
}

describe("MLB collection catalog importer", () => {
  it("includes every player tied at a top-N cutoff", async () => {
    const fetchSeasonStats = vi.fn(async () => [
      split(1, 60, 1),
      split(2, 55, 2),
      split(3, 50, 3),
      split(4, 50, 3),
      split(5, 49, 5),
    ]);

    const members = await importCollectionMembers(
      {
        type: "season_rank",
        season: 2025,
        group: "hitting",
        statKey: "homeRuns",
        sortStat: "homeRuns",
        direction: "desc",
        top: 3,
      },
      source({ fetchSeasonStats }),
    );

    expect(members.map((member) => member.mlbamId)).toEqual([1, 2, 3, 4]);
    expect(fetchSeasonStats).toHaveBeenCalledWith(
      expect.objectContaining({ season: 2025, group: "hitting", sortStat: "homeRuns" }),
    );
  });

  it("forwards qualified and postseason source filters", async () => {
    const fetchSeasonStats = vi.fn(async () => [split(7, 1.97)]);

    await importCollectionMembers(
      {
        type: "season_rank",
        season: 2025,
        group: "pitching",
        statKey: "era",
        sortStat: "earnedRunAverage",
        direction: "asc",
        top: 10,
        qualified: true,
        gameType: "P",
      },
      source({ fetchSeasonStats }),
    );

    expect(fetchSeasonStats).toHaveBeenCalledWith({
      season: 2025,
      group: "pitching",
      sortStat: "earnedRunAverage",
      qualified: true,
      gameType: "P",
      limit: 1000,
    });
  });

  it("imports every player meeting a numeric threshold", async () => {
    const members = await importCollectionMembers(
      {
        type: "threshold",
        season: 2025,
        group: "hitting",
        statKey: "homeRuns",
        sortStat: "homeRuns",
        direction: "desc",
        minimum: 30,
      },
      source({ fetchSeasonStats: vi.fn(async () => [split(1, 31), split(2, 30), split(3, 29)]) }),
    );

    expect(members.map((member) => member.mlbamId)).toEqual([1, 2]);
  });

  it("combines official award IDs and de-duplicates recipients", async () => {
    const fetchAwardRecipients = vi
      .fn()
      .mockResolvedValueOnce([
        { awardId: "ALSS", player: { id: 10, fullName: "A Player" }, position: "OF" },
        { awardId: "ALSS", player: { id: 11, fullName: "B Player" }, position: "C" },
      ])
      .mockResolvedValueOnce([
        { awardId: "NLSS", player: { id: 11, fullName: "B Player" }, position: "C" },
        { awardId: "NLSS", player: { id: 12, fullName: "C Player" }, position: "SS" },
      ]);

    const members = await importCollectionMembers(
      { type: "awards", season: 2025, awardIds: ["ALSS", "NLSS"] },
      source({ fetchAwardRecipients }),
    );

    expect(members.map((member) => member.mlbamId)).toEqual([10, 11, 12]);
    expect(fetchAwardRecipients).toHaveBeenNthCalledWith(1, "ALSS", 2025);
    expect(fetchAwardRecipients).toHaveBeenNthCalledWith(2, "NLSS", 2025);
  });

  it("rejects a composite award source when any configured award is empty", async () => {
    const fetchAwardRecipients = vi
      .fn()
      .mockResolvedValueOnce([
        { awardId: "ALSS", player: { id: 10, fullName: "A Player" }, position: "OF" },
      ])
      .mockResolvedValueOnce([]);

    await expect(
      importCollectionMembers(
        { type: "awards", season: 2025, awardIds: ["ALSS", "NLSS"] },
        source({ fetchAwardRecipients }),
      ),
    ).rejects.toThrow("MLB award source NLSS returned no recipients for 2025");
  });

  it("rejects malformed or non-numeric stat values instead of silently selecting them", async () => {
    await expect(
      importCollectionMembers(
        {
          type: "season_rank",
          season: 2025,
          group: "hitting",
          statKey: "homeRuns",
          sortStat: "homeRuns",
          direction: "desc",
          top: 10,
        },
        source({
          fetchSeasonStats: vi.fn(async () => [
            {
              ...split(1, 30),
              stat: { homeRuns: "not-a-number" },
            },
          ]),
        }),
      ),
    ).rejects.toThrow(/non-numeric homeRuns/i);
  });
});

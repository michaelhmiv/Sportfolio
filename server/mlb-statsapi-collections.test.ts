import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAwardRecipients, fetchSeasonStatSplits } from "./mlb-statsapi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MLB StatsAPI collection source", () => {
  it("requests explicit season-stat filters and returns split rows", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request) =>
        new Response(
          JSON.stringify({
            stats: [
              {
                splits: [
                  {
                    season: "2025",
                    rank: 1,
                    player: { id: 663728, fullName: "Cal Raleigh" },
                    stat: { homeRuns: 60 },
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const rows = await fetchSeasonStatSplits({
      season: 2025,
      group: "hitting",
      sortStat: "homeRuns",
      qualified: true,
      gameType: "P",
      limit: 1000,
    });

    expect(rows[0]?.player.id).toBe(663728);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/stats");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      stats: "season",
      group: "hitting",
      season: "2025",
      sportIds: "1",
      sortStat: "homeRuns",
      playerPool: "QUALIFIED",
      gameType: "P",
      limit: "1000",
    });
  });

  it("normalizes official award recipient rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              awards: [
                {
                  id: "ALSS",
                  date: "2025-11-07",
                  team: { id: 147 },
                  player: {
                    id: 592450,
                    nameFirstLast: "Aaron Judge",
                    primaryPosition: { abbreviation: "OF" },
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(fetchAwardRecipients("ALSS", 2025)).resolves.toEqual([
      {
        awardId: "ALSS",
        awardDate: "2025-11-07",
        player: { id: 592450, fullName: "Aaron Judge" },
        position: "OF",
        teamId: 147,
      },
    ]);
  });
});

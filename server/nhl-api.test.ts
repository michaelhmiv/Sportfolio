import { describe, expect, it, vi } from "vitest";

import {
  NHL_API_BASE,
  NhlApiClient,
  NhlApiError,
  createNhlGameId,
  createNhlPlayerId,
  formatNhlGameDay,
  normalizeNhlGameState,
  selectNhlSeason,
} from "./nhl-api";

describe("NHL identity and date helpers", () => {
  it("uses collision-safe, sport-prefixed identifiers", () => {
    expect(createNhlPlayerId(8478402)).toBe("nhl_8478402");
    expect(createNhlGameId(2026020001)).toBe("nhl_2026020001");
  });

  it("formats game days in America/New_York instead of server local time", () => {
    expect(formatNhlGameDay(new Date("2026-01-02T04:30:00.000Z"))).toBe("2026-01-01");
    expect(formatNhlGameDay(new Date("2026-01-02T05:30:00.000Z"))).toBe("2026-01-02");
  });
});

describe("selectNhlSeason", () => {
  const seasons = [
    { id: 20232024, startDate: "2023-09-20", endDate: "2024-06-24" },
    { id: 20242025, startDate: "2024-09-18", endDate: "2025-06-24" },
    { id: 20252026, startDate: "2025-09-16", endDate: "2026-06-24" },
  ];

  it("prefers the official active season", () => {
    expect(selectNhlSeason(seasons, new Date("2026-01-10T12:00:00Z"))).toBe("20252026");
  });

  it("selects the most recently completed official season in the offseason", () => {
    expect(selectNhlSeason(seasons, new Date("2026-07-10T12:00:00Z"))).toBe("20252026");
  });

  it("understands the field names returned by standings-season", () => {
    expect(
      selectNhlSeason(
        [
          { id: 20252026, standingsStart: "2025-10-07", standingsEnd: "2026-04-17" },
          { id: 20262027, standingsStart: "2026-09-29", standingsEnd: "2027-04-10" },
        ],
        new Date("2026-07-10T12:00:00Z"),
      ),
    ).toBe("20252026");
  });

  it("does not derive a season from calendar-year concatenation", () => {
    expect(
      selectNhlSeason(
        [{ id: 20192020, startDate: "2019-09-01", endDate: "2020-09-30" }],
        new Date("2026-01-01"),
      ),
    ).toBe("20192020");
  });
});

describe("normalizeNhlGameState", () => {
  it.each([
    ["FUT", "scheduled"],
    ["PRE", "scheduled"],
    ["LIVE", "inprogress"],
    ["CRIT", "inprogress"],
    ["OFF", "completed"],
    ["FINAL", "completed"],
    ["PPD", "postponed"],
    ["SUSP", "postponed"],
    ["CANC", "postponed"],
    ["unexpected", "scheduled"],
  ] as const)("maps %s to %s", (state, expected) => {
    expect(normalizeNhlGameState(state)).toBe(expected);
  });

  it("never regresses a final game from an older feed", () => {
    expect(normalizeNhlGameState("LIVE", "completed")).toBe("completed");
  });
});

describe("NhlApiClient", () => {
  it("reads official season metadata from the documented envelope", async () => {
    const client = new NhlApiClient({
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ seasons: [{ id: 20252026 }] }), { status: 200 }),
        ),
    });
    await expect(client.getSeasons()).resolves.toEqual([{ id: 20252026 }]);
  });

  it("validates endpoint payloads and coalesces concurrent requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ games: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new NhlApiClient({ fetch: fetchMock, cacheTtlMs: 1_000 });

    const [first, second] = await Promise.all([
      client.getScore("2026-01-01"),
      client.getScore("2026-01-01"),
    ]);
    expect(first).toEqual({ games: [] });
    expect(second).toEqual({ games: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${NHL_API_BASE}/score/2026-01-01`, expect.any(Object));
  });

  it("retries transient responses after a bounded delay and respects reasonable Retry-After", async () => {
    const delays: number[] = [];
    const retryFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ games: [] }), { status: 200 }));
    const retryClient = new NhlApiClient({ fetch: retryFetch, retryDelayMs: 100, maxRetries: 1, random: () => 0, sleep: async (delay) => { delays.push(delay); } });
    await expect(retryClient.getScore("2026-01-01")).resolves.toEqual({ games: [] });
    expect(delays).toEqual([100]);

    const rateLimited = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ games: [] }), { status: 200 }));
    const retryAfterDelays: number[] = [];
    await new NhlApiClient({ fetch: rateLimited, maxRetries: 1, random: () => 0, sleep: async (delay) => { retryAfterDelays.push(delay); } }).getScore("2026-01-02");
    expect(retryAfterDelays).toEqual([2_000]);
  });

  it("bounds malformed Retry-After hints and cleans pending requests after rejection", async () => {
    const delays: number[] = [];
    const fetchMock = vi.fn().mockResolvedValue(new Response("busy", { status: 503, headers: { "retry-after": "999999" } }));
    const client = new NhlApiClient({ fetch: fetchMock, maxRetries: 1, random: () => 0, sleep: async (delay) => { delays.push(delay); } });
    await expect(client.getScore("2026-01-01")).rejects.toBeInstanceOf(NhlApiError);
    expect(delays[0]).toBeLessThanOrEqual(30_000);
    await expect(client.getScore("2026-01-01")).rejects.toBeInstanceOf(NhlApiError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries a transient response but not an ordinary 4xx contract error", async () => {
    const retryFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ games: [] }), { status: 200 }));
    const retryClient = new NhlApiClient({ fetch: retryFetch, retryDelayMs: 0, maxRetries: 1 });
    await expect(retryClient.getScore("2026-01-01")).resolves.toEqual({ games: [] });
    expect(retryFetch).toHaveBeenCalledTimes(2);

    const notFoundFetch = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    const notFoundClient = new NhlApiClient({
      fetch: notFoundFetch,
      retryDelayMs: 0,
      maxRetries: 2,
    });
    await expect(notFoundClient.getScore("2026-01-01")).rejects.toBeInstanceOf(NhlApiError);
    expect(notFoundFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed top-level payloads", async () => {
    const client = new NhlApiClient({
      fetch: vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ wrong: [] }), { status: 200 })),
    });
    await expect(client.getScore("2026-01-01")).rejects.toThrow("malformed response");
  });
});

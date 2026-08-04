import { describe, expect, it, vi } from "vitest";
import { SportsAdapterRegistry } from "./adapter-registry";
import type { ProviderMetadata } from "./contracts";
import { assembleSportsContext } from "./context-service";

const provider: ProviderMetadata = {
  provider: "fixture",
  fetchedAt: "2026-08-04T15:00:00.000Z",
  staleAfterSeconds: 60,
  isStale: false,
};

function registry() {
  const value = new SportsAdapterRegistry();
  value.register({
    sport: "mlb",
    getAthlete: vi.fn(async (id) => ({ id, sport: "mlb", name: id, active: true, provider })),
    getTeams: vi.fn(async () => [{ id: "mlb_team_1", sport: "mlb", name: "A", provider }]),
    getSchedule: vi.fn(async () => [
      {
        id: "mlb_game_1",
        sport: "mlb",
        startsAt: "2026-08-04T20:00:00.000Z",
        status: "scheduled",
        homeTeamId: "a",
        awayTeamId: "b",
        provider,
      },
    ]),
    getStats: vi.fn(async (ids) =>
      ids.map((id) => ({
        entityId: id,
        sport: "mlb",
        season: "2026",
        stats: { points: 1 },
        provider,
      })),
    ),
    getLiveState: vi.fn(async (id) => ({
      gameId: id,
      status: "in_progress",
      clock: null,
      period: "5th",
      summary: "Top 5",
      provider,
    })),
  });
  value.register({
    sport: "nhl",
    getSchedule: vi.fn(async () => [
      {
        id: "nhl_game_1",
        sport: "nhl",
        startsAt: "2026-08-04T18:00:00.000Z",
        status: "scheduled",
        homeTeamId: "c",
        awayTeamId: "d",
        provider,
      },
    ]),
  });
  value.register({ sport: "nascar" });
  return value;
}

const lookup = vi.fn(async (references) =>
  references.map((reference) => ({ ...reference, sportfolioId: reference.providerId })),
);
const storage = {
  getUserHoldingsWithPlayers: vi.fn(async () => [
    {
      holding: { quantity: 4, lockedQuantity: 1, multiplier: 2 },
      player: { id: "mlb_1", sport: "MLB" },
    },
  ]),
  getWatchlists: vi.fn(async () => [{ id: "w1", name: "Targets", items: ["mlb_1", "mlb_2"] }]),
};

describe("assembleSportsContext", () => {
  it("deduplicates repeated provider calls and reports measured call counts", async () => {
    const sportsRegistry = registry();
    const result = await assembleSportsContext(
      {
        requests: [
          { sport: "mlb", sections: ["schedule"], date: "2026-08-04" },
          { sport: "mlb", sections: ["schedule"], date: "2026-08-04" },
        ],
      },
      { mode: "public" },
      {
        registry: sportsRegistry,
        identityLookup: lookup,
        now: () => new Date("2026-08-04T15:00:00.000Z"),
      },
    );
    expect(sportsRegistry.get("mlb").getSchedule).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).toMatchObject({ sourceCalls: 1, cacheHits: 1 });
  });

  it("runs one deduplicated identity resolution batch", async () => {
    lookup.mockClear();
    const reference = {
      sport: "mlb" as const,
      provider: "sportfolio",
      entityType: "athlete" as const,
      providerId: "mlb_1",
    };
    const result = await assembleSportsContext(
      {
        requests: [{ sport: "mlb", sections: ["entities"], athleteIds: ["mlb_1"] }],
        providerReferences: [reference, reference],
      },
      { mode: "public" },
      { registry: registry(), identityLookup: lookup },
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][0]).toHaveLength(1);
    expect(result.identityResolution.resolved).toHaveLength(1);
  });

  it("supports deterministic mixed-sport responses", async () => {
    const result = await assembleSportsContext(
      {
        requests: [
          { sport: "nhl", sections: ["schedule"], date: "2026-08-04" },
          { sport: "mlb", sections: ["schedule"], date: "2026-08-04" },
        ],
      },
      { mode: "public" },
      {
        registry: registry(),
        identityLookup: lookup,
        now: () => new Date("2026-08-04T15:00:00.000Z"),
      },
    );
    expect(result.requests.map((request) => request.sport)).toEqual(["mlb", "nhl"]);
    expect(result.generatedAt).toBe("2026-08-04T15:00:00.000Z");
  });

  it("returns partial section failures without discarding successful sections", async () => {
    const value = registry();
    value.get("mlb").getTeams = async () => {
      throw new Error("provider down");
    };
    const result = await assembleSportsContext(
      { requests: [{ sport: "mlb", sections: ["teams", "schedule"], date: "2026-08-04" }] },
      { mode: "public" },
      { registry: value, identityLookup: lookup },
    );
    expect(result.partial).toBe(true);
    expect(result.requests[0].sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "schedule", status: "complete" }),
        expect.objectContaining({ name: "teams", status: "error" }),
      ]),
    );
  });

  it("never exposes private state in public mode", async () => {
    storage.getUserHoldingsWithPlayers.mockClear();
    const result = await assembleSportsContext(
      { requests: [{ sport: "mlb", sections: ["user_exposure"], athleteIds: ["mlb_1"] }] },
      { mode: "public" },
      { registry: registry(), identityLookup: lookup, storage },
    );
    expect(result.requests[0].sections[0]).toMatchObject({ status: "error", data: null });
    expect(storage.getUserHoldingsWithPlayers).not.toHaveBeenCalled();
  });

  it("sanitizes authenticated connected-user exposure", async () => {
    const result = await assembleSportsContext(
      { requests: [{ sport: "mlb", sections: ["user_exposure"], athleteIds: ["mlb_1"] }] },
      { mode: "authenticated", userId: "u1" },
      { registry: registry(), identityLookup: lookup, storage },
    );
    expect(result.requests[0].sections[0].data).toEqual({
      holdings: [{ playerId: "mlb_1", shares: 4, lockedShares: 1, multiplier: 2 }],
      watchlists: [{ id: "w1", name: "Targets", playerIds: ["mlb_1"] }],
    });
  });

  it("rejects oversized requests before provider access", async () => {
    await expect(
      assembleSportsContext(
        {
          requests: Array.from({ length: 7 }, () => ({
            sport: "mlb" as const,
            sections: ["teams" as const],
          })),
        },
        { mode: "public" },
        { registry: registry(), identityLookup: lookup },
      ),
    ).rejects.toBeTruthy();
  });
});

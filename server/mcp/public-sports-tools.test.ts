import { describe, expect, it } from "vitest";
import { SportsAdapterRegistry } from "../sports/adapter-registry";
import type { ProviderMetadata } from "../sports/contracts";
import { executePublicTool, buildPublicToolRegistry } from "./public-tool-registry";
import { createMockPublicMcpDependencies } from "./testing";

const provider: ProviderMetadata = {
  provider: "fixture",
  fetchedAt: "2026-08-04T12:00:00.000Z",
  staleAfterSeconds: 60,
  isStale: false,
};

function buildRegistry() {
  const registry = new SportsAdapterRegistry();
  registry.register({
    sport: "mlb",
    async searchAthletes(query) {
      return query.toLowerCase().includes("ohtani")
        ? [
            {
              id: "mlb_660271",
              sport: "mlb",
              name: "Shohei Ohtani",
              teamId: "mlb_team_119",
              position: "DH",
              active: true,
              provider,
            },
          ]
        : [];
    },
    async getAthlete(id) {
      return id === "mlb_660271"
        ? {
            id,
            sport: "mlb",
            name: "Shohei Ohtani",
            teamId: "mlb_team_119",
            position: "DH",
            active: true,
            provider,
          }
        : null;
    },
    async getTeams() {
      return [
        {
          id: "mlb_team_119",
          sport: "mlb",
          name: "Los Angeles Dodgers",
          abbreviation: "LAD",
          provider,
        },
      ];
    },
    async getSchedule() {
      return [
        {
          id: "mlb_game_1",
          sport: "mlb",
          startsAt: "2026-08-04T23:10:00.000Z",
          status: "scheduled",
          homeTeamId: "mlb_team_119",
          awayTeamId: "mlb_team_144",
          provider,
        },
      ];
    },
    async getLiveState(gameId) {
      return {
        gameId,
        status: "in_progress",
        clock: null,
        period: "5th",
        summary: "Top 5th",
        provider,
      };
    },
  });
  registry.register({
    sport: "nhl",
    async getSchedule() {
      return [];
    },
  });
  registry.register({
    sport: "nascar",
    async getSchedule() {
      return [];
    },
  });
  return registry;
}

function context() {
  const harness = createMockPublicMcpDependencies();
  harness.deps.sportsRegistry = buildRegistry();
  return { userId: harness.userId, deps: harness.deps };
}

describe("compact unified public sports tools", () => {
  it("registers only curated sport-agnostic names", () => {
    const names = buildPublicToolRegistry().map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_supported_sports_capabilities",
        "search_sports_entities",
        "get_sports_entity",
        "get_event_slate",
        "get_event_live_state",
      ]),
    );
    expect(names.some((name) => name.startsWith("mlb_mcp__"))).toBe(false);
  });

  it("selects the requested adapter and returns compact provenance", async () => {
    const result = await executePublicTool(context(), "search_sports_entities", {
      sport: "mlb",
      entityType: "athlete",
      query: "Ohtani",
      limit: 10,
    });
    expect(result).toMatchObject({
      sport: "mlb",
      entityType: "athlete",
      items: [{ id: "mlb_660271", provider: { provider: "fixture" } }],
      pagination: { total: 1, hasMore: false },
    });
  });

  it("orders and bounds event slate responses", async () => {
    const result = await executePublicTool(context(), "get_event_slate", {
      sport: "mlb",
      date: "2026-08-04",
      limit: 10,
    });
    expect(result).toMatchObject({
      sport: "mlb",
      events: [{ id: "mlb_game_1", status: "scheduled" }],
      pagination: { total: 1 },
    });
  });

  it("fails closed for unsupported capability combinations", async () => {
    await expect(
      executePublicTool(context(), "search_sports_entities", {
        sport: "nascar",
        entityType: "athlete",
        query: "Larson",
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
  });

  it("rejects oversized date windows", async () => {
    await expect(
      executePublicTool(context(), "get_event_slate", {
        sport: "mlb",
        startDate: "2026-08-01",
        endDate: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "request_too_broad" });
  });
});

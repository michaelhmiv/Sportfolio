import type { SportsAdapter } from "./adapter-registry";
import type { Game, GameStatus, LiveState, ProviderMetadata, Team } from "./contracts";
import {
  NhlApiClient,
  nhlApi,
  normalizeNhlGameState,
  type NhlGame,
  type NhlTeam,
} from "../nhl-api";

type NhlDependencies = {
  client: Pick<NhlApiClient, "getStandings" | "getSchedule" | "getScore">;
  now: () => Date;
};
const defaults: NhlDependencies = { client: nhlApi, now: () => new Date() };
function metadata(now: Date, ttl = 300): ProviderMetadata {
  return {
    provider: "nhl-web",
    fetchedAt: now.toISOString(),
    staleAfterSeconds: ttl,
    isStale: false,
  };
}
function gameStatus(value: NhlGame): GameStatus {
  const state = normalizeNhlGameState(value.gameState || value.gameScheduleState);
  if (state === "completed") return "final";
  if (state === "inprogress") return "in_progress";
  if (state === "postponed") return "postponed";
  return "scheduled";
}
function game(value: NhlGame, now: Date): Game {
  if (!value.startTimeUTC) throw new Error(`NHL game ${value.id} is missing startTimeUTC`);
  return {
    id: `nhl_game_${value.id}`,
    sport: "nhl",
    startsAt: new Date(value.startTimeUTC).toISOString(),
    status: gameStatus(value),
    homeTeamId: value.homeTeam?.abbrev ? `nhl_team_${value.homeTeam.abbrev.toUpperCase()}` : null,
    awayTeamId: value.awayTeam?.abbrev ? `nhl_team_${value.awayTeam.abbrev.toUpperCase()}` : null,
    provider: metadata(now),
  };
}
function team(value: NhlTeam, now: Date): Team {
  const abbreviation = value.abbrev?.toUpperCase() || null;
  return {
    id: `nhl_team_${abbreviation || value.id}`,
    sport: "nhl",
    name:
      value.commonName?.default || value.placeName?.default || abbreviation || `NHL ${value.id}`,
    abbreviation,
    provider: metadata(now),
  };
}
export function createNhlAdapter(deps: Partial<NhlDependencies> = {}): SportsAdapter {
  const api = { ...defaults, ...deps };
  return {
    sport: "nhl",
    async getTeams() {
      const response = await api.client.getStandings("now");
      const now = api.now();
      return response.standings.map((value) => team(value, now));
    },
    async getSchedule(from, to) {
      const now = api.now();
      const games = new Map<number, NhlGame>();
      for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
        const response = await api.client.getSchedule(cursor.toISOString().slice(0, 10));
        for (const week of response.gameWeek)
          for (const value of week.games || []) games.set(value.id, value);
      }
      return [...games.values()]
        .filter(
          (value) =>
            value.startTimeUTC &&
            new Date(value.startTimeUTC) >= from &&
            new Date(value.startTimeUTC) <= to,
        )
        .map((value) => game(value, now));
    },
    async getLiveState(id) {
      const providerId = id.replace(/^nhl_game_/, "");
      if (!/^\d+$/.test(providerId)) return null;
      const response = await api.client.getScore("now");
      const value = response.games.find((candidate) => String(candidate.id) === providerId);
      if (!value) return null;
      return {
        gameId: id,
        status: gameStatus(value),
        clock: value.clock?.timeRemaining ?? null,
        period: value.periodDescriptor?.number ? String(value.periodDescriptor.number) : null,
        summary: value.periodDescriptor?.periodType ?? null,
        provider: metadata(api.now(), 15),
      } satisfies LiveState;
    },
  };
}

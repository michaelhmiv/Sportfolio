import type { SportsAdapter } from "./adapter-registry";
import type { Game, LiveState, ProviderMetadata, Team } from "./contracts";
import { createProviderMetadata, reconcileAndSortGames, resolveNhlGameStatus } from "./semantics";
import { NhlApiClient, nhlApi, type NhlGame, type NhlTeam } from "../nhl-api";

type NhlDependencies = {
  client: Pick<NhlApiClient, "getStandings" | "getSchedule" | "getScore">;
  now: () => Date;
};
const defaults: NhlDependencies = { client: nhlApi, now: () => new Date() };
function metadata(now: Date, ttl = 300): ProviderMetadata {
  return createProviderMetadata({ provider: "nhl-web", fetchedAt: now, staleAfterSeconds: ttl });
}
function game(value: NhlGame, now: Date): Game {
  if (!value.startTimeUTC) throw new Error(`NHL game ${value.id} is missing startTimeUTC`);
  const status = resolveNhlGameStatus(value.gameState || value.gameScheduleState);
  const startsAt = new Date(value.startTimeUTC).toISOString();
  return {
    id: `nhl_game_${value.id}`,
    sport: "nhl",
    startsAt,
    status: status.status,
    homeTeamId: value.homeTeam?.abbrev ? `nhl_team_${value.homeTeam.abbrev.toUpperCase()}` : null,
    awayTeamId: value.awayTeam?.abbrev ? `nhl_team_${value.awayTeam.abbrev.toUpperCase()}` : null,
    sourceStatus: status.sourceStatus,
    statusSource: status.statusSource,
    statusConfidence: status.statusConfidence,
    statusReason: status.statusReason,
    eventOrderKey: `${startsAt}|${value.id}`,
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
      const normalized = [...games.values()]
        .filter(
          (value) =>
            value.startTimeUTC &&
            new Date(value.startTimeUTC) >= from &&
            new Date(value.startTimeUTC) <= to,
        )
        .map((value) => game(value, now));
      return reconcileAndSortGames(normalized);
    },
    async getLiveState(id) {
      const providerId = id.replace(/^nhl_game_/, "");
      if (!/^\d+$/.test(providerId)) return null;
      const response = await api.client.getScore("now");
      const value = response.games.find((candidate) => String(candidate.id) === providerId);
      if (!value) return null;
      const status = resolveNhlGameStatus(value.gameState || value.gameScheduleState);
      const periodNumber = value.periodDescriptor?.number ?? null;
      return {
        gameId: id,
        status: status.status,
        clock: value.clock?.timeRemaining ?? null,
        period: periodNumber ? String(periodNumber) : null,
        summary: value.periodDescriptor?.periodType ?? null,
        sourceStatus: status.sourceStatus,
        statusSource: status.statusSource,
        statusConfidence: status.statusConfidence,
        statusReason: status.statusReason,
        phase: {
          kind: "period",
          number: periodNumber,
          label: value.periodDescriptor?.periodType ?? null,
        },
        progress: null,
        provider: metadata(api.now(), 15),
      } satisfies LiveState;
    },
  };
}

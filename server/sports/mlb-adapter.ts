import type { SportsAdapter } from "./adapter-registry";
import type { Athlete, Game, LiveState, ProviderMetadata, Team } from "./contracts";
import { createProviderMetadata, reconcileAndSortGames, resolveMlbGameStatus } from "./semantics";
import {
  createPlayerId,
  fetchAllPlayers,
  fetchLinescore,
  fetchPlayer,
  fetchSchedule,
  fetchTeams,
  parsePlayerId,
  type MlbGame,
  type MlbLinescore,
  type MlbPlayer,
  type MlbTeam,
} from "../mlb-statsapi";

type MlbDependencies = {
  fetchAllPlayers: typeof fetchAllPlayers;
  fetchPlayer: typeof fetchPlayer;
  fetchTeams: typeof fetchTeams;
  fetchSchedule: typeof fetchSchedule;
  fetchLinescore: typeof fetchLinescore;
  now: () => Date;
};

const defaults: MlbDependencies = {
  fetchAllPlayers,
  fetchPlayer,
  fetchTeams,
  fetchSchedule,
  fetchLinescore,
  now: () => new Date(),
};

function metadata(now: Date, ttl = 300): ProviderMetadata {
  return createProviderMetadata({
    provider: "mlb-statsapi",
    fetchedAt: now,
    staleAfterSeconds: ttl,
  });
}
function athlete(player: MlbPlayer, now: Date): Athlete {
  return {
    id: createPlayerId(player.id),
    sport: "mlb",
    name: player.fullName,
    teamId: player.currentTeam?.id ? `mlb_team_${player.currentTeam.id}` : null,
    position: player.primaryPosition?.abbreviation ?? null,
    active: player.active !== false,
    provider: metadata(now),
  };
}
function team(value: MlbTeam, now: Date): Team {
  return {
    id: `mlb_team_${value.id}`,
    sport: "mlb",
    name: value.name,
    abbreviation: value.abbreviation || null,
    provider: metadata(now),
  };
}
function game(value: MlbGame, now: Date): Game {
  const status = resolveMlbGameStatus(value.status);
  const startsAt = new Date(value.gameDate).toISOString();
  return {
    id: `mlb_game_${value.gamePk}`,
    sport: "mlb",
    startsAt,
    status: status.status,
    homeTeamId: `mlb_team_${value.teams.home.team.id}`,
    awayTeamId: `mlb_team_${value.teams.away.team.id}`,
    sourceStatus: status.sourceStatus,
    statusSource: status.statusSource,
    statusConfidence: status.statusConfidence,
    statusReason: status.statusReason,
    eventOrderKey: `${startsAt}|${value.gamePk}`,
    provider: metadata(now),
  };
}
function live(gameId: string, value: MlbLinescore, now: Date): LiveState {
  const hasInning = Number.isFinite(value.currentInning) && Number(value.currentInning) > 0;
  return {
    gameId,
    status: hasInning ? "in_progress" : "unknown",
    clock: null,
    period: value.currentInningOrdinal ?? null,
    summary:
      value.currentInningOrdinal && value.inningHalf
        ? `${value.inningHalf} ${value.currentInningOrdinal}`
        : null,
    sourceStatus: hasInning ? "linescore_inning_present" : "linescore_phase_missing",
    statusSource: hasInning ? "provider" : "fallback",
    statusConfidence: hasInning ? "authoritative" : "unknown",
    statusReason: hasInning
      ? null
      : "MLB linescore did not expose a game phase; scheduled was not inferred.",
    phase: {
      kind: "inning",
      number: hasInning ? Number(value.currentInning) : null,
      label: value.currentInningOrdinal ?? null,
    },
    progress: {
      current: hasInning ? Number(value.currentInning) : null,
      total: Number.isFinite(value.scheduledInnings) ? Number(value.scheduledInnings) : null,
      remaining: null,
      unit: "inning",
    },
    provider: metadata(now, 15),
  };
}

export function createMlbAdapter(deps: Partial<MlbDependencies> = {}): SportsAdapter {
  const api = { ...defaults, ...deps };
  return {
    sport: "mlb",
    async searchAthletes(query) {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return [];
      const now = api.now();
      return (await api.fetchAllPlayers())
        .filter((player) => player.fullName.toLowerCase().includes(normalized))
        .slice(0, 50)
        .map((player) => athlete(player, now));
    },
    async getAthlete(id) {
      const providerId = parsePlayerId(id);
      if (!providerId) return null;
      return athlete(await api.fetchPlayer(providerId), api.now());
    },
    async getTeams() {
      const now = api.now();
      return (await api.fetchTeams()).map((value) => team(value, now));
    },
    async getSchedule(from, to) {
      const now = api.now();
      const values = await api.fetchSchedule({
        startDate: from.toISOString().slice(0, 10),
        endDate: to.toISOString().slice(0, 10),
      });
      return reconcileAndSortGames(values.map((value) => game(value, now)));
    },
    async getLiveState(id) {
      const providerId = Number(id.replace(/^mlb_game_/, ""));
      if (!Number.isSafeInteger(providerId) || providerId <= 0) return null;
      return live(id, await api.fetchLinescore(providerId), api.now());
    },
  };
}

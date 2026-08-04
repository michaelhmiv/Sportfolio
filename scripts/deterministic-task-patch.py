from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = {
"server/sports/mlb-adapter.ts": r'''import type { SportsAdapter } from "./adapter-registry";
import type { Athlete, Game, GameStatus, LiveState, ProviderMetadata, Team } from "./contracts";
import {
  createPlayerId,
  fetchAllPlayers,
  fetchLinescore,
  fetchPlayer,
  fetchSchedule,
  fetchTeams,
  normalizeGameStatus,
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

const defaults: MlbDependencies = { fetchAllPlayers, fetchPlayer, fetchTeams, fetchSchedule, fetchLinescore, now: () => new Date() };

function metadata(now: Date): ProviderMetadata {
  return { provider: "mlb-statsapi", fetchedAt: now.toISOString(), staleAfterSeconds: 300, isStale: false };
}
function status(game: MlbGame): GameStatus {
  const value = normalizeGameStatus(game);
  if (value === "completed") return "final";
  if (value === "inprogress") return "in_progress";
  if (value === "postponed") return "postponed";
  return "scheduled";
}
function athlete(player: MlbPlayer, now: Date): Athlete {
  return {
    id: createPlayerId(player.id), sport: "mlb", name: player.fullName,
    teamId: player.currentTeam?.id ? `mlb_team_${player.currentTeam.id}` : null,
    position: player.primaryPosition?.abbreviation ?? null,
    active: player.active !== false, provider: metadata(now),
  };
}
function team(value: MlbTeam, now: Date): Team {
  return { id: `mlb_team_${value.id}`, sport: "mlb", name: value.name, abbreviation: value.abbreviation || null, provider: metadata(now) };
}
function game(value: MlbGame, now: Date): Game {
  return {
    id: `mlb_game_${value.gamePk}`, sport: "mlb", startsAt: new Date(value.gameDate).toISOString(), status: status(value),
    homeTeamId: `mlb_team_${value.teams.home.team.id}`, awayTeamId: `mlb_team_${value.teams.away.team.id}`,
    provider: metadata(now),
  };
}
function live(gameId: string, value: MlbLinescore, now: Date): LiveState {
  return {
    gameId, status: value.currentInning ? "in_progress" : "scheduled",
    clock: null, period: value.currentInningOrdinal ?? null,
    summary: value.currentInningOrdinal && value.inningHalf ? `${value.inningHalf} ${value.currentInningOrdinal}` : null,
    provider: { ...metadata(now), staleAfterSeconds: 15 },
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
      return (await api.fetchAllPlayers()).filter((player) => player.fullName.toLowerCase().includes(normalized)).slice(0, 50).map((player) => athlete(player, now));
    },
    async getAthlete(id) {
      const providerId = parsePlayerId(id);
      if (!providerId) return null;
      return athlete(await api.fetchPlayer(providerId), api.now());
    },
    async getTeams() { const now = api.now(); return (await api.fetchTeams()).map((value) => team(value, now)); },
    async getSchedule(from, to) {
      const now = api.now();
      const values = await api.fetchSchedule({ startDate: from.toISOString().slice(0, 10), endDate: to.toISOString().slice(0, 10) });
      return values.map((value) => game(value, now));
    },
    async getLiveState(id) {
      const providerId = Number(id.replace(/^mlb_game_/, ""));
      if (!Number.isSafeInteger(providerId) || providerId <= 0) return null;
      return live(id, await api.fetchLinescore(providerId), api.now());
    },
  };
}
''',
"server/sports/nhl-adapter.ts": r'''import type { SportsAdapter } from "./adapter-registry";
import type { Game, GameStatus, LiveState, ProviderMetadata, Team } from "./contracts";
import { NhlApiClient, nhlApi, normalizeNhlGameState, type NhlGame, type NhlTeam } from "../nhl-api";

type NhlDependencies = { client: Pick<NhlApiClient, "getStandings" | "getSchedule" | "getScore">; now: () => Date };
const defaults: NhlDependencies = { client: nhlApi, now: () => new Date() };
function metadata(now: Date, ttl = 300): ProviderMetadata { return { provider: "nhl-web", fetchedAt: now.toISOString(), staleAfterSeconds: ttl, isStale: false }; }
function gameStatus(value: NhlGame): GameStatus {
  const state = normalizeNhlGameState(value.gameState || value.gameScheduleState);
  if (state === "completed") return "final";
  if (state === "inprogress") return "in_progress";
  if (state === "postponed") return "postponed";
  return "scheduled";
}
function game(value: NhlGame, now: Date): Game {
  if (!value.startTimeUTC) throw new Error(`NHL game ${value.id} is missing startTimeUTC`);
  return { id: `nhl_game_${value.id}`, sport: "nhl", startsAt: new Date(value.startTimeUTC).toISOString(), status: gameStatus(value),
    homeTeamId: value.homeTeam?.abbrev ? `nhl_team_${value.homeTeam.abbrev.toUpperCase()}` : null,
    awayTeamId: value.awayTeam?.abbrev ? `nhl_team_${value.awayTeam.abbrev.toUpperCase()}` : null,
    provider: metadata(now) };
}
function team(value: NhlTeam, now: Date): Team {
  const abbreviation = value.abbrev?.toUpperCase() || null;
  return { id: `nhl_team_${abbreviation || value.id}`, sport: "nhl", name: value.commonName?.default || value.placeName?.default || abbreviation || `NHL ${value.id}`, abbreviation, provider: metadata(now) };
}
export function createNhlAdapter(deps: Partial<NhlDependencies> = {}): SportsAdapter {
  const api = { ...defaults, ...deps };
  return {
    sport: "nhl",
    async getTeams() { const response = await api.client.getStandings("now"); const now = api.now(); return response.standings.map((value) => team(value, now)); },
    async getSchedule(from, to) {
      const now = api.now(); const games = new Map<number, NhlGame>();
      for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
        const response = await api.client.getSchedule(cursor.toISOString().slice(0, 10));
        for (const week of response.gameWeek) for (const value of week.games || []) games.set(value.id, value);
      }
      return [...games.values()].filter((value) => value.startTimeUTC && new Date(value.startTimeUTC) >= from && new Date(value.startTimeUTC) <= to).map((value) => game(value, now));
    },
    async getLiveState(id) {
      const providerId = id.replace(/^nhl_game_/, ""); if (!/^\d+$/.test(providerId)) return null;
      const response = await api.client.getScore("now"); const value = response.games.find((candidate) => String(candidate.id) === providerId); if (!value) return null;
      return { gameId: id, status: gameStatus(value), clock: value.clock?.timeRemaining ?? null,
        period: value.periodDescriptor?.number ? String(value.periodDescriptor.number) : null,
        summary: value.periodDescriptor?.periodType ?? null, provider: metadata(api.now(), 15) } satisfies LiveState;
    },
  };
}
''',
"server/sports/nascar-adapter.ts": r'''import type { SportsAdapter } from "./adapter-registry";
import type { Game, GameStatus, LiveState, ProviderMetadata } from "./contracts";
import { fetchLiveFeed, fetchRaceSchedule, parseNascarEtDateTime, type NascarLiveFeed, type NascarRaceListItem } from "../nascar-api";
import { normalizeNascarSeries } from "./nascar-series";

type NascarDependencies = { fetchRaceSchedule: typeof fetchRaceSchedule; fetchLiveFeed: typeof fetchLiveFeed; now: () => Date };
const defaults: NascarDependencies = { fetchRaceSchedule, fetchLiveFeed, now: () => new Date() };
function metadata(now: Date, ttl = 900): ProviderMetadata { return { provider: "nascar-feed", fetchedAt: now.toISOString(), staleAfterSeconds: ttl, isStale: false }; }
function scheduleGame(value: NascarRaceListItem, now: Date): Game {
  const series = normalizeNascarSeries(value.series_id);
  const startsAt = parseNascarEtDateTime(value.race_date || value.date_scheduled).toISOString();
  const complete = Number(value.actual_laps) > 0 && Number(value.actual_distance) > 0;
  return { id: `nascar_race_${value.race_id}`, sport: "nascar", startsAt, status: complete ? "final" : "scheduled",
    homeTeamId: null, awayTeamId: null, seriesId: series.id, provider: metadata(now) };
}
function liveStatus(feed: NascarLiveFeed): GameStatus {
  if (feed.laps_to_go <= 0 || [8, 9].includes(feed.flag_state)) return "final";
  return feed.lap_number > 0 ? "in_progress" : "scheduled";
}
export function createNascarAdapter(deps: Partial<NascarDependencies> = {}): SportsAdapter {
  const api = { ...defaults, ...deps };
  return {
    sport: "nascar",
    async getSchedule(from, to) {
      const years = [...new Set([from.getUTCFullYear(), to.getUTCFullYear()])]; const now = api.now();
      const values = (await Promise.all(years.map((year) => api.fetchRaceSchedule(year)))).flat();
      return values.map((value) => scheduleGame(value, now)).filter((value) => new Date(value.startsAt) >= from && new Date(value.startsAt) <= to);
    },
    async getLiveState(id) {
      const providerId = id.replace(/^nascar_race_/, ""); if (!/^\d+$/.test(providerId)) return null;
      const feed = await api.fetchLiveFeed(); if (!feed || String(feed.race_id) !== providerId) return null;
      return { gameId: id, status: liveStatus(feed), clock: feed.laps_to_go >= 0 ? `${feed.laps_to_go} laps to go` : null,
        period: feed.stage?.stage_num ? `Stage ${feed.stage.stage_num}` : null, summary: feed.run_name || null,
        provider: metadata(api.now(), 10) } satisfies LiveState;
    },
  };
}
''',
"server/sports/default-registry.ts": r'''import { SportsAdapterRegistry } from "./adapter-registry";
import { createMlbAdapter } from "./mlb-adapter";
import { createNascarAdapter } from "./nascar-adapter";
import { createNhlAdapter } from "./nhl-adapter";

export function createDefaultSportsAdapterRegistry(): SportsAdapterRegistry {
  const registry = new SportsAdapterRegistry();
  registry.register(createMlbAdapter());
  registry.register(createNhlAdapter());
  registry.register(createNascarAdapter());
  return registry;
}
''',
"server/sports/adapters.test.ts": r'''import { describe, expect, it } from "vitest";
import { createMlbAdapter } from "./mlb-adapter";
import { createNascarAdapter } from "./nascar-adapter";
import { createNhlAdapter } from "./nhl-adapter";
import { createDefaultSportsAdapterRegistry } from "./default-registry";

const now = () => new Date("2026-08-04T12:00:00.000Z");
describe("unified sports adapters", () => {
  it("normalizes MLB athletes, teams, schedules, and live state", async () => {
    const adapter = createMlbAdapter({ now,
      fetchAllPlayers: async () => [{ id: 1, fullName: "Test Player", firstName: "Test", lastName: "Player", active: true, primaryPosition: { code: "1", name: "Pitcher", type: "Pitcher", abbreviation: "P" } }],
      fetchPlayer: async () => ({ id: 1, fullName: "Test Player", firstName: "Test", lastName: "Player", active: true }),
      fetchTeams: async () => [{ id: 10, name: "Test Team", teamName: "Team", locationName: "Test", abbreviation: "TST" }],
      fetchSchedule: async () => [{ gamePk: 99, gameDate: "2026-08-04T17:00:00Z", status: { abstractGameState: "Preview", codedGameState: "S", detailedState: "Scheduled", statusCode: "S", startTimeTBD: false }, teams: { away: { team: { id: 10, name: "Away", abbreviation: "AWY" }, score: null, isWinner: false }, home: { team: { id: 11, name: "Home", abbreviation: "HME" }, score: null, isWinner: false } } }],
      fetchLinescore: async () => ({ currentInning: 3, currentInningOrdinal: "3rd", inningHalf: "Top", teams: { home: { runs: 0, hits: 0, errors: 0 }, away: { runs: 1, hits: 2, errors: 0 } } }),
    });
    expect((await adapter.searchAthletes!("test"))[0]).toMatchObject({ id: "mlb_1", sport: "mlb" });
    expect((await adapter.getTeams!())[0].id).toBe("mlb_team_10");
    expect((await adapter.getSchedule!(new Date("2026-08-04"), new Date("2026-08-05")))[0].id).toBe("mlb_game_99");
    expect(await adapter.getLiveState!("mlb_game_99")).toMatchObject({ status: "in_progress", period: "3rd" });
  });

  it("normalizes NHL schedules and live score state", async () => {
    const game = { id: 7, startTimeUTC: "2026-08-04T19:00:00Z", gameState: "LIVE", homeTeam: { abbrev: "BOS" }, awayTeam: { abbrev: "NYR" }, periodDescriptor: { number: 2, periodType: "REG" }, clock: { timeRemaining: "10:00" } };
    const adapter = createNhlAdapter({ now, client: {
      getStandings: async () => ({ standings: [{ id: 1, abbrev: "BOS", commonName: { default: "Bruins" } }] }),
      getSchedule: async () => ({ gameWeek: [{ games: [game] }] }), getScore: async () => ({ games: [game] }),
    } as any });
    expect((await adapter.getTeams!())[0].id).toBe("nhl_team_BOS");
    expect((await adapter.getSchedule!(new Date("2026-08-04"), new Date("2026-08-05")))[0].status).toBe("in_progress");
    expect(await adapter.getLiveState!("nhl_game_7")).toMatchObject({ clock: "10:00", period: "2" });
  });

  it("normalizes NASCAR schedules and live state without inventing teams", async () => {
    const adapter = createNascarAdapter({ now,
      fetchRaceSchedule: async () => [{ race_id: 5, series_id: 1, race_season: 2026, race_name: "Test 400", race_type_id: 1, restrictor_plate: false, track_id: 2, track_name: "Test", date_scheduled: "2026-08-04 14:00:00", race_date: "2026-08-04 14:00:00", qualifying_date: "", tunein_date: "", scheduled_distance: 400, actual_distance: 0, scheduled_laps: 200, actual_laps: 0, stage_1_laps: 50, stage_2_laps: 50, stage_3_laps: 100, number_of_cars_in_field: 36 }],
      fetchLiveFeed: async () => ({ race_id: 5, run_id: 1, series_id: 1, track_id: 2, track_name: "Test", track_length: 2, lap_number: 100, elapsed_time: 1, laps_in_race: 200, laps_to_go: 100, run_name: "Race", run_type: 3, flag_state: 1, number_of_caution_segments: 0, number_of_lead_changes: 0, number_of_leaders: 1, avg_diff_1to3: 0, stage: { stage_num: 2, finish_at_lap: 100, laps_in_stage: 50 }, vehicles: [] }),
    });
    const schedule = await adapter.getSchedule!(new Date("2026-08-04T00:00:00Z"), new Date("2026-08-05T23:59:59Z"));
    expect(schedule[0]).toMatchObject({ id: "nascar_race_5", homeTeamId: null, seriesId: "1" });
    expect(await adapter.getLiveState!("nascar_race_5")).toMatchObject({ status: "in_progress", period: "Stage 2" });
  });

  it("registers exactly one adapter for each supported sport", () => {
    expect(createDefaultSportsAdapterRegistry().list()).toEqual(["mlb", "nascar", "nhl"]);
  });
});
''',
"docs/implementation/unified-sports-adapters.md": r'''# Unified Sports Adapters

Sportfolio now has internal adapters for MLB, NHL, and NASCAR that normalize existing provider clients into the neutral sports contracts. The adapters are dependency-injected for deterministic testing and register through one fail-closed default registry.

MLB wraps the existing official StatsAPI client. NHL wraps the existing credential-free NHL web API client. NASCAR wraps the existing schedule and live-feed client and uses canonical series identifiers. No new provider, database, public tool, scheduler, or market behavior is introduced by this release.

Concrete consumer migration and compact public sports tools remain separate releases so rollback can occur per surface.
''',
}
for path, content in FILES.items():
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")

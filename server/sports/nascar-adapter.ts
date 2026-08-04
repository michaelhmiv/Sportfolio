import type { SportsAdapter } from "./adapter-registry";
import type { Game, GameStatus, LiveState, ProviderMetadata } from "./contracts";
import {
  fetchLiveFeed,
  fetchRaceSchedule,
  parseNascarEtDateTime,
  type NascarLiveFeed,
  type NascarRaceListItem,
} from "../nascar-api";
import { normalizeNascarSeries } from "./nascar-series";

type NascarDependencies = {
  fetchRaceSchedule: typeof fetchRaceSchedule;
  fetchLiveFeed: typeof fetchLiveFeed;
  now: () => Date;
};
const defaults: NascarDependencies = { fetchRaceSchedule, fetchLiveFeed, now: () => new Date() };
function metadata(now: Date, ttl = 900): ProviderMetadata {
  return {
    provider: "nascar-feed",
    fetchedAt: now.toISOString(),
    staleAfterSeconds: ttl,
    isStale: false,
  };
}
function scheduleGame(value: NascarRaceListItem, now: Date): Game {
  const series = normalizeNascarSeries(value.series_id);
  const startsAt = parseNascarEtDateTime(value.race_date || value.date_scheduled).toISOString();
  const complete = Number(value.actual_laps) > 0 && Number(value.actual_distance) > 0;
  return {
    id: `nascar_race_${value.race_id}`,
    sport: "nascar",
    startsAt,
    status: complete ? "final" : "scheduled",
    homeTeamId: null,
    awayTeamId: null,
    seriesId: series.id,
    provider: metadata(now),
  };
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
      const years = [...new Set([from.getUTCFullYear(), to.getUTCFullYear()])];
      const now = api.now();
      const values = (await Promise.all(years.map((year) => api.fetchRaceSchedule(year)))).flat();
      return values
        .map((value) => scheduleGame(value, now))
        .filter((value) => new Date(value.startsAt) >= from && new Date(value.startsAt) <= to);
    },
    async getLiveState(id) {
      const providerId = id.replace(/^nascar_race_/, "");
      if (!/^\d+$/.test(providerId)) return null;
      const feed = await api.fetchLiveFeed();
      if (!feed || String(feed.race_id) !== providerId) return null;
      return {
        gameId: id,
        status: liveStatus(feed),
        clock: feed.laps_to_go >= 0 ? `${feed.laps_to_go} laps to go` : null,
        period: feed.stage?.stage_num ? `Stage ${feed.stage.stage_num}` : null,
        summary: feed.run_name || null,
        provider: metadata(api.now(), 10),
      } satisfies LiveState;
    },
  };
}

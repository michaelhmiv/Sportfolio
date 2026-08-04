import type { SportsAdapter } from "./adapter-registry";
import type { Game, LiveState, ProviderMetadata } from "./contracts";
import {
  createProviderMetadata,
  reconcileAndSortGames,
  resolveNascarLiveStatus,
  resolveNascarScheduleStatus,
} from "./semantics";
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
  return createProviderMetadata({
    provider: "nascar-feed",
    fetchedAt: now,
    staleAfterSeconds: ttl,
  });
}
function scheduleGame(value: NascarRaceListItem, now: Date): Game {
  const series = normalizeNascarSeries(value.series_id);
  const startsAt = parseNascarEtDateTime(value.race_date || value.date_scheduled).toISOString();
  const status = resolveNascarScheduleStatus({
    actualLaps: value.actual_laps,
    actualDistance: value.actual_distance,
  });
  return {
    id: `nascar_race_${value.race_id}`,
    sport: "nascar",
    startsAt,
    status: status.status,
    homeTeamId: null,
    awayTeamId: null,
    seriesId: series.id,
    seasonId: String(value.race_season),
    sourceStatus: status.sourceStatus,
    statusSource: status.statusSource,
    statusConfidence: status.statusConfidence,
    statusReason: status.statusReason,
    eventOrderKey: `${startsAt}|${series.id}|${value.race_id}`,
    provider: metadata(now),
  };
}
export function createNascarAdapter(deps: Partial<NascarDependencies> = {}): SportsAdapter {
  const api = { ...defaults, ...deps };
  return {
    sport: "nascar",
    async getSchedule(from, to) {
      const years = [...new Set([from.getUTCFullYear(), to.getUTCFullYear()])];
      const now = api.now();
      const values = (await Promise.all(years.map((year) => api.fetchRaceSchedule(year)))).flat();
      return reconcileAndSortGames(
        values
          .map((value) => scheduleGame(value, now))
          .filter((value) => new Date(value.startsAt) >= from && new Date(value.startsAt) <= to),
      );
    },
    async getLiveState(id) {
      const providerId = id.replace(/^nascar_race_/, "");
      if (!/^\d+$/.test(providerId)) return null;
      const feed = await api.fetchLiveFeed();
      if (!feed || String(feed.race_id) !== providerId) return null;
      const status = resolveNascarLiveStatus({
        lapNumber: feed.lap_number,
        lapsToGo: feed.laps_to_go,
        flagState: feed.flag_state,
      });
      return {
        gameId: id,
        status: status.status,
        clock: feed.laps_to_go >= 0 ? `${feed.laps_to_go} laps to go` : null,
        period: feed.stage?.stage_num ? `Stage ${feed.stage.stage_num}` : null,
        summary: feed.run_name || null,
        sourceStatus: status.sourceStatus,
        statusSource: status.statusSource,
        statusConfidence: status.statusConfidence,
        statusReason: status.statusReason,
        phase: {
          kind: "stage",
          number: feed.stage?.stage_num ?? null,
          label: feed.stage?.stage_num ? `Stage ${feed.stage.stage_num}` : feed.run_name || null,
        },
        progress: {
          current: Number.isFinite(feed.lap_number) ? feed.lap_number : null,
          total: Number.isFinite(feed.laps_in_race) ? feed.laps_in_race : null,
          remaining: Number.isFinite(feed.laps_to_go) ? feed.laps_to_go : null,
          unit: "lap",
        },
        provider: metadata(api.now(), 10),
      } satisfies LiveState;
    },
  };
}

/**
 * NASCAR API Service
 *
 * Handles all interactions with the NASCAR API (unofficial).
 * Based on: https://github.com/ooohfascinating/NascarApi
 *
 * Endpoints used:
 * - GET /live/feeds/live-feed.json - Real-time race data
 * - GET /cacher/{year}/{seriesID}/{raceID}/weekend-feed.json - Race weekend data
 * - GET /feedtest/enhancedcurrentresults?raceID={raceID} - Historical race results by race ID
 *
 * Series IDs:
 * - 1 = Cup Series (NCS)
 * - 2 = Xfinity Series (NXS)
 * - 3 = Truck Series (TRucks)
 */

import axios, { AxiosInstance } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { fromZonedTime } from "date-fns-tz";

const NASCAR_API_BASE = "https://cf.nascar.com";
const NASCAR_ENHANCED_RESULTS_BASE = "https://feed.racinginsights.com";
const NASCAR_ENHANCED_RESULTS_PATH = "/feedtest/enhancedcurrentresults";
const NASCAR_PROXY_URL = process.env.NASCAR_PROXY_URL;
const NASCAR_ET_TIMEZONE = "America/New_York";

// Parse IPRoyal proxy URL format: host:port:username:password
function parseProxyUrl(
  proxyUrl: string,
): { host: string; port: number; auth: { username: string; password: string } } | null {
  const parts = proxyUrl.split(":");
  if (parts.length >= 4) {
    const host = parts[0];
    const port = parseInt(parts[1], 10);
    const username = parts[2];
    const password = parts.slice(3).join(":"); // Join rest in case password contains colons
    return { host, port, auth: { username, password } };
  }
  return null;
}

// Create axios instance for NASCAR API
// When NASCAR_PROXY_URL is set, requests will be routed through that proxy
// This is needed when hosting on cloud platforms that NASCAR API blocks
function createApiClient(baseURL: string = NASCAR_API_BASE): AxiosInstance {
  const config: any = {
    baseURL,
    timeout: 30000,
    headers: {
      "User-Agent": "Sportfolio/1.0",
    },
  };

  // Configure proxy if set (supports IPRoyal format: host:port:username:password)
  if (NASCAR_PROXY_URL) {
    const proxy = parseProxyUrl(NASCAR_PROXY_URL);
    if (proxy) {
      const proxyUrl = `https://${proxy.auth.username}:${proxy.auth.password}@${proxy.host}:${proxy.port}`;
      config.httpsAgent = new HttpsProxyAgent(proxyUrl);
      config.proxy = false; // Disable default axios proxy since we're using httpsAgent
      console.log(`[NASCAR API] Using proxy: ${proxy.host}:${proxy.port} (https)`);
    } else {
      console.warn(`[NASCAR API] Invalid proxy URL format: ${NASCAR_PROXY_URL}`);
    }
  }

  return axios.create(config);
}

const apiClient = createApiClient();
const enhancedResultsClient = createApiClient(NASCAR_ENHANCED_RESULTS_BASE);

// ============================================================================
// Types
// ============================================================================

export const NASCAR_SERIES = {
  CUP: 1,
  XFINITY: 2,
  TRUCKS: 3,
} as const;

export type NascarSeriesId = (typeof NASCAR_SERIES)[keyof typeof NASCAR_SERIES];

export const NASCAR_SERIES_NAMES: Record<NascarSeriesId, string> = {
  [NASCAR_SERIES.CUP]: "Cup Series",
  [NASCAR_SERIES.XFINITY]: "Xfinity Series",
  [NASCAR_SERIES.TRUCKS]: "Truck Series",
};

export const NASCAR_SERIES_CODES: Record<NascarSeriesId, string> = {
  [NASCAR_SERIES.CUP]: "NCS",
  [NASCAR_SERIES.XFINITY]: "NXS",
  [NASCAR_SERIES.TRUCKS]: "NTS",
};

// NASCAR Driver
// Note: API returns snake_case
export interface NascarDriver {
  driver_id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  short_name?: string;
}

// NASCAR Vehicle (car during race)
// Note: API returns snake_case
export interface NascarVehicle {
  vehicle_id: number;
  vehicle_number: string;
  vehicle_manufacturer: string; // "Tyt" = Toyota, "Chv" = Chevy, "Frd" = Ford
  driver: NascarDriver;
  // Position data
  running_position: number;
  starting_position: number;
  position_differential_last_10_percent?: number;
  // Lap data
  laps_completed: number;
  laps_led: Array<number | { start_lap?: number; end_lap?: number }>;
  fastest_laps_run?: number;
  laps_position_improved?: number;
  // Speed data
  average_running_position: number;
  average_speed: number;
  best_lap: number;
  best_lap_speed: number;
  best_lap_time: string;
  // Time data
  delta: number; // Gap to leader in seconds
  // Pit stops
  pit_stops: NascarPitStop[];
  // Status
  is_on_track: boolean;
  is_on_dvp: boolean; // Damaged Vehicle Policy
}

// Pit stop data
export interface NascarPitStop {
  lap: number;
  time: string;
  position: number;
}

// Race information
export interface NascarRaceInfo {
  raceId: number;
  year: number;
  seriesId: NascarSeriesId;
  trackId: number;
  trackName: string;
  trackLength: number; // in miles
  raceName: string;
  runId: number;
  runName: string;
  runType: number; // 1=Practice, 2=Qualifying, 3=Race
  lapsInRace: number;
}

// Live feed response
// Note: API returns snake_case (series_id, race_id, etc.), not camelCase
export interface NascarLiveFeed {
  // Race info - API uses snake_case
  race_id: number;
  run_id: number;
  series_id: number;
  track_id: number;
  track_name: string;
  track_length: number;
  // Session info
  lap_number: number;
  elapsed_time: number; // seconds
  laps_in_race: number;
  laps_to_go: number;
  run_name: string;
  run_type: number; // 1=Practice, 2=Qualifying, 3=Race
  // Race state
  flag_state: number; // Provider uses additional terminal values after the race ends
  number_of_caution_segments: number;
  number_of_lead_changes: number;
  number_of_leaders: number;
  avg_diff_1to3: number;
  // Stage info
  stage: {
    stage_num: number;
    finish_at_lap: number;
    laps_in_stage: number;
  } | null;
  // Vehicles
  vehicles: NascarVehicle[];
}

// Add camelCase aliases for backwards compatibility
export type NascarLiveFeedAlias = NascarLiveFeed & {
  raceId?: number;
  runId?: number;
  seriesId?: number;
  trackId?: number;
  trackName?: string;
  trackLength?: number;
  lapNumber?: number;
  elapsedTime?: number;
  lapsInRace?: number;
  lapsToGo?: number;
  runName?: string;
  runType?: number;
  flagState?: number;
  numberOfCautionSegments?: number;
  numberOfLeadChanges?: number;
  numberOfLeaders?: number;
  avgDiff1to3?: number;
};

// Race list / schedule (from race_list_basic.json)
export interface NascarRaceListItem {
  race_id: number;
  series_id: number;
  race_season: number;
  race_name: string;
  race_type_id: number;
  restrictor_plate: boolean;
  track_id: number;
  track_name: string;
  date_scheduled: string;
  race_date: string;
  qualifying_date: string;
  tunein_date: string;
  scheduled_distance: number;
  actual_distance: number;
  scheduled_laps: number;
  actual_laps: number;
  stage_1_laps: number;
  stage_2_laps: number;
  stage_3_laps: number;
  number_of_cars_in_field: number;
}

// Weekend feed - practice/qualifying/race results
// API returns: weekend_runs[].run_type: 1=Practice, 2=Qualifying, 3=Race
export interface NascarWeekendSession {
  runId: number;
  runName: string;
  runType: number;
  status: string;
  scheduledStartTime: string;
  actualStartTime?: string;
  laps: number;
  vehicles: NascarVehicle[];
}

// Actual API response structure from /cacher/{year}/{series}/{raceId}/weekend-feed.json
export interface NascarWeekendRun {
  weekend_run_id: number;
  race_id: number;
  timing_run_id: number;
  run_type: number;
  run_name: string;
  run_date: string;
  run_date_utc: string;
  results: NascarWeekendResult[];
}

export interface NascarWeekendResult {
  run_id: number;
  car_number: string;
  vehicle_number: string;
  manufacturer: string;
  driver_id: number;
  driver_name: string;
  finishing_position: number;
  best_lap_time: number;
  best_lap_speed: number;
  best_lap_number: number;
  laps_completed: number;
  comment: string;
  delta_leader: number;
  disqualified: boolean;
}

export interface NascarWeekendFeed {
  raceId: number;
  seriesId: NascarSeriesId;
  trackId: number;
  trackName: string;
  raceName: string;
  date: string;
  sessions: NascarWeekendSession[];
}

interface NascarEnhancedRunData {
  RaceID?: number | string;
  RunID?: number | string;
  RunType?: number | string;
  LapsToGo?: number | string;
  FlagState?: string;
}

interface NascarEnhancedResultRow {
  Number?: string | number;
  Manufacturer?: string;
  DriverNameTag?: string;
  DriverFirstName?: string;
  DriverLastName?: string;
  DriverID?: number | string;
  NASCARDriverID?: number | string;
  RunningPos?: number | string;
  StartPos?: number | string;
  LapsLed?: number | string;
  FastestLapsRun?: number | string;
  FastestLap?: number | string;
  PointsThisRace?: number | string;
  Status?: string;
  iStatus?: number | string;
  CompLaps?: number | string;
}

interface NascarEnhancedRaceResultsResponse {
  RunData?: NascarEnhancedRunData[];
  Results?: NascarEnhancedResultRow[];
}

// Fantasy-relevant race stats
export interface NascarRaceResult {
  driverId: number;
  driverName: string;
  carNumber: string;
  manufacturer: string;
  finishPosition: number;
  startPosition: number;
  positionDifferential: number;
  lapsCompleted: number;
  lapsLed: number;
  fastestLaps: number;
  points: number;
  stage1Position?: number;
  stage2Position?: number;
  status: string; // "Running", "Finished", "DNF", etc.
}

// Race with results
export interface NascarRace {
  raceId: number;
  raceName: string;
  seriesId: NascarSeriesId;
  seriesName: string;
  trackId: number;
  trackName: string;
  date: Date;
  status: "scheduled" | "practice" | "qualifying" | "live" | "completed";
  results?: NascarRaceResult[];
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * NASCAR schedule fields are returned in Eastern Time without a timezone suffix.
 * Parse as ET and convert to UTC so comparisons are accurate in all environments.
 */
export function parseNascarEtDateTime(rawDateTime: string): Date {
  const parsed = fromZonedTime(rawDateTime, NASCAR_ET_TIMEZONE);
  if (Number.isFinite(parsed.getTime())) return parsed;
  return new Date(rawDateTime);
}

export function isNascarRaceSession(runType: number | null | undefined): boolean {
  return runType === 3;
}

export function countNascarLapsLed(
  lapsLed: NascarVehicle["laps_led"] | null | undefined,
  currentLap?: number | null,
): number {
  if (!Array.isArray(lapsLed)) return 0;

  let total = 0;
  for (const segment of lapsLed) {
    if (typeof segment === "number") {
      if (Number.isFinite(segment)) total += 1;
      continue;
    }

    if (!segment || typeof segment !== "object") continue;
    const startLap = Number(segment.start_lap);
    const rawEndLap = Number(segment.end_lap);
    const endLap = Number.isFinite(rawEndLap) ? rawEndLap : Number(currentLap);
    if (!Number.isFinite(startLap) || !Number.isFinite(endLap)) continue;
    if (startLap <= 0 || endLap < startLap) continue;
    total += endLap - startLap + 1;
  }

  return total;
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseOptionalString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeEnhancedStatus(
  status: NascarEnhancedResultRow["Status"],
  iStatus: NascarEnhancedResultRow["iStatus"],
): string {
  const normalizedStatus = parseOptionalString(status);
  if (normalizedStatus) return normalizedStatus;

  const statusCode = parseOptionalNumber(iStatus);
  if (statusCode === 1) return "Running";
  if (statusCode === 2) return "Finished";
  return "Unknown";
}

export function normalizeEnhancedNascarDriverId(
  row: Pick<NascarEnhancedResultRow, "NASCARDriverID" | "DriverID">,
): number | null {
  const canonicalDriverId = parseOptionalNumber(row.NASCARDriverID);
  if (canonicalDriverId && canonicalDriverId > 0) return canonicalDriverId;

  const fallbackDriverId = parseOptionalNumber(row.DriverID);
  if (fallbackDriverId && fallbackDriverId > 0) return fallbackDriverId;

  return null;
}

export function mapEnhancedResultsToRaceResults(
  payload: NascarEnhancedRaceResultsResponse,
  raceId: number,
): NascarRaceResult[] {
  if (!payload || !Array.isArray(payload.Results)) {
    return [];
  }

  const runData = Array.isArray(payload.RunData) ? payload.RunData[0] : null;
  const responseRaceId = parseOptionalNumber(runData?.RaceID);
  if (responseRaceId !== null && responseRaceId !== raceId) {
    console.warn(
      `[NASCAR API] Enhanced results race mismatch: requested=${raceId}, got=${responseRaceId}`,
    );
    return [];
  }

  const runType = parseOptionalNumber(runData?.RunType);
  if (runType !== null && runType !== 3) {
    console.log(
      `[NASCAR API] Enhanced results race ${raceId} is not a race run (runType=${runType})`,
    );
    return [];
  }

  const lapsToGo = parseOptionalNumber(runData?.LapsToGo);
  const flagState = parseOptionalString(runData?.FlagState).toLowerCase();
  const isRaceComplete =
    (lapsToGo !== null && lapsToGo <= 0) ||
    flagState === "finish" ||
    flagState === "not active" ||
    flagState === "final" ||
    flagState === "checkered";

  if (!isRaceComplete) {
    console.log(
      `[NASCAR API] Enhanced results race ${raceId} is still live (lapsToGo=${lapsToGo ?? "unknown"}, flag=${flagState || "unknown"})`,
    );
    return [];
  }

  let skippedMissingDriverIds = 0;
  const mappedResults: NascarRaceResult[] = [];

  for (const row of payload.Results) {
    const finishPosition = parseOptionalNumber(row.RunningPos);
    if (!finishPosition || finishPosition <= 0) continue;

    const driverId = normalizeEnhancedNascarDriverId(row);
    if (!driverId) {
      skippedMissingDriverIds++;
      continue;
    }

    const startPosition = parseOptionalNumber(row.StartPos) ?? finishPosition;
    const lapsLed = Math.max(0, parseOptionalNumber(row.LapsLed) ?? 0);
    const fastestLaps = Math.max(
      0,
      parseOptionalNumber(row.FastestLapsRun) ?? parseOptionalNumber(row.FastestLap) ?? 0,
    );
    const pointsThisRace = parseOptionalNumber(row.PointsThisRace);
    const driverName =
      parseOptionalString(row.DriverNameTag) ||
      [parseOptionalString(row.DriverFirstName), parseOptionalString(row.DriverLastName)]
        .filter(Boolean)
        .join(" ") ||
      `Driver ${driverId}`;

    mappedResults.push({
      driverId,
      driverName,
      carNumber: String(row.Number ?? ""),
      manufacturer: parseOptionalString(row.Manufacturer),
      finishPosition,
      startPosition,
      positionDifferential: startPosition - finishPosition,
      lapsCompleted: Math.max(0, parseOptionalNumber(row.CompLaps) ?? 0),
      lapsLed,
      fastestLaps,
      points: pointsThisRace ?? 0,
      status: normalizeEnhancedStatus(row.Status, row.iStatus),
    });
  }

  mappedResults.sort((a, b) => a.finishPosition - b.finishPosition);

  mappedResults.forEach((result, index) => {
    if (result.points > 0) return;
    result.points = calculatePoints(index + 1, result.lapsLed > 0);
  });

  if (skippedMissingDriverIds > 0) {
    console.warn(
      `[NASCAR API] Enhanced results skipped ${skippedMissingDriverIds} rows with missing driver IDs for race ${raceId}`,
    );
  }

  return mappedResults;
}

async function fetchEnhancedRaceResults(raceId: number): Promise<NascarRaceResult[]> {
  const response = await enhancedResultsClient.get<NascarEnhancedRaceResultsResponse>(
    NASCAR_ENHANCED_RESULTS_PATH,
    {
      params: { raceID: raceId },
    },
  );

  const mappedResults = mapEnhancedResultsToRaceResults(response.data, raceId);
  if (mappedResults.length > 0) {
    console.log(`[NASCAR API] Fetched ${mappedResults.length} enhanced results for race ${raceId}`);
  } else {
    console.log(`[NASCAR API] No enhanced results available for race ${raceId}`);
  }

  return mappedResults;
}

/**
 * Fetch live feed for current/ongoing race
 */
export async function fetchLiveFeed(seriesId?: NascarSeriesId): Promise<NascarLiveFeed | null> {
  console.log(`[NASCAR API] fetchLiveFeed called with seriesId=${seriesId}`);
  try {
    const response = await apiClient.get<NascarLiveFeed>("/live/feeds/live-feed.json");
    const feed = response.data;

    // Debug log
    console.log(
      `[NASCAR API] Live feed: series_id=${feed?.series_id}, race_id=${feed?.race_id}, lap=${feed?.lap_number}, hasData=${!!feed}`,
    );

    // If no feed data, return null
    if (!feed) {
      console.log("[NASCAR API] No feed data returned");
      return null;
    }

    // If seriesId is specified and doesn't match, return null (no live race for that series)
    // Note: NASCAR API only returns ONE live race at a time
    if (seriesId !== undefined && feed.series_id !== seriesId) {
      console.log(`[NASCAR API] Series mismatch: requested=${seriesId}, got=${feed.series_id}`);
      return null;
    }

    // Return the feed regardless - caller can check series_id
    return feed;
  } catch (error: any) {
    // No live race may return 404 or other errors
    if (error.response?.status === 404 || error.code === "ECONNREFUSED") {
      console.log("[NASCAR API] No live race currently");
      return null;
    }
    // Log more details about the error
    console.error(
      "[NASCAR API] Error fetching live feed:",
      error.message,
      "code:",
      error.code,
      "status:",
      error.response?.status,
    );
    throw error;
  }
}

/**
 * Fetch race list/schedule for a given year
 * Fetches from all 3 series (Cup, Xfinity, Trucks) and combines them
 */
export async function fetchRaceSchedule(year: number): Promise<NascarRaceListItem[]> {
  const allRaces: NascarRaceListItem[] = [];
  const seriesList = [1, 2, 3]; // Cup, Xfinity, Trucks

  for (const seriesId of seriesList) {
    try {
      // Use race_list_basic.json endpoint (not race_list.json which returns 403)
      const response = await apiClient.get(`/cacher/${year}/${seriesId}/race_list_basic.json`);
      const raceList: NascarRaceListItem[] = response.data;

      if (raceList.length > 0) {
        allRaces.push(...raceList);
        console.log(`[NASCAR API] Fetched ${raceList.length} races for ${year} series ${seriesId}`);
      }
    } catch (error: any) {
      console.error(
        `[NASCAR API] Error fetching race schedule for ${year} series ${seriesId}:`,
        error.message,
      );
      // Continue with other series if one fails
    }
  }

  // Sort by race date
  allRaces.sort(
    (a, b) =>
      parseNascarEtDateTime(a.race_date).getTime() - parseNascarEtDateTime(b.race_date).getTime(),
  );

  console.log(`[NASCAR API] Total races for ${year}: ${allRaces.length}`);
  return allRaces;
}

/**
 * Fetch weekend feed for a specific race (practice, qualifying, race results)
 */
export async function fetchWeekendFeed(
  year: number,
  seriesId: NascarSeriesId,
  raceId: number,
): Promise<NascarWeekendFeed | null> {
  try {
    const response = await apiClient.get<any>(
      `/cacher/${year}/${seriesId}/${raceId}/weekend-feed.json`,
    );
    const data = response.data;

    if (!data || !data.weekend_runs) {
      console.log(`[NASCAR API] No weekend feed for race ${raceId}`);
      return null;
    }

    // Extract race info from weekend_race array
    const raceInfo = data.weekend_race?.[0] || {};

    // Transform weekend_runs to sessions format
    const sessions: NascarWeekendSession[] = data.weekend_runs.map((run: NascarWeekendRun) => ({
      runId: run.weekend_run_id,
      runName: run.run_name,
      runType: run.run_type,
      status: "completed", // Weekend feed is historical
      scheduledStartTime: run.run_date,
      actualStartTime: run.run_date_utc,
      laps: run.results?.[0]?.laps_completed || 0,
      vehicles:
        run.results?.map((result) => ({
          vehicle_id: 0,
          vehicle_number: result.car_number,
          vehicle_manufacturer: result.manufacturer,
          driver: {
            driver_id: result.driver_id,
            full_name: result.driver_name,
            first_name: result.driver_name.split(" ")[0],
            last_name: result.driver_name.split(" ").slice(1).join(" "),
          },
          running_position: result.finishing_position,
          starting_position: result.finishing_position, // Not available in PQ
          laps_completed: result.laps_completed,
          laps_led: [], // Not available
          average_running_position: 0,
          average_speed: result.best_lap_speed,
          best_lap: result.best_lap_number,
          best_lap_speed: result.best_lap_speed,
          best_lap_time: String(result.best_lap_time),
          delta: result.delta_leader,
          pit_stops: [],
          is_on_track: !result.disqualified,
          is_on_dvp: false,
        })) || [],
    }));

    return {
      raceId: raceInfo.race_id || raceId,
      seriesId: seriesId,
      trackId: raceInfo.track_id || 0,
      trackName: raceInfo.track_name || "",
      raceName: raceInfo.race_name || "",
      date: raceInfo.race_date || "",
      sessions,
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log(`[NASCAR API] No weekend feed for race ${raceId}`);
      return null;
    }
    console.error(`[NASCAR API] Error fetching weekend feed:`, error.message);
    throw error;
  }
}

/**
 * Fetch race results (final positions after race completion)
 */
export async function fetchRaceResults(
  year: number,
  seriesId: NascarSeriesId,
  raceId: number,
): Promise<NascarRaceResult[]> {
  try {
    try {
      const enhancedResults = await fetchEnhancedRaceResults(raceId);
      if (enhancedResults.length > 0) {
        return enhancedResults;
      }
    } catch (error: any) {
      console.warn(
        `[NASCAR API] Enhanced results request failed for race ${raceId}, falling back to weekend/live feed: ${error.message}`,
      );
    }

    const weekendFeed = await fetchWeekendFeed(year, seriesId, raceId);

    // Try to find race session in weekend feed (runType 3 = Race)
    let raceSession = weekendFeed?.sessions.find((s) => isNascarRaceSession(s.runType));

    // If no race session in weekend feed, try live feed
    if (!raceSession) {
      try {
        const liveFeed = await fetchLiveFeed(seriesId);
        if (
          liveFeed &&
          liveFeed.race_id === raceId &&
          isNascarRaceSession(liveFeed.run_type) &&
          isNascarRaceFinished(liveFeed)
        ) {
          // Transform live feed to session format
          raceSession = {
            runId: liveFeed.run_id,
            runName: liveFeed.run_name,
            runType: liveFeed.run_type,
            status: "completed",
            scheduledStartTime: "",
            laps: liveFeed.laps_in_race,
            vehicles: liveFeed.vehicles.map((v) => ({
              vehicle_id: 0,
              vehicle_number: v.vehicle_number,
              vehicle_manufacturer: v.vehicle_manufacturer,
              driver: v.driver,
              running_position: v.running_position,
              starting_position: v.starting_position,
              laps_completed: v.laps_completed,
              laps_led: v.laps_led,
              average_running_position: v.average_running_position,
              average_speed: v.average_speed,
              best_lap: v.best_lap,
              best_lap_speed: v.best_lap_speed,
              best_lap_time: v.best_lap_time,
              delta: v.delta,
              pit_stops: v.pit_stops,
              is_on_track: v.is_on_track,
              is_on_dvp: v.is_on_dvp,
            })),
          };
        }
      } catch (e) {
        // Ignore live feed errors
      }
    }

    if (!raceSession) {
      console.log(`[NASCAR API] No race session found for race ${raceId}`);
      return [];
    }

    // Guard against placeholder sessions that can appear before the race has real lap data.
    const maxLapsCompleted = raceSession.vehicles.reduce(
      (max, vehicle) => Math.max(max, Number(vehicle.laps_completed) || 0),
      0,
    );
    if (maxLapsCompleted <= 0) {
      console.log(
        `[NASCAR API] Race session ${raceId} has no completed laps yet, skipping results`,
      );
      return [];
    }

    // Convert vehicles to race results
    const results: NascarRaceResult[] = raceSession.vehicles
      .filter((v) => v.running_position > 0)
      .map((vehicle) => ({
        driverId: vehicle.driver.driver_id,
        driverName: vehicle.driver.full_name,
        carNumber: vehicle.vehicle_number,
        manufacturer: vehicle.vehicle_manufacturer,
        finishPosition: vehicle.running_position,
        startPosition: vehicle.starting_position,
        positionDifferential: vehicle.starting_position - vehicle.running_position,
        lapsCompleted: vehicle.laps_completed,
        lapsLed: countNascarLapsLed(vehicle.laps_led, raceSession?.laps),
        fastestLaps: Math.max(0, Number(vehicle.fastest_laps_run) || 0),
        points: 0, // Points based on finish position
        status: vehicle.is_on_track ? "Running" : "DNF",
      }));

    // Calculate points based on finish position (standard NASCAR points)
    results.forEach((result, index) => {
      result.points = calculatePoints(index + 1, result.lapsLed > 0);
    });

    return results;
  } catch (error: any) {
    console.error(`[NASCAR API] Error fetching race results:`, error.message);
    return [];
  }
}

/**
 * Fetch practice/qualifying session results to get active drivers for a race
 * This helps identify which drivers are entered in upcoming races
 * Returns drivers from practice (runType=1) and qualifying (runType=2) sessions
 */
export async function fetchPracticeQualifyingDrivers(
  year: number,
  seriesId: NascarSeriesId,
  raceId: number,
): Promise<NascarDriver[]> {
  try {
    const weekendFeed = await fetchWeekendFeed(year, seriesId, raceId);
    if (!weekendFeed || !weekendFeed.sessions) {
      console.log(`[NASCAR API] No weekend feed for race ${raceId}`);
      return [];
    }

    // Get unique drivers from practice and qualifying sessions
    const driverMap = new Map<number, NascarDriver>();

    for (const session of weekendFeed.sessions) {
      // runType: 1=Practice, 2=Qualifying
      if (session.runType === 1 || session.runType === 2) {
        for (const vehicle of session.vehicles) {
          if (vehicle.driver && vehicle.driver.driver_id) {
            driverMap.set(vehicle.driver.driver_id, vehicle.driver);
          }
        }
      }
    }

    const drivers = Array.from(driverMap.values());
    console.log(
      `[NASCAR API] Found ${drivers.length} active drivers for race ${raceId} from practice/qualifying`,
    );
    return drivers;
  } catch (error: any) {
    console.error(`[NASCAR API] Error fetching practice/qualifying drivers:`, error.message);
    return [];
  }
}

/**
 * Fetch entry list for an upcoming race (official list of drivers entered)
 */
export async function fetchEntryList(
  year: number,
  seriesId: NascarSeriesId,
  raceId: number,
): Promise<NascarDriver[]> {
  try {
    const response = await apiClient.get(`/cacher/${year}/${seriesId}/${raceId}/entry-list.json`);
    const data = response.data;

    if (!data || !Array.isArray(data)) {
      console.log(`[NASCAR API] No entry list for race ${raceId}`);
      return [];
    }

    // Entry list typically has driver objects with driver_id
    const drivers: NascarDriver[] = data
      .filter((entry: any) => entry.driver_id)
      .map((entry: any) => ({
        driver_id: entry.driver_id,
        full_name: entry.driver_name || entry.Full_Name || "",
        first_name: entry.first_name || entry.First_Name || "",
        last_name: entry.last_name || entry.Last_Name || "",
        short_name: entry.short_name || entry.Short_Name || undefined,
      }));

    console.log(`[NASCAR API] Found ${drivers.length} drivers in entry list for race ${raceId}`);
    return drivers;
  } catch (error: any) {
    // Entry list might not exist for all races
    if (error.response?.status === 404) {
      console.log(`[NASCAR API] No entry list found for race ${raceId}`);
    } else {
      console.error(`[NASCAR API] Error fetching entry list:`, error.message);
    }
    return [];
  }
}

/**
 * Get active drivers for a race - tries multiple sources in order:
 * 1. Entry list (for upcoming races)
 * 2. Practice/qualifying results (for recent races)
 * 3. Race results (as fallback)
 */
export async function fetchActiveDriversForRace(
  year: number,
  seriesId: NascarSeriesId,
  raceId: number,
): Promise<NascarDriver[]> {
  // Try entry list first (best for upcoming races)
  let drivers = await fetchEntryList(year, seriesId, raceId);
  if (drivers.length > 0) {
    return drivers;
  }

  // Fall back to practice/qualifying
  drivers = await fetchPracticeQualifyingDrivers(year, seriesId, raceId);
  if (drivers.length > 0) {
    return drivers;
  }

  // Last resort: race results
  const results = await fetchRaceResults(year, seriesId, raceId);
  return results.map((r) => ({
    driver_id: r.driverId,
    full_name: r.driverName,
    first_name: r.driverName.split(" ")[0],
    last_name: r.driverName.split(" ").slice(1).join(" "),
  }));
}

/**
 * Standard NASCAR points system (playoff and regular)
 * Position 1-40+ points, plus bonus points for leading laps and pole position
 */
function calculatePoints(finishPosition: number, ledLaps: boolean): number {
  // Base points for each position
  const basePoints = [
    40,
    35,
    34,
    33,
    32,
    31,
    30,
    29,
    28,
    27, // 1-10
    26,
    25,
    24,
    23,
    22,
    21,
    20,
    19,
    18,
    17, // 11-20
    16,
    15,
    14,
    13,
    12,
    11,
    10,
    9,
    8,
    7, // 21-30
    6,
    5,
    4,
    3,
    2,
    1,
    0,
    0,
    0,
    0, // 31-40
  ];

  let points = basePoints[Math.min(finishPosition - 1, basePoints.length - 1)] || 0;

  // Bonus points
  if (finishPosition === 1) points += 5; // Win bonus
  if (ledLaps) points += 1; // Led at least one lap

  return points;
}

/**
 * Fetch all drivers for a series (active roster)
 * Uses the drivers database endpoint which doesn't require proxy
 */
export async function fetchDrivers(seriesId: NascarSeriesId): Promise<NascarDriver[]> {
  try {
    // Use the drivers database endpoint - it works without proxy
    // and provides all drivers across all series
    const response = await apiClient.get("/cacher/drivers.json");
    const data = response.data;

    if (!data.response || !Array.isArray(data.response)) {
      console.error("[NASCAR API] Invalid drivers response format");
      return [];
    }

    // Map series logos to series IDs
    // NCS = NASCAR Cup Series, NOAPS = Xfinity (likely), trucks = Trucks
    const seriesLogoMap: Record<string, number> = {
      "NCS_RGB_240x120.png": 1, // Cup Series
      "NOAPS-Primary_FullColor-RGB.svg": 2, // Xfinity Series
      "nascar_craftsman_truck_series_logo.svg": 3, // Truck Series
    };

    // Filter drivers by series based on Series_Logo
    const seriesDrivers = data.response.filter((driver: any) => {
      const logoUrl = driver.Series_Logo || "";
      const logo = logoUrl.split("/").pop() || ""; // Get filename
      const driverSeries = seriesLogoMap[logo];
      return driverSeries === seriesId;
    });

    // Convert to our driver format
    const drivers: NascarDriver[] = seriesDrivers.map((driver: any) => ({
      driver_id: parseInt(driver.Nascar_Driver_ID, 10),
      full_name: driver.Full_Name,
      first_name: driver.First_Name,
      last_name: driver.Last_Name,
      short_name: driver.Short_Name || undefined,
    }));

    console.log(`[NASCAR API] Fetched ${drivers.length} drivers for series ${seriesId}`);
    return drivers;
  } catch (error: any) {
    console.error(`[NASCAR API] Error fetching drivers for series ${seriesId}:`, error.message);

    // Fallback: try live feed
    try {
      const liveFeed = await fetchLiveFeed(seriesId);
      if (liveFeed) {
        return liveFeed.vehicles.map((v) => v.driver);
      }
    } catch (e) {
      // Ignore fallback errors
    }

    return [];
  }
}

/**
 * Fetch current standings/points for a series
 */
export async function fetchStandings(
  year: number,
  seriesId: NascarSeriesId,
): Promise<
  {
    driverId: number;
    driverName: string;
    position: number;
    wins: number;
    top5: number;
    top10: number;
    lapsLed: number;
    points: number;
  }[]
> {
  try {
    // Standings may be available in live points data
    const liveFeed = await fetchLiveFeed(seriesId);
    if (liveFeed && liveFeed.vehicles.length > 0) {
      // Sort by running position to get standings
      return liveFeed.vehicles
        .filter((v) => v.running_position > 0)
        .map((vehicle, index) => ({
          driverId: vehicle.driver.driver_id,
          driverName: vehicle.driver.full_name,
          position: vehicle.running_position,
          wins: 0, // Would need historical data
          top5: 0,
          top10: 0,
          lapsLed: vehicle.laps_led.length,
          points: 0, // Would need complete season data
        }));
    }
    return [];
  } catch (error: any) {
    console.error(`[NASCAR API] Error fetching standings:`, error.message);
    return [];
  }
}

/**
 * Calculate fantasy points for a driver based on race results
 */
export function calculateFantasyPoints(result: NascarRaceResult): number {
  let points = 0;

  // Finish position points (inverted - higher finish = more points)
  // Using a scale where P1 gets 100, P2 gets 95, etc.
  points += Math.max(0, 100 - (result.finishPosition - 1) * 2.5);

  // Bonus points
  if (result.finishPosition === 1) points += 25; // Win bonus
  if (result.finishPosition <= 3) points += 10; // Podium bonus
  if (result.finishPosition <= 10) points += 5; // Top 10 bonus

  // Laps led bonus
  if (result.lapsLed > 0) points += result.lapsLed * 0.5;
  if (result.lapsLed >= 1) points += 15; // Led a lap bonus
  if (result.lapsLed >= 1 && result.finishPosition === 1) points += 25; // Led most laps + won

  // Fastest laps (if available)
  if (result.fastestLaps > 0) points += result.fastestLaps * 2;

  return Math.round(points * 100) / 100;
}

/**
 * Determine whether a live feed represents a race that has already finished.
 */
export function isNascarRaceFinished(
  feed: Pick<NascarLiveFeed, "flag_state" | "laps_to_go">,
): boolean {
  if (feed.laps_to_go <= 0) {
    return true;
  }

  // The feed can stay published after the race ends and switch to a terminal flag state.
  return feed.flag_state === 4 || feed.flag_state === 9;
}

/**
 * Get flag state description
 */
export function getFlagStateDescription(flagState: number): string {
  const flagStates: Record<number, string> = {
    1: "Green",
    2: "Yellow",
    3: "Red",
    4: "Checkered",
    5: "White",
    9: "Final",
  };
  return flagStates[flagState] || "Unknown";
}

/**
 * Get manufacturer full name
 */
export function getManufacturerName(abbrev: string): string {
  const manufacturers: Record<string, string> = {
    Tyt: "Toyota",
    Chv: "Chevrolet",
    Frd: "Ford",
  };
  return manufacturers[abbrev] || abbrev;
}

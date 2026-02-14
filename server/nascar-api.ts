/**
 * NASCAR API Service
 *
 * Handles all interactions with the NASCAR API (unofficial).
 * Based on: https://github.com/ooohfascinating/NascarApi
 *
 * Endpoints used:
 * - GET /live/feeds/live-feed.json - Real-time race data
 * - GET /cacher/{year}/{seriesID}/{raceID}/weekend-feed.json - Race weekend data
 *
 * Series IDs:
 * - 1 = Cup Series (NCS)
 * - 2 = Xfinity Series (NXS)
 * - 3 = Truck Series (TRucks)
 */

import axios, { AxiosInstance } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

const NASCAR_API_BASE = "https://cf.nascar.com";
const NASCAR_PROXY_URL = process.env.NASCAR_PROXY_URL;

// Parse IPRoyal proxy URL format: host:port:username:password
function parseProxyUrl(proxyUrl: string): { host: string; port: number; auth: { username: string; password: string } } | null {
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
function createApiClient(): AxiosInstance {
  const config: any = {
    baseURL: NASCAR_API_BASE,
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
  laps_led: number[];
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
  run_type: number;
  // Race state
  flag_state: number; // 1=Green, 2=Yellow, 3=Red
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

export interface NascarWeekendFeed {
  raceId: number;
  seriesId: NascarSeriesId;
  trackId: number;
  trackName: string;
  raceName: string;
  date: string;
  sessions: NascarWeekendSession[];
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
 * Fetch live feed for current/ongoing race
 */
export async function fetchLiveFeed(seriesId?: NascarSeriesId): Promise<NascarLiveFeed | null> {
  console.log(`[NASCAR API] fetchLiveFeed called with seriesId=${seriesId}`);
  try {
    const response = await apiClient.get<NascarLiveFeed>("/live/feeds/live-feed.json");
    const feed = response.data;

    // Debug log
    console.log(`[NASCAR API] Live feed: series_id=${feed.series_id}, race_id=${feed.race_id}, lap=${feed.lap_number}`);

    // Filter by series if specified - API uses series_id (snake_case)
    if (seriesId && feed.series_id !== seriesId) {
      console.log(`[NASCAR API] Series mismatch: requested=${seriesId}, got=${feed.series_id}`);
      return null;
    }

    return feed;
  } catch (error: any) {
    // No live race may return 404 or other errors
    if (error.response?.status === 404 || error.code === "ECONNREFUSED") {
      console.log("[NASCAR API] No live race currently");
      return null;
    }
    // Log more details about the error
    console.error("[NASCAR API] Error fetching live feed:", error.message, "code:", error.code, "status:", error.response?.status);
    throw error;
  }
}

/**
 * Fetch race list/schedule for a given year
 */
export async function fetchRaceSchedule(year: number): Promise<NascarRaceListItem[]> {
  try {
    // Use race_list_basic.json endpoint (not race_list.json which returns 403)
    const response = await apiClient.get(`/cacher/${year}/1/race_list_basic.json`);
    const raceList: NascarRaceListItem[] = response.data;

    console.log(`[NASCAR API] Fetched ${raceList.length} races for ${year}`);
    return raceList;
  } catch (error: any) {
    console.error(`[NASCAR API] Error fetching race schedule for ${year}:`, error.message);
    // Return empty array if no data available yet for this year
    if (error.response?.status === 404 || error.response?.status === 403) {
      return [];
    }
    throw error;
  }
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
    const response = await apiClient.get<NascarWeekendFeed>(
      `/cacher/${year}/${seriesId}/${raceId}/weekend-feed.json`,
    );
    return response.data;
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
    const weekendFeed = await fetchWeekendFeed(year, seriesId, raceId);
    if (!weekendFeed) return [];

    // Find the race session (runType 3 = Race)
    const raceSession = weekendFeed.sessions.find((s) => s.runType === 3);
    if (!raceSession) return [];

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
        lapsLed: vehicle.laps_led.length,
        fastestLaps: 0, // Need to calculate from lap data
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
 * Standard NASCAR points system (playoff and regular)
 * Position 1-40+ points, plus bonus points for leading laps and pole position
 */
function calculatePoints(finishPosition: number, ledLaps: boolean): number {
  // Base points for each position
  const basePoints = [
    40, 35, 34, 33, 32, 31, 30, 29, 28, 27, // 1-10
    26, 25, 24, 23, 22, 21, 20, 19, 18, 17, // 11-20
    16, 15, 14, 13, 12, 11, 10, 9, 8, 7, // 21-30
    6, 5, 4, 3, 2, 1, 0, 0, 0, 0, // 31-40
  ];

  let points = basePoints[Math.min(finishPosition - 1, basePoints.length - 1)] || 0;

  // Bonus points
  if (finishPosition === 1) points += 5; // Win bonus
  if (ledLaps) points += 1; // Led at least one lap

  return points;
}

/**
 * Fetch all drivers for a series (active roster)
 */
export async function fetchDrivers(seriesId: NascarSeriesId): Promise<NascarDriver[]> {
  try {
    // Get current live feed or use a known race to get driver list
    // Drivers are available in the live feed vehicle list
    const liveFeed = await fetchLiveFeed(seriesId);
    if (liveFeed) {
      return liveFeed.vehicles.map((v) => v.driver);
    }

    // Fallback: try to fetch from a recent race
    const currentYear = new Date().getFullYear();
    const schedule = await fetchRaceSchedule(currentYear);
    const racesForSeries = schedule.filter((r) => r.series_id === seriesId);

    if (racesForSeries.length === 0) {
      return [];
    }

    // Try to get drivers from the most recent race
    for (const race of racesForSeries.reverse()) {
      const weekendFeed = await fetchWeekendFeed(currentYear, seriesId, race.race_id);
      if (weekendFeed) {
        // Get unique drivers from all sessions
        const driverMap = new Map<number, NascarDriver>();
        for (const session of weekendFeed.sessions) {
          for (const vehicle of session.vehicles) {
            driverMap.set(vehicle.driver.driver_id, vehicle.driver);
          }
        }
        return Array.from(driverMap.values());
      }
    }

    return [];
  } catch (error: any) {
    console.error(`[NASCAR API] Error fetching drivers for series ${seriesId}:`, error.message);
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
 * Get flag state description
 */
export function getFlagStateDescription(flagState: number): string {
  const flagStates: Record<number, string> = {
    1: "Green",
    2: "Yellow",
    3: "Red",
    4: "Checkered",
    5: "White",
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

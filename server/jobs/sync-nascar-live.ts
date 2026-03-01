/**
 * NASCAR Live Stats Sync Job
 *
 * Fetches real-time NASCAR race data during live events.
 * Updates driver positions, laps led, fastest laps, and live fantasy points.
 * Should be run frequently (every 30-60 seconds) during live races.
 * Supports all 3 series: Cup, Xfinity, and Trucks.
 */

import { storage } from "../storage";
import {
  fetchLiveFeed,
  NASCAR_SERIES,
  NASCAR_SERIES_NAMES,
  NASCAR_SERIES_CODES,
  NascarSeriesId,
  NascarLiveFeed,
  getFlagStateDescription,
  isNascarRaceFinished,
} from "../nascar-api";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

const NASCAR_SPORT = "NASCAR";

/**
 * Create a NASCAR player ID from driver ID
 * Uses the NASCAR driver ID directly - this is consistent across all series
 * so shares transfer when drivers move between series
 */
function createNascarPlayerId(driverId: number, _seriesId: NascarSeriesId): string {
  return `nascar_${driverId}`;
}

/**
 * Create a game ID for the live race
 */
function createNascarGameId(raceId: number, seriesId: NascarSeriesId): string {
  const seriesCode = NASCAR_SERIES_CODES[seriesId];
  return `nascar_${seriesCode}_${raceId}`;
}

/**
 * Convert live feed vehicle data to player game stats
 */
async function convertLiveFeedToStats(
  liveFeed: NascarLiveFeed,
  seriesId: NascarSeriesId,
): Promise<
  {
    playerId: string;
    gameId: string;
    sport: string;
    gameDate: Date;
    week: number | null;
    season: string;
    statsJson: Record<string, any>;
    fantasyPoints: string;
  }[]
> {
  const raceId = liveFeed.race_id;
  const gameId = createNascarGameId(raceId, seriesId);
  const gameDate = new Date();
  const season = String(new Date().getFullYear());

  const statsPromises = liveFeed.vehicles.map(async (vehicle) => {
    // Calculate live fantasy points
    let liveFantasyPoints = 0;
    liveFantasyPoints += (41 - vehicle.running_position) * 2.5; // Position points
    if (vehicle.running_position === 1) liveFantasyPoints += 25; // Leader bonus
    if (vehicle.laps_led.length > 0) {
      liveFantasyPoints += 15; // Led a lap
      liveFantasyPoints += vehicle.laps_led.length * 0.5; // Laps led bonus
    }
    liveFantasyPoints = Math.round(liveFantasyPoints * 100) / 100;

    const playerId = createNascarPlayerId(vehicle.driver.driver_id, seriesId);

    const statsJson = {
      // Live position data
      runningPosition: vehicle.running_position,
      startingPosition: vehicle.starting_position,
      positionDifferential: vehicle.starting_position - vehicle.running_position,
      // Lap data
      lapsCompleted: vehicle.laps_completed,
      lapsLed: vehicle.laps_led,
      lapsLedCount: vehicle.laps_led.length,
      // Speed data
      averageRunningPosition: vehicle.average_running_position,
      averageSpeed: vehicle.average_speed,
      bestLap: vehicle.best_lap,
      bestLapSpeed: vehicle.best_lap_speed,
      bestLapTime: vehicle.best_lap_time,
      // Time gap
      delta: vehicle.delta,
      // Car info
      carNumber: vehicle.vehicle_number,
      manufacturer: vehicle.vehicle_manufacturer,
      // Status
      isOnTrack: vehicle.is_on_track,
      isOnDvp: vehicle.is_on_dvp,
      // Race info
      raceId: liveFeed.race_id,
      trackName: liveFeed.track_name,
      lapNumber: liveFeed.lap_number,
      lapsInRace: liveFeed.laps_in_race,
      lapsToGo: liveFeed.laps_to_go,
      flagState: liveFeed.flag_state,
      flagStateDescription: getFlagStateDescription(liveFeed.flag_state),
      runName: liveFeed.run_name,
    };

    return {
      playerId,
      gameId,
      sport: NASCAR_SPORT,
      gameDate,
      week: null,
      season,
      opponentTeam: "",
      homeAway: "neutral",
      statsJson,
      // NBA-specific fields (not used for NASCAR)
      minutes: 0,
      points: vehicle.running_position,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      rebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      isDoubleDouble: false,
      isTripleDouble: false,
      fantasyPoints: String(liveFantasyPoints),
    };
  });

  return Promise.all(statsPromises);
}

/**
 * Sync live stats for a specific series
 */
export async function syncNascarLiveForSeries(
  seriesId: NascarSeriesId,
  progressCallback?: ProgressCallback,
): Promise<{
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
  isLive: boolean;
  raceInfo: {
    raceId: number;
    trackName: string;
    lapNumber: number;
    lapsToGo: number;
    flagState: string;
  } | null;
}> {
  const seriesName = NASCAR_SERIES_NAMES[seriesId];

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;
  let isLive = false;
  let raceInfo = null;

  try {
    // Fetch live feed
    requestCount++;
    const liveFeed = await fetchLiveFeed(seriesId);

    if (!liveFeed) {
      console.log(`[nascar_live_sync] No live race for ${seriesName}`);
      return { requestCount, recordsProcessed: 0, errorCount: 0, isLive: false, raceInfo: null };
    }

    // Check if this is the series we're looking for
    if (liveFeed.series_id !== seriesId) {
      console.log(
        `[nascar_live_sync] Live race is for series ${liveFeed.series_id}, not ${seriesId}`,
      );
      return { requestCount, recordsProcessed: 0, errorCount: 0, isLive: false, raceInfo: null };
    }

    isLive = true;
    const flagStateDesc = getFlagStateDescription(liveFeed.flag_state);
    const isRaceFinished = isNascarRaceFinished(liveFeed);

    // Update the dailyGames status - mark as completed if checkered flag, otherwise inprogress
    const gameId = createNascarGameId(liveFeed.race_id, seriesId);
    const newStatus = isRaceFinished ? "completed" : "inprogress";
    try {
      await storage.updateDailyGameStatus(gameId, newStatus);
      console.log(
        `[nascar_live_sync] Updated game ${gameId} status to ${newStatus} (flag: ${flagStateDesc})`,
      );
    } catch (error: any) {
      console.error(`[nascar_live_sync] Failed to update game status:`, error.message);
    }

    console.log(
      `[nascar_live_sync] Live race: ${liveFeed.track_name}, Lap ${liveFeed.lap_number}/${liveFeed.laps_in_race}, Flag: ${flagStateDesc}`,
    );

    raceInfo = {
      raceId: liveFeed.race_id,
      trackName: liveFeed.track_name,
      lapNumber: liveFeed.lap_number,
      lapsToGo: liveFeed.laps_to_go,
      flagState: flagStateDesc,
    };

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Live race: ${liveFeed.track_name}, Lap ${liveFeed.lap_number}/${liveFeed.laps_in_race}`,
      data: raceInfo,
    });

    // Convert live feed to stats
    const statsData = await convertLiveFeedToStats(liveFeed, seriesId);

    // Store stats in database
    for (const stats of statsData) {
      try {
        await storage.upsertPlayerGameStats(stats);
        recordsProcessed++;
      } catch (error: any) {
        console.error(`[nascar_live_sync] Failed to store live stats for driver:`, error.message);
        errorCount++;
      }
    }

    console.log(
      `[nascar_live_sync] Completed live sync for ${seriesName}: ${recordsProcessed} driver stats updated`,
    );

    return { requestCount, recordsProcessed, errorCount, isLive: true, raceInfo };
  } catch (error: any) {
    console.error(`[nascar_live_sync] Error syncing live data for ${seriesName}:`, error.message);
    return {
      requestCount,
      recordsProcessed: 0,
      errorCount: errorCount + 1,
      isLive: false,
      raceInfo: null,
    };
  }
}

/**
 * Main live sync job - syncs live data for all series
 * Note: This should be run more frequently during race events
 */
export async function syncNascarLive(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[nascar_live_sync] Starting NASCAR live stats sync...");

  const seriesList: NascarSeriesId[] = [
    NASCAR_SERIES.CUP,
    NASCAR_SERIES.XFINITY,
    NASCAR_SERIES.TRUCKS,
  ];

  let totalRequestCount = 0;
  let totalRecordsProcessed = 0;
  let totalErrorCount = 0;
  let liveRacesFound = 0;
  const liveRaceInfo: { series: string; info: any }[] = [];

  for (const seriesId of seriesList) {
    const seriesName = NASCAR_SERIES_NAMES[seriesId];
    const result = await syncNascarLiveForSeries(seriesId, progressCallback);

    totalRequestCount += result.requestCount;
    totalRecordsProcessed += result.recordsProcessed;
    totalErrorCount += result.errorCount;

    if (result.isLive) {
      liveRacesFound++;
      liveRaceInfo.push({ series: seriesName, info: result.raceInfo });
    }
  }

  console.log(
    `[nascar_live_sync] Completed NASCAR live sync: ${totalRecordsProcessed} driver stats, ${liveRacesFound} live races`,
  );

  return {
    requestCount: totalRequestCount,
    recordsProcessed: totalRecordsProcessed,
    errorCount: totalErrorCount,
  };
}

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
} from "../nascar-api";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

const NASCAR_SPORT = "NASCAR";

/**
 * Create a NASCAR player ID from driver ID and series
 */
function createNascarPlayerId(driverId: number, seriesId: NascarSeriesId): string {
  const seriesCode = NASCAR_SERIES_CODES[seriesId];
  return `nascar_${seriesCode}_${driverId}`;
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
): Promise<{
  playerId: string;
  gameId: string;
  sport: string;
  gameDate: Date;
  week: number | null;
  season: string;
  statsJson: Record<string, any>;
  fantasyPoints: string;
}[]> {
  const raceId = liveFeed.raceId;
  const gameId = createNascarGameId(raceId, seriesId);
  const gameDate = new Date();
  const season = String(new Date().getFullYear());

  const statsPromises = liveFeed.vehicles.map(async (vehicle) => {
    // Calculate live fantasy points
    let liveFantasyPoints = 0;
    liveFantasyPoints += (41 - vehicle.runningPosition) * 2.5; // Position points
    if (vehicle.runningPosition === 1) liveFantasyPoints += 25; // Leader bonus
    if (vehicle.lapsLed.length > 0) {
      liveFantasyPoints += 15; // Led a lap
      liveFantasyPoints += vehicle.lapsLed.length * 0.5; // Laps led bonus
    }
    liveFantasyPoints = Math.round(liveFantasyPoints * 100) / 100;

    const playerId = createNascarPlayerId(vehicle.driver.driverId, seriesId);

    const statsJson = {
      // Live position data
      runningPosition: vehicle.runningPosition,
      startingPosition: vehicle.startingPosition,
      positionDifferential: vehicle.startingPosition - vehicle.runningPosition,
      // Lap data
      lapsCompleted: vehicle.lapsCompleted,
      lapsLed: vehicle.lapsLed,
      lapsLedCount: vehicle.lapsLed.length,
      // Speed data
      averageRunningPosition: vehicle.averageRunningPosition,
      averageSpeed: vehicle.averageSpeed,
      bestLap: vehicle.bestLap,
      bestLapSpeed: vehicle.bestLapSpeed,
      bestLapTime: vehicle.bestLapTime,
      // Time gap
      delta: vehicle.delta,
      // Car info
      carNumber: vehicle.vehicleNumber,
      manufacturer: vehicle.vehicleManufacturer,
      // Status
      isOnTrack: vehicle.isOnTrack,
      isOnDvp: vehicle.isOnDvp,
      // Race info
      raceId: liveFeed.raceId,
      trackName: liveFeed.trackName,
      lapNumber: liveFeed.lapNumber,
      lapsInRace: liveFeed.lapsInRace,
      lapsToGo: liveFeed.lapsToGo,
      flagState: liveFeed.flagState,
      flagStateDescription: getFlagStateDescription(liveFeed.flagState),
      runName: liveFeed.runName,
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
      points: vehicle.runningPosition,
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
  raceInfo: { raceId: number; trackName: string; lapNumber: number; lapsToGo: number; flagState: string } | null;
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
    if (liveFeed.seriesId !== seriesId) {
      console.log(`[nascar_live_sync] Live race is for series ${liveFeed.seriesId}, not ${seriesId}`);
      return { requestCount, recordsProcessed: 0, errorCount: 0, isLive: false, raceInfo: null };
    }

    isLive = true;
    const flagStateDesc = getFlagStateDescription(liveFeed.flagState);
    const isRaceFinished = liveFeed.flagState === 4; // 4 = Checkered flag = race finished

    // Update the dailyGames status - mark as completed if checkered flag, otherwise inprogress
    const gameId = createNascarGameId(liveFeed.raceId, seriesId);
    const newStatus = isRaceFinished ? "completed" : "inprogress";
    try {
      await storage.updateDailyGameStatus(gameId, newStatus);
      console.log(`[nascar_live_sync] Updated game ${gameId} status to ${newStatus} (flag: ${flagStateDesc})`);
    } catch (error: any) {
      console.error(`[nascar_live_sync] Failed to update game status:`, error.message);
    }

    console.log(
      `[nascar_live_sync] Live race: ${liveFeed.trackName}, Lap ${liveFeed.lapNumber}/${liveFeed.lapsInRace}, Flag: ${flagStateDesc}`,
    );

    raceInfo = {
      raceId: liveFeed.raceId,
      trackName: liveFeed.trackName,
      lapNumber: liveFeed.lapNumber,
      lapsToGo: liveFeed.lapsToGo,
      flagState: flagStateDesc,
    };

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Live race: ${liveFeed.trackName}, Lap ${liveFeed.lapNumber}/${liveFeed.lapsInRace}`,
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
        console.error(
          `[nascar_live_sync] Failed to store live stats for driver:`,
          error.message,
        );
        errorCount++;
      }
    }

    console.log(
      `[nascar_live_sync] Completed live sync for ${seriesName}: ${recordsProcessed} driver stats updated`,
    );

    return { requestCount, recordsProcessed, errorCount, isLive: true, raceInfo };
  } catch (error: any) {
    console.error(`[nascar_live_sync] Error syncing live data for ${seriesName}:`, error.message);
    return { requestCount, recordsProcessed: 0, errorCount: errorCount + 1, isLive: false, raceInfo: null };
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

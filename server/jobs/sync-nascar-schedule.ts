/**
 * NASCAR Schedule Sync Job
 *
 * Fetches NASCAR race schedules from NASCAR API and updates the database.
 * Stores race information for contest eligibility checking.
 * Supports all 3 series: Cup, Xfinity, and Trucks.
 */

import { storage } from "../storage";
import {
  fetchRaceSchedule,
  NASCAR_SERIES,
  NASCAR_SERIES_NAMES,
  NASCAR_SERIES_CODES,
  NascarSeriesId,
  NascarRaceListItem,
} from "../nascar-api";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";
import { getGameDay, getETDayBoundaries } from "../lib/time";

const NASCAR_SPORT = "NASCAR";

/**
 * Create a game ID for a NASCAR race
 */
function createNascarGameId(raceId: number, seriesId: NascarSeriesId): string {
  const seriesCode = NASCAR_SERIES_CODES[seriesId];
  return `nascar_${seriesCode}_${raceId}`;
}

/**
 * Convert NASCAR race list item to daily game
 */
async function convertToDailyGame(
  race: NascarRaceListItem,
  seriesId: NascarSeriesId,
): Promise<{
  gameId: string;
  sport: string;
  date: Date;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  status: string;
  startTime: Date;
}> {
  // For NASCAR, "home" team is the track, "away" team could be the series
  // Or we could use a different format: "Series vs Track"
  const seriesName = NASCAR_SERIES_CODES[seriesId];
  const trackName = race.track_name;

  // Parse the race date/time (use race_date field)
  // NASCAR API returns times in Eastern Time without timezone info
  // So "13:30" means 1:30 PM ET, not UTC
  // We need to convert ET to UTC (add 5 hours for EST, 4 for EDT)
  const isEDT = () => {
    const date = new Date(race.race_date);
    const month = date.getMonth();
    return month > 2 && month < 11; // April-October is EDT
  };
  const etOffset = isEDT() ? 4 : 5; // ET offset from UTC
  const raceDateTimeET = new Date(race.race_date);
  const raceDateTimeUTC = new Date(raceDateTimeET.getTime() + etOffset * 60 * 60 * 1000);

  // Calculate game day in Eastern Time
  const gameDay = getGameDay(raceDateTimeUTC);
  const { startOfDay } = getETDayBoundaries(gameDay);

  // Determine initial status based on race time
  // If race is in the future, status = "scheduled"
  // If race recently happened (within 24 hours), let live sync determine
  // If race is older than 24 hours, mark as "completed"
  const now = new Date();
  const raceHasStarted = raceDateTimeUTC < now;
  const withinRecentWindow = now.getTime() - raceDateTimeUTC.getTime() < 24 * 60 * 60 * 1000;

  let status: string;
  if (!raceHasStarted) {
    status = "scheduled";
  } else if (withinRecentWindow) {
    // Recently completed or possibly still live - let live sync determine
    status = "scheduled";
  } else {
    // Old race - mark as completed
    status = "completed";
  }

  return {
    gameId: createNascarGameId(race.race_id, seriesId),
    sport: NASCAR_SPORT,
    date: startOfDay,
    homeTeam: trackName, // Track is "home"
    awayTeam: seriesName, // Series is "away"
    venue: trackName,
    status,
    startTime: raceDateTimeUTC,
  };
}

/**
 * Sync NASCAR schedule for a specific year and series
 */
export async function syncNascarScheduleForYearAndSeries(
  year: number,
  seriesId: NascarSeriesId,
  progressCallback?: ProgressCallback,
): Promise<{ requestCount: number; recordsProcessed: number; errorCount: number }> {
  const seriesName = NASCAR_SERIES_NAMES[seriesId];
  console.log(`[nascar_schedule_sync] Starting ${seriesName} schedule sync for ${year}...`);

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: `Starting ${seriesName} schedule sync for ${year}`,
  });

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;

  try {
    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Fetching ${seriesName} race schedule from NASCAR API`,
    });

    // Fetch race schedule
    requestCount++;
    const races = await fetchRaceSchedule(year);

    // Filter for the specific series if needed
    const seriesRaces = races.filter(
      (r) => r.series_id === seriesId,
    );

    console.log(`[nascar_schedule_sync] Fetched ${seriesRaces.length} races for ${seriesName} in ${year}`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Fetched ${seriesRaces.length} races, updating database`,
      data: { totalRaces: seriesRaces.length, series: seriesName, year },
    });

    // Store races in database
    for (const race of seriesRaces) {
      try {
        const gameData = await convertToDailyGame(race, seriesId);

        await storage.upsertDailyGame({
          gameId: gameData.gameId,
          sport: gameData.sport,
          date: gameData.date,
          homeTeam: gameData.homeTeam,
          awayTeam: gameData.awayTeam,
          venue: gameData.venue,
          status: gameData.status,
          startTime: gameData.startTime,
        });

        recordsProcessed++;

        // Progress update every 5 races
        if (recordsProcessed % 5 === 0) {
          progressCallback?.({
            type: "progress",
            timestamp: new Date().toISOString(),
            message: `Updated ${recordsProcessed}/${seriesRaces.length} races`,
            data: {
              current: recordsProcessed,
              total: seriesRaces.length,
              percentage: Math.round((recordsProcessed / seriesRaces.length) * 100),
              series: seriesName,
              year,
            },
          });
        }
      } catch (error: any) {
        console.error(`[nascar_schedule_sync] Failed to update race ${race.race_id}:`, error.message);
        errorCount++;
      }
    }

    console.log(
      `[nascar_schedule_sync] Completed ${seriesName} ${year} schedule: ${recordsProcessed} races updated, ${errorCount} errors`,
    );

    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
    console.error(`[nascar_schedule_sync] Error syncing ${seriesName} schedule for ${year}:`, error.message);
    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Error syncing ${seriesName} schedule for ${year}: ${error.message}`,
    });
    return { requestCount, recordsProcessed: 0, errorCount: errorCount + 1 };
  }
}

/**
 * Main schedule sync job - syncs schedule for current year and next year
 */
export async function syncNascarSchedule(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[nascar_schedule_sync] Starting NASCAR schedule sync...");

  const currentYear = new Date().getFullYear();
  const yearsToSync = [currentYear - 1, currentYear, currentYear + 1]; // Past, current, and next year
  const seriesList: NascarSeriesId[] = [
    NASCAR_SERIES.CUP,
    NASCAR_SERIES.XFINITY,
    NASCAR_SERIES.TRUCKS,
  ];

  let totalRequestCount = 0;
  let totalRecordsProcessed = 0;
  let totalErrorCount = 0;

  for (const year of yearsToSync) {
    for (const seriesId of seriesList) {
      const result = await syncNascarScheduleForYearAndSeries(year, seriesId, progressCallback);
      totalRequestCount += result.requestCount;
      totalRecordsProcessed += result.recordsProcessed;
      totalErrorCount += result.errorCount;
    }
  }

  console.log(
    `[nascar_schedule_sync] Completed NASCAR schedule sync: ${totalRecordsProcessed} races updated, ${totalErrorCount} errors`,
  );

  return {
    requestCount: totalRequestCount,
    recordsProcessed: totalRecordsProcessed,
    errorCount: totalErrorCount,
  };
}

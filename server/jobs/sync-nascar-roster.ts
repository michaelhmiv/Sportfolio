/**
 * NASCAR Roster Sync Job
 *
 * Fetches NASCAR driver rosters from NASCAR API and updates the database.
 * Supports all 3 series: Cup, Xfinity, and Trucks.
 */

import { storage } from "../storage";
import {
  fetchDrivers,
  fetchRaceSchedule,
  fetchActiveDriversForRace,
  NASCAR_SERIES,
  NASCAR_SERIES_NAMES,
  NASCAR_SERIES_CODES,
  NascarSeriesId,
  NascarDriver,
} from "../nascar-api";
import type { JobResult } from "./types";
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
 * Sync NASCAR driver roster for a specific series
 */
export async function syncNascarRosterForSeries(
  seriesId: NascarSeriesId,
  progressCallback?: ProgressCallback,
): Promise<{ requestCount: number; recordsProcessed: number; errorCount: number }> {
  const seriesName = NASCAR_SERIES_NAMES[seriesId];
  console.log(`[nascar_roster_sync] Starting ${seriesName} roster sync...`);

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: `Starting ${seriesName} roster sync`,
  });

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;

  try {
    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Fetching ${seriesName} drivers from NASCAR API`,
    });

    // Fetch drivers
    requestCount++;
    const drivers = await fetchDrivers(seriesId);

    console.log(`[nascar_roster_sync] Fetched ${drivers.length} drivers from ${seriesName}`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Fetched ${drivers.length} drivers from API, updating database`,
      data: { totalDrivers: drivers.length, series: seriesName },
    });

    // Update drivers in database
    for (const driver of drivers) {
      try {
        // For NASCAR, team should be the series code so it matches the game awayTeam
        // This enables the dashboard to find eligible players for boosts
        // Use codes: NCS (Cup), NXS (Xfinity), NTS (Trucks)
        const team = NASCAR_SERIES_CODES[seriesId]; // e.g., "NCS", "NXS", "NTS"

        await storage.upsertPlayer({
          id: createNascarPlayerId(driver.driver_id, seriesId),
          sport: NASCAR_SPORT,
          firstName: driver.first_name,
          lastName: driver.last_name,
          team: team,
          position: "DRV",
          jerseyNumber: "", // No jersey number in NASCAR
          isActive: true,
          isEligibleForVesting: true,
        });

        recordsProcessed++;

        // Progress update every 10 drivers
        if (recordsProcessed % 10 === 0) {
          progressCallback?.({
            type: "progress",
            timestamp: new Date().toISOString(),
            message: `Updated ${recordsProcessed}/${drivers.length} drivers`,
            data: {
              current: recordsProcessed,
              total: drivers.length,
              percentage: Math.round((recordsProcessed / drivers.length) * 100),
              series: seriesName,
            },
          });
        }
      } catch (error: any) {
        console.error(
          `[nascar_roster_sync] Failed to update driver ${driver.driver_id}:`,
          error.message,
        );
        errorCount++;
      }
    }

    console.log(
      `[nascar_roster_sync] Completed ${seriesName} sync: ${recordsProcessed} drivers updated, ${errorCount} errors`,
    );

    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
    console.error(`[nascar_roster_sync] Error syncing ${seriesName} roster:`, error.message);
    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Error syncing ${seriesName} roster: ${error.message}`,
    });
    return { requestCount, recordsProcessed: 0, errorCount: errorCount + 1 };
  }
}

/**
 * Main roster sync job - syncs all 3 NASCAR series
 */
export async function syncNascarRoster(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[nascar_roster_sync] Starting NASCAR roster sync for all series...");

  let totalRequestCount = 0;
  let totalRecordsProcessed = 0;
  let totalErrorCount = 0;

  const seriesList: NascarSeriesId[] = [
    NASCAR_SERIES.CUP,
    NASCAR_SERIES.XFINITY,
    NASCAR_SERIES.TRUCKS,
  ];

  for (const seriesId of seriesList) {
    const result = await syncNascarRosterForSeries(seriesId, progressCallback);
    totalRequestCount += result.requestCount;
    totalRecordsProcessed += result.recordsProcessed;
    totalErrorCount += result.errorCount;
  }

  console.log(
    `[nascar_roster_sync] Completed NASCAR roster sync: ${totalRecordsProcessed} drivers updated, ${totalErrorCount} errors`,
  );

  return {
    requestCount: totalRequestCount,
    recordsProcessed: totalRecordsProcessed,
    errorCount: totalErrorCount,
  };
}

/**
 * Helper: Update a single driver in the database
 */
async function upsertDriver(
  driver: NascarDriver,
  seriesId: NascarSeriesId,
  isActive: boolean,
): Promise<void> {
  const team = NASCAR_SERIES_CODES[seriesId];
  await storage.upsertPlayer({
    id: createNascarPlayerId(driver.driver_id, seriesId),
    sport: NASCAR_SPORT,
    firstName: driver.first_name,
    lastName: driver.last_name,
    team: team,
    position: "DRV",
    jerseyNumber: "",
    isActive: isActive,
    isEligibleForVesting: true,
  });
}

/**
 * Sync active NASCAR drivers from upcoming/recent races
 * This filters out old/inactive drivers by only including drivers
 * who are entered in upcoming races or have raced recently
 *
 * @param upcomingDays - How many days ahead to look for upcoming races (default 14)
 * @param pastDays - How many days back to look for recent races (default 7)
 */
export async function syncNascarActiveRoster(
  upcomingDays: number = 14,
  pastDays: number = 7,
  progressCallback?: ProgressCallback,
): Promise<JobResult> {
  console.log(
    `[nascar_roster_sync] Syncing ACTIVE drivers (upcoming: ${upcomingDays} days, past: ${pastDays} days)...`,
  );

  const currentYear = new Date().getFullYear();
  const now = new Date();

  // Calculate date range
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - pastDays);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + upcomingDays);

  let totalRequestCount = 0;
  let totalRecordsProcessed = 0;
  let totalErrorCount = 0;

  const seriesList: NascarSeriesId[] = [
    NASCAR_SERIES.CUP,
    NASCAR_SERIES.XFINITY,
    NASCAR_SERIES.TRUCKS,
  ];

  for (const seriesId of seriesList) {
    const seriesName = NASCAR_SERIES_NAMES[seriesId];
    console.log(`[nascar_roster_sync] Processing active drivers for ${seriesName}...`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Processing ${seriesName} active drivers`,
    });

    try {
      // Fetch schedule for this year/series
      totalRequestCount++;
      const schedule = await fetchRaceSchedule(currentYear);
      const seriesSchedule = schedule.filter((race) => race.series_id === seriesId);

      // Filter to races within our date range
      const relevantRaces = seriesSchedule.filter((race) => {
        const raceDate = new Date(race.race_date);
        return raceDate >= startDate && raceDate <= endDate;
      });

      console.log(
        `[nascar_roster_sync] Found ${relevantRaces.length} relevant races for ${seriesName}`,
      );

      // Collect all active driver IDs from relevant races
      const activeDriverIds = new Set<number>();
      const activeDrivers: NascarDriver[] = [];

      for (const race of relevantRaces) {
        try {
          totalRequestCount++;
          const drivers = await fetchActiveDriversForRace(currentYear, seriesId, race.race_id);

          for (const driver of drivers) {
            if (!activeDriverIds.has(driver.driver_id)) {
              activeDriverIds.add(driver.driver_id);
              activeDrivers.push(driver);
            }
          }
        } catch (error: any) {
          console.error(
            `[nascar_roster_sync] Error fetching drivers for race ${race.race_id}:`,
            error.message,
          );
          totalErrorCount++;
        }
      }

      console.log(
        `[nascar_roster_sync] Found ${activeDrivers.length} active drivers for ${seriesName}`,
      );

      // Upsert all active drivers (mark as active)
      for (const driver of activeDrivers) {
        try {
          await upsertDriver(driver, seriesId, true);
          totalRecordsProcessed++;
        } catch (error: any) {
          console.error(
            `[nascar_roster_sync] Error upserting driver ${driver.driver_id}:`,
            error.message,
          );
          totalErrorCount++;
        }
      }

      // Mark other drivers from the full database as inactive
      // (This is optional - we keep them in DB but mark as inactive)
      // Note: We don't remove players, just mark them as inactive
      console.log(
        `[nascar_roster_sync] ${seriesName}: ${activeDrivers.length} active drivers synced`,
      );
    } catch (error: any) {
      console.error(`[nascar_roster_sync] Error processing ${seriesName}:`, error.message);
      totalErrorCount++;
    }
  }

  console.log(
    `[nascar_roster_sync] Completed active roster sync: ${totalRecordsProcessed} drivers, ${totalErrorCount} errors`,
  );

  return {
    requestCount: totalRequestCount,
    recordsProcessed: totalRecordsProcessed,
    errorCount: totalErrorCount,
  };
}

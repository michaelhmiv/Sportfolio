/**
 * NASCAR Roster Sync Job
 *
 * Fetches NASCAR driver rosters from NASCAR API and updates the database.
 * Supports all 3 series: Cup, Xfinity, and Trucks.
 */

import { storage } from "../storage";
import {
  fetchDrivers,
  NASCAR_SERIES,
  NASCAR_SERIES_NAMES,
  NASCAR_SERIES_CODES,
  NascarSeriesId,
} from "../nascar-api";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

const NASCAR_SPORT = "NASCAR";

/**
 * Create a NASCAR player ID from driver ID
 */
function createNascarPlayerId(driverId: number, seriesId: NascarSeriesId): string {
  // Use series code to distinguish between Cup/Xfinity/Trucks drivers
  // who might race in multiple series
  const seriesCode = NASCAR_SERIES_CODES[seriesId];
  return `nascar_${seriesCode}_${driverId}`;
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
          id: createNascarPlayerId(driver.driverId, seriesId),
          sport: NASCAR_SPORT,
          firstName: driver.firstName,
          lastName: driver.lastName,
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
          `[nascar_roster_sync] Failed to update driver ${driver.driverId}:`,
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

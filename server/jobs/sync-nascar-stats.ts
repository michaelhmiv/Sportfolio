/**
 * NASCAR Stats Sync Job
 *
 * Fetches NASCAR race results from NASCAR API and updates the database.
 * Stores per-driver race statistics for fantasy point calculations.
 * Supports all 3 series: Cup, Xfinity, and Trucks.
 */

import { storage } from "../storage";
import {
  fetchRaceResults,
  fetchRaceSchedule,
  calculateFantasyPoints,
  parseNascarEtDateTime,
  NASCAR_SERIES_NAMES,
  NASCAR_SERIES_CODES,
  NascarSeriesId,
  NascarRaceResult,
} from "../nascar-api";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

const NASCAR_SPORT = "NASCAR";
const NASCAR_RESULTS_LOOKBACK_DAYS = 30;

/**
 * Create a NASCAR player ID from driver ID
 * Uses the NASCAR driver ID directly - this is consistent across all series
 * so shares transfer when drivers move between series
 */
function createNascarPlayerId(driverId: number, _seriesId: NascarSeriesId): string {
  return `nascar_${driverId}`;
}

/**
 * Create a game ID for a NASCAR race
 */
function createNascarGameId(raceId: number, seriesId: NascarSeriesId): string {
  const seriesCode = NASCAR_SERIES_CODES[seriesId];
  return `nascar_${seriesCode}_${raceId}`;
}

function splitNascarDriverName(driverName: string): { firstName: string; lastName: string } {
  const trimmedName = (driverName || "").trim();
  if (!trimmedName) return { firstName: "Unknown", lastName: "Driver" };

  const nameParts = trimmedName.split(/\s+/);
  if (nameParts.length === 1) {
    return { firstName: nameParts[0], lastName: "Driver" };
  }

  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(" "),
  };
}

async function ensureNascarPlayersForResults(
  results: NascarRaceResult[],
  seriesId: NascarSeriesId,
): Promise<{ createdCount: number; errorCount: number }> {
  const uniqueDriverResults = new Map<number, NascarRaceResult>();
  for (const result of results) {
    if (!uniqueDriverResults.has(result.driverId)) {
      uniqueDriverResults.set(result.driverId, result);
    }
  }

  const playerIds = Array.from(uniqueDriverResults.keys()).map((driverId) =>
    createNascarPlayerId(driverId, seriesId),
  );
  if (playerIds.length === 0) {
    return { createdCount: 0, errorCount: 0 };
  }

  const existingPlayers = await storage.getPlayersByIds(playerIds);
  const existingPlayerIds = new Set(existingPlayers.map((player) => player.id));

  let createdCount = 0;
  let errorCount = 0;

  for (const [driverId, driverResult] of uniqueDriverResults) {
    const playerId = createNascarPlayerId(driverId, seriesId);
    if (existingPlayerIds.has(playerId)) continue;

    const { firstName, lastName } = splitNascarDriverName(driverResult.driverName);

    try {
      await storage.upsertPlayer({
        id: playerId,
        sport: NASCAR_SPORT,
        firstName,
        lastName,
        team: NASCAR_SERIES_CODES[seriesId],
        position: "DRV",
        jerseyNumber: driverResult.carNumber || "",
        isActive: true,
        isEligibleForVesting: true,
      });
      existingPlayerIds.add(playerId);
      createdCount++;
    } catch (error: any) {
      console.error(
        `[nascar_stats_sync] Failed to upsert missing NASCAR player ${playerId}:`,
        error.message,
      );
      errorCount++;
    }
  }

  return { createdCount, errorCount };
}

/**
 * Convert NASCAR race result to player game stats
 */
async function convertToPlayerGameStats(
  result: NascarRaceResult,
  seriesId: NascarSeriesId,
  raceId: number,
  raceDate: Date,
  season: string,
): Promise<{
  playerId: string;
  gameId: string;
  sport: string;
  gameDate: Date;
  week: number | null;
  season: string;
  statsJson: Record<string, any>;
  fantasyPoints: number;
}> {
  const playerId = createNascarPlayerId(result.driverId, seriesId);
  const gameId = createNascarGameId(raceId, seriesId);

  // Calculate fantasy points
  const fantasyPoints = calculateFantasyPoints(result);

  // Store all NASCAR-specific stats in JSON
  const statsJson = {
    // Race result info
    finishPosition: result.finishPosition,
    startPosition: result.startPosition,
    positionDifferential: result.positionDifferential,
    carNumber: result.carNumber,
    manufacturer: result.manufacturer,
    status: result.status,
    // Performance stats
    lapsCompleted: result.lapsCompleted,
    lapsLed: result.lapsLed,
    fastestLaps: result.fastestLaps,
    // Points
    points: result.points,
    stage1Position: result.stage1Position,
    stage2Position: result.stage2Position,
  };

  return {
    playerId,
    gameId,
    sport: NASCAR_SPORT,
    gameDate: raceDate,
    week: null, // Could derive from race number in season
    season,
    statsJson,
    fantasyPoints,
  };
}

/**
 * Sync NASCAR race results for a specific race
 */
export async function syncNascarRaceResults(
  year: number,
  seriesId: NascarSeriesId,
  raceId: number,
  raceDate: Date,
  progressCallback?: ProgressCallback,
): Promise<{ requestCount: number; recordsProcessed: number; errorCount: number }> {
  const seriesName = NASCAR_SERIES_NAMES[seriesId];
  console.log(`[nascar_stats_sync] Syncing results for race ${raceId} (${seriesName})...`);

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;

  try {
    if (raceDate.getTime() > Date.now()) {
      console.log(`[nascar_stats_sync] Race ${raceId} has not started yet, skipping result sync`);
      return { requestCount, recordsProcessed, errorCount };
    }

    // Fetch race results
    requestCount++;
    const results = await fetchRaceResults(year, seriesId, raceId);

    if (results.length === 0) {
      console.log(`[nascar_stats_sync] No results available for race ${raceId}`);
      return { requestCount, recordsProcessed: 0, errorCount: 0 };
    }

    console.log(`[nascar_stats_sync] Fetched ${results.length} driver results for race ${raceId}`);

    const ensuredPlayers = await ensureNascarPlayersForResults(results, seriesId);
    if (ensuredPlayers.createdCount > 0) {
      console.log(
        `[nascar_stats_sync] Created ${ensuredPlayers.createdCount} missing NASCAR players before stats sync for race ${raceId}`,
      );
    }
    errorCount += ensuredPlayers.errorCount;

    // Determine season string (e.g., "2024", "2025")
    const season = String(year);
    const knownPlayerIds = new Set(
      (
        await storage.getPlayersByIds(
          Array.from(
            new Set(results.map((result) => createNascarPlayerId(result.driverId, seriesId))),
          ),
        )
      ).map((player) => player.id),
    );

    // Store stats in database
    for (const result of results) {
      try {
        const statsData = await convertToPlayerGameStats(
          result,
          seriesId,
          raceId,
          raceDate,
          season,
        );

        if (!knownPlayerIds.has(statsData.playerId)) {
          console.error(
            `[nascar_stats_sync] Missing local player ${statsData.playerId}; skipping stat write for race ${raceId}`,
          );
          errorCount++;
          continue;
        }

        await storage.upsertPlayerGameStats({
          playerId: statsData.playerId,
          gameId: statsData.gameId,
          sport: statsData.sport,
          gameDate: statsData.gameDate,
          week: statsData.week,
          season: statsData.season,
          opponentTeam: "", // NASCAR doesn't have opponents in traditional sense
          homeAway: "neutral", // All races at tracks
          statsJson: statsData.statsJson,
          // NBA-specific fields (defaults for backward compatibility)
          minutes: 0,
          points: result.finishPosition, // Use finish position as proxy
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
          fantasyPoints: String(statsData.fantasyPoints),
        });

        recordsProcessed++;
      } catch (error: any) {
        console.error(
          `[nascar_stats_sync] Failed to store stats for driver ${result.driverId}:`,
          error.message,
        );
        errorCount++;
      }
    }

    const gameId = createNascarGameId(raceId, seriesId);
    // Only mark race as completed if all driver stats were successfully stored
    // to avoid presenting a "Final" race with incomplete data
    if (errorCount === 0) {
      try {
        await storage.updateDailyGameStatus(gameId, "completed");
      } catch (error: any) {
        console.error(
          `[nascar_stats_sync] Failed to mark race ${raceId} as completed:`,
          error.message,
        );
        errorCount++;
      }
    } else {
      console.warn(
        `[nascar_stats_sync] Race ${raceId} not marked as completed due to ${errorCount} driver stat write failures`,
      );
    }

    console.log(
      `[nascar_stats_sync] Completed race ${raceId}: ${recordsProcessed} driver stats stored, ${errorCount} errors`,
    );

    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
    console.error(`[nascar_stats_sync] Error syncing race ${raceId}:`, error.message);
    return { requestCount, recordsProcessed: 0, errorCount: errorCount + 1 };
  }
}

/**
 * Main stats sync job - syncs results for recent and upcoming races
 */
export async function syncNascarStats(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[nascar_stats_sync] Starting NASCAR stats sync...");

  const currentYear = new Date().getFullYear();

  let totalRequestCount = 0;
  let totalRecordsProcessed = 0;
  let totalErrorCount = 0;

  // Fetch races for the current year
  const schedule = await fetchRaceSchedule(currentYear);

  if (schedule.length === 0) {
    console.log("[nascar_stats_sync] No races found in schedule");
    return {
      requestCount: 0,
      recordsProcessed: 0,
      errorCount: 0,
    };
  }

  // Reconcile completed races from the recent lookback window so we recover any missed live writes.
  const now = new Date();
  const lookbackStart = new Date(now);
  lookbackStart.setDate(lookbackStart.getDate() - NASCAR_RESULTS_LOOKBACK_DAYS);

  const recentRaces = schedule.filter((race) => {
    const raceDate = parseNascarEtDateTime(race.race_date);
    if (!Number.isFinite(raceDate.getTime())) return false;
    return raceDate >= lookbackStart && raceDate <= now;
  });

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: `Syncing stats for ${recentRaces.length} races in the last ${NASCAR_RESULTS_LOOKBACK_DAYS} days`,
    data: {
      recentRaces: recentRaces.length,
      totalSchedule: schedule.length,
      lookbackDays: NASCAR_RESULTS_LOOKBACK_DAYS,
    },
  });

  for (const race of recentRaces) {
    // Determine series ID from the race
    const seriesId = race.series_id as NascarSeriesId;
    const raceDate = parseNascarEtDateTime(race.race_date);
    if (!Number.isFinite(raceDate.getTime())) {
      console.warn(`[nascar_stats_sync] Invalid race date for race ${race.race_id}, skipping`);
      continue;
    }

    const result = await syncNascarRaceResults(
      currentYear,
      seriesId,
      race.race_id,
      raceDate,
      progressCallback,
    );
    totalRequestCount += result.requestCount;
    totalRecordsProcessed += result.recordsProcessed;
    totalErrorCount += result.errorCount;
  }

  const success = totalErrorCount === 0;
  console.log(
    `[nascar_stats_sync] Completed NASCAR stats sync: ${totalRecordsProcessed} driver stats updated, ${totalErrorCount} errors`,
  );

  return {
    requestCount: totalRequestCount,
    recordsProcessed: totalRecordsProcessed,
    errorCount: totalErrorCount,
  };
}

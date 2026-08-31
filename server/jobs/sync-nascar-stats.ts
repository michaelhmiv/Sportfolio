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
import { mergeNascarFinalStats } from "../nascar-performance";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

const NASCAR_SPORT = "NASCAR";
const NASCAR_RESULTS_LOOKBACK_DAYS = 30;
const NASCAR_ACTIVE_PARTICIPATION_DAYS = 7;

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

function splitNascarDriverName(
  driverName: string,
  driverId: number,
): {
  firstName: string;
  lastName: string;
} {
  const normalized = driverName.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { firstName: "NASCAR", lastName: String(driverId) };
  }

  const [firstName, ...lastNameParts] = normalized.split(" ");
  return {
    firstName,
    lastName: lastNameParts.join(" "),
  };
}

function isRecentNascarParticipation(raceDate: Date): boolean {
  const activeCutoff = new Date();
  activeCutoff.setDate(activeCutoff.getDate() - NASCAR_ACTIVE_PARTICIPATION_DAYS);
  return raceDate >= activeCutoff;
}

/**
 * Race participation is an authoritative player-discovery surface. A driver may be
 * omitted from a current roster after a one-off/part-time appearance, but once the
 * NASCAR API exposes that stable driver ID Sportfolio keeps the asset permanently.
 */
async function admitNascarRaceParticipant(
  result: NascarRaceResult,
  seriesId: NascarSeriesId,
  raceDate: Date,
): Promise<string> {
  const playerId = createNascarPlayerId(result.driverId, seriesId);
  const { firstName, lastName } = splitNascarDriverName(result.driverName, result.driverId);
  const isActive = isRecentNascarParticipation(raceDate);

  await storage.upsertPlayer({
    id: playerId,
    sport: NASCAR_SPORT,
    firstName,
    lastName,
    team: NASCAR_SERIES_CODES[seriesId],
    position: "DRV",
    jerseyNumber: "",
    isActive,
    isEligibleForVesting: isActive,
  });

  return playerId;
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

  const fantasyPoints = calculateFantasyPoints(result);
  const statsJson = {
    finishPosition: result.finishPosition,
    startPosition: result.startPosition,
    positionDifferential: result.positionDifferential,
    carNumber: result.carNumber,
    manufacturer: result.manufacturer,
    status: result.status,
    lapsCompleted: result.lapsCompleted,
    lapsLed: result.lapsLed,
    fastestLaps: result.fastestLaps,
    points: result.points,
    stage1Position: result.stage1Position,
    stage2Position: result.stage2Position,
  };

  return {
    playerId,
    gameId,
    sport: NASCAR_SPORT,
    gameDate: raceDate,
    week: null,
    season,
    statsJson,
    fantasyPoints,
  };
}

/**
 * Sync NASCAR race results for a specific race.
 *
 * Authoritative race participation may admit a previously unseen stable NASCAR driver
 * ID before reconciliation writes stats. Existing assets are never deleted here.
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

    requestCount++;
    const results = await fetchRaceResults(year, seriesId, raceId);

    if (results.length === 0) {
      console.log(`[nascar_stats_sync] No results available for race ${raceId}`);
      return { requestCount, recordsProcessed: 0, errorCount: 0 };
    }

    console.log(`[nascar_stats_sync] Fetched ${results.length} driver results for race ${raceId}`);

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
          await admitNascarRaceParticipant(result, seriesId, raceDate);
          knownPlayerIds.add(statsData.playerId);
          console.log(
            `[nascar_stats_sync] Admitted authoritative race participant ${statsData.playerId} from race ${raceId}`,
          );
        }

        // The final result remains authoritative. Carry forward only explicitly safe
        // analytical context from the live row; never preserve live race-state fields.
        const existingStats = await storage.getPlayerGameStats(statsData.playerId, statsData.gameId);
        const mergedStatsJson = mergeNascarFinalStats(
          existingStats?.statsJson,
          statsData.statsJson,
        );

        await storage.upsertPlayerGameStats({
          playerId: statsData.playerId,
          gameId: statsData.gameId,
          sport: statsData.sport,
          gameDate: statsData.gameDate,
          week: statsData.week,
          season: statsData.season,
          opponentTeam: "",
          homeAway: "neutral",
          statsJson: mergedStatsJson,
          minutes: 0,
          points: result.finishPosition,
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

  const schedule = await fetchRaceSchedule(currentYear);

  if (schedule.length === 0) {
    console.log("[nascar_stats_sync] No races found in schedule");
    return {
      requestCount: 0,
      recordsProcessed: 0,
      errorCount: 0,
    };
  }

  const now = new Date();
  const lookbackStart = new Date(now);
  lookbackStart.setDate(now.getDate() - NASCAR_RESULTS_LOOKBACK_DAYS);

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

  console.log(
    `[nascar_stats_sync] Completed NASCAR stats sync: ${totalRecordsProcessed} driver stats updated, ${totalErrorCount} errors`,
  );

  return {
    requestCount: totalRequestCount,
    recordsProcessed: totalRecordsProcessed,
    errorCount: totalErrorCount,
  };
}

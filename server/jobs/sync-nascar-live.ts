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
  isNascarRaceSession,
  isNascarRaceFinished,
  countNascarLapsLed,
} from "../nascar-api";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

const NASCAR_SPORT = "NASCAR";
const NASCAR_MISSING_DRIVER_SAMPLE_LIMIT = 8;

interface NascarLiveJobResult extends JobResult {
  skippedMissingPlayers: number;
}

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

async function ensureNascarPlayersForLiveFeed(
  liveFeed: NascarLiveFeed,
  seriesId: NascarSeriesId,
): Promise<{ createdCount: number; errorCount: number; knownPlayerIds: Set<string> }> {
  const uniqueDrivers = new Map<number, NascarLiveFeed["vehicles"][number]["driver"]>();
  for (const vehicle of liveFeed.vehicles) {
    const driverId = Number(vehicle.driver?.driver_id);
    if (Number.isFinite(driverId) && driverId > 0 && !uniqueDrivers.has(driverId)) {
      uniqueDrivers.set(driverId, vehicle.driver);
    }
  }

  const playerIds = Array.from(uniqueDrivers.keys()).map((driverId) =>
    createNascarPlayerId(driverId, seriesId),
  );
  const knownPlayerIds = new Set(
    (await storage.getPlayersByIds(playerIds)).map((player) => player.id),
  );

  let createdCount = 0;
  let errorCount = 0;
  for (const [driverId, driver] of uniqueDrivers) {
    const playerId = createNascarPlayerId(driverId, seriesId);
    if (knownPlayerIds.has(playerId)) continue;

    const driverName =
      driver.full_name ||
      [driver.first_name, driver.last_name].filter(Boolean).join(" ") ||
      `Driver ${driverId}`;
    const { firstName, lastName } = splitNascarDriverName(driverName);

    try {
      await storage.upsertPlayer({
        id: playerId,
        sport: NASCAR_SPORT,
        firstName,
        lastName,
        team: NASCAR_SERIES_CODES[seriesId],
        position: "DRV",
        jerseyNumber: "",
        isActive: true,
        isEligibleForVesting: true,
      });
      knownPlayerIds.add(playerId);
      createdCount++;
    } catch (error: any) {
      console.error(
        `[nascar_live_sync] Failed to upsert missing live driver ${playerId}:`,
        error.message,
      );
      errorCount++;
    }
  }

  return { createdCount, errorCount, knownPlayerIds };
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
    const lapsLedCount = countNascarLapsLed(vehicle.laps_led, liveFeed.lap_number);
    const fastestLaps = Math.max(0, Number(vehicle.fastest_laps_run) || 0);

    // Calculate live fantasy points
    let liveFantasyPoints = 0;
    liveFantasyPoints += (41 - vehicle.running_position) * 2.5; // Position points
    if (vehicle.running_position === 1) liveFantasyPoints += 25; // Leader bonus
    if (lapsLedCount > 0) {
      liveFantasyPoints += 15; // Led a lap
      liveFantasyPoints += lapsLedCount * 0.5; // Laps led bonus
    }
    if (fastestLaps > 0) liveFantasyPoints += fastestLaps * 2;
    liveFantasyPoints = Math.round(liveFantasyPoints * 100) / 100;

    const playerId = createNascarPlayerId(vehicle.driver.driver_id, seriesId);

    const statsJson = {
      // Live position data
      runningPosition: vehicle.running_position,
      startingPosition: vehicle.starting_position,
      positionDifferential: vehicle.starting_position - vehicle.running_position,
      positionImproved: vehicle.laps_position_improved ?? null,
      // Lap data
      lapsCompleted: vehicle.laps_completed,
      lapsLed: lapsLedCount,
      lapsLedCount,
      lapsLedSegments: vehicle.laps_led,
      fastestLaps,
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
      driverId: vehicle.driver.driver_id,
      driverName: vehicle.driver.full_name,
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
      runType: liveFeed.run_type,
      seriesId: liveFeed.series_id,
      runId: liveFeed.run_id,
      stage: liveFeed.stage,
      numberOfCautionSegments: liveFeed.number_of_caution_segments,
      numberOfLeadChanges: liveFeed.number_of_lead_changes,
      numberOfLeaders: liveFeed.number_of_leaders,
      avgDiff1to3: liveFeed.avg_diff_1to3,
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
  liveFeedOverride?: NascarLiveFeed | null,
): Promise<{
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
  skippedMissingPlayers: number;
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
  let skippedMissingPlayers = 0;
  let isLive = false;
  let raceInfo = null;

  try {
    const liveFeed =
      liveFeedOverride ??
      (await (async () => {
        requestCount++;
        return fetchLiveFeed(seriesId);
      })());

    if (!liveFeed) {
      console.log(`[nascar_live_sync] No live race for ${seriesName}`);
      return {
        requestCount,
        recordsProcessed: 0,
        errorCount: 0,
        skippedMissingPlayers: 0,
        isLive: false,
        raceInfo: null,
      };
    }

    // Check if this is the series we're looking for
    if (liveFeed.series_id !== seriesId) {
      console.log(
        `[nascar_live_sync] Live race is for series ${liveFeed.series_id}, not ${seriesId}`,
      );
      return {
        requestCount,
        recordsProcessed: 0,
        errorCount: 0,
        skippedMissingPlayers: 0,
        isLive: false,
        raceInfo: null,
      };
    }

    const gameId = createNascarGameId(liveFeed.race_id, seriesId);

    // Ignore practice/qualifying sessions. They can publish position-like data that is not race-final.
    if (!isNascarRaceSession(liveFeed.run_type)) {
      console.log(
        `[nascar_live_sync] Ignoring non-race session for ${seriesName}: run_type=${liveFeed.run_type}, run_name="${liveFeed.run_name}"`,
      );

      // Self-heal previously misclassified statuses from non-race sessions.
      try {
        const game = await storage.getDailyGameByGameId(gameId);
        if (game) {
          const startMs = new Date(game.startTime).getTime();
          const safeStatus =
            Number.isFinite(startMs) && startMs > Date.now() ? "scheduled" : "inprogress";
          const currentStatus = String(game.status || "").toLowerCase();

          if (currentStatus !== safeStatus) {
            await storage.updateDailyGameStatus(gameId, safeStatus);
            console.warn(
              `[nascar_live_sync] Reset game ${gameId} status from ${currentStatus || "(empty)"} to ${safeStatus} after non-race session`,
            );
          }
        }
      } catch (error: any) {
        console.error(`[nascar_live_sync] Failed status repair for ${gameId}:`, error.message);
      }

      return {
        requestCount,
        recordsProcessed: 0,
        errorCount: 0,
        skippedMissingPlayers: 0,
        isLive: false,
        raceInfo: null,
      };
    }

    isLive = true;
    const flagStateDesc = getFlagStateDescription(liveFeed.flag_state);
    const isRaceFinished = isNascarRaceFinished(liveFeed);

    // Update the dailyGames status - mark as completed if checkered flag, otherwise inprogress
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
    const ensuredPlayers = await ensureNascarPlayersForLiveFeed(liveFeed, seriesId);
    const knownPlayerIds = ensuredPlayers.knownPlayerIds;
    if (ensuredPlayers.createdCount > 0) {
      console.log(
        `[nascar_live_sync] Created ${ensuredPlayers.createdCount} missing live NASCAR drivers for ${seriesName}`,
      );
    }
    errorCount += ensuredPlayers.errorCount;

    const statsData = await convertLiveFeedToStats(liveFeed, seriesId);
    const missingPlayerSamples = new Set<string>();

    // Store stats in database
    for (const stats of statsData) {
      try {
        if (!knownPlayerIds.has(stats.playerId)) {
          skippedMissingPlayers++;
          if (missingPlayerSamples.size < NASCAR_MISSING_DRIVER_SAMPLE_LIMIT) {
            missingPlayerSamples.add(stats.playerId.replace(/^nascar_/, ""));
          }
          continue;
        }

        await storage.upsertPlayerGameStats(stats);
        recordsProcessed++;
      } catch (error: any) {
        console.error(`[nascar_live_sync] Failed to store live stats for driver:`, error.message);
        errorCount++;
      }
    }

    if (skippedMissingPlayers > 0) {
      console.log(
        `[nascar_live_sync] Skipped ${skippedMissingPlayers} live stat rows for drivers missing from the local roster` +
          (missingPlayerSamples.size > 0
            ? ` (sample driver ids: ${Array.from(missingPlayerSamples).join(", ")})`
            : ""),
      );
    }

    console.log(
      `[nascar_live_sync] Completed live sync for ${seriesName}: ${recordsProcessed} driver stats updated`,
    );

    return {
      requestCount,
      recordsProcessed,
      errorCount,
      skippedMissingPlayers,
      isLive: true,
      raceInfo,
    };
  } catch (error: any) {
    console.error(`[nascar_live_sync] Error syncing live data for ${seriesName}:`, error.message);
    return {
      requestCount,
      recordsProcessed: 0,
      errorCount: errorCount + 1,
      skippedMissingPlayers,
      isLive: false,
      raceInfo: null,
    };
  }
}

/**
 * Main live sync job - syncs live data for all series
 * Note: This should be run more frequently during race events
 */
export async function syncNascarLive(
  progressCallback?: ProgressCallback,
): Promise<NascarLiveJobResult> {
  console.log("[nascar_live_sync] Starting NASCAR live stats sync...");

  const seriesList: NascarSeriesId[] = [
    NASCAR_SERIES.CUP,
    NASCAR_SERIES.XFINITY,
    NASCAR_SERIES.TRUCKS,
  ];

  let totalRequestCount = 0;
  let totalRecordsProcessed = 0;
  let totalErrorCount = 0;
  let totalSkippedMissingPlayers = 0;
  let liveRacesFound = 0;
  const liveRaceInfo: { series: string; info: any }[] = [];
  let sharedLiveFeed: NascarLiveFeed | null = null;

  try {
    totalRequestCount++;
    sharedLiveFeed = await fetchLiveFeed();
  } catch (error: any) {
    console.error("[nascar_live_sync] Failed to fetch shared live feed:", error.message);
    return {
      requestCount: totalRequestCount,
      recordsProcessed: 0,
      errorCount: 1,
      skippedMissingPlayers: 0,
    };
  }

  for (const seriesId of seriesList) {
    const seriesName = NASCAR_SERIES_NAMES[seriesId];
    const result = await syncNascarLiveForSeries(seriesId, progressCallback, sharedLiveFeed);

    totalRequestCount += result.requestCount;
    totalRecordsProcessed += result.recordsProcessed;
    totalErrorCount += result.errorCount;
    totalSkippedMissingPlayers += result.skippedMissingPlayers;

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
    skippedMissingPlayers: totalSkippedMissingPlayers,
  };
}

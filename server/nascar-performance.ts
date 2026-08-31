import type { NascarWeekendFeed } from "./nascar-api";

export interface NascarPerformanceMetrics {
  averageRunningPosition: number | null;
  averageSpeed: number | null;
  resultPosition: number | null;
  resultDelta: number | null;
  fastLapPct: number | null;
  passesMade: number | null;
  timesPassed: number | null;
  passingDifferential: number | null;
  qualityPasses: number | null;
  top15Laps: number | null;
  top15Pct: number | null;
  driverRating: number | null;
  averageRestartSpeed: number | null;
}

export interface NascarWeekendSessionResult {
  sessionName: string;
  position: number | null;
  bestLapSpeed: number | null;
  bestLapTime: string | null;
  bestLapNumber: number | null;
}

export interface NascarWeekendDriverContext {
  playerId: string;
  driverId: number;
  driverName: string;
  practice: NascarWeekendSessionResult | null;
  qualifying: NascarWeekendSessionResult | null;
  startingPosition: number | null;
}

type JsonRecord = Record<string, any>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function positiveNumberOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function roundMetric(value: number | null, digits = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return roundMetric((numerator / denominator) * 100, 1);
}

/**
 * Normalizes NASCAR performance context from either a provider vehicle payload,
 * the existing flat statsJson shape, or the additive nested performance shape.
 * None of these metrics participate in Sportfolio scoring.
 */
export function deriveNascarPerformance(source: unknown): NascarPerformanceMetrics {
  const root = asRecord(source);
  const nested = asRecord(root.performance);

  const averageRunningPosition = firstNumber(
    nested.averageRunningPosition,
    root.averageRunningPosition,
    root.average_running_position,
  );
  const averageSpeed = firstNumber(nested.averageSpeed, root.averageSpeed, root.average_speed);
  const finishPosition = positiveNumberOrNull(root.finishPosition ?? root.finish_position);
  const runningPosition = positiveNumberOrNull(root.runningPosition ?? root.running_position);
  const resultPosition = firstNumber(nested.resultPosition, finishPosition, runningPosition);
  const lapsCompleted = firstNumber(root.lapsCompleted, root.laps_completed);
  const fastestLaps = firstNumber(
    root.fastestLaps,
    root.fastest_laps_run,
    nested.fastestLaps,
  );
  const passesMade = firstNumber(
    nested.passesMade,
    root.passesMade,
    root.passes_made,
    root.greenFlagPasses,
    root.green_flag_passes,
  );
  const timesPassed = firstNumber(
    nested.timesPassed,
    root.timesPassed,
    root.times_passed,
    root.greenFlagTimesPassed,
    root.green_flag_times_passed,
  );
  const explicitPassingDifferential = firstNumber(
    nested.passingDifferential,
    root.passingDifferential,
    root.passing_differential,
  );
  const passingDifferential =
    explicitPassingDifferential ??
    (passesMade !== null && timesPassed !== null ? passesMade - timesPassed : null);
  const qualityPasses = firstNumber(
    nested.qualityPasses,
    root.qualityPasses,
    root.quality_passes,
  );
  const top15Laps = firstNumber(
    nested.top15Laps,
    root.top15Laps,
    root.top_15_laps,
    root.lapsInTop15,
    root.laps_in_top_15,
  );
  const driverRating = firstNumber(
    nested.driverRating,
    root.driverRating,
    root.driver_rating,
  );
  const averageRestartSpeed = firstNumber(
    nested.averageRestartSpeed,
    root.averageRestartSpeed,
    root.average_restart_speed,
  );

  return {
    averageRunningPosition: roundMetric(averageRunningPosition, 1),
    averageSpeed: roundMetric(averageSpeed, 1),
    resultPosition,
    resultDelta:
      averageRunningPosition !== null && resultPosition !== null
        ? roundMetric(averageRunningPosition - resultPosition, 1)
        : null,
    fastLapPct: percent(fastestLaps, lapsCompleted),
    passesMade,
    timesPassed,
    passingDifferential,
    qualityPasses,
    top15Laps,
    top15Pct: percent(top15Laps, lapsCompleted),
    driverRating: roundMetric(driverRating, 1),
    averageRestartSpeed: roundMetric(averageRestartSpeed, 1),
  };
}

const SAFE_FLAT_ANALYTICS_KEYS = [
  "averageRunningPosition",
  "averageSpeed",
  "bestLap",
  "bestLapSpeed",
  "bestLapTime",
  "positionImproved",
  "passesMade",
  "timesPassed",
  "passingDifferential",
  "qualityPasses",
  "top15Laps",
  "driverRating",
  "averageRestartSpeed",
] as const;

/**
 * Final NASCAR results are authoritative for scoring/result fields. This merge only
 * carries forward safe analytical context captured during the live race and purposely
 * does not copy live race-state fields such as runningPosition, flagState, lapsToGo,
 * delta, stage, or isOnTrack into the finalized row.
 */
export function mergeNascarFinalStats(
  existingStatsJson: unknown,
  finalStatsJson: Record<string, any>,
): Record<string, any> {
  const existing = asRecord(existingStatsJson);
  const merged: Record<string, any> = { ...finalStatsJson };

  for (const key of SAFE_FLAT_ANALYTICS_KEYS) {
    if (merged[key] == null && existing[key] != null) {
      merged[key] = existing[key];
    }
  }

  const performance = deriveNascarPerformance({
    ...existing,
    ...merged,
    performance: {
      ...asRecord(existing.performance),
      ...asRecord(finalStatsJson.performance),
    },
  });

  merged.performance = performance;
  return merged;
}

function normalizeSessionResult(
  sessionName: string,
  vehicle: any,
): NascarWeekendSessionResult {
  return {
    sessionName,
    position: positiveNumberOrNull(vehicle?.running_position),
    bestLapSpeed: roundMetric(numberOrNull(vehicle?.best_lap_speed), 1),
    bestLapTime:
      vehicle?.best_lap_time != null && String(vehicle.best_lap_time).trim()
        ? String(vehicle.best_lap_time)
        : null,
    bestLapNumber: positiveNumberOrNull(vehicle?.best_lap),
  };
}

/**
 * Builds per-driver weekend context without treating practice or qualifying as a race.
 * For multi-round qualifying, each driver's latest session in which they recorded a
 * result wins, so drivers eliminated in an earlier round still retain a result.
 */
export function buildNascarWeekendDriverContexts(
  weekend: NascarWeekendFeed | null,
): NascarWeekendDriverContext[] {
  if (!weekend?.sessions?.length) return [];

  const contexts = new Map<number, NascarWeekendDriverContext>();
  const getContext = (vehicle: any): NascarWeekendDriverContext | null => {
    const driverId = positiveNumberOrNull(vehicle?.driver?.driver_id);
    if (!driverId) return null;
    const existing = contexts.get(driverId);
    if (existing) return existing;

    const driverName = String(vehicle?.driver?.full_name || `Driver ${driverId}`).trim();
    const created: NascarWeekendDriverContext = {
      playerId: `nascar_${driverId}`,
      driverId,
      driverName,
      practice: null,
      qualifying: null,
      startingPosition: null,
    };
    contexts.set(driverId, created);
    return created;
  };

  for (const session of weekend.sessions) {
    for (const vehicle of session.vehicles || []) {
      const context = getContext(vehicle);
      if (!context) continue;

      if (session.runType === 1) {
        context.practice = normalizeSessionResult(session.runName || "Practice", vehicle);
      } else if (session.runType === 2) {
        context.qualifying = normalizeSessionResult(session.runName || "Qualifying", vehicle);
      } else if (session.runType === 3) {
        context.startingPosition = positiveNumberOrNull(vehicle?.starting_position);
      }
    }
  }

  return Array.from(contexts.values()).sort((a, b) => a.driverName.localeCompare(b.driverName));
}

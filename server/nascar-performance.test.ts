import { describe, expect, it } from "vitest";

import { calculateFantasyPoints } from "./nascar-api";
import {
  buildNascarWeekendDriverContexts,
  deriveNascarPerformance,
  mergeNascarFinalStats,
} from "./nascar-performance";

describe("deriveNascarPerformance", () => {
  it("derives result delta, fast-lap rate, passing differential, and top-15 rate", () => {
    expect(
      deriveNascarPerformance({
        finishPosition: 6,
        averageRunningPosition: 18.6,
        lapsCompleted: 200,
        fastestLaps: 16,
        passesMade: 87,
        timesPassed: 52,
        top15Laps: 164,
        driverRating: 104.25,
      }),
    ).toMatchObject({
      averageRunningPosition: 18.6,
      resultPosition: 6,
      resultDelta: 12.6,
      fastLapPct: 8,
      passesMade: 87,
      timesPassed: 52,
      passingDifferential: 35,
      top15Laps: 164,
      top15Pct: 82,
      driverRating: 104.3,
    });
  });

  it("handles missing and zero-denominator provider data without NaN", () => {
    const metrics = deriveNascarPerformance({
      running_position: 8,
      laps_completed: 0,
      fastest_laps_run: 5,
      passes_made: 10,
    });

    expect(metrics.resultPosition).toBe(8);
    expect(metrics.fastLapPct).toBeNull();
    expect(metrics.top15Pct).toBeNull();
    expect(metrics.passingDifferential).toBeNull();
    expect(Object.values(metrics).some((value) => typeof value === "number" && Number.isNaN(value))).toBe(
      false,
    );
  });
});

describe("mergeNascarFinalStats", () => {
  it("preserves safe analytics while keeping final result fields authoritative", () => {
    const merged = mergeNascarFinalStats(
      {
        runningPosition: 2,
        averageRunningPosition: 5.8,
        averageSpeed: 147.2,
        bestLapSpeed: 181.4,
        delta: 0.4,
        flagState: 1,
        lapsToGo: 10,
        isOnTrack: true,
        lapsCompleted: 190,
        fastestLaps: 12,
        performance: {
          resultPosition: 2,
          averageRunningPosition: 5.8,
        },
      },
      {
        finishPosition: 27,
        startPosition: 12,
        positionDifferential: -15,
        lapsCompleted: 200,
        lapsLed: 18,
        fastestLaps: 14,
        status: "Finished",
        points: 10,
      },
    );

    expect(merged.finishPosition).toBe(27);
    expect(merged.lapsCompleted).toBe(200);
    expect(merged.fastestLaps).toBe(14);
    expect(merged.averageRunningPosition).toBe(5.8);
    expect(merged.performance).toMatchObject({
      averageRunningPosition: 5.8,
      resultPosition: 27,
      resultDelta: -21.2,
      fastLapPct: 7,
    });

    expect(merged).not.toHaveProperty("runningPosition");
    expect(merged).not.toHaveProperty("delta");
    expect(merged).not.toHaveProperty("flagState");
    expect(merged).not.toHaveProperty("lapsToGo");
    expect(merged).not.toHaveProperty("isOnTrack");
  });
});

describe("buildNascarWeekendDriverContexts", () => {
  it("keeps practice/qualifying separate and retains each driver's latest qualifying round", () => {
    const drivers = buildNascarWeekendDriverContexts({
      raceId: 6001,
      seriesId: 1,
      trackId: 1,
      trackName: "Test Speedway",
      raceName: "Test 400",
      date: "2026-09-06",
      sessions: [
        {
          runId: 1,
          runName: "Practice",
          runType: 1,
          status: "completed",
          scheduledStartTime: "",
          laps: 10,
          vehicles: [
            {
              driver: { driver_id: 10, full_name: "Driver One" },
              running_position: 4,
              best_lap_speed: 176.84,
              best_lap_time: "30.100",
              best_lap: 6,
            },
          ],
        },
        {
          runId: 2,
          runName: "Qualifying Round 1",
          runType: 2,
          status: "completed",
          scheduledStartTime: "",
          laps: 1,
          vehicles: [
            {
              driver: { driver_id: 10, full_name: "Driver One" },
              running_position: 9,
              best_lap_speed: 178.1,
              best_lap_time: "29.900",
              best_lap: 1,
            },
            {
              driver: { driver_id: 11, full_name: "Driver Two" },
              running_position: 18,
              best_lap_speed: 176.2,
              best_lap_time: "30.200",
              best_lap: 1,
            },
          ],
        },
        {
          runId: 3,
          runName: "Qualifying Round 2",
          runType: 2,
          status: "completed",
          scheduledStartTime: "",
          laps: 1,
          vehicles: [
            {
              driver: { driver_id: 10, full_name: "Driver One" },
              running_position: 7,
              best_lap_speed: 178.6,
              best_lap_time: "29.800",
              best_lap: 1,
            },
          ],
        },
      ] as any,
    });

    expect(drivers.find((driver) => driver.driverId === 10)).toMatchObject({
      practice: { position: 4, bestLapSpeed: 176.8 },
      qualifying: { sessionName: "Qualifying Round 2", position: 7, bestLapSpeed: 178.6 },
      startingPosition: null,
    });
    expect(drivers.find((driver) => driver.driverId === 11)).toMatchObject({
      qualifying: { sessionName: "Qualifying Round 1", position: 18, bestLapSpeed: 176.2 },
      startingPosition: null,
    });
  });
});

describe("NASCAR fantasy scoring regression", () => {
  it("keeps the existing final-race fantasy formula unchanged", () => {
    const points = calculateFantasyPoints({
      driverId: 10,
      driverName: "Regression Driver",
      carNumber: "10",
      manufacturer: "Frd",
      finishPosition: 3,
      startPosition: 12,
      positionDifferential: 9,
      lapsCompleted: 200,
      lapsLed: 20,
      fastestLaps: 8,
      points: 34,
      status: "Finished",
    });

    // 95 base + 10 top-3 + 5 top-10 + 15 led-a-lap + 10 laps-led + 16 fast laps.
    expect(points).toBe(151);
  });
});

import { describe, expect, it } from "vitest";

import {
  countNascarLapsLed,
  mapEnhancedResultsToRaceResults,
  normalizeEnhancedNascarDriverId,
} from "./nascar-api";

describe("mapEnhancedResultsToRaceResults", () => {
  it("maps completed enhanced results payloads into race results", () => {
    const mapped = mapEnhancedResultsToRaceResults(
      {
        RunData: [
          {
            RaceID: 5621,
            RunType: 3,
            LapsToGo: 0,
            FlagState: "Finish",
          },
        ],
        Results: [
          {
            Number: "97",
            Manufacturer: "Chv",
            DriverNameTag: "Shane van Gisbergen",
            DriverID: 8803,
            NASCARDriverID: 4469,
            RunningPos: 1,
            StartPos: 1,
            LapsLed: 74,
            FastestLapsRun: 34,
            PointsThisRace: 68,
            Status: "Finished",
            CompLaps: 100,
          },
          {
            Number: "71",
            Manufacturer: "Chv",
            DriverNameTag: "Second Driver",
            DriverID: 1002,
            NASCARDriverID: 4102,
            RunningPos: 2,
            StartPos: 7,
            LapsLed: 0,
            FastestLapsRun: 4,
            PointsThisRace: 35,
            Status: "Finished",
            CompLaps: 100,
          },
        ],
      },
      5621,
    );

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({
      driverId: 4469,
      driverName: "Shane van Gisbergen",
      carNumber: "97",
      manufacturer: "Chv",
      finishPosition: 1,
      startPosition: 1,
      lapsCompleted: 100,
      lapsLed: 74,
      fastestLaps: 34,
      points: 68,
      status: "Finished",
    });
    expect(mapped[1]).toMatchObject({
      driverId: 4102,
      finishPosition: 2,
      startPosition: 7,
      positionDifferential: 5,
    });
  });

  it("uses DriverID as fallback when NASCARDriverID is sparse and skips rows with no IDs", () => {
    const mapped = mapEnhancedResultsToRaceResults(
      {
        RunData: [
          {
            RaceID: 5606,
            RunType: 3,
            LapsToGo: 0,
            FlagState: "Not Active",
          },
        ],
        Results: [
          {
            Number: "12",
            Manufacturer: "Frd",
            DriverFirstName: "Fallback",
            DriverLastName: "Driver",
            DriverID: 9123,
            NASCARDriverID: "",
            RunningPos: 15,
            StartPos: 20,
            LapsLed: 0,
            FastestLapsRun: 1,
            Status: "",
            iStatus: 1,
            CompLaps: 400,
          },
          {
            Number: "00",
            Manufacturer: "Chv",
            DriverNameTag: "Missing ID",
            RunningPos: 16,
            StartPos: 10,
            LapsLed: 0,
            CompLaps: 400,
          },
        ],
      },
      5606,
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0].driverId).toBe(9123);
    expect(mapped[0].driverName).toBe("Fallback Driver");
    expect(mapped[0].status).toBe("Running");
  });

  it("returns no rows when enhanced run is still live", () => {
    const mapped = mapEnhancedResultsToRaceResults(
      {
        RunData: [
          {
            RaceID: 5621,
            RunType: 3,
            LapsToGo: 23,
            FlagState: "Green",
          },
        ],
        Results: [
          {
            Number: "97",
            DriverID: 8803,
            NASCARDriverID: 4469,
            RunningPos: 1,
            StartPos: 1,
          },
        ],
      },
      5621,
    );

    expect(mapped).toEqual([]);
  });
});

describe("normalizeEnhancedNascarDriverId", () => {
  it("prefers NASCARDriverID and falls back to DriverID", () => {
    expect(normalizeEnhancedNascarDriverId({ NASCARDriverID: 4469, DriverID: 8803 })).toBe(4469);
    expect(normalizeEnhancedNascarDriverId({ NASCARDriverID: "", DriverID: 8803 })).toBe(8803);
    expect(normalizeEnhancedNascarDriverId({ NASCARDriverID: null, DriverID: null })).toBeNull();
  });
});

describe("countNascarLapsLed", () => {
  it("counts legacy per-lap arrays and current range segment arrays", () => {
    expect(countNascarLapsLed([1, 2, 3], 10)).toBe(3);
    expect(
      countNascarLapsLed(
        [
          { start_lap: 55, end_lap: 75 },
          { start_lap: 86, end_lap: 95 },
        ],
        95,
      ),
    ).toBe(31);
  });

  it("uses the current lap when a live segment has no end lap", () => {
    expect(countNascarLapsLed([{ start_lap: 90 }], 95)).toBe(6);
    expect(countNascarLapsLed([{ start_lap: 90 }], null)).toBe(0);
  });
});

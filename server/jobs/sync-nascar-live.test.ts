import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  updateDailyGameStatus: vi.fn(),
  upsertPlayerGameStats: vi.fn(),
  upsertPlayer: vi.fn(),
  getDailyGameByGameId: vi.fn(),
  getPlayersByIds: vi.fn(),
}));

const nascarApiMocks = vi.hoisted(() => ({
  fetchLiveFeed: vi.fn(),
  getFlagStateDescription: vi.fn(),
  isNascarRaceFinished: vi.fn(),
  isNascarRaceSession: vi.fn(),
  countNascarLapsLed: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    updateDailyGameStatus: storageMocks.updateDailyGameStatus,
    upsertPlayerGameStats: storageMocks.upsertPlayerGameStats,
    upsertPlayer: storageMocks.upsertPlayer,
    getDailyGameByGameId: storageMocks.getDailyGameByGameId,
    getPlayersByIds: storageMocks.getPlayersByIds,
  },
}));

vi.mock("../nascar-api", () => ({
  NASCAR_SERIES: {
    CUP: 1,
    XFINITY: 2,
    TRUCKS: 3,
  },
  NASCAR_SERIES_NAMES: {
    1: "Cup Series",
    2: "Xfinity Series",
    3: "Truck Series",
  },
  NASCAR_SERIES_CODES: {
    1: "NCS",
    2: "NXS",
    3: "NTS",
  },
  fetchLiveFeed: nascarApiMocks.fetchLiveFeed,
  getFlagStateDescription: nascarApiMocks.getFlagStateDescription,
  isNascarRaceFinished: nascarApiMocks.isNascarRaceFinished,
  isNascarRaceSession: nascarApiMocks.isNascarRaceSession,
  countNascarLapsLed: nascarApiMocks.countNascarLapsLed,
}));

function buildLiveFeed(overrides?: Record<string, unknown>): any {
  return {
    race_id: 5637,
    run_id: 999,
    series_id: 2,
    track_id: 1,
    track_name: "Phoenix Raceway",
    track_length: 1,
    lap_number: 1,
    elapsed_time: 0,
    laps_in_race: 200,
    laps_to_go: 199,
    run_name: "GOVX 200",
    run_type: 3,
    flag_state: 1,
    number_of_caution_segments: 0,
    number_of_lead_changes: 0,
    number_of_leaders: 0,
    avg_diff_1to3: 0,
    stage: null,
    vehicles: [
      {
        vehicle_id: 1,
        vehicle_number: "1",
        vehicle_manufacturer: "Chv",
        driver: {
          driver_id: 1234,
          full_name: "Driver One",
          first_name: "Driver",
          last_name: "One",
        },
        running_position: 1,
        starting_position: 2,
        position_differential_last_10_percent: 0,
        laps_completed: 1,
        laps_led: [1],
        average_running_position: 1,
        average_speed: 120,
        best_lap: 1,
        best_lap_speed: 120,
        best_lap_time: "30.0",
        delta: 0,
        pit_stops: [],
        is_on_track: true,
        is_on_dvp: false,
      },
    ],
    ...overrides,
  };
}

describe("syncNascarLiveForSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nascarApiMocks.getFlagStateDescription.mockReturnValue("Final");
    nascarApiMocks.countNascarLapsLed.mockReturnValue(1);
    storageMocks.getPlayersByIds.mockResolvedValue([{ id: "nascar_1234" }]);
    storageMocks.upsertPlayer.mockResolvedValue(undefined);
  });

  it("ignores qualifying/practice sessions and repairs status away from completed", async () => {
    nascarApiMocks.fetchLiveFeed.mockResolvedValue(
      buildLiveFeed({
        run_type: 2,
        run_name: "GOVX 200 Kennametal Pole Qualifying",
        flag_state: 9,
      }),
    );
    nascarApiMocks.isNascarRaceSession.mockReturnValue(false);
    storageMocks.getDailyGameByGameId.mockResolvedValue({
      gameId: "nascar_NXS_5637",
      status: "completed",
      startTime: new Date(Date.now() + 60 * 60 * 1000),
    });

    const { syncNascarLiveForSeries } = await import("./sync-nascar-live");
    const result = await syncNascarLiveForSeries(2 as any);

    expect(result.isLive).toBe(false);
    expect(storageMocks.updateDailyGameStatus).toHaveBeenCalledWith("nascar_NXS_5637", "scheduled");
    expect(storageMocks.upsertPlayerGameStats).not.toHaveBeenCalled();
  });

  it("processes race sessions and includes runType in persisted stats", async () => {
    nascarApiMocks.fetchLiveFeed.mockResolvedValue(buildLiveFeed({ run_type: 3, flag_state: 4 }));
    nascarApiMocks.isNascarRaceSession.mockReturnValue(true);
    nascarApiMocks.isNascarRaceFinished.mockReturnValue(true);

    const { syncNascarLiveForSeries } = await import("./sync-nascar-live");
    const result = await syncNascarLiveForSeries(2 as any);

    expect(result.isLive).toBe(true);
    expect(storageMocks.updateDailyGameStatus).toHaveBeenCalledWith("nascar_NXS_5637", "completed");
    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledTimes(1);

    const [firstCallArg] = storageMocks.upsertPlayerGameStats.mock.calls[0];
    expect(firstCallArg.statsJson.runType).toBe(3);
  });

  it("upserts missing local drivers before writing live stats", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    nascarApiMocks.fetchLiveFeed.mockResolvedValue(
      buildLiveFeed({
        run_type: 3,
        vehicles: [
          buildLiveFeed().vehicles[0],
          {
            ...buildLiveFeed().vehicles[0],
            driver: {
              driver_id: 9999,
              full_name: "Driver Two",
              first_name: "Driver",
              last_name: "Two",
            },
          },
        ],
      }),
    );
    nascarApiMocks.isNascarRaceSession.mockReturnValue(true);
    nascarApiMocks.isNascarRaceFinished.mockReturnValue(false);
    storageMocks.getPlayersByIds.mockResolvedValue([{ id: "nascar_1234" }]);

    const { syncNascarLiveForSeries } = await import("./sync-nascar-live");
    const result = await syncNascarLiveForSeries(2 as any);

    expect(storageMocks.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "nascar_9999",
        sport: "NASCAR",
        firstName: "Driver",
        lastName: "Two",
        team: "NXS",
      }),
    );
    expect(result.recordsProcessed).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(result.skippedMissingPlayers).toBe(0);
    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Created 1 missing live NASCAR drivers for Xfinity Series"),
    );

    logSpy.mockRestore();
  });
});

describe("syncNascarLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nascarApiMocks.getFlagStateDescription.mockReturnValue("Green");
    nascarApiMocks.countNascarLapsLed.mockReturnValue(1);
    nascarApiMocks.isNascarRaceSession.mockReturnValue(true);
    nascarApiMocks.isNascarRaceFinished.mockReturnValue(false);
    storageMocks.getPlayersByIds.mockResolvedValue([{ id: "nascar_1234" }]);
    storageMocks.upsertPlayer.mockResolvedValue(undefined);
  });

  it("fetches the proxied live feed once and reuses it across series checks", async () => {
    nascarApiMocks.fetchLiveFeed.mockResolvedValue(buildLiveFeed({ series_id: 2, run_type: 3 }));

    const { syncNascarLive } = await import("./sync-nascar-live");
    const result = await syncNascarLive();

    expect(nascarApiMocks.fetchLiveFeed).toHaveBeenCalledTimes(1);
    expect(nascarApiMocks.fetchLiveFeed).toHaveBeenCalledWith();
    expect(result.requestCount).toBe(1);
    expect(result.recordsProcessed).toBe(1);
    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledTimes(1);
    expect(storageMocks.updateDailyGameStatus).toHaveBeenCalledWith(
      "nascar_NXS_5637",
      "inprogress",
    );
  });
});

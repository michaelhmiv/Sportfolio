import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getPlayersByIds: vi.fn(),
  upsertPlayer: vi.fn(),
  upsertPlayerGameStats: vi.fn(),
  updateDailyGameStatus: vi.fn(),
}));

const nascarApiMocks = vi.hoisted(() => ({
  fetchRaceResults: vi.fn(),
  fetchRaceSchedule: vi.fn(),
  calculateFantasyPoints: vi.fn(),
  parseNascarEtDateTime: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getPlayersByIds: storageMocks.getPlayersByIds,
    upsertPlayer: storageMocks.upsertPlayer,
    upsertPlayerGameStats: storageMocks.upsertPlayerGameStats,
    updateDailyGameStatus: storageMocks.updateDailyGameStatus,
  },
}));

vi.mock("../nascar-api", () => ({
  fetchRaceResults: nascarApiMocks.fetchRaceResults,
  fetchRaceSchedule: nascarApiMocks.fetchRaceSchedule,
  calculateFantasyPoints: nascarApiMocks.calculateFantasyPoints,
  parseNascarEtDateTime: nascarApiMocks.parseNascarEtDateTime,
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
}));

function buildResult(overrides?: Record<string, unknown>) {
  return {
    driverId: 4469,
    driverName: "Shane van Gisbergen",
    carNumber: "97",
    manufacturer: "Chv",
    finishPosition: 1,
    startPosition: 1,
    positionDifferential: 0,
    lapsCompleted: 100,
    lapsLed: 74,
    fastestLaps: 34,
    points: 68,
    status: "Finished",
    ...overrides,
  };
}

function buildRaceListItem(overrides?: Record<string, unknown>) {
  return {
    race_id: 5621,
    series_id: 1,
    race_date: "2026-05-10T19:00:00.000Z",
    ...overrides,
  };
}

describe("syncNascarRaceResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nascarApiMocks.fetchRaceResults.mockResolvedValue([buildResult()]);
    nascarApiMocks.calculateFantasyPoints.mockReturnValue(42.5);
    storageMocks.getPlayersByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id })),
    );
    storageMocks.upsertPlayer.mockResolvedValue(undefined);
    storageMocks.upsertPlayerGameStats.mockResolvedValue(undefined);
    storageMocks.updateDailyGameStatus.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes race stats for an already admitted permanent driver asset", async () => {
    const { syncNascarRaceResults } = await import("./sync-nascar-stats");
    const result = await syncNascarRaceResults(
      2026,
      1 as any,
      5621,
      new Date("2026-05-10T22:00:00.000Z"),
    );

    expect(storageMocks.upsertPlayer).not.toHaveBeenCalled();
    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledTimes(1);
    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: "nascar_4469",
        gameId: "nascar_NCS_5621",
      }),
    );
    expect(storageMocks.updateDailyGameStatus).toHaveBeenCalledWith("nascar_NCS_5621", "completed");
    expect(result).toMatchObject({
      requestCount: 1,
      recordsProcessed: 1,
      errorCount: 0,
    });
  });

  it("admits an unseen historical race participant as a permanent inactive asset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    storageMocks.getPlayersByIds.mockResolvedValue([]);

    const { syncNascarRaceResults } = await import("./sync-nascar-stats");
    const result = await syncNascarRaceResults(
      2026,
      1 as any,
      5621,
      new Date("2026-05-10T22:00:00.000Z"),
    );

    expect(storageMocks.upsertPlayer).toHaveBeenCalledWith({
      id: "nascar_4469",
      sport: "NASCAR",
      firstName: "Shane",
      lastName: "van Gisbergen",
      team: "NCS",
      position: "DRV",
      jerseyNumber: "",
      isActive: false,
      isEligibleForVesting: false,
    });
    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: "nascar_4469", gameId: "nascar_NCS_5621" }),
    );
    expect(storageMocks.updateDailyGameStatus).toHaveBeenCalledWith("nascar_NCS_5621", "completed");
    expect(result).toMatchObject({ recordsProcessed: 1, errorCount: 0 });
  });

  it("admits a late-entry current participant as active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));
    storageMocks.getPlayersByIds.mockResolvedValue([]);

    const { syncNascarRaceResults } = await import("./sync-nascar-stats");
    await syncNascarRaceResults(
      2026,
      2 as any,
      5625,
      new Date("2026-05-10T22:00:00.000Z"),
    );

    expect(storageMocks.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "nascar_4469",
        team: "NXS",
        isActive: true,
        isEligibleForVesting: true,
      }),
    );
  });

  it("does not mark race completed when a driver stat write fails", async () => {
    nascarApiMocks.fetchRaceResults.mockResolvedValue([
      buildResult({ driverId: 1111, driverName: "Driver One" }),
      buildResult({
        driverId: 2222,
        driverName: "Driver Two",
        finishPosition: 2,
        startPosition: 5,
      }),
    ]);
    storageMocks.getPlayersByIds.mockResolvedValue([{ id: "nascar_1111" }, { id: "nascar_2222" }]);
    storageMocks.upsertPlayerGameStats
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("db write failed"));

    const { syncNascarRaceResults } = await import("./sync-nascar-stats");
    const result = await syncNascarRaceResults(
      2026,
      1 as any,
      5622,
      new Date("2026-05-10T22:00:00.000Z"),
    );

    expect(storageMocks.upsertPlayerGameStats).toHaveBeenCalledTimes(2);
    expect(storageMocks.updateDailyGameStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      requestCount: 1,
      recordsProcessed: 1,
      errorCount: 1,
    });
  });
});

describe("syncNascarStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nascarApiMocks.calculateFantasyPoints.mockReturnValue(38);
    nascarApiMocks.parseNascarEtDateTime.mockImplementation((rawDate: string) => new Date(rawDate));
    nascarApiMocks.fetchRaceResults.mockResolvedValue([
      buildResult({
        driverId: 9001,
        driverName: "Recent Driver",
        finishPosition: 5,
        startPosition: 9,
      }),
    ]);
    storageMocks.getPlayersByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id })),
    );
    storageMocks.upsertPlayer.mockResolvedValue(undefined);
    storageMocks.upsertPlayerGameStats.mockResolvedValue(undefined);
    storageMocks.updateDailyGameStatus.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconciles races in the 30-day lookback window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));

    nascarApiMocks.fetchRaceSchedule.mockResolvedValue([
      buildRaceListItem({ race_id: 5601, series_id: 1, race_date: "2026-05-10T18:00:00.000Z" }),
      buildRaceListItem({ race_id: 5602, series_id: 2, race_date: "2026-04-20T18:00:00.000Z" }),
      buildRaceListItem({ race_id: 5603, series_id: 3, race_date: "2026-03-30T18:00:00.000Z" }),
      buildRaceListItem({ race_id: 5604, series_id: 1, race_date: "invalid-date" }),
    ]);

    const { syncNascarStats } = await import("./sync-nascar-stats");
    const result = await syncNascarStats();

    expect(nascarApiMocks.fetchRaceResults).toHaveBeenCalledTimes(2);
    expect(nascarApiMocks.fetchRaceResults).toHaveBeenNthCalledWith(1, 2026, 1, 5601);
    expect(nascarApiMocks.fetchRaceResults).toHaveBeenNthCalledWith(2, 2026, 2, 5602);
    expect(storageMocks.updateDailyGameStatus).toHaveBeenCalledWith("nascar_NCS_5601", "completed");
    expect(storageMocks.updateDailyGameStatus).toHaveBeenCalledWith("nascar_NXS_5602", "completed");
    expect(result).toMatchObject({
      requestCount: 2,
      recordsProcessed: 2,
      errorCount: 0,
    });
  });
});

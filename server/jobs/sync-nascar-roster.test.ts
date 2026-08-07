import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  upsertPlayer: vi.fn(),
  getPlayersBySport: vi.fn(),
  updatePlayer: vi.fn(),
}));
const api = vi.hoisted(() => ({
  fetchDrivers: vi.fn(),
  fetchRaceSchedule: vi.fn(),
  fetchActiveDriversForRace: vi.fn(),
}));

vi.mock("../storage", () => ({ storage }));
vi.mock("../nascar-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nascar-api")>();
  return {
    ...actual,
    fetchDrivers: api.fetchDrivers,
    fetchRaceSchedule: api.fetchRaceSchedule,
    fetchActiveDriversForRace: api.fetchActiveDriversForRace,
  };
});

import { syncNascarRoster } from "./sync-nascar-roster";

const driver = (id: number) => ({
  driver_id: id,
  first_name: "Driver",
  last_name: String(id),
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchDrivers.mockImplementation(async (seriesId: number) => [driver(seriesId * 100 + 1)]);
  storage.getPlayersBySport.mockResolvedValue([]);
  storage.upsertPlayer.mockResolvedValue(undefined);
  storage.updatePlayer.mockResolvedValue(undefined);
});

describe("syncNascarRoster player lifecycle", () => {
  it("deactivates a previously admitted missing driver without deleting the asset", async () => {
    storage.getPlayersBySport.mockResolvedValue([{ id: "nascar_999", isActive: true }]);

    const result = await syncNascarRoster();

    expect(result.errorCount).toBe(0);
    expect(storage.updatePlayer).toHaveBeenCalledWith(
      "nascar_999",
      expect.objectContaining({ isActive: false }),
    );
  });

  it("reactivates a returning driver by the same permanent driver id", async () => {
    api.fetchDrivers.mockImplementation(async (seriesId: number) =>
      seriesId === 1 ? [driver(999)] : [driver(seriesId * 100 + 1)],
    );

    await syncNascarRoster();

    expect(storage.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nascar_999", isActive: true }),
    );
  });

  it("refuses mass deactivation when any authoritative series feed is empty", async () => {
    storage.getPlayersBySport.mockResolvedValue([{ id: "nascar_999", isActive: true }]);
    api.fetchDrivers.mockImplementation(async (seriesId: number) =>
      seriesId === 2 ? [] : [driver(seriesId * 100 + 1)],
    );

    const result = await syncNascarRoster();

    expect(result.errorCount).toBeGreaterThan(0);
    expect(storage.updatePlayer).not.toHaveBeenCalled();
  });
});

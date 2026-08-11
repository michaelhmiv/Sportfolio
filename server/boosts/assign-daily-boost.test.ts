import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getCanonicalPlayerId: vi.fn(),
  getDailyBoosts: vi.fn(),
  getPlayerGameForDate: vi.fn(),
  getAvailableShares: vi.fn(),
  createDailyBoost: vi.fn(),
  reserveShares: vi.fn(),
  deleteDailyBoost: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMocks }));

describe("assignDailyBoostWithValidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.getCanonicalPlayerId.mockResolvedValue("canonical_player");
    storageMocks.getDailyBoosts.mockResolvedValue([]);
    storageMocks.getPlayerGameForDate.mockResolvedValue({
      gameId: "game_1",
      startTime: new Date(Date.now() + 60 * 60 * 1000),
      status: "scheduled",
    });
    storageMocks.getAvailableShares.mockResolvedValue(12.5);
    storageMocks.createDailyBoost.mockResolvedValue({ id: "boost_1" });
    storageMocks.reserveShares.mockResolvedValue(undefined);
    storageMocks.deleteDailyBoost.mockResolvedValue(undefined);
  });

  it("rejects an occupied slot", async () => {
    const { assignDailyBoostWithValidation, DailyBoostValidationError } =
      await import("./assign-daily-boost");
    storageMocks.getDailyBoosts.mockResolvedValue([{ slotTier: 5, playerId: "other_player" }]);

    await expect(
      assignDailyBoostWithValidation({
        userId: "user_1",
        playerId: "raw_player",
        sport: "MLB",
        slotTier: 5,
        shares: 2,
        etDate: "2026-08-11",
      }),
    ).rejects.toBeInstanceOf(DailyBoostValidationError);
  });

  it("creates and reserves an arbitrary positive Singles quantity", async () => {
    const { assignDailyBoostWithValidation } = await import("./assign-daily-boost");
    const result = await assignDailyBoostWithValidation({
      userId: "user_1",
      playerId: "raw_player",
      sport: "MLB",
      slotTier: 10,
      shares: 3.25,
      etDate: "2026-08-11",
    });

    expect(storageMocks.createDailyBoost).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        playerId: "canonical_player",
        sport: "MLB",
        slotTier: 10,
        sharesEntered: 3.25,
        gameId: "game_1",
      }),
    );
    expect(storageMocks.reserveShares).toHaveBeenCalledWith(
      "user_1",
      "player",
      "canonical_player",
      "boost",
      "boost_1",
      3.25,
    );
    expect(result).toMatchObject({
      canonicalPlayerId: "canonical_player",
      sharesCommitted: 3.25,
    });
  });

  it("rejects unavailable quantities and retired 4x slots", async () => {
    const { assignDailyBoostWithValidation, DailyBoostValidationError } =
      await import("./assign-daily-boost");

    await expect(
      assignDailyBoostWithValidation({
        userId: "user_1",
        playerId: "raw_player",
        sport: "MLB",
        slotTier: 4,
        shares: 1,
        etDate: "2026-08-11",
      }),
    ).rejects.toBeInstanceOf(DailyBoostValidationError);

    storageMocks.getAvailableShares.mockResolvedValue(1.5);
    await expect(
      assignDailyBoostWithValidation({
        userId: "user_1",
        playerId: "raw_player",
        sport: "MLB",
        slotTier: 7,
        shares: 2,
        etDate: "2026-08-11",
      }),
    ).rejects.toBeInstanceOf(DailyBoostValidationError);
  });
});

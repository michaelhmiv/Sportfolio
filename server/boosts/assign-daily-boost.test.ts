import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getCanonicalPlayerId: vi.fn(),
  getDailyBoosts: vi.fn(),
  getPlayerGameForDate: vi.fn(),
  getAvailableShares: vi.fn(),
  getPlayerShareBreakdown: vi.fn(),
  createDailyBoost: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: storageMocks,
}));

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
    storageMocks.getAvailableShares.mockResolvedValue(2);
    storageMocks.getPlayerShareBreakdown.mockResolvedValue({
      regular: { quantity: "2" },
      stacked: [{ quantity: "1", multiplier: "3.50" }],
    });
    storageMocks.createDailyBoost.mockResolvedValue({ id: "boost_1" });
  });

  it("rejects assignment when slot is already occupied", async () => {
    const { assignDailyBoostWithValidation, DailyBoostValidationError } =
      await import("./assign-daily-boost");

    storageMocks.getDailyBoosts.mockResolvedValue([{ slotTier: 5, playerId: "other_player" }]);

    await expect(
      assignDailyBoostWithValidation({
        userId: "user_1",
        playerId: "raw_player",
        sport: "NBA",
        slotTier: 5,
        etDate: "2026-05-29",
      }),
    ).rejects.toBeInstanceOf(DailyBoostValidationError);
  });

  it("creates a boost with canonical player id and selected share source", async () => {
    const { assignDailyBoostWithValidation } = await import("./assign-daily-boost");

    const result = await assignDailyBoostWithValidation({
      userId: "user_1",
      playerId: "raw_player",
      sport: "NBA",
      slotTier: 5,
      etDate: "2026-05-29",
    });

    expect(storageMocks.createDailyBoost).toHaveBeenCalledTimes(1);
    expect(storageMocks.createDailyBoost.mock.calls[0][0]).toMatchObject({
      userId: "user_1",
      playerId: "canonical_player",
      sport: "NBA",
      slotTier: 5,
      sharesEntered: 1,
      shareMultiplier: "3.50",
      shareSourceType: "stacked",
      gameId: "game_1",
    });

    expect(result.canonicalPlayerId).toBe("canonical_player");
    expect(result.shareSourceType).toBe("stacked");
    expect(result.shareMultiplier).toBe("3.50");
  });

  it("falls back to a regular share when no stacked share is available", async () => {
    const { assignDailyBoostWithValidation } = await import("./assign-daily-boost");

    storageMocks.getPlayerShareBreakdown.mockResolvedValue({
      regular: { quantity: "2" },
      stacked: [],
    });

    const result = await assignDailyBoostWithValidation({
      userId: "user_1",
      playerId: "raw_player",
      sport: "NBA",
      slotTier: 4,
      etDate: "2026-05-29",
    });

    expect(storageMocks.createDailyBoost).toHaveBeenCalledTimes(1);
    expect(storageMocks.createDailyBoost.mock.calls[0][0]).toMatchObject({
      playerId: "canonical_player",
      slotTier: 4,
      shareMultiplier: "1.00",
      shareSourceType: "regular",
    });
    expect(result.shareSourceType).toBe("regular");
    expect(result.shareMultiplier).toBe("1.00");
  });
});

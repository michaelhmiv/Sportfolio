import { describe, expect, it, vi } from "vitest";
import { loadUserEntitlements, resolveUserEntitlements } from "./user-entitlements";

describe("resolveUserEntitlements", () => {
  const now = new Date("2026-03-29T12:00:00.000Z");

  it("returns the free scout cap when no entitlement is active", () => {
    const entitlements = resolveUserEntitlements(
      {
        id: "user-free",
        isPremium: false,
        premiumExpiresAt: null,
      },
      null,
      now,
    );

    expect(entitlements.premiumActive).toBe(false);
    expect(entitlements.rewardedScoutBoostActive).toBe(false);
    expect(entitlements.maxScouts).toBe(5);
  });

  it("keeps premium users at the boosted scout cap", () => {
    const entitlements = resolveUserEntitlements(
      {
        id: "user-premium",
        isPremium: true,
        premiumExpiresAt: new Date("2026-04-10T12:00:00.000Z"),
      },
      null,
      now,
    );

    expect(entitlements.premiumActive).toBe(true);
    expect(entitlements.maxScouts).toBe(10);
  });

  it("grants the boosted scout cap from a rewarded scout boost", () => {
    const entitlements = resolveUserEntitlements(
      {
        id: "user-boosted",
        isPremium: false,
        premiumExpiresAt: null,
      },
      {
        expiresAt: new Date("2026-03-29T20:00:00.000Z"),
        revokedAt: null,
      },
      now,
    );

    expect(entitlements.rewardedScoutBoostActive).toBe(true);
    expect(entitlements.maxScouts).toBe(10);
  });

  it("does not stack premium and rewarded scout boost above ten scouts", () => {
    const entitlements = resolveUserEntitlements(
      {
        id: "user-both",
        isPremium: true,
        premiumExpiresAt: new Date("2026-04-10T12:00:00.000Z"),
      },
      {
        expiresAt: new Date("2026-03-29T20:00:00.000Z"),
        revokedAt: null,
      },
      now,
    );

    expect(entitlements.premiumActive).toBe(true);
    expect(entitlements.rewardedScoutBoostActive).toBe(true);
    expect(entitlements.maxScouts).toBe(10);
  });

  it("drops back to the base cap when the rewarded boost is expired", () => {
    const entitlements = resolveUserEntitlements(
      {
        id: "user-expired-boost",
        isPremium: false,
        premiumExpiresAt: null,
      },
      {
        expiresAt: new Date("2026-03-29T11:59:00.000Z"),
        revokedAt: null,
      },
      now,
    );

    expect(entitlements.rewardedScoutBoostActive).toBe(false);
    expect(entitlements.maxScouts).toBe(5);
  });
});

describe("loadUserEntitlements", () => {
  it("repairs stale premium rows before returning entitlements", async () => {
    const updateUserPremiumStatus = vi.fn().mockResolvedValue(undefined);
    const getUser = vi.fn().mockResolvedValue({
      id: "user-expired-premium",
      isPremium: true,
      premiumExpiresAt: new Date("2026-03-28T12:00:00.000Z"),
    });
    const getActiveRewardedScoutBoostForUser = vi.fn().mockResolvedValue(undefined);

    const result = await loadUserEntitlements(
      {
        getUser,
        getActiveRewardedScoutBoostForUser,
        updateUserPremiumStatus,
      },
      "user-expired-premium",
      new Date("2026-03-29T12:00:00.000Z"),
    );

    expect(result?.entitlements.premiumActive).toBe(false);
    expect(result?.entitlements.maxScouts).toBe(5);
    expect(updateUserPremiumStatus).toHaveBeenCalledWith(
      "user-expired-premium",
      false,
      new Date("2026-03-28T12:00:00.000Z"),
    );
  });
});

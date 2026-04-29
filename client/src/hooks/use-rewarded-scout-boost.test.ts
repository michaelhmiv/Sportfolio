import { describe, expect, it } from "vitest";
import {
  getRewardedScoutBoostUnavailableMessage,
  hasBoostExpirationAdvanced,
} from "./use-rewarded-scout-boost";

describe("rewarded scout boost helpers", () => {
  it("waits for an active boost expiration to advance when stacking time", () => {
    expect(
      hasBoostExpirationAdvanced(
        {
          rewardedScoutBoostActive: true,
          rewardedScoutBoostExpiresAt: "2026-04-29T18:00:00.000Z",
          maxScouts: 10,
        },
        "2026-04-29T18:00:00.000Z",
      ),
    ).toBe(false);

    expect(
      hasBoostExpirationAdvanced(
        {
          rewardedScoutBoostActive: true,
          rewardedScoutBoostExpiresAt: "2026-04-30T06:00:00.000Z",
          maxScouts: 10,
        },
        "2026-04-29T18:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("uses premium-specific copy when premium users cannot watch rewarded scout ads", () => {
    expect(getRewardedScoutBoostUnavailableMessage("premium_active")).toContain(
      "Premium already gives you",
    );
  });

  it("uses specific copy for Android and ad availability states", () => {
    expect(getRewardedScoutBoostUnavailableMessage("android_unavailable")).toContain("Android app");
    expect(getRewardedScoutBoostUnavailableMessage("ad_unavailable")).toContain("not available");
    expect(getRewardedScoutBoostUnavailableMessage("ad_closed_early")).toContain(
      "Finish the rewarded ad",
    );
  });
});

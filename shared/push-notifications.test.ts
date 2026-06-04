import { describe, expect, it } from "vitest";
import {
  getPushNotificationAndroidChannelId,
  normalizeInternalNotificationRoute,
  resolvePushNotificationPreferences,
} from "./push-notifications";

describe("push notification helpers", () => {
  it("normalizes and whitelists supported internal routes", () => {
    expect(normalizeInternalNotificationRoute("/boosts")).toBe("/boosts");
    expect(normalizeInternalNotificationRoute("/player/nba_123?tab=chart")).toBe("/player/nba_123");
    expect(normalizeInternalNotificationRoute("https://evil.com")).toBeNull();
    expect(normalizeInternalNotificationRoute("//evil.com")).toBeNull();
    expect(normalizeInternalNotificationRoute("/admin")).toBeNull();
  });

  it("merges defaults with stored preference overrides", () => {
    const resolved = resolvePushNotificationPreferences({
      watchlist_news: true,
      boost_settled: false,
      scout_complete: true,
    });

    expect(resolved.watchlist_news).toBe(true);
    expect(resolved.boost_settled).toBe(false);
    expect(resolved.scout_complete).toBe(false);
    expect(resolved.boost_locking_soon).toBe(false);
  });

  it("keeps temporarily muted push types off even when overrides try to enable them", () => {
    const resolved = resolvePushNotificationPreferences({
      scout_complete: true,
      boost_locking_soon: true,
      boost_settled: true,
    });

    expect(resolved.scout_complete).toBe(false);
    expect(resolved.boost_locking_soon).toBe(false);
    expect(resolved.boost_settled).toBe(false);
  });

  it("maps notification types to stable Android channels", () => {
    expect(getPushNotificationAndroidChannelId("boost_settled")).toBe("sportfolio_gameplay");
    expect(getPushNotificationAndroidChannelId("portfolio_movement")).toBe("sportfolio_market");
    expect(getPushNotificationAndroidChannelId("watchlist_news")).toBe("sportfolio_watchlist");
    expect(getPushNotificationAndroidChannelId("system_announcements")).toBe("sportfolio_system");
  });
});

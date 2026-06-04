import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  applyLegacyNewsNotificationPreference,
  mergeNotificationPreferences,
  normalizeNotificationPreferences,
} from "./notifications";

describe("notification preference helpers", () => {
  it("normalizes unknown inputs to defaults", () => {
    expect(normalizeNotificationPreferences(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(normalizeNotificationPreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(normalizeNotificationPreferences({ invalid: true })).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
  });

  it("merges valid category patches over current preferences", () => {
    const merged = mergeNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES, {
      trade_execution: false,
      watchlist_alerts: true,
      boost_lifecycle: true,
      nonexistent: false,
    });

    expect(merged.trade_execution).toBe(false);
    expect(merged.watchlist_alerts).toBe(false);
    expect(merged.boost_lifecycle).toBe(false);
    expect(merged.game_lifecycle).toBe(false);
    expect(merged.market_alerts).toBe(DEFAULT_NOTIFICATION_PREFERENCES.market_alerts);
  });

  it("maps legacy news opt-out to player news + daily digest off", () => {
    const mapped = applyLegacyNewsNotificationPreference(false, {
      player_news: true,
      daily_digest: true,
      trade_execution: true,
    });

    expect(mapped.player_news).toBe(false);
    expect(mapped.daily_digest).toBe(false);
    expect(mapped.trade_execution).toBe(true);
  });

  it("preserves current preferences when legacy news flag is true", () => {
    const mapped = applyLegacyNewsNotificationPreference(true, {
      player_news: true,
      daily_digest: false,
    });

    expect(mapped.player_news).toBe(true);
    expect(mapped.daily_digest).toBe(false);
  });
});

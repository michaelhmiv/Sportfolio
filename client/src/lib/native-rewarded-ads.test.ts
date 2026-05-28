import { describe, expect, it, vi } from "vitest";
import { resolveNativeRewardedPlugin } from "./native-rewarded-ads";

describe("resolveNativeRewardedPlugin", () => {
  it("returns Android plugin mapping when platform is android", () => {
    const androidPlugin = {
      isAvailable: vi.fn(),
      showRewardedAd: vi.fn(),
    };
    const iosPlugin = {
      isAvailable: vi.fn(),
      showRewardedAd: vi.fn(),
    };

    const resolved = resolveNativeRewardedPlugin("android", {
      android: androidPlugin,
      ios: iosPlugin,
    });

    expect(resolved).toEqual({
      platform: "android",
      plugin: androidPlugin,
    });
  });

  it("returns iOS plugin mapping when platform is ios", () => {
    const androidPlugin = {
      isAvailable: vi.fn(),
      showRewardedAd: vi.fn(),
    };
    const iosPlugin = {
      isAvailable: vi.fn(),
      showRewardedAd: vi.fn(),
    };

    const resolved = resolveNativeRewardedPlugin("ios", {
      android: androidPlugin,
      ios: iosPlugin,
    });

    expect(resolved).toEqual({
      platform: "ios",
      plugin: iosPlugin,
    });
  });

  it("returns null for web builds", () => {
    const resolved = resolveNativeRewardedPlugin("web", {
      android: {
        isAvailable: vi.fn(),
        showRewardedAd: vi.fn(),
      },
      ios: {
        isAvailable: vi.fn(),
        showRewardedAd: vi.fn(),
      },
    });

    expect(resolved).toBeNull();
  });
});

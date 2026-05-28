import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid, isNativeIOS } from "./native-platform";

export interface ShowRewardedAdOptions {
  adUnitId: string;
  customData: string;
  userId?: string;
  nonPersonalizedOnly?: boolean;
}

export interface ShowRewardedAdResult {
  completed: boolean;
  rewardEarned: boolean;
  rewardAmount: number;
  rewardType: string;
  adUnitId?: string;
  adResponseId?: string | null;
  mediationAdapterClassName?: string | null;
  ssvOptionsAttached?: boolean;
  ssvCustomDataAttached?: boolean;
  ssvUserIdAttached?: boolean;
  ssvCustomDataLength?: number;
}

interface NativeRewardedAdsPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  showRewardedAd(options: ShowRewardedAdOptions): Promise<ShowRewardedAdResult>;
}

const AndroidRewardedAds = registerPlugin<NativeRewardedAdsPlugin>("AndroidRewardedAds");
const IOSRewardedAds = registerPlugin<NativeRewardedAdsPlugin>("IOSRewardedAds");

type RewardedPlatform = "android" | "ios";

interface ResolvedRewardedPlugin {
  platform: RewardedPlatform;
  plugin: NativeRewardedAdsPlugin;
}

export function resolveNativeRewardedPlugin(
  platform: "android" | "ios" | "web",
  plugins: { android: NativeRewardedAdsPlugin; ios: NativeRewardedAdsPlugin } = {
    android: AndroidRewardedAds,
    ios: IOSRewardedAds,
  },
): ResolvedRewardedPlugin | null {
  if (platform === "android") {
    return { platform: "android", plugin: plugins.android };
  }

  if (platform === "ios") {
    return { platform: "ios", plugin: plugins.ios };
  }

  return null;
}

export function getNativeRewardedAdsPlatform(): RewardedPlatform | null {
  if (isNativeAndroid()) return "android";
  if (isNativeIOS()) return "ios";
  return null;
}

export async function canShowNativeRewardedAd() {
  const platform = getNativeRewardedAdsPlatform();
  const resolved = resolveNativeRewardedPlugin(platform ?? "web");
  if (!resolved) {
    return {
      available: false,
      platform: null,
    } as const;
  }

  try {
    const result = await resolved.plugin.isAvailable();
    return {
      available: result.available,
      platform: resolved.platform,
    } as const;
  } catch {
    return {
      available: false,
      platform: resolved.platform,
    } as const;
  }
}

export async function showNativeRewardedAd(options: ShowRewardedAdOptions) {
  const platform = getNativeRewardedAdsPlatform();
  const resolved = resolveNativeRewardedPlugin(platform ?? "web");
  if (!resolved) {
    throw new Error("Rewarded ads are only available in the native mobile app.");
  }

  const result = await resolved.plugin.showRewardedAd(options);
  return {
    ...result,
    platform: resolved.platform,
  } as const;
}

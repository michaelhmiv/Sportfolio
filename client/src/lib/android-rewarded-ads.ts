import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid } from "./native-platform";

interface ShowRewardedAdOptions {
  adUnitId: string;
  customData: string;
  userId?: string;
}

interface ShowRewardedAdResult {
  completed: boolean;
  rewardEarned: boolean;
  rewardAmount: number;
  rewardType: string;
}

interface AndroidRewardedAdsPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  showRewardedAd(options: ShowRewardedAdOptions): Promise<ShowRewardedAdResult>;
}

const AndroidRewardedAds = registerPlugin<AndroidRewardedAdsPlugin>("AndroidRewardedAds");

export async function canShowAndroidRewardedAd() {
  if (!isNativeAndroid()) {
    return false;
  }

  try {
    const result = await AndroidRewardedAds.isAvailable();
    return result.available;
  } catch {
    return false;
  }
}

export async function showAndroidRewardedAd(options: ShowRewardedAdOptions) {
  if (!isNativeAndroid()) {
    throw new Error("Rewarded ads are only available on Android");
  }

  return AndroidRewardedAds.showRewardedAd(options);
}

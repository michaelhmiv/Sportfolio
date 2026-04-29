import { useEffect, useRef, useState } from "react";
import { canShowAndroidRewardedAd, showAndroidRewardedAd } from "@/lib/android-rewarded-ads";
import { isNativeAndroid } from "@/lib/native-platform";
import { apiRequest, authenticatedFetch, queryClient } from "@/lib/queryClient";

export interface RewardedScoutBoostStatus {
  premiumActive?: boolean;
  rewardedScoutBoostActive: boolean;
  rewardedScoutBoostExpiresAt?: string | null;
  maxScouts: number;
}

export interface RewardedScoutBoostSessionResponse extends RewardedScoutBoostStatus {
  eligible: boolean;
  reason?: string;
  adUnitId?: string;
  customData?: string;
  rewardSessionId?: string;
  expiresAt?: string;
  boostDurationHours?: number;
}

type RewardedScoutBoostStartResult =
  | {
      outcome: "ineligible";
      session: RewardedScoutBoostSessionResponse;
      status: null;
    }
  | {
      outcome: "closed_early";
      session: RewardedScoutBoostSessionResponse;
      status: null;
    }
  | {
      outcome: "completed";
      session: RewardedScoutBoostSessionResponse;
      status: RewardedScoutBoostStatus | null;
    };

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function hasBoostExpirationAdvanced(
  status: RewardedScoutBoostStatus,
  previousExpiresAt?: string | null,
) {
  if (!status.rewardedScoutBoostActive || !status.rewardedScoutBoostExpiresAt) {
    return false;
  }

  if (!previousExpiresAt) {
    return true;
  }

  return (
    new Date(status.rewardedScoutBoostExpiresAt).getTime() > new Date(previousExpiresAt).getTime()
  );
}

export function getRewardedScoutBoostUnavailableMessage(reason?: string) {
  if (reason === "premium_active") {
    return "Premium already gives you the full 10-scout cap on this account.";
  }

  if (reason === "ad_closed_early") {
    return "Finish the rewarded ad to add 12 hours of scout boost time.";
  }

  if (reason === "android_unavailable") {
    return "Rewarded scout boosts are available in the Android app.";
  }

  if (reason === "ad_unavailable") {
    return "Rewarded ads are not available in this Android build yet.";
  }

  return "A rewarded scout boost cannot be started right now.";
}

export async function invalidateRewardedScoutBoostQueries() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/premium/status"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/scouts"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] }),
  ]);
}

async function waitForRewardedBoostExtension(previousExpiresAt?: string | null) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await authenticatedFetch("/api/premium/status");

    if (!response.ok) {
      break;
    }

    const latestStatus = (await response.json()) as RewardedScoutBoostStatus;
    queryClient.setQueryData(["/api/premium/status"], latestStatus);

    if (hasBoostExpirationAdvanced(latestStatus, previousExpiresAt)) {
      await invalidateRewardedScoutBoostQueries();
      return latestStatus;
    }

    await sleep(1500);
  }

  await invalidateRewardedScoutBoostQueries();
  return null;
}

export function useRewardedScoutBoost({ userId }: { userId?: string | null }) {
  const androidBuild = isNativeAndroid();
  const rewardFlowInFlightRef = useRef(false);
  const [rewardedAdAvailable, setRewardedAdAvailable] = useState(false);
  const [rewardedAdLoading, setRewardedAdLoading] = useState(false);
  const [rewardedVerificationPending, setRewardedVerificationPending] = useState(false);

  useEffect(() => {
    if (!androidBuild) {
      setRewardedAdAvailable(false);
      return;
    }

    let cancelled = false;
    void canShowAndroidRewardedAd().then((available) => {
      if (!cancelled) {
        setRewardedAdAvailable(available);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [androidBuild]);

  const startRewardedScoutBoost = async ({
    previousExpiresAt,
  }: {
    previousExpiresAt?: string | null;
  } = {}): Promise<RewardedScoutBoostStartResult> => {
    if (rewardFlowInFlightRef.current) {
      throw new Error("A rewarded scout boost is already in progress.");
    }

    if (!androidBuild) {
      throw new Error("Rewarded ads are only available on Android.");
    }

    if (!rewardedAdAvailable) {
      throw new Error("This Android build does not have rewarded ads ready yet.");
    }

    rewardFlowInFlightRef.current = true;
    setRewardedAdLoading(true);
    try {
      const sessionResponse = await apiRequest("POST", "/api/mobile/rewarded-scout-boost/session");
      const session = (await sessionResponse.json()) as RewardedScoutBoostSessionResponse;

      if (!session.eligible || !session.adUnitId || !session.customData) {
        return { outcome: "ineligible", session, status: null };
      }

      const result = await showAndroidRewardedAd({
        adUnitId: session.adUnitId,
        customData: session.customData,
        userId: userId || undefined,
      });

      if (!result.rewardEarned) {
        return { outcome: "closed_early", session, status: null };
      }

      setRewardedVerificationPending(true);
      const status = await waitForRewardedBoostExtension(
        previousExpiresAt ?? session.rewardedScoutBoostExpiresAt,
      );
      return { outcome: "completed", session, status };
    } finally {
      rewardFlowInFlightRef.current = false;
      setRewardedVerificationPending(false);
      setRewardedAdLoading(false);
    }
  };

  return {
    androidBuild,
    rewardedAdAvailable,
    rewardedAdLoading,
    rewardedVerificationPending,
    startRewardedScoutBoost,
  };
}

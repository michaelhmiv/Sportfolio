import { useEffect, useRef, useState } from "react";
import { rememberRewardedAdReportContext } from "@/lib/ad-report";
import {
  canShowNativeRewardedAd,
  getNativeRewardedAdsPlatform,
  showNativeRewardedAd,
} from "@/lib/native-rewarded-ads";
import { apiRequest, authenticatedFetch, queryClient } from "@/lib/queryClient";

export interface RewardedScoutBoostStatus {
  premiumActive?: boolean;
  rewardedScoutBoostActive: boolean;
  rewardedScoutBoostExpiresAt?: string | null;
  maxScouts: number;
  verificationStatus?: "pending_ssv" | "verified" | string;
}

export interface RewardedScoutBoostSessionResponse extends RewardedScoutBoostStatus {
  eligible: boolean;
  reason?: string;
  adUnitId?: string;
  customData?: string;
  rewardSessionId?: string;
  statusCheckUrl?: string;
  expiresAt?: string;
  boostDurationHours?: number;
}

export interface RewardedScoutBoostClientCompleteResponse extends RewardedScoutBoostStatus {
  success: boolean;
  outcome: "granted" | "duplicate" | "premium_active" | "user_not_found";
  rewardSessionId: string;
  expiresAt?: string | null;
  verificationStatus?: "pending_ssv" | "verified" | string;
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

  if (reason === "mobile_unavailable") {
    return "Rewarded scout boosts are available in the native iOS and Android apps.";
  }

  if (reason === "ad_unavailable") {
    return "Rewarded ads are not available in this mobile build yet.";
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

    if (hasBoostExpirationAdvanced(latestStatus, previousExpiresAt)) {
      await invalidateRewardedScoutBoostQueries();
      return latestStatus;
    }

    await sleep(1500);
  }

  await invalidateRewardedScoutBoostQueries();
  return null;
}

async function fetchRewardedScoutBoostSessionStatus(statusCheckUrl: string) {
  const response = await authenticatedFetch(statusCheckUrl, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to verify rewarded scout boost status");
  }

  return (await response.json()) as RewardedScoutBoostStatus & {
    outcome: "pending" | "granted";
    rewardSessionId: string;
    expiresAt?: string | null;
  };
}

async function recordRewardedScoutBoostClientComplete({
  session,
  adResult,
}: {
  session: RewardedScoutBoostSessionResponse;
  adResult: Awaited<ReturnType<typeof showNativeRewardedAd>>;
}) {
  if (!session.rewardSessionId || !session.customData) {
    return null;
  }

  const response = await apiRequest(
    "POST",
    `/api/mobile/rewarded-scout-boost/session/${session.rewardSessionId}/client-complete`,
    {
      customData: session.customData,
      adUnitId: adResult.adUnitId || session.adUnitId,
      adResponseId: adResult.adResponseId,
      mediationAdapterClassName: adResult.mediationAdapterClassName,
      ssvOptionsAttached: adResult.ssvOptionsAttached,
      ssvCustomDataAttached: adResult.ssvCustomDataAttached,
      ssvUserIdAttached: adResult.ssvUserIdAttached,
      ssvCustomDataLength: adResult.ssvCustomDataLength,
      rewardAmount: adResult.rewardAmount,
      rewardType: adResult.rewardType,
      platform: adResult.platform,
      nonPersonalizedOnly: true,
    },
  );

  return (await response.json()) as RewardedScoutBoostClientCompleteResponse;
}

async function waitForRewardedBoostGrantBySession(
  statusCheckUrl: string,
  previousExpiresAt?: string | null,
) {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await fetchRewardedScoutBoostSessionStatus(statusCheckUrl);

    if (status.outcome === "granted" || hasBoostExpirationAdvanced(status, previousExpiresAt)) {
      await invalidateRewardedScoutBoostQueries();
      return status;
    }

    await sleep(1000 + attempt * 500);
  }

  await invalidateRewardedScoutBoostQueries();
  return null;
}

export function useRewardedScoutBoost({ userId }: { userId?: string | null }) {
  const rewardedAdsPlatform = getNativeRewardedAdsPlatform();
  const nativeRewardedBuild = rewardedAdsPlatform !== null;
  const rewardFlowInFlightRef = useRef(false);
  const [rewardedAdAvailable, setRewardedAdAvailable] = useState(false);
  const [rewardedAdLoading, setRewardedAdLoading] = useState(false);
  const [rewardedVerificationPending, setRewardedVerificationPending] = useState(false);

  useEffect(() => {
    if (!nativeRewardedBuild) {
      setRewardedAdAvailable(false);
      return;
    }

    let cancelled = false;
    void canShowNativeRewardedAd().then((result) => {
      if (!cancelled) {
        setRewardedAdAvailable(result.available);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [nativeRewardedBuild]);

  const startRewardedScoutBoost = async ({
    previousExpiresAt,
  }: {
    previousExpiresAt?: string | null;
  } = {}): Promise<RewardedScoutBoostStartResult> => {
    if (rewardFlowInFlightRef.current) {
      throw new Error("A rewarded scout boost is already in progress.");
    }

    if (!nativeRewardedBuild) {
      throw new Error("Rewarded ads are only available in the native iOS and Android apps.");
    }

    if (!rewardedAdAvailable) {
      throw new Error("Rewarded ads are not available in this mobile build yet.");
    }

    rewardFlowInFlightRef.current = true;
    setRewardedAdLoading(true);
    try {
      const sessionResponse = await apiRequest("POST", "/api/mobile/rewarded-scout-boost/session", {
        platform: rewardedAdsPlatform,
      });
      const session = (await sessionResponse.json()) as RewardedScoutBoostSessionResponse;

      if (!session.eligible || !session.adUnitId || !session.customData) {
        return { outcome: "ineligible", session, status: null };
      }

      const result = await showNativeRewardedAd({
        adUnitId: session.adUnitId,
        customData: session.customData,
        userId: userId || undefined,
        nonPersonalizedOnly: true,
      });

      rememberRewardedAdReportContext({
        platform: result.platform,
        shownAt: new Date().toISOString(),
        adResponseId: result.adResponseId,
        mediationAdapterClassName: result.mediationAdapterClassName,
      });

      if (!result.rewardEarned) {
        return { outcome: "closed_early", session, status: null };
      }

      setRewardedVerificationPending(true);
      const clientCompleteStatus = await recordRewardedScoutBoostClientComplete({
        session,
        adResult: result,
      });

      if (clientCompleteStatus?.rewardedScoutBoostActive) {
        await invalidateRewardedScoutBoostQueries();
        return { outcome: "completed", session, status: clientCompleteStatus };
      }

      const status =
        session.rewardSessionId && session.statusCheckUrl
          ? await waitForRewardedBoostGrantBySession(
              session.statusCheckUrl,
              previousExpiresAt ?? session.rewardedScoutBoostExpiresAt,
            )
          : await waitForRewardedBoostExtension(
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
    nativeRewardedBuild,
    rewardedAdsPlatform,
    rewardedAdAvailable,
    rewardedAdLoading,
    rewardedVerificationPending,
    startRewardedScoutBoost,
  };
}

package sportfolio.market;

import android.app.Activity;
import android.util.Log;
import androidx.annotation.NonNull;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.rewarded.RewardItem;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AndroidRewardedAds")
public class AndroidRewardedAdsPlugin extends Plugin {
    private static final String TAG = "AndroidRewardedAds";
    private final AtomicBoolean adFlowInFlight = new AtomicBoolean(false);

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity == null) {
            return;
        }

        activity.runOnUiThread(() -> MobileAds.initialize(activity, initializationStatus ->
            Log.d(TAG, "Google Mobile Ads initialized")
        ));
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", getActivity() != null);
        call.resolve(result);
    }

    @PluginMethod
    public void showRewardedAd(PluginCall call) {
        if (!adFlowInFlight.compareAndSet(false, true)) {
            call.reject("A rewarded ad is already in progress");
            return;
        }

        String adUnitId = call.getString("adUnitId");
        String customData = call.getString("customData");
        String userId = call.getString("userId");

        if (adUnitId == null || adUnitId.trim().isEmpty()) {
            adFlowInFlight.set(false);
            call.reject("adUnitId is required");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            adFlowInFlight.set(false);
            call.reject("No active Android activity is available");
            return;
        }

        Log.d(TAG, "Starting rewarded ad load");
        activity.runOnUiThread(() -> loadAndShowRewardedAd(activity, call, adUnitId, customData, userId));
    }

    private void loadAndShowRewardedAd(
        Activity activity,
        PluginCall call,
        String adUnitId,
        String customData,
        String userId
    ) {
        AdRequest adRequest = new AdRequest.Builder().build();

        RewardedAd.load(activity, adUnitId, adRequest, new RewardedAdLoadCallback() {
            @Override
            public void onAdFailedToLoad(@NonNull LoadAdError loadAdError) {
                adFlowInFlight.set(false);
                Log.e(TAG, "Rewarded ad failed to load: " + loadAdError.getMessage());
                call.reject("Failed to load rewarded ad: " + loadAdError.getMessage());
            }

            @Override
            public void onAdLoaded(@NonNull RewardedAd rewardedAd) {
                Log.d(TAG, "Rewarded ad loaded");

                ServerSideVerificationOptions.Builder verificationOptionsBuilder =
                    new ServerSideVerificationOptions.Builder();
                boolean hasVerificationOptions = false;

                if (customData != null && !customData.trim().isEmpty()) {
                    verificationOptionsBuilder.setCustomData(customData);
                    hasVerificationOptions = true;
                }

                if (userId != null && !userId.trim().isEmpty()) {
                    verificationOptionsBuilder.setUserId(userId);
                    hasVerificationOptions = true;
                }

                if (hasVerificationOptions) {
                    rewardedAd.setServerSideVerificationOptions(verificationOptionsBuilder.build());
                    Log.d(
                        TAG,
                        "Rewarded ad SSV options attached: customData=" +
                        (customData != null && !customData.trim().isEmpty()) +
                        ", userId=" +
                        (userId != null && !userId.trim().isEmpty())
                    );
                } else {
                    Log.w(TAG, "Rewarded ad SSV options were not attached");
                }

                String responseId = null;
                String mediationAdapterClassName = null;
                if (rewardedAd.getResponseInfo() != null) {
                    responseId = rewardedAd.getResponseInfo().getResponseId();
                    mediationAdapterClassName =
                        rewardedAd.getResponseInfo().getMediationAdapterClassName();
                }

                AtomicBoolean resolved = new AtomicBoolean(false);
                AtomicBoolean rewardEarned = new AtomicBoolean(false);
                final int[] rewardAmount = {0};
                final String[] rewardType = {""};
                final String adResponseId = responseId;
                final String adMediationAdapterClassName = mediationAdapterClassName;
                final boolean ssvOptionsAttached = hasVerificationOptions;
                final boolean ssvCustomDataAttached = customData != null && !customData.trim().isEmpty();
                final boolean ssvUserIdAttached = userId != null && !userId.trim().isEmpty();
                final int ssvCustomDataLength = customData == null ? 0 : customData.length();

                rewardedAd.setFullScreenContentCallback(new FullScreenContentCallback() {
                    @Override
                    public void onAdDismissedFullScreenContent() {
                        if (resolved.compareAndSet(false, true)) {
                            adFlowInFlight.set(false);
                            JSObject result = new JSObject();
                            result.put("completed", true);
                            result.put("rewardEarned", rewardEarned.get());
                            result.put("rewardAmount", rewardAmount[0]);
                            result.put("rewardType", rewardType[0]);
                            result.put("adUnitId", adUnitId);
                            result.put("adResponseId", adResponseId);
                            result.put("mediationAdapterClassName", adMediationAdapterClassName);
                            result.put("ssvOptionsAttached", ssvOptionsAttached);
                            result.put("ssvCustomDataAttached", ssvCustomDataAttached);
                            result.put("ssvUserIdAttached", ssvUserIdAttached);
                            result.put("ssvCustomDataLength", ssvCustomDataLength);
                            call.resolve(result);
                        }
                    }

                    @Override
                    public void onAdFailedToShowFullScreenContent(@NonNull AdError adError) {
                        if (resolved.compareAndSet(false, true)) {
                            adFlowInFlight.set(false);
                            Log.e(TAG, "Rewarded ad failed to show: " + adError.getMessage());
                            call.reject("Failed to show rewarded ad: " + adError.getMessage());
                        }
                    }
                });

                Log.d(TAG, "Showing rewarded ad");
                rewardedAd.show(activity, rewardItem -> {
                    rewardEarned.set(true);
                    rewardAmount[0] = rewardItem.getAmount();
                    rewardType[0] = rewardItem.getType();

                    JSObject rewardEvent = new JSObject();
                    rewardEvent.put("amount", rewardItem.getAmount());
                    rewardEvent.put("type", rewardItem.getType());
                    notifyListeners("rewarded", rewardEvent);

                    Log.d(TAG, "User earned rewarded ad item: " + rewardItem.getType());
                });
            }
        });
    }
}

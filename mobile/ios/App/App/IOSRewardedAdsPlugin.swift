import Capacitor
import Foundation
import GoogleMobileAds
import UIKit

@objc(IOSRewardedAdsPlugin)
public class IOSRewardedAdsPlugin: CAPPlugin, CAPBridgedPlugin, FullScreenContentDelegate {
    public let identifier = "IOSRewardedAdsPlugin"
    public let jsName = "IOSRewardedAds"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showRewardedAd", returnType: CAPPluginReturnPromise),
    ]

    private var rewardedAd: RewardedAd?
    private var pendingCall: CAPPluginCall?
    private var adFlowInFlight = false
    private var rewardEarned = false
    private var rewardAmount = 0
    private var rewardType = ""
    private var adResponseId: String?
    private var mediationAdapterClassName: String?
    private var ssvOptionsAttached = false
    private var ssvCustomDataAttached = false
    private var ssvUserIdAttached = false
    private var ssvCustomDataLength = 0

    public override func load() {
        DispatchQueue.main.async {
            MobileAds.sharedInstance().start(completionHandler: nil)
        }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": bridge?.viewController != nil
        ])
    }

    @objc func showRewardedAd(_ call: CAPPluginCall) {
        if adFlowInFlight {
            call.reject("A rewarded ad is already in progress")
            return
        }

        guard let adUnitId = call.getString("adUnitId"), !adUnitId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("adUnitId is required")
            return
        }

        let customData = call.getString("customData")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let userId = call.getString("userId")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let nonPersonalizedOnly = call.getBool("nonPersonalizedOnly") ?? true

        guard let viewController = bridge?.viewController else {
            call.reject("No active iOS view controller is available")
            return
        }

        adFlowInFlight = true
        pendingCall = call
        rewardEarned = false
        rewardAmount = 0
        rewardType = ""
        adResponseId = nil
        mediationAdapterClassName = nil
        ssvOptionsAttached = false
        ssvCustomDataAttached = false
        ssvUserIdAttached = false
        ssvCustomDataLength = customData?.count ?? 0

        DispatchQueue.main.async {
            let request = Request()
            if nonPersonalizedOnly {
                let extras = Extras()
                extras.additionalParameters = ["npa": "1"]
                request.register(extras)
            }

            RewardedAd.load(withAdUnitID: adUnitId, request: request) { [weak self] ad, error in
                guard let self else { return }

                if let error {
                    self.rejectPendingCall("Failed to load rewarded ad: \(error.localizedDescription)")
                    return
                }

                guard let ad else {
                    self.rejectPendingCall("Failed to load rewarded ad: no ad returned")
                    return
                }

                self.rewardedAd = ad
                ad.fullScreenContentDelegate = self

                if let responseInfo = ad.responseInfo {
                    self.adResponseId = responseInfo.responseIdentifier
                    self.mediationAdapterClassName = responseInfo.adNetworkClassName
                }

                let verificationOptions = ServerSideVerificationOptions()
                var hasVerificationOptions = false
                if let customData, !customData.isEmpty {
                    verificationOptions.customRewardString = customData
                    self.ssvCustomDataAttached = true
                    hasVerificationOptions = true
                }
                if let userId, !userId.isEmpty {
                    verificationOptions.userIdentifier = userId
                    self.ssvUserIdAttached = true
                    hasVerificationOptions = true
                }

                if hasVerificationOptions {
                    ad.serverSideVerificationOptions = verificationOptions
                    self.ssvOptionsAttached = true
                }

                ad.present(fromRootViewController: viewController) { [weak self] in
                    guard let self else { return }
                    let adReward = ad.adReward
                    self.rewardEarned = true
                    self.rewardAmount = adReward.amount.intValue
                    self.rewardType = adReward.type
                    self.notifyListeners("rewarded", data: [
                        "amount": self.rewardAmount,
                        "type": self.rewardType,
                    ])
                }
            }
        }
    }

    public func ad(_ ad: any FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: any Error) {
        rejectPendingCall("Failed to show rewarded ad: \(error.localizedDescription)")
    }

    public func adDidDismissFullScreenContent(_ ad: any FullScreenPresentingAd) {
        guard let call = pendingCall else {
            resetState()
            return
        }

        call.resolve([
            "completed": true,
            "rewardEarned": rewardEarned,
            "rewardAmount": rewardAmount,
            "rewardType": rewardType,
            "adUnitId": rewardedAd?.adUnitID as Any,
            "adResponseId": adResponseId as Any,
            "mediationAdapterClassName": mediationAdapterClassName as Any,
            "ssvOptionsAttached": ssvOptionsAttached,
            "ssvCustomDataAttached": ssvCustomDataAttached,
            "ssvUserIdAttached": ssvUserIdAttached,
            "ssvCustomDataLength": ssvCustomDataLength,
        ])

        resetState()
    }

    public func adWillPresentFullScreenContent(_ ad: any FullScreenPresentingAd) {}

    private func rejectPendingCall(_ message: String) {
        if let call = pendingCall {
            call.reject(message)
        }
        resetState()
    }

    private func resetState() {
        rewardedAd = nil
        pendingCall = nil
        adFlowInFlight = false
        rewardEarned = false
        rewardAmount = 0
        rewardType = ""
        adResponseId = nil
        mediationAdapterClassName = nil
        ssvOptionsAttached = false
        ssvCustomDataAttached = false
        ssvUserIdAttached = false
        ssvCustomDataLength = 0
    }
}

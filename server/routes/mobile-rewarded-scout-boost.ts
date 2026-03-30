import type { Express, RequestHandler } from "express";
import type { IStorage } from "../storage";
import { storage } from "../storage";
import {
  createRewardedScoutBoostSessionToken,
  getRewardedScoutBoostAdUnitId,
  grantVerifiedRewardedScoutBoost,
  verifyAdMobSsvCallbackUrl,
} from "../services/rewarded-scout-boost";
import { loadUserEntitlements } from "../services/user-entitlements";

type MobileRewardedScoutBoostStorage = Pick<
  IStorage,
  | "getUser"
  | "updateUserPremiumStatus"
  | "getActiveRewardedScoutBoostForUser"
  | "createRewardedScoutBoostGrant"
>;

interface RegisterMobileRewardedScoutBoostRoutesOptions {
  authMiddleware?: RequestHandler;
  storage?: MobileRewardedScoutBoostStorage;
}

function getUserId(req: any): string {
  if (!req.user?.claims?.sub) {
    throw new Error("User not authenticated");
  }

  return req.user.claims.sub;
}

export async function registerMobileRewardedScoutBoostRoutes(
  app: Express,
  options: RegisterMobileRewardedScoutBoostRoutesOptions = {},
) {
  const storageLayer = options.storage ?? storage;

  app.get("/api/mobile/rewarded-scout-boost/admob/ssv", async (req, res) => {
    const callbackUrl = `https://rewarded-scout-boost.local${req.originalUrl}`;

    let verifiedCallback;
    try {
      verifiedCallback = await verifyAdMobSsvCallbackUrl(callbackUrl);
    } catch (error: any) {
      console.warn("[REWARDED_SCOUT_BOOST] Invalid AdMob callback:", error?.message || error);
      return res.status(400).json({ error: "Invalid reward verification callback" });
    }

    try {
      const result = await grantVerifiedRewardedScoutBoost(storageLayer, verifiedCallback);

      if (result.outcome === "granted") {
        console.log(
          `[REWARDED_SCOUT_BOOST] Granted reward session ${result.rewardSessionId} through ${result.expiresAt.toISOString()}`,
        );
      } else {
        console.log(
          `[REWARDED_SCOUT_BOOST] Ignored callback ${verifiedCallback.transactionId}: ${result.outcome}`,
        );
      }

      return res.json({
        success: true,
        outcome: result.outcome,
        rewardSessionId: result.rewardSessionId,
        transactionId: result.transactionId,
        expiresAt: "expiresAt" in result ? result.expiresAt : null,
      });
    } catch (error: any) {
      console.error("[REWARDED_SCOUT_BOOST] Failed to grant reward:", error);
      const message = error?.message || "Failed to grant reward";
      const isValidationError =
        message.includes("custom data") ||
        message.includes("session token") ||
        message.includes("transaction_id") ||
        message.includes("user mismatch");
      return res.status(isValidationError ? 400 : 500).json({ error: message });
    }
  });

  const authMiddleware =
    options.authMiddleware ?? (await import("../supabaseAuth")).isAuthenticated;

  app.post("/api/mobile/rewarded-scout-boost/session", authMiddleware, async (req, res) => {
    try {
      const userId = getUserId(req);
      const userState = await loadUserEntitlements(storageLayer, userId);
      if (!userState) {
        return res.status(404).json({ error: "User not found" });
      }

      if (userState.entitlements.rewardedScoutBoostActive) {
        return res.json({
          eligible: false,
          reason: "already_active",
          premiumActive: userState.entitlements.premiumActive,
          rewardedScoutBoostActive: true,
          rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
          maxScouts: userState.entitlements.maxScouts,
        });
      }

      if (userState.entitlements.premiumActive) {
        return res.json({
          eligible: false,
          reason: "premium_active",
          premiumActive: true,
          rewardedScoutBoostActive: false,
          rewardedScoutBoostExpiresAt: null,
          maxScouts: userState.entitlements.maxScouts,
        });
      }

      const session = createRewardedScoutBoostSessionToken(userId);

      return res.json({
        eligible: true,
        adNetwork: "admob",
        adUnitId: getRewardedScoutBoostAdUnitId(),
        customData: session.customData,
        rewardSessionId: session.rewardSessionId,
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
        boostDurationHours: 12,
        premiumActive: userState.entitlements.premiumActive,
        rewardedScoutBoostActive: false,
        maxScouts: userState.entitlements.maxScouts,
      });
    } catch (error: any) {
      console.error("[REWARDED_SCOUT_BOOST] Failed to create session:", error);
      return res.status(500).json({ error: error.message });
    }
  });
}

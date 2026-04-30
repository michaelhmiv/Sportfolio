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
import { logger } from "../lib/logger";

type MobileRewardedScoutBoostStorage = Pick<
  IStorage,
  | "getUser"
  | "updateUserPremiumStatus"
  | "getActiveRewardedScoutBoostForUser"
  | "getLatestRewardedScoutBoostGrantBySessionId"
  | "createStackedRewardedScoutBoostGrant"
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

function applyNoStore(res: any) {
  res.set("Cache-Control", "no-store, max-age=0");
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
      logger.warn({ err: error }, "[REWARDED_SCOUT_BOOST] Invalid AdMob callback");
      return res.status(400).json({ error: "Invalid reward verification callback" });
    }

    try {
      const result = await grantVerifiedRewardedScoutBoost(storageLayer, verifiedCallback);

      if (result.outcome === "granted") {
        logger.info(
          { rewardSessionId: result.rewardSessionId, expiresAt: result.expiresAt },
          "[REWARDED_SCOUT_BOOST] Granted reward session",
        );
      } else {
        logger.info(
          { transactionId: verifiedCallback.transactionId, outcome: result.outcome },
          "[REWARDED_SCOUT_BOOST] Ignored callback",
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
      logger.error({ err: error }, "[REWARDED_SCOUT_BOOST] Failed to grant reward");
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
    applyNoStore(res);

    try {
      const userId = getUserId(req);
      const userState = await loadUserEntitlements(storageLayer, userId);
      if (!userState) {
        return res.status(404).json({ error: "User not found" });
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
        statusCheckUrl: `/api/mobile/rewarded-scout-boost/session/${session.rewardSessionId}/status`,
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
        boostDurationHours: 12,
        premiumActive: userState.entitlements.premiumActive,
        rewardedScoutBoostActive: userState.entitlements.rewardedScoutBoostActive,
        rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
        maxScouts: userState.entitlements.maxScouts,
      });
    } catch (error: any) {
      logger.error({ err: error }, "[REWARDED_SCOUT_BOOST] Failed to create session");
      return res.status(500).json({ error: error.message });
    }
  });

  app.get(
    "/api/mobile/rewarded-scout-boost/session/:rewardSessionId/status",
    authMiddleware,
    async (req, res) => {
      applyNoStore(res);

      try {
        const userId = getUserId(req);
        const rewardSessionId = String(req.params.rewardSessionId || "").trim();

        if (!rewardSessionId) {
          return res.status(400).json({ error: "rewardSessionId is required" });
        }

        const [userState, grant] = await Promise.all([
          loadUserEntitlements(storageLayer, userId),
          storageLayer.getLatestRewardedScoutBoostGrantBySessionId(userId, rewardSessionId),
        ]);

        if (!userState) {
          return res.status(404).json({ error: "User not found" });
        }

        return res.json({
          outcome: grant ? "granted" : "pending",
          rewardSessionId,
          expiresAt: grant?.expiresAt ?? null,
          premiumActive: userState.entitlements.premiumActive,
          rewardedScoutBoostActive: userState.entitlements.rewardedScoutBoostActive,
          rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
          maxScouts: userState.entitlements.maxScouts,
        });
      } catch (error: any) {
        logger.error(
          { err: error },
          "[REWARDED_SCOUT_BOOST] Failed to load rewarded scout boost session status",
        );
        return res.status(500).json({ error: error.message });
      }
    },
  );
}

import type { Express, RequestHandler } from "express";
import { createHash } from "node:crypto";
import type { IStorage } from "../storage";
import { storage } from "../storage";
import {
  createRewardedScoutBoostSessionToken,
  getRewardedScoutBoostAdUnitId,
  getRewardedScoutBoostCallbackUrl,
  grantClientCompletedRewardedScoutBoost,
  grantVerifiedRewardedScoutBoost,
  verifyAdMobSsvCallbackUrl,
  verifyRewardedScoutBoostCustomData,
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
  | "updateRewardedScoutBoostGrantMetadata"
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

function safeUserPrefix(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

function getGrantMetadataRecord(grant: { metadata?: unknown } | null | undefined) {
  return grant?.metadata && typeof grant.metadata === "object" && !Array.isArray(grant.metadata)
    ? (grant.metadata as Record<string, unknown>)
    : {};
}

function getGrantVerificationStatus(grant: { metadata?: unknown } | null | undefined) {
  const metadata = getGrantMetadataRecord(grant);
  return typeof metadata.verificationStatus === "string" ? metadata.verificationStatus : null;
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

    if (!verifiedCallback.customData) {
      logger.info(
        {
          outcome: "verification_probe",
          transactionId: verifiedCallback.transactionId || null,
          adUnitId: verifiedCallback.adUnitId,
          rewardItem: verifiedCallback.rewardItem,
          rewardAmount: verifiedCallback.rewardAmount,
          keyId: verifiedCallback.keyId,
        },
        "[REWARDED_SCOUT_BOOST] Verified AdMob SSV setup probe",
      );

      return res.json({
        success: true,
        outcome: "verification_probe",
        transactionId: verifiedCallback.transactionId || null,
      });
    }

    try {
      const result = await grantVerifiedRewardedScoutBoost(storageLayer, verifiedCallback);

      if (result.outcome === "granted" || result.outcome === "verified_existing") {
        logger.info(
          {
            rewardSessionId: result.rewardSessionId,
            expiresAt: result.expiresAt,
            outcome: result.outcome,
          },
          "[REWARDED_SCOUT_BOOST] Verified reward session",
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
      const adUnitId = getRewardedScoutBoostAdUnitId();
      logger.info(
        {
          rewardSessionId: session.rewardSessionId,
          userIdHash: safeUserPrefix(userId),
          adUnitId,
          expectedCallbackUrl: getRewardedScoutBoostCallbackUrl(),
          issuedAt: session.issuedAt,
          expiresAt: session.expiresAt,
        },
        "[REWARDED_SCOUT_BOOST] Created reward session",
      );

      return res.json({
        eligible: true,
        adNetwork: "admob",
        adUnitId,
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

  app.post(
    "/api/mobile/rewarded-scout-boost/session/:rewardSessionId/client-complete",
    authMiddleware,
    async (req, res) => {
      applyNoStore(res);

      try {
        const userId = getUserId(req);
        const rewardSessionId = String(req.params.rewardSessionId || "").trim();
        const customData = String(req.body?.customData || "").trim();

        if (!rewardSessionId) {
          return res.status(400).json({ error: "rewardSessionId is required" });
        }

        if (!customData) {
          return res.status(400).json({ error: "customData is required" });
        }

        const result = await grantClientCompletedRewardedScoutBoost(storageLayer, {
          authenticatedUserId: userId,
          rewardSessionId,
          customData,
          adUnitId: req.body?.adUnitId,
          rewardAmount:
            typeof req.body?.rewardAmount === "number" ? req.body.rewardAmount : undefined,
          rewardType: req.body?.rewardType,
        });

        logger.info(
          {
            rewardSessionId: result.rewardSessionId,
            userIdHash: safeUserPrefix(userId),
            outcome: result.outcome,
            expiresAt: "expiresAt" in result ? result.expiresAt : null,
          },
          "[REWARDED_SCOUT_BOOST] Client reward callback recorded",
        );

        return res.json({
          success: true,
          outcome: result.outcome,
          rewardSessionId: result.rewardSessionId,
          transactionId: result.transactionId,
          expiresAt: "expiresAt" in result ? result.expiresAt : null,
          verificationStatus: result.outcome === "granted" ? "pending_ssv" : undefined,
          rewardedScoutBoostActive: "expiresAt" in result && Boolean(result.expiresAt),
          rewardedScoutBoostExpiresAt: "expiresAt" in result ? result.expiresAt : null,
          maxScouts: "expiresAt" in result && result.expiresAt ? 10 : 5,
        });
      } catch (error: any) {
        logger.error({ err: error }, "[REWARDED_SCOUT_BOOST] Failed to record client reward");
        const message = error?.message || "Failed to record client reward";
        const isValidationError =
          message.includes("custom data") ||
          message.includes("session") ||
          message.includes("user mismatch");
        return res.status(isValidationError ? 400 : 500).json({ error: message });
      }
    },
  );

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

        const [userState, initialGrant] = await Promise.all([
          loadUserEntitlements(storageLayer, userId),
          storageLayer.getLatestRewardedScoutBoostGrantBySessionId(userId, rewardSessionId),
        ]);

        if (!userState) {
          return res.status(404).json({ error: "User not found" });
        }

        let grant = initialGrant;
        const metadata = getGrantMetadataRecord(grant);
        const verificationStatus = getGrantVerificationStatus(grant);
        const clientCompletedAt =
          typeof metadata.clientCompletedAt === "string"
            ? Date.parse(metadata.clientCompletedAt)
            : Number.NaN;
        const pendingAgeMs =
          verificationStatus === "pending_ssv" && Number.isFinite(clientCompletedAt)
            ? Math.max(0, Date.now() - clientCompletedAt)
            : null;
        const ssvMissingAfter =
          typeof metadata.ssvMissingAfter === "string"
            ? Date.parse(metadata.ssvMissingAfter)
            : Number.NaN;

        let effectiveVerificationStatus = verificationStatus;
        if (
          grant &&
          verificationStatus === "pending_ssv" &&
          Number.isFinite(ssvMissingAfter) &&
          Date.now() >= ssvMissingAfter
        ) {
          grant = await storageLayer.updateRewardedScoutBoostGrantMetadata(grant.id, {
            ...metadata,
            verificationStatus: "ssv_missing",
            ssvMissingMarkedAt: new Date().toISOString(),
          });
          effectiveVerificationStatus = "ssv_missing";
        }

        logger.info(
          {
            rewardSessionId,
            userIdHash: safeUserPrefix(userId),
            outcome: grant ? "granted" : "pending",
            hasGrant: Boolean(grant),
            grantVerificationStatus: effectiveVerificationStatus,
            pendingAgeMs,
          },
          "[REWARDED_SCOUT_BOOST] Session status poll",
        );

        return res.json({
          outcome: grant ? "granted" : "pending",
          rewardSessionId,
          expiresAt: grant?.expiresAt ?? null,
          premiumActive: userState.entitlements.premiumActive,
          rewardedScoutBoostActive: userState.entitlements.rewardedScoutBoostActive,
          rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
          maxScouts: userState.entitlements.maxScouts,
          verificationStatus: effectiveVerificationStatus,
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

  app.get(
    "/api/admin/rewarded-scout-boost/session/:rewardSessionId",
    authMiddleware,
    async (req: any, res) => {
      applyNoStore(res);

      const adminUserId = req.user?.claims?.sub;
      const adminUser = adminUserId ? await storageLayer.getUser(adminUserId) : undefined;
      if (!adminUser?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      try {
        const rewardSessionId = String(req.params.rewardSessionId || "").trim();
        const customData = String(req.query.customData || "").trim();
        const userId = customData
          ? verifyRewardedScoutBoostCustomData(customData).uid
          : String(req.query.userId || "").trim();

        if (!rewardSessionId || !userId) {
          return res.status(400).json({
            error: "rewardSessionId and either userId or customData are required",
          });
        }

        const grant = await storageLayer.getLatestRewardedScoutBoostGrantBySessionId(
          userId,
          rewardSessionId,
        );

        return res.json({
          rewardSessionId,
          userIdHash: safeUserPrefix(userId),
          found: Boolean(grant),
          grant: grant
            ? {
                id: grant.id,
                expiresAt: grant.expiresAt,
                grantedAt: grant.grantedAt,
                revokedAt: grant.revokedAt,
                transactionId: grant.transactionId,
                metadata: grant.metadata,
              }
            : null,
        });
      } catch (error: any) {
        logger.error(
          { err: error },
          "[REWARDED_SCOUT_BOOST] Failed to load admin rewarded scout boost session",
        );
        return res.status(500).json({ error: error.message });
      }
    },
  );
}

import express, { type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRewardedScoutBoostSessionToken } from "../services/rewarded-scout-boost";
import { registerMobileRewardedScoutBoostRoutes } from "./mobile-rewarded-scout-boost";

function createTestServer() {
  const app = express();
  app.use(express.json());
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    app,
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

describe("registerMobileRewardedScoutBoostRoutes", () => {
  beforeEach(() => {
    process.env.REWARDED_SCOUT_BOOST_SECRET = "test-rewarded-scout-secret";
    delete process.env.ADMOB_REWARDED_SCOUT_AD_UNIT_ID;
  });

  afterEach(() => {
    delete process.env.REWARDED_SCOUT_BOOST_SECRET;
    delete process.env.ADMOB_REWARDED_SCOUT_AD_UNIT_ID;
  });

  it("serves the public AdMob SSV route before a later API 404 handler", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (_req, _res, next) => {
      next();
    };

    await registerMobileRewardedScoutBoostRoutes(app, {
      authMiddleware,
      storage: {
        getUser: vi.fn(),
        updateUserPremiumStatus: vi.fn(),
        getActiveRewardedScoutBoostForUser: vi.fn(),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn(),
        createStackedRewardedScoutBoostGrant: vi.fn(),
        updateRewardedScoutBoostGrantMetadata: vi.fn(),
      },
    });
    app.use("/api", (_req, res) => {
      res.status(404).json({ error: "Not found" });
    });

    try {
      const response = await fetch(`${baseUrl}/api/mobile/rewarded-scout-boost/admob/ssv`);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "Invalid reward verification callback",
      });
    } finally {
      await close();
    }
  });

  it("creates an authenticated rewarded scout boost session", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-session" } };
      next();
    };

    await registerMobileRewardedScoutBoostRoutes(app, {
      authMiddleware,
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "user-session",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn(),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue(undefined),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn().mockResolvedValue(undefined),
        createStackedRewardedScoutBoostGrant: vi.fn(),
        updateRewardedScoutBoostGrantMetadata: vi.fn(),
      },
    });
    app.use("/api", (_req, res) => {
      res.status(404).json({ error: "Not found" });
    });

    try {
      const response = await fetch(`${baseUrl}/api/mobile/rewarded-scout-boost/session`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        eligible: true,
        adNetwork: "admob",
        statusCheckUrl: expect.stringContaining("/api/mobile/rewarded-scout-boost/session/"),
        boostDurationHours: 12,
        premiumActive: false,
        rewardedScoutBoostActive: false,
        maxScouts: 5,
      });
    } finally {
      await close();
    }
  });

  it("creates a new rewarded scout boost session while an existing boost is active", async () => {
    const { app, baseUrl, close } = createTestServer();
    const activeExpiresAt = new Date("2099-04-15T12:00:00.000Z");
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-active-reward" } };
      next();
    };

    await registerMobileRewardedScoutBoostRoutes(app, {
      authMiddleware,
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "user-active-reward",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn(),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue({
          expiresAt: activeExpiresAt,
          revokedAt: null,
        }),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn().mockResolvedValue(undefined),
        createStackedRewardedScoutBoostGrant: vi.fn(),
        updateRewardedScoutBoostGrantMetadata: vi.fn(),
      },
    });
    app.use("/api", (_req, res) => {
      res.status(404).json({ error: "Not found" });
    });

    try {
      const response = await fetch(`${baseUrl}/api/mobile/rewarded-scout-boost/session`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        eligible: true,
        adNetwork: "admob",
        statusCheckUrl: expect.stringContaining("/api/mobile/rewarded-scout-boost/session/"),
        boostDurationHours: 12,
        premiumActive: false,
        rewardedScoutBoostActive: true,
        rewardedScoutBoostExpiresAt: activeExpiresAt.toISOString(),
        maxScouts: 10,
      });
    } finally {
      await close();
    }
  });

  it("marks premium users as ineligible for rewarded scout boost sessions", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-premium" } };
      next();
    };

    await registerMobileRewardedScoutBoostRoutes(app, {
      authMiddleware,
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "user-premium",
          isPremium: true,
          premiumExpiresAt: new Date("2099-04-15T00:00:00.000Z"),
        }),
        updateUserPremiumStatus: vi.fn(),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue(undefined),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn().mockResolvedValue(undefined),
        createStackedRewardedScoutBoostGrant: vi.fn(),
        updateRewardedScoutBoostGrantMetadata: vi.fn(),
      },
    });
    app.use("/api", (_req, res) => {
      res.status(404).json({ error: "Not found" });
    });

    try {
      const response = await fetch(`${baseUrl}/api/mobile/rewarded-scout-boost/session`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        eligible: false,
        reason: "premium_active",
        premiumActive: true,
        rewardedScoutBoostActive: false,
        maxScouts: 10,
      });
    } finally {
      await close();
    }
  });

  it("returns pending status for a reward session before the SSV grant lands", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-status-pending" } };
      next();
    };

    await registerMobileRewardedScoutBoostRoutes(app, {
      authMiddleware,
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "user-status-pending",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn(),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue(undefined),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn().mockResolvedValue(undefined),
        createStackedRewardedScoutBoostGrant: vi.fn(),
        updateRewardedScoutBoostGrantMetadata: vi.fn(),
      },
    });

    try {
      const response = await fetch(
        `${baseUrl}/api/mobile/rewarded-scout-boost/session/session-pending/status`,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        outcome: "pending",
        rewardSessionId: "session-pending",
        rewardedScoutBoostActive: false,
        maxScouts: 5,
      });
    } finally {
      await close();
    }
  });

  it("returns granted status for a reward session after the SSV grant lands", async () => {
    const { app, baseUrl, close } = createTestServer();
    const grantedExpiresAt = new Date("2099-04-16T00:00:00.000Z");
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-status-granted" } };
      next();
    };

    await registerMobileRewardedScoutBoostRoutes(app, {
      authMiddleware,
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "user-status-granted",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn(),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue({
          expiresAt: grantedExpiresAt,
          revokedAt: null,
        }),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn().mockResolvedValue({
          expiresAt: grantedExpiresAt,
          revokedAt: null,
        }),
        createStackedRewardedScoutBoostGrant: vi.fn(),
        updateRewardedScoutBoostGrantMetadata: vi.fn(),
      },
    });

    try {
      const response = await fetch(
        `${baseUrl}/api/mobile/rewarded-scout-boost/session/session-granted/status`,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        outcome: "granted",
        rewardSessionId: "session-granted",
        expiresAt: grantedExpiresAt.toISOString(),
        rewardedScoutBoostActive: true,
        rewardedScoutBoostExpiresAt: grantedExpiresAt.toISOString(),
        maxScouts: 10,
      });
    } finally {
      await close();
    }
  });

  it("flags provisional grants when SSV is still missing after the review timeout", async () => {
    const { app, baseUrl, close } = createTestServer();
    const grantedExpiresAt = new Date("2099-04-16T00:00:00.000Z");
    const provisionalGrant = {
      id: "grant-ssv-missing",
      expiresAt: grantedExpiresAt,
      revokedAt: null,
      metadata: {
        verificationStatus: "pending_ssv",
        clientCompletedAt: "2026-04-30T10:00:00.000Z",
        ssvMissingAfter: "2026-04-30T10:05:00.000Z",
      },
    };
    const updateRewardedScoutBoostGrantMetadata = vi.fn().mockResolvedValue({
      ...provisionalGrant,
      metadata: {
        ...provisionalGrant.metadata,
        verificationStatus: "ssv_missing",
        ssvMissingMarkedAt: "2026-04-30T10:10:00.000Z",
      },
    });
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-status-ssv-missing" } };
      next();
    };

    await registerMobileRewardedScoutBoostRoutes(app, {
      authMiddleware,
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "user-status-ssv-missing",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn(),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue({
          expiresAt: grantedExpiresAt,
          revokedAt: null,
        }),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn().mockResolvedValue(provisionalGrant),
        createStackedRewardedScoutBoostGrant: vi.fn(),
        updateRewardedScoutBoostGrantMetadata,
      },
    });

    try {
      const response = await fetch(
        `${baseUrl}/api/mobile/rewarded-scout-boost/session/session-ssv-missing/status`,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        outcome: "granted",
        rewardSessionId: "session-ssv-missing",
        verificationStatus: "ssv_missing",
        rewardedScoutBoostActive: true,
        maxScouts: 10,
      });
      expect(updateRewardedScoutBoostGrantMetadata).toHaveBeenCalledWith(
        "grant-ssv-missing",
        expect.objectContaining({ verificationStatus: "ssv_missing" }),
      );
    } finally {
      await close();
    }
  });

  it("grants provisional scout boost time when Android reports the rewarded callback", async () => {
    const { app, baseUrl, close } = createTestServer();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const session = createRewardedScoutBoostSessionToken(
      "user-client-complete",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-client-complete" } };
      next();
    };
    const createStackedRewardedScoutBoostGrant = vi.fn().mockResolvedValue({
      id: "grant-client-complete",
      userId: "user-client-complete",
      rewardSessionId: session.rewardSessionId,
      transactionId: `client:${session.rewardSessionId}`,
      expiresAt,
      grantedAt: now,
      rewardedAt: now,
      revokedAt: null,
      metadata: { verificationStatus: "pending_ssv" },
    });

    await registerMobileRewardedScoutBoostRoutes(app, {
      authMiddleware,
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "user-client-complete",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn(),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue(undefined),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn().mockResolvedValue(undefined),
        createStackedRewardedScoutBoostGrant,
        updateRewardedScoutBoostGrantMetadata: vi.fn(),
      },
    });

    try {
      const response = await fetch(
        `${baseUrl}/api/mobile/rewarded-scout-boost/session/${session.rewardSessionId}/client-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customData: session.customData,
            adUnitId: "ca-app-pub-2708638041809482/7806162422",
            adResponseId: "response-route-123",
            mediationAdapterClassName: "com.google.ads.mediation.admob.AdMobAdapter",
            ssvOptionsAttached: true,
            ssvCustomDataAttached: true,
            ssvUserIdAttached: true,
            ssvCustomDataLength: session.customData.length,
            rewardAmount: 1,
            rewardType: "scout_boost",
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        outcome: "granted",
        rewardSessionId: session.rewardSessionId,
        verificationStatus: "pending_ssv",
        rewardedScoutBoostActive: true,
        maxScouts: 10,
      });
      expect(createStackedRewardedScoutBoostGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: `client:${session.rewardSessionId}`,
          metadata: expect.objectContaining({
            verificationStatus: "pending_ssv",
            androidAdDiagnostics: expect.objectContaining({
              adResponseId: "response-route-123",
              ssvOptionsAttached: true,
              ssvCustomDataAttached: true,
              ssvUserIdAttached: true,
              ssvCustomDataLength: session.customData.length,
            }),
          }),
        }),
        12 * 60 * 60 * 1000,
        expect.any(Date),
      );
    } finally {
      await close();
    }
  });
});

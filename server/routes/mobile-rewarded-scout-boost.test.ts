import express, { type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});

import express, { type RequestHandler } from "express";
import { describe, expect, it, vi } from "vitest";
import { registerMobilePushNotificationRoutes } from "./mobile-push-notifications";

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

function createNotificationSyncMocks() {
  return {
    registerNotificationDevice: vi.fn().mockResolvedValue({
      isNewToken: false,
      isNewDeviceForUser: false,
    }),
    unregisterNotificationDevice: vi.fn().mockResolvedValue({ disabledCount: 0 }),
  };
}

describe("registerMobilePushNotificationRoutes", () => {
  it("registers an android push token for the authenticated user", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-123" } };
      next();
    };

    const storageMock = {
      upsertUserPushToken: vi.fn().mockResolvedValue(undefined),
      deactivateUserPushTokens: vi.fn().mockResolvedValue(0),
      listActiveUserPushTokens: vi.fn().mockResolvedValue([]),
      getUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      upsertUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      getPushNotificationEvents: vi.fn().mockResolvedValue([]),
    };
    const syncMocks = createNotificationSyncMocks();

    await registerMobilePushNotificationRoutes(app, {
      authMiddleware,
      storage: storageMock,
      ...syncMocks,
    });
    app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

    try {
      const response = await fetch(`${baseUrl}/api/mobile/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "fcm_token_abcdefghijklmnopqrstuvwxyz123456",
          platform: "android",
          deviceId: "device-1",
        }),
      });

      expect(response.status).toBe(200);
      expect(storageMock.upsertUserPushToken).toHaveBeenCalledWith({
        userId: "user-123",
        platform: "android",
        token: "fcm_token_abcdefghijklmnopqrstuvwxyz123456",
        deviceId: "device-1",
        appVersion: null,
        osVersion: null,
        deviceModel: null,
      });
      expect(syncMocks.registerNotificationDevice).toHaveBeenCalledWith({
        userId: "user-123",
        platform: "android",
        token: "fcm_token_abcdefghijklmnopqrstuvwxyz123456",
        deviceId: "device-1",
        appVersion: undefined,
        permissionStatus: "granted",
      });
    } finally {
      await close();
    }
  });

  it("rejects malformed push token payloads", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-123" } };
      next();
    };
    const syncMocks = createNotificationSyncMocks();

    await registerMobilePushNotificationRoutes(app, {
      authMiddleware,
      storage: {
        upsertUserPushToken: vi.fn(),
        deactivateUserPushTokens: vi.fn(),
        listActiveUserPushTokens: vi.fn().mockResolvedValue([]),
        getUserNotificationPreferences: vi.fn().mockResolvedValue([]),
        upsertUserNotificationPreferences: vi.fn().mockResolvedValue([]),
        getPushNotificationEvents: vi.fn().mockResolvedValue([]),
      },
      ...syncMocks,
    });
    app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

    try {
      const response = await fetch(`${baseUrl}/api/mobile/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "short" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "Invalid push token" });
      expect(syncMocks.registerNotificationDevice).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("reads and updates notification preferences", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-123" } };
      next();
    };

    const getPreferences = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "pref_1",
          userId: "user-123",
          notificationType: "watchlist_news",
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

    const storageMock = {
      upsertUserPushToken: vi.fn(),
      deactivateUserPushTokens: vi.fn().mockResolvedValue(0),
      getPushNotificationEventById: vi.fn(),
      updatePushNotificationEvent: vi.fn(),
      listActiveUserPushTokens: vi.fn().mockResolvedValue([]),
      getUserNotificationPreferences: getPreferences,
      upsertUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      getPushNotificationEvents: vi.fn().mockResolvedValue([]),
    };
    const syncMocks = createNotificationSyncMocks();

    await registerMobilePushNotificationRoutes(app, {
      authMiddleware,
      storage: storageMock,
      ...syncMocks,
    });
    app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

    try {
      const initial = await fetch(`${baseUrl}/api/notifications/preferences`);
      expect(initial.status).toBe(200);
      const initialPayload = await initial.json();
      expect(initialPayload.preferences.watchlist_news).toBe(false);
      expect(initialPayload.preferences.boost_settled).toBe(true);

      const update = await fetch(`${baseUrl}/api/notifications/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: {
            watchlist_news: true,
            scout_complete: true,
          },
        }),
      });

      expect(update.status).toBe(200);
      expect(storageMock.upsertUserNotificationPreferences).toHaveBeenCalledWith("user-123", [
        { notificationType: "watchlist_news", enabled: true },
        { notificationType: "scout_complete", enabled: true },
      ]);
      await expect(update.json()).resolves.toMatchObject({
        updatedCount: 2,
      });
    } finally {
      await close();
    }
  });

  it("returns push status diagnostics for the current Android device", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-123" } };
      next();
    };

    const storageMock = {
      upsertUserPushToken: vi.fn(),
      deactivateUserPushTokens: vi.fn().mockResolvedValue(0),
      getPushNotificationEventById: vi.fn(),
      updatePushNotificationEvent: vi.fn(),
      listActiveUserPushTokens: vi.fn().mockResolvedValue([
        {
          id: "tok_1",
          userId: "user-123",
          token: "fcm_token_abcdefghijklmnopqrstuvwxyz123456",
          platform: "android",
          deviceId: "device-1",
          isActive: true,
          lastRegisteredAt: new Date("2026-04-20T10:00:00Z"),
          lastSuccessfulAt: new Date("2026-04-20T11:00:00Z"),
          lastFailureAt: null,
          lastError: null,
        },
      ]),
      getUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      upsertUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      getPushNotificationEvents: vi.fn().mockResolvedValue([
        {
          id: "evt_1",
          userId: "user-123",
          notificationType: "boost_settled",
          title: "Boost settled",
          body: "Done",
          route: "/boosts",
          deliveryStatus: "sent",
          metadata: { openedAt: "2026-04-20T11:07:00Z" },
          createdAt: new Date("2026-04-20T11:05:00Z"),
          sentAt: new Date("2026-04-20T11:05:10Z"),
        },
      ]),
    };
    const syncMocks = createNotificationSyncMocks();

    await registerMobilePushNotificationRoutes(app, {
      authMiddleware,
      storage: storageMock as any,
      ...syncMocks,
    });
    app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

    try {
      const response = await fetch(`${baseUrl}/api/mobile/push/status?deviceId=device-1`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        activeTokenCount: 1,
        currentDevice: {
          deviceId: "device-1",
          registered: true,
          lastError: null,
        },
        diagnostics: {
          runtime: "firebase-admin",
          platform: "android",
          deviceCount: 1,
        },
        recentEvents: [
          expect.objectContaining({
            notificationType: "boost_settled",
            deliveryStatus: "sent",
            route: "/boosts",
            metadata: expect.objectContaining({
              openedAt: "2026-04-20T11:07:00Z",
            }),
          }),
        ],
      });
    } finally {
      await close();
    }
  });

  it("marks a push event as opened for the authenticated user", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-123" } };
      next();
    };

    const storageMock = {
      upsertUserPushToken: vi.fn(),
      deactivateUserPushTokens: vi.fn().mockResolvedValue(0),
      getPushNotificationEventById: vi.fn().mockResolvedValue({
        id: "evt_1",
        userId: "user-123",
        route: "/boosts",
        deliveryStatus: "sent",
        metadata: {},
      }),
      updatePushNotificationEvent: vi.fn().mockResolvedValue(undefined),
      listActiveUserPushTokens: vi.fn().mockResolvedValue([]),
      getUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      upsertUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      getPushNotificationEvents: vi.fn().mockResolvedValue([]),
    };
    const syncMocks = createNotificationSyncMocks();

    await registerMobilePushNotificationRoutes(app, {
      authMiddleware,
      storage: storageMock as any,
      ...syncMocks,
    });
    app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

    try {
      const response = await fetch(`${baseUrl}/api/mobile/push/opened`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: "evt_1",
          route: "/boosts",
          openedFrom: "tap",
        }),
      });

      expect(response.status).toBe(200);
      expect(storageMock.updatePushNotificationEvent).toHaveBeenCalledWith(
        "evt_1",
        expect.objectContaining({
          deliveryStatus: "opened",
          metadata: expect.objectContaining({
            openedFrom: "tap",
            lastOpenedRoute: "/boosts",
          }),
        }),
      );
    } finally {
      await close();
    }
  });

  it("deactivates matching android tokens in both token stores on unregister", async () => {
    const { app, baseUrl, close } = createTestServer();
    const authMiddleware: RequestHandler = (req: any, _res, next) => {
      req.user = { claims: { sub: "user-123" } };
      next();
    };

    const storageMock = {
      upsertUserPushToken: vi.fn(),
      deactivateUserPushTokens: vi.fn().mockResolvedValue(1),
      getPushNotificationEventById: vi.fn(),
      updatePushNotificationEvent: vi.fn(),
      listActiveUserPushTokens: vi.fn().mockResolvedValue([]),
      getUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      upsertUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      getPushNotificationEvents: vi.fn().mockResolvedValue([]),
    };
    const syncMocks = createNotificationSyncMocks();

    await registerMobilePushNotificationRoutes(app, {
      authMiddleware,
      storage: storageMock as any,
      ...syncMocks,
    });
    app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

    try {
      const response = await fetch(`${baseUrl}/api/mobile/push/unregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "fcm_token_abcdefghijklmnopqrstuvwxyz123456",
          reason: "logout",
        }),
      });

      expect(response.status).toBe(200);
      expect(storageMock.deactivateUserPushTokens).toHaveBeenCalledWith("user-123", {
        token: "fcm_token_abcdefghijklmnopqrstuvwxyz123456",
        deviceId: undefined,
        reason: "logout",
      });
      expect(syncMocks.unregisterNotificationDevice).toHaveBeenCalledWith({
        userId: "user-123",
        token: "fcm_token_abcdefghijklmnopqrstuvwxyz123456",
        deviceId: undefined,
      });
    } finally {
      await close();
    }
  });
});

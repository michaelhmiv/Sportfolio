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
      getUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      upsertUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      getPushNotificationEvents: vi.fn().mockResolvedValue([]),
    };

    await registerMobilePushNotificationRoutes(app, {
      authMiddleware,
      storage: storageMock,
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

    await registerMobilePushNotificationRoutes(app, {
      authMiddleware,
      storage: {
        upsertUserPushToken: vi.fn(),
        deactivateUserPushTokens: vi.fn(),
        getUserNotificationPreferences: vi.fn().mockResolvedValue([]),
        upsertUserNotificationPreferences: vi.fn().mockResolvedValue([]),
        getPushNotificationEvents: vi.fn().mockResolvedValue([]),
      },
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
      getUserNotificationPreferences: getPreferences,
      upsertUserNotificationPreferences: vi.fn().mockResolvedValue([]),
      getPushNotificationEvents: vi.fn().mockResolvedValue([]),
    };

    await registerMobilePushNotificationRoutes(app, {
      authMiddleware,
      storage: storageMock,
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
});

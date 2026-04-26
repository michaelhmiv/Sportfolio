import type { Express, RequestHandler } from "express";
import {
  resolvePushNotificationPreferences,
  isPushNotificationType,
} from "@shared/push-notifications";
import { storage, type IStorage } from "../storage";
import { hasFirebasePushCredentialsConfigured } from "../services/push-notifications";

type MobilePushStorage = Pick<
  IStorage,
  | "upsertUserPushToken"
  | "deactivateUserPushTokens"
  | "listActiveUserPushTokens"
  | "getUserNotificationPreferences"
  | "upsertUserNotificationPreferences"
  | "getPushNotificationEvents"
>;

interface RegisterMobilePushNotificationRoutesOptions {
  authMiddleware?: RequestHandler;
  storage?: MobilePushStorage;
}

function getUserId(req: any): string {
  if (!req.user?.claims?.sub) {
    throw new Error("User not authenticated");
  }

  return req.user.claims.sub;
}

function parseBooleanPreferences(
  value: unknown,
): Array<{ notificationType: string; enabled: boolean }> {
  if (!value || typeof value !== "object") {
    return [];
  }

  const updates: Array<{ notificationType: string; enabled: boolean }> = [];
  for (const [notificationType, enabled] of Object.entries(value as Record<string, unknown>)) {
    if (!isPushNotificationType(notificationType)) continue;
    if (typeof enabled !== "boolean") continue;
    updates.push({ notificationType, enabled });
  }

  return updates;
}

function isLikelyFcmToken(token: string): boolean {
  // FCM tokens are long opaque strings and should never include whitespace.
  return token.length >= 20 && token.length <= 4096 && !/\s/.test(token);
}

export async function registerMobilePushNotificationRoutes(
  app: Express,
  options: RegisterMobilePushNotificationRoutesOptions = {},
) {
  const storageLayer = options.storage ?? storage;
  const authMiddleware =
    options.authMiddleware ?? (await import("../supabaseAuth")).isAuthenticated;

  app.post("/api/mobile/push/register", authMiddleware, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      const platform =
        typeof req.body?.platform === "string" ? req.body.platform.trim() : "android";

      if (platform.toLowerCase() !== "android") {
        return res.status(400).json({ error: "Only android platform is supported" });
      }

      if (!isLikelyFcmToken(token)) {
        return res.status(400).json({ error: "Invalid push token" });
      }

      console.info("[MOBILE_PUSH] Registering Android token", {
        userId,
        deviceId: typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : null,
      });

      await storageLayer.upsertUserPushToken({
        userId,
        platform: "android",
        token,
        deviceId: typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : null,
        appVersion: typeof req.body?.appVersion === "string" ? req.body.appVersion.trim() : null,
        osVersion: typeof req.body?.osVersion === "string" ? req.body.osVersion.trim() : null,
        deviceModel: typeof req.body?.deviceModel === "string" ? req.body.deviceModel.trim() : null,
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error("[MOBILE_PUSH] Failed to register token:", error);
      return res.status(500).json({ error: error?.message || "Failed to register push token" });
    }
  });

  app.post("/api/mobile/push/unregister", authMiddleware, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";

      if (!token && !deviceId) {
        return res.status(400).json({ error: "token or deviceId is required" });
      }

      const deactivated = await storageLayer.deactivateUserPushTokens(userId, {
        token: token || undefined,
        deviceId: deviceId || undefined,
        reason: typeof req.body?.reason === "string" ? req.body.reason.trim() : "user_logout",
      });

      console.info("[MOBILE_PUSH] Deactivated Android tokens", {
        userId,
        deviceId: deviceId || null,
        deactivated,
      });

      return res.json({ success: true, deactivated });
    } catch (error: any) {
      console.error("[MOBILE_PUSH] Failed to unregister token:", error);
      return res.status(500).json({ error: error?.message || "Failed to unregister push token" });
    }
  });

  app.get("/api/mobile/push/status", authMiddleware, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId.trim() : "";
      const tokens = await storageLayer.listActiveUserPushTokens(userId, "android");
      const currentDeviceToken = deviceId
        ? tokens.find((token) => token.deviceId === deviceId) || null
        : null;
      const events = await storageLayer.getPushNotificationEvents(userId, { limit: 10, offset: 0 });

      return res.json({
        providerConfigured: hasFirebasePushCredentialsConfigured(),
        activeTokenCount: tokens.length,
        currentDevice: {
          deviceId: deviceId || null,
          registered: Boolean(currentDeviceToken),
          lastRegisteredAt: currentDeviceToken?.lastRegisteredAt ?? null,
          lastSuccessfulAt: currentDeviceToken?.lastSuccessfulAt ?? null,
          lastFailureAt: currentDeviceToken?.lastFailureAt ?? null,
          lastError: currentDeviceToken?.lastError ?? null,
        },
        recentEvents: events.map((event) => ({
          id: event.id,
          notificationType: event.notificationType,
          title: event.title,
          deliveryStatus: event.deliveryStatus,
          createdAt: event.createdAt,
          sentAt: event.sentAt,
          route: event.route,
        })),
      });
    } catch (error: any) {
      console.error("[MOBILE_PUSH] Failed to load push status:", error);
      return res.status(500).json({ error: error?.message || "Failed to load push status" });
    }
  });

  app.get("/api/notifications/preferences", authMiddleware, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const rows = await storageLayer.getUserNotificationPreferences(userId);
      const overrides = Object.fromEntries(rows.map((row) => [row.notificationType, row.enabled]));

      return res.json({
        preferences: resolvePushNotificationPreferences(overrides),
      });
    } catch (error: any) {
      console.error("[MOBILE_PUSH] Failed to load notification preferences:", error);
      return res
        .status(500)
        .json({ error: error?.message || "Failed to load notification preferences" });
    }
  });

  app.put("/api/notifications/preferences", authMiddleware, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const updates = parseBooleanPreferences(req.body?.preferences);

      if (updates.length > 0) {
        await storageLayer.upsertUserNotificationPreferences(userId, updates);
      }

      const rows = await storageLayer.getUserNotificationPreferences(userId);
      const overrides = Object.fromEntries(rows.map((row) => [row.notificationType, row.enabled]));

      return res.json({
        preferences: resolvePushNotificationPreferences(overrides),
        updatedCount: updates.length,
      });
    } catch (error: any) {
      console.error("[MOBILE_PUSH] Failed to update notification preferences:", error);
      return res
        .status(500)
        .json({ error: error?.message || "Failed to update notification preferences" });
    }
  });

  app.get("/api/notifications/history", authMiddleware, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const limit = Number.parseInt(String(req.query.limit || "50"), 10);
      const offset = Number.parseInt(String(req.query.offset || "0"), 10);
      const events = await storageLayer.getPushNotificationEvents(userId, {
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
      });

      return res.json({
        events,
      });
    } catch (error: any) {
      console.error("[MOBILE_PUSH] Failed to load notification history:", error);
      return res
        .status(500)
        .json({ error: error?.message || "Failed to load notification history" });
    }
  });
}

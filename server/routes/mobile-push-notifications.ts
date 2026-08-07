import type { Express, RequestHandler } from "express";
import {
  resolvePushNotificationPreferences,
  isPushNotificationType,
} from "@shared/push-notifications";
import { storage, type IStorage } from "../storage";
import { ensureFirebasePushProviderDiagnostics } from "../services/push-notifications";
import {
  registerPushDevice,
  unregisterPushDevice,
  type RegisterPushDeviceInput,
} from "../services/notification-settings";

type MobilePushStorage = Pick<
  IStorage,
  | "upsertUserPushToken"
  | "deactivateUserPushTokens"
  | "listActiveUserPushTokens"
  | "getPushNotificationEventById"
  | "updatePushNotificationEvent"
  | "getUserNotificationPreferences"
  | "upsertUserNotificationPreferences"
  | "getPushNotificationEvents"
>;

interface RegisterMobilePushNotificationRoutesOptions {
  authMiddleware?: RequestHandler;
  storage?: MobilePushStorage;
  registerNotificationDevice?: (
    input: RegisterPushDeviceInput,
  ) => Promise<{ isNewToken: boolean; isNewDeviceForUser: boolean }>;
  unregisterNotificationDevice?: (input: {
    userId: string;
    token?: string;
    deviceId?: string;
  }) => Promise<{ disabledCount: number }>;
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

function normalizePermissionStatus(value: unknown): RegisterPushDeviceInput["permissionStatus"] {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (
    normalized === "prompt" ||
    normalized === "prompt-with-rationale" ||
    normalized === "granted" ||
    normalized === "denied"
  ) {
    return normalized;
  }

  return undefined;
}

function mergeEventMetadata(
  event: { metadata: unknown } | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    event?.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : {};

  return {
    ...base,
    ...patch,
  };
}

export async function registerMobilePushNotificationRoutes(
  app: Express,
  options: RegisterMobilePushNotificationRoutesOptions = {},
) {
  const storageLayer = options.storage ?? storage;
  const registerNotificationDevice = options.registerNotificationDevice ?? registerPushDevice;
  const unregisterNotificationDevice = options.unregisterNotificationDevice ?? unregisterPushDevice;
  const authMiddleware =
    options.authMiddleware ?? (await import("../auth/runtime-auth")).isAuthenticated;

  app.post("/api/mobile/push/register", authMiddleware, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      const platform =
        typeof req.body?.platform === "string" ? req.body.platform.trim() : "android";
      const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
      const appVersion = typeof req.body?.appVersion === "string" ? req.body.appVersion.trim() : "";
      const osVersion =
        typeof req.body?.osVersion === "string" ? req.body.osVersion.trim().slice(0, 255) : "";
      const deviceModel =
        typeof req.body?.deviceModel === "string" ? req.body.deviceModel.trim().slice(0, 255) : "";
      const permissionStatus = normalizePermissionStatus(req.body?.permissionStatus) ?? "granted";

      if (platform.toLowerCase() !== "android") {
        return res.status(400).json({ error: "Only android platform is supported" });
      }

      if (!isLikelyFcmToken(token)) {
        return res.status(400).json({ error: "Invalid push token" });
      }

      console.info("[MOBILE_PUSH] Registering Android token", {
        userId,
        deviceId: deviceId || null,
      });

      await storageLayer.upsertUserPushToken({
        userId,
        platform: "android",
        token,
        deviceId: deviceId || null,
        appVersion: appVersion || null,
        osVersion: osVersion || null,
        deviceModel: deviceModel || null,
      });
      await registerNotificationDevice({
        userId,
        platform: "android",
        token,
        deviceId: deviceId || undefined,
        appVersion: appVersion || undefined,
        permissionStatus,
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
      await unregisterNotificationDevice({
        userId,
        token: token || undefined,
        deviceId: deviceId || undefined,
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
      const providerDiagnostics = await ensureFirebasePushProviderDiagnostics();
      const tokens = await storageLayer.listActiveUserPushTokens(userId, "android");
      const currentDeviceToken = deviceId
        ? tokens.find((token) => token.deviceId === deviceId) || null
        : null;
      const events = await storageLayer.getPushNotificationEvents(userId, { limit: 10, offset: 0 });

      return res.json({
        providerConfigured: providerDiagnostics.providerReady,
        activeTokenCount: tokens.length,
        currentDevice: {
          deviceId: deviceId || null,
          registered: Boolean(currentDeviceToken),
          lastRegisteredAt: currentDeviceToken?.lastRegisteredAt ?? null,
          lastSuccessfulAt: currentDeviceToken?.lastSuccessfulAt ?? null,
          lastFailureAt: currentDeviceToken?.lastFailureAt ?? null,
          lastError: currentDeviceToken?.lastError ?? null,
        },
        diagnostics: {
          runtime: "firebase-admin",
          platform: "android",
          deviceCount: tokens.length,
          latestTokenSeenAt: tokens[0]?.lastRegisteredAt ?? null,
          provider: providerDiagnostics,
        },
        recentEvents: events.map((event) => ({
          id: event.id,
          notificationType: event.notificationType,
          title: event.title,
          deliveryStatus: event.deliveryStatus,
          createdAt: event.createdAt,
          sentAt: event.sentAt,
          route: event.route,
          metadata: event.metadata,
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

  app.post("/api/mobile/push/opened", authMiddleware, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const eventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";

      if (!eventId) {
        return res.status(400).json({ error: "eventId is required" });
      }

      const event = await storageLayer.getPushNotificationEventById(eventId);
      if (!event || event.userId !== userId) {
        return res.status(404).json({ error: "Push event not found" });
      }

      await storageLayer.updatePushNotificationEvent(eventId, {
        deliveryStatus: event.deliveryStatus === "sent" ? "opened" : event.deliveryStatus,
        metadata: mergeEventMetadata(event, {
          openedAt: new Date().toISOString(),
          openedFrom: typeof req.body?.openedFrom === "string" ? req.body.openedFrom : "tap",
          lastOpenedRoute:
            typeof req.body?.route === "string" ? req.body.route.trim().slice(0, 255) : event.route,
        }),
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error("[MOBILE_PUSH] Failed to mark push as opened:", error);
      return res.status(500).json({ error: error?.message || "Failed to mark push as opened" });
    }
  });
}

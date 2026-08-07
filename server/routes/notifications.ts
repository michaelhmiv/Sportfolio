import type { Express, NextFunction, Request, Response } from "express";
import {
  adminBroadcastNotificationSchema,
  NOTIFICATION_CATEGORY_META,
  notificationCategorySchema,
  notificationSettingsUpdateSchema,
  pushDeviceRegisterSchema,
  pushDeviceUnregisterSchema,
} from "@shared/notifications";
import { isAuthenticated } from "../auth/runtime-auth";
import {
  getNotificationSettings,
  getUserPushDevices,
  registerPushDevice,
  unregisterPushDevice,
  updateNotificationSettings,
} from "../services/notification-settings";
import {
  sendCategoryBroadcastNotification,
  sendUserNotification,
} from "../services/notification-dispatcher";
import { storage } from "../storage";

function getUserId(req: Request): string {
  return req.user?.claims?.sub || "";
}

async function adminAuth(req: Request, res: Response, next: NextFunction) {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const user = await storage.getUser(userId);
  if (!user?.isAdmin) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }

  next();
}

function handleNotificationRouteError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
  prefix: string,
) {
  console.error(`[Notifications] ${prefix}:`, error);
  const detail =
    process.env.NODE_ENV !== "production"
      ? error instanceof Error
        ? error.message
        : String(error)
      : undefined;
  res.status(500).json({
    message: fallbackMessage,
    ...(detail ? { error: detail } : {}),
  });
}

export function registerNotificationRoutes(app: Express): void {
  app.get("/api/account/notifications", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [settings, devices] = await Promise.all([
        getNotificationSettings(userId),
        getUserPushDevices(userId),
      ]);
      res.json({
        settings,
        devices,
        categories: NOTIFICATION_CATEGORY_META,
      });
    } catch (error) {
      handleNotificationRouteError(
        res,
        error,
        "Could not load notification settings",
        "GET /api/account/notifications",
      );
    }
  });

  app.put("/api/account/notifications", isAuthenticated, async (req: Request, res: Response) => {
    const parsed = notificationSettingsUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid notification settings payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const userId = getUserId(req);
      const settings = await updateNotificationSettings(userId, parsed.data);
      const devices = await getUserPushDevices(userId);
      res.json({
        settings,
        devices,
        categories: NOTIFICATION_CATEGORY_META,
      });
    } catch (error) {
      handleNotificationRouteError(
        res,
        error,
        "Could not update notification settings",
        "PUT /api/account/notifications",
      );
    }
  });

  app.post(
    "/api/account/notifications/push/register",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const parsed = pushDeviceRegisterSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({
          message: "Invalid push registration payload",
          issues: parsed.error.flatten(),
        });
        return;
      }

      try {
        const userId = getUserId(req);
        const result = await registerPushDevice({
          userId,
          ...parsed.data,
        });

        if (result.isNewDeviceForUser) {
          void sendUserNotification({
            userId,
            category: "account_security",
            title: "New Device Connected",
            body: "A new device was registered for push notifications.",
            deepLink: "/user/" + userId,
            dedupeKey: `new_device:${result.device.deviceId || result.device.token}`,
            excludeTokens: [result.device.token],
          }).catch((error) => {
            console.error("[Notifications] Failed sending new device security notice:", error);
          });
        }

        res.status(201).json({
          registered: true,
          isNewToken: result.isNewToken,
          isNewDeviceForUser: result.isNewDeviceForUser,
        });
      } catch (error) {
        handleNotificationRouteError(
          res,
          error,
          "Could not register push device",
          "POST /api/account/notifications/push/register",
        );
      }
    },
  );

  app.post(
    "/api/account/notifications/push/unregister",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const parsed = pushDeviceUnregisterSchema.safeParse(req.body || {});
      if (!parsed.success || (!parsed.data.token && !parsed.data.deviceId)) {
        res.status(400).json({
          message: "token or deviceId is required",
          issues: parsed.success ? undefined : parsed.error.flatten(),
        });
        return;
      }

      try {
        const result = await unregisterPushDevice({
          userId: getUserId(req),
          token: parsed.data.token,
          deviceId: parsed.data.deviceId,
        });
        res.json({
          unregistered: result.disabledCount > 0,
          disabledCount: result.disabledCount,
        });
      } catch (error) {
        handleNotificationRouteError(
          res,
          error,
          "Could not unregister push device",
          "POST /api/account/notifications/push/unregister",
        );
      }
    },
  );

  app.post(
    "/api/account/notifications/test",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const categoryResult = notificationCategorySchema.safeParse(
        req.body?.category || "system_operational",
      );
      if (!categoryResult.success) {
        res.status(400).json({
          message: "Invalid category for test notification",
          issues: categoryResult.error.flatten(),
        });
        return;
      }

      try {
        const result = await sendUserNotification({
          userId: getUserId(req),
          category: categoryResult.data,
          title: "Sportfolio Notification Test",
          body: `Push notifications are enabled for ${categoryResult.data}.`,
          deepLink: "/user/" + getUserId(req),
          dedupeKey: `test:${categoryResult.data}:${new Date().toISOString().slice(0, 16)}`,
          cooldownMs: 5_000,
        });

        res.json({
          sent: result.sentCount > 0,
          result,
        });
      } catch (error) {
        handleNotificationRouteError(
          res,
          error,
          "Could not send test notification",
          "POST /api/account/notifications/test",
        );
      }
    },
  );

  app.post(
    "/api/admin/notifications/broadcast",
    isAuthenticated,
    adminAuth,
    async (req: Request, res: Response) => {
      const parsed = adminBroadcastNotificationSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({
          message: "Invalid broadcast payload",
          issues: parsed.error.flatten(),
        });
        return;
      }

      try {
        const result = await sendCategoryBroadcastNotification({
          ...parsed.data,
          dedupeKey: `admin_broadcast:${parsed.data.category}:${parsed.data.title}`,
          cooldownMs: 15_000,
        });

        res.json({
          queued: true,
          result,
        });
      } catch (error) {
        handleNotificationRouteError(
          res,
          error,
          "Could not broadcast notification",
          "POST /api/admin/notifications/broadcast",
        );
      }
    },
  );
}

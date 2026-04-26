import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  mergeNotificationPreferences,
  NOTIFICATION_CATEGORIES,
  type NotificationPreferences,
} from "@shared/notifications";

const mocks = vi.hoisted(() => ({
  getNotificationSettings: vi.fn(),
  updateNotificationSettings: vi.fn(),
  registerPushDevice: vi.fn(),
  unregisterPushDevice: vi.fn(),
  getUserPushDevices: vi.fn(),
  sendUserNotification: vi.fn(),
  sendCategoryBroadcastNotification: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../supabaseAuth", () => ({
  isAuthenticated: (req: any, _res: any, next: () => void) => {
    const userId = req.header("x-user-id") || "user-1";
    req.user = { claims: { sub: userId } };
    next();
  },
}));

vi.mock("../services/notification-settings", () => ({
  getNotificationSettings: mocks.getNotificationSettings,
  updateNotificationSettings: mocks.updateNotificationSettings,
  registerPushDevice: mocks.registerPushDevice,
  unregisterPushDevice: mocks.unregisterPushDevice,
  getUserPushDevices: mocks.getUserPushDevices,
}));

vi.mock("../services/notification-dispatcher", () => ({
  sendUserNotification: mocks.sendUserNotification,
  sendCategoryBroadcastNotification: mocks.sendCategoryBroadcastNotification,
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: mocks.getUser,
  },
}));

import { registerNotificationRoutes } from "./notifications";

describe("notification routes", () => {
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";
  let currentSettings: {
    userId: string;
    pushEnabled: boolean;
    categoryPreferences: NotificationPreferences;
    createdAt: Date;
    updatedAt: Date;
  };

  beforeEach(async () => {
    const now = new Date("2026-04-26T12:00:00.000Z");
    currentSettings = {
      userId: "user-1",
      pushEnabled: true,
      categoryPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
      createdAt: now,
      updatedAt: now,
    };

    vi.clearAllMocks();

    mocks.getNotificationSettings.mockImplementation(async () => currentSettings);
    mocks.getUserPushDevices.mockResolvedValue([
      {
        id: "device-1",
        token: "token-abc123456789",
        platform: "android",
        permissionStatus: "granted",
        enabled: true,
        invalidatedAt: null,
        invalidReason: null,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    mocks.updateNotificationSettings.mockImplementation(async (_userId: string, patch: any) => {
      currentSettings = {
        ...currentSettings,
        pushEnabled:
          typeof patch.pushEnabled === "boolean" ? patch.pushEnabled : currentSettings.pushEnabled,
        categoryPreferences: patch.categoryPreferences
          ? mergeNotificationPreferences(
              currentSettings.categoryPreferences,
              patch.categoryPreferences,
            )
          : currentSettings.categoryPreferences,
        updatedAt: new Date("2026-04-26T12:05:00.000Z"),
      };
      return currentSettings;
    });
    mocks.registerPushDevice.mockResolvedValue({
      device: {
        token: "token-abc123456789",
        deviceId: "device-1",
      },
      isNewToken: true,
      isNewDeviceForUser: true,
    });
    mocks.unregisterPushDevice.mockResolvedValue({ disabledCount: 1 });
    mocks.sendUserNotification.mockResolvedValue({
      recipientUsers: 1,
      attemptedTokens: 1,
      sentCount: 1,
      failureCount: 0,
      providerEnabled: true,
      invalidTokens: [],
    });
    mocks.sendCategoryBroadcastNotification.mockResolvedValue({
      recipientUsers: 1,
      attemptedTokens: 1,
      sentCount: 1,
      failureCount: 0,
      providerEnabled: true,
      invalidTokens: [],
    });
    mocks.getUser.mockImplementation(async (userId: string) => ({
      id: userId,
      isAdmin: userId === "admin-user",
    }));

    const app = express();
    app.use(express.json());
    registerNotificationRoutes(app);

    server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });

    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      server = null;
    }
  });

  it("returns settings and categories for the authenticated user", async () => {
    const response = await fetch(`${baseUrl}/api/account/notifications`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings.pushEnabled).toBe(true);
    expect(payload.categories).toHaveLength(NOTIFICATION_CATEGORIES.length);
    expect(payload.devices).toHaveLength(1);
  });

  it("validates update payloads", async () => {
    const response = await fetch(`${baseUrl}/api/account/notifications`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  it("persists full category updates and reads parity back", async () => {
    const allOff = Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, false]));

    const updateResponse = await fetch(`${baseUrl}/api/account/notifications`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pushEnabled: false,
        categoryPreferences: allOff,
      }),
    });
    expect(updateResponse.status).toBe(200);

    const readResponse = await fetch(`${baseUrl}/api/account/notifications`);
    const payload = await readResponse.json();

    expect(readResponse.status).toBe(200);
    expect(payload.settings.pushEnabled).toBe(false);
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(payload.settings.categoryPreferences[category]).toBe(false);
    }
  });

  it("validates push registration and unregistration payloads", async () => {
    const badRegister = await fetch(`${baseUrl}/api/account/notifications/push/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "short" }),
    });
    expect(badRegister.status).toBe(400);

    const badUnregister = await fetch(`${baseUrl}/api/account/notifications/push/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(badUnregister.status).toBe(400);
  });

  it("enforces admin auth on broadcast route", async () => {
    const forbidden = await fetch(`${baseUrl}/api/admin/notifications/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "system_operational",
        title: "Notice",
        body: "Maintenance",
      }),
    });
    expect(forbidden.status).toBe(403);

    const allowed = await fetch(`${baseUrl}/api/admin/notifications/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-user",
      },
      body: JSON.stringify({
        category: "system_operational",
        title: "Notice",
        body: "Maintenance",
      }),
    });
    expect(allowed.status).toBe(200);
    expect(mocks.sendCategoryBroadcastNotification).toHaveBeenCalledTimes(1);
  });
});

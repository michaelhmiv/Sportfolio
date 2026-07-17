import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  applyLegacyNewsNotificationPreference,
  mergeNotificationPreferences,
  normalizeNotificationPreferences,
  type NotificationCategory,
  type NotificationPreferences,
} from "@shared/notifications";
import { userNotificationSettings, userPushDevices, users } from "@shared/schema";
import { db } from "../db";

const DEFAULT_PERMISSION_STATUS = "unknown";

type NotificationSettingsRow = typeof userNotificationSettings.$inferSelect;
type PushDeviceRow = typeof userPushDevices.$inferSelect;

export interface NotificationSettingsView {
  userId: string;
  pushEnabled: boolean;
  categoryPreferences: NotificationPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationSettingsUpdateInput {
  pushEnabled?: boolean;
  categoryPreferences?: Partial<Record<string, unknown>>;
}

export interface RegisterPushDeviceInput {
  userId: string;
  platform?: "android";
  token: string;
  deviceId?: string;
  appVersion?: string;
  permissionStatus?: string;
}

export interface RegisterPushDeviceResult {
  device: PushDeviceRow;
  isNewToken: boolean;
  isNewDeviceForUser: boolean;
}

function toSettingsView(row: NotificationSettingsRow): NotificationSettingsView {
  return {
    userId: row.userId,
    pushEnabled: row.pushEnabled,
    categoryPreferences: normalizeNotificationPreferences(row.categoryPreferences),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function createDefaultSettings(userId: string): Promise<NotificationSettingsRow> {
  const [user] = await db
    .select({
      id: users.id,
      newsNotificationsEnabled: users.newsNotificationsEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const categoryPreferences = applyLegacyNewsNotificationPreference(
    user?.newsNotificationsEnabled,
    null,
  );

  const [created] = await db
    .insert(userNotificationSettings)
    .values({
      userId,
      pushEnabled: true,
      categoryPreferences,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userNotificationSettings.userId,
      set: {
        updatedAt: new Date(),
      },
    })
    .returning();

  return created;
}

export async function ensureNotificationSettings(userId: string): Promise<NotificationSettingsRow> {
  const [existing] = await db
    .select()
    .from(userNotificationSettings)
    .where(eq(userNotificationSettings.userId, userId))
    .limit(1);

  if (existing) {
    return existing;
  }

  return createDefaultSettings(userId);
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettingsView> {
  const row = await ensureNotificationSettings(userId);
  return toSettingsView(row);
}

export async function getUserPushDevices(userId: string) {
  return db
    .select({
      id: userPushDevices.id,
      token: userPushDevices.token,
      platform: userPushDevices.platform,
      deviceId: userPushDevices.deviceId,
      appVersion: userPushDevices.appVersion,
      permissionStatus: userPushDevices.permissionStatus,
      enabled: userPushDevices.enabled,
      invalidatedAt: userPushDevices.invalidatedAt,
      invalidReason: userPushDevices.invalidReason,
      lastSeenAt: userPushDevices.lastSeenAt,
      createdAt: userPushDevices.createdAt,
      updatedAt: userPushDevices.updatedAt,
    })
    .from(userPushDevices)
    .where(eq(userPushDevices.userId, userId))
    .orderBy(userPushDevices.lastSeenAt);
}

export async function updateNotificationSettings(
  userId: string,
  input: NotificationSettingsUpdateInput,
): Promise<NotificationSettingsView> {
  const current = await ensureNotificationSettings(userId);
  const currentPreferences = normalizeNotificationPreferences(current.categoryPreferences);
  const categoryPreferences = input.categoryPreferences
    ? mergeNotificationPreferences(currentPreferences, input.categoryPreferences)
    : currentPreferences;
  const pushEnabled =
    typeof input.pushEnabled === "boolean" ? input.pushEnabled : current.pushEnabled;

  const [updated] = await db
    .update(userNotificationSettings)
    .set({
      pushEnabled,
      categoryPreferences,
      updatedAt: new Date(),
    })
    .where(eq(userNotificationSettings.userId, userId))
    .returning();

  return toSettingsView(updated);
}

export async function registerPushDevice(
  input: RegisterPushDeviceInput,
): Promise<RegisterPushDeviceResult> {
  return db.transaction(async (tx) => {
    // Serialize registration with account deletion. Deletion locks this same user
    // row before erasing devices, so a request authenticated before deletion cannot
    // recreate a push token after the deletion transaction commits.
    const [activeUser] = await tx
      .select({
        id: users.id,
        newsNotificationsEnabled: users.newsNotificationsEnabled,
      })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .for("update")
      .limit(1);

    if (!activeUser) {
      throw new Error("Cannot register push notifications for a deleted account");
    }

    const [tokenOwnerBefore] = await tx
      .select()
      .from(userPushDevices)
      .where(eq(userPushDevices.token, input.token))
      .limit(1);

    const existingForUserWithSameDeviceId =
      input.deviceId && input.deviceId.length > 0
        ? await tx
            .select({ id: userPushDevices.id })
            .from(userPushDevices)
            .where(
              and(
                eq(userPushDevices.userId, input.userId),
                eq(userPushDevices.deviceId, input.deviceId),
                eq(userPushDevices.enabled, true),
                isNull(userPushDevices.invalidatedAt),
              ),
            )
            .limit(1)
        : [];

    const now = new Date();
    const [device] = await tx
      .insert(userPushDevices)
      .values({
        userId: input.userId,
        platform: input.platform || "android",
        token: input.token,
        deviceId: input.deviceId?.trim() || null,
        appVersion: input.appVersion?.trim() || null,
        permissionStatus: input.permissionStatus || DEFAULT_PERMISSION_STATUS,
        lastSeenAt: now,
        enabled: true,
        invalidatedAt: null,
        invalidReason: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPushDevices.token,
        set: {
          userId: input.userId,
          platform: input.platform || "android",
          deviceId: input.deviceId?.trim() || null,
          appVersion: input.appVersion?.trim() || null,
          permissionStatus: input.permissionStatus || DEFAULT_PERMISSION_STATUS,
          lastSeenAt: now,
          enabled: true,
          invalidatedAt: null,
          invalidReason: null,
          updatedAt: now,
        },
      })
      .returning();

    const categoryPreferences = applyLegacyNewsNotificationPreference(
      activeUser.newsNotificationsEnabled,
      null,
    );
    await tx
      .insert(userNotificationSettings)
      .values({
        userId: input.userId,
        pushEnabled: true,
        categoryPreferences,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: userNotificationSettings.userId });

    return {
      device,
      isNewToken: !tokenOwnerBefore,
      isNewDeviceForUser: existingForUserWithSameDeviceId.length === 0,
    };
  });
}

export async function unregisterPushDevice(input: {
  userId: string;
  token?: string;
  deviceId?: string;
}): Promise<{ disabledCount: number }> {
  if (!input.token && !input.deviceId) {
    return { disabledCount: 0 };
  }

  const filters = [eq(userPushDevices.userId, input.userId)];
  if (input.token) {
    filters.push(eq(userPushDevices.token, input.token));
  }
  if (input.deviceId) {
    filters.push(eq(userPushDevices.deviceId, input.deviceId));
  }

  const rows = await db
    .update(userPushDevices)
    .set({
      enabled: false,
      invalidatedAt: new Date(),
      invalidReason: "user_unregistered",
      updatedAt: new Date(),
    })
    .where(and(...filters))
    .returning({ id: userPushDevices.id });

  return { disabledCount: rows.length };
}

export async function markPushTokenInvalid(token: string, reason: string) {
  await db
    .update(userPushDevices)
    .set({
      enabled: false,
      invalidatedAt: new Date(),
      invalidReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(userPushDevices.token, token));
}

export async function getActivePushDevicesForUsers(userIds: string[]) {
  if (userIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(userPushDevices)
    .where(
      and(
        inArray(userPushDevices.userId, userIds),
        eq(userPushDevices.enabled, true),
        isNull(userPushDevices.invalidatedAt),
      ),
    );
}

export async function getCategoryEligibleUsers(
  userIds: string[],
  category: NotificationCategory,
): Promise<string[]> {
  if (userIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      userId: users.id,
      legacyNewsEnabled: users.newsNotificationsEnabled,
      pushEnabled: userNotificationSettings.pushEnabled,
      categoryPreferences: userNotificationSettings.categoryPreferences,
    })
    .from(users)
    .leftJoin(userNotificationSettings, eq(userNotificationSettings.userId, users.id))
    .where(inArray(users.id, userIds));

  return rows
    .filter((row) => {
      const preferences = applyLegacyNewsNotificationPreference(
        row.legacyNewsEnabled,
        row.categoryPreferences,
      );
      const pushEnabled = row.pushEnabled ?? true;
      return pushEnabled && preferences[category] !== false;
    })
    .map((row) => row.userId);
}

export async function getAllUsersEligibleForCategory(category: NotificationCategory) {
  const rows = await db
    .select({
      userId: users.id,
      isBot: users.isBot,
      legacyNewsEnabled: users.newsNotificationsEnabled,
      pushEnabled: userNotificationSettings.pushEnabled,
      categoryPreferences: userNotificationSettings.categoryPreferences,
    })
    .from(users)
    .leftJoin(userNotificationSettings, eq(userNotificationSettings.userId, users.id));

  return rows
    .filter((row) => {
      if (row.isBot) {
        return false;
      }
      const preferences = applyLegacyNewsNotificationPreference(
        row.legacyNewsEnabled,
        row.categoryPreferences,
      );
      const pushEnabled = row.pushEnabled ?? true;
      return pushEnabled && preferences[category] !== false;
    })
    .map((row) => row.userId);
}

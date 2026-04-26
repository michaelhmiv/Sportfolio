import { randomUUID } from "node:crypto";
import { type NotificationCategory, type NotificationPreferences } from "@shared/notifications";
import {
  getActivePushDevicesForUsers,
  getAllUsersEligibleForCategory,
  getCategoryEligibleUsers,
  markPushTokenInvalid,
} from "./notification-settings";
import { sendPushMulticast } from "./push-notifications";

const cooldownCache = new Map<string, number>();

// Keep memory use bounded for long-running processes.
const cooldownSweepInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, expiresAt] of cooldownCache.entries()) {
      if (expiresAt <= now) {
        cooldownCache.delete(key);
      }
    }
  },
  5 * 60 * 1000,
);
cooldownSweepInterval.unref?.();

const DEFAULT_CATEGORY_COOLDOWNS_MS: Record<NotificationCategory, number> = {
  trade_execution: 30_000,
  portfolio_changes: 60_000,
  boost_lifecycle: 30_000,
  community_boosts: 120_000,
  scout_lifecycle: 30_000,
  game_lifecycle: 120_000,
  player_news: 300_000,
  daily_digest: 3_600_000,
  watchlist_alerts: 600_000,
  market_alerts: 600_000,
  whale_alerts: 300_000,
  lp_liquidity: 60_000,
  condense_opportunities: 3_600_000,
  leaderboard_competition: 3_600_000,
  account_security: 60_000,
  billing_premium: 300_000,
  system_operational: 300_000,
  product_marketing: 3_600_000,
};

interface BaseSendPayload {
  category: NotificationCategory;
  title: string;
  body: string;
  data?: Record<string, string>;
  deepLink?: string;
  cooldownMs?: number;
  dedupeKey?: string;
  excludeTokens?: string[];
}

export interface UserNotificationPayload extends BaseSendPayload {
  userId: string;
}

export interface MultiUserNotificationPayload extends BaseSendPayload {
  userIds: string[];
}

export interface SendNotificationResult {
  recipientUsers: number;
  attemptedTokens: number;
  sentCount: number;
  failureCount: number;
  providerEnabled: boolean;
  invalidTokens: string[];
}

function logDispatcherError(message: string, error: unknown) {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  console.error(`[Notifications] ${message}:`, error);
}

function toCooldownCacheKey(
  userId: string,
  category: NotificationCategory,
  dedupeKey: string,
): string {
  return `${userId}:${category}:${dedupeKey}`;
}

function shouldSendForUser(
  userId: string,
  category: NotificationCategory,
  dedupeKey: string,
  cooldownMs: number,
): boolean {
  const key = toCooldownCacheKey(userId, category, dedupeKey);
  const now = Date.now();
  const expiresAt = cooldownCache.get(key);
  if (expiresAt && expiresAt > now) {
    return false;
  }

  cooldownCache.set(key, now + cooldownMs);
  return true;
}

function buildNotificationData(
  category: NotificationCategory,
  deepLink?: string,
  data?: Record<string, string>,
): Record<string, string> {
  return {
    category,
    notificationId: randomUUID(),
    ...(deepLink ? { deepLink } : {}),
    ...(data || {}),
  };
}

async function sendToUsers(
  userIds: string[],
  payload: BaseSendPayload,
): Promise<SendNotificationResult> {
  if (userIds.length === 0) {
    return {
      recipientUsers: 0,
      attemptedTokens: 0,
      sentCount: 0,
      failureCount: 0,
      providerEnabled: true,
      invalidTokens: [],
    };
  }

  let eligibleUsers: string[] = [];
  try {
    eligibleUsers = await getCategoryEligibleUsers(userIds, payload.category);
  } catch (error) {
    logDispatcherError("Failed to resolve category-eligible users", error);
    return {
      recipientUsers: 0,
      attemptedTokens: 0,
      sentCount: 0,
      failureCount: 1,
      providerEnabled: true,
      invalidTokens: [],
    };
  }
  if (eligibleUsers.length === 0) {
    return {
      recipientUsers: 0,
      attemptedTokens: 0,
      sentCount: 0,
      failureCount: 0,
      providerEnabled: true,
      invalidTokens: [],
    };
  }

  let devices: Awaited<ReturnType<typeof getActivePushDevicesForUsers>> = [];
  try {
    devices = await getActivePushDevicesForUsers(eligibleUsers);
  } catch (error) {
    logDispatcherError("Failed to resolve active push devices", error);
    return {
      recipientUsers: 0,
      attemptedTokens: 0,
      sentCount: 0,
      failureCount: 1,
      providerEnabled: true,
      invalidTokens: [],
    };
  }
  const devicesByUser = new Map<string, string[]>();
  for (const device of devices) {
    const existing = devicesByUser.get(device.userId);
    if (existing) {
      existing.push(device.token);
    } else {
      devicesByUser.set(device.userId, [device.token]);
    }
  }

  const dedupeKey = payload.dedupeKey || `${payload.category}:${payload.title}:${payload.body}`;
  const cooldownMs = payload.cooldownMs || DEFAULT_CATEGORY_COOLDOWNS_MS[payload.category];
  const excludedTokenSet = new Set(payload.excludeTokens || []);
  const tokens: string[] = [];
  let recipientUsers = 0;

  for (const userId of eligibleUsers) {
    if (!shouldSendForUser(userId, payload.category, dedupeKey, cooldownMs)) {
      continue;
    }

    const userTokens = (devicesByUser.get(userId) || []).filter(
      (token) => !excludedTokenSet.has(token),
    );
    if (userTokens.length === 0) {
      continue;
    }

    recipientUsers += 1;
    tokens.push(...userTokens);
  }

  if (tokens.length === 0) {
    return {
      recipientUsers,
      attemptedTokens: 0,
      sentCount: 0,
      failureCount: 0,
      providerEnabled: true,
      invalidTokens: [],
    };
  }

  let result: Awaited<ReturnType<typeof sendPushMulticast>>;
  try {
    result = await sendPushMulticast(tokens, {
      title: payload.title,
      body: payload.body,
      data: buildNotificationData(payload.category, payload.deepLink, payload.data),
    });
  } catch (error) {
    logDispatcherError("Push provider send failed", error);
    return {
      recipientUsers,
      attemptedTokens: tokens.length,
      sentCount: 0,
      failureCount: tokens.length,
      providerEnabled: true,
      invalidTokens: [],
    };
  }

  if (result.invalidTokens.length > 0) {
    try {
      await Promise.all(
        result.invalidTokens.map((token) => markPushTokenInvalid(token, "fcm_invalid_token")),
      );
    } catch (error) {
      logDispatcherError("Failed to invalidate tokens after push send", error);
    }
  }

  return {
    recipientUsers,
    attemptedTokens: result.attempted,
    sentCount: result.sentCount,
    failureCount: result.failureCount,
    providerEnabled: result.providerEnabled,
    invalidTokens: result.invalidTokens,
  };
}

export async function sendUserNotification(
  payload: UserNotificationPayload,
): Promise<SendNotificationResult> {
  return sendToUsers([payload.userId], payload);
}

export async function sendNotificationToUsers(
  payload: MultiUserNotificationPayload,
): Promise<SendNotificationResult> {
  const uniqueUserIds = Array.from(new Set(payload.userIds));
  return sendToUsers(uniqueUserIds, payload);
}

export async function sendCategoryBroadcastNotification(
  payload: Omit<BaseSendPayload, "dedupeKey"> & { dedupeKey?: string },
): Promise<SendNotificationResult> {
  let eligibleUsers: string[] = [];
  try {
    eligibleUsers = await getAllUsersEligibleForCategory(payload.category);
  } catch (error) {
    logDispatcherError("Failed to resolve broadcast users", error);
    return {
      recipientUsers: 0,
      attemptedTokens: 0,
      sentCount: 0,
      failureCount: 1,
      providerEnabled: true,
      invalidTokens: [],
    };
  }
  return sendToUsers(eligibleUsers, payload);
}

export function getDefaultNotificationCooldowns() {
  return { ...DEFAULT_CATEGORY_COOLDOWNS_MS } as Record<NotificationCategory, number>;
}

export function isCategoryEnabled(
  preferences: NotificationPreferences,
  category: NotificationCategory,
) {
  return preferences[category] !== false;
}

export function clearNotificationCooldownCacheForTests() {
  cooldownCache.clear();
}

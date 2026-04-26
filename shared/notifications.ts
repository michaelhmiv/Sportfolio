import { z } from "zod";

export const NOTIFICATION_CATEGORIES = [
  "trade_execution",
  "portfolio_changes",
  "boost_lifecycle",
  "community_boosts",
  "scout_lifecycle",
  "game_lifecycle",
  "player_news",
  "daily_digest",
  "watchlist_alerts",
  "market_alerts",
  "whale_alerts",
  "lp_liquidity",
  "condense_opportunities",
  "leaderboard_competition",
  "account_security",
  "billing_premium",
  "system_operational",
  "product_marketing",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationPreferences = Record<NotificationCategory, boolean>;

export type NotificationCategoryMeta = {
  id: NotificationCategory;
  label: string;
  defaultEnabled: boolean;
};

export const NOTIFICATION_CATEGORY_META: NotificationCategoryMeta[] = [
  { id: "trade_execution", label: "Trade Execution", defaultEnabled: true },
  { id: "portfolio_changes", label: "Portfolio Changes", defaultEnabled: true },
  { id: "boost_lifecycle", label: "Daily Boost Lifecycle", defaultEnabled: true },
  { id: "community_boosts", label: "Community Boosts", defaultEnabled: true },
  { id: "scout_lifecycle", label: "Scout Lifecycle", defaultEnabled: true },
  { id: "game_lifecycle", label: "Game Lifecycle", defaultEnabled: true },
  { id: "player_news", label: "Relevant Player News", defaultEnabled: true },
  { id: "daily_digest", label: "Daily Digest", defaultEnabled: true },
  { id: "watchlist_alerts", label: "Watchlist Alerts", defaultEnabled: false },
  { id: "market_alerts", label: "Market Alerts", defaultEnabled: false },
  { id: "whale_alerts", label: "Whale Alerts", defaultEnabled: false },
  { id: "lp_liquidity", label: "LP & Liquidity", defaultEnabled: true },
  { id: "condense_opportunities", label: "Condense Opportunities", defaultEnabled: false },
  { id: "leaderboard_competition", label: "Leaderboard Movement", defaultEnabled: false },
  { id: "account_security", label: "Account & Security", defaultEnabled: true },
  { id: "billing_premium", label: "Billing & Premium", defaultEnabled: true },
  { id: "system_operational", label: "System Notices", defaultEnabled: true },
  { id: "product_marketing", label: "Product Updates", defaultEnabled: false },
];

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = Object.freeze(
  NOTIFICATION_CATEGORY_META.reduce((acc, category) => {
    acc[category.id] = category.defaultEnabled;
    return acc;
  }, {} as NotificationPreferences),
);

export function normalizeNotificationPreferences(
  value?: Partial<Record<string, unknown>> | null,
): NotificationPreferences {
  const normalized = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  if (!value || typeof value !== "object") {
    return normalized;
  }

  for (const category of NOTIFICATION_CATEGORIES) {
    if (typeof value[category] === "boolean") {
      normalized[category] = value[category] as boolean;
    }
  }

  return normalized;
}

export function mergeNotificationPreferences(
  current: NotificationPreferences,
  patch?: Partial<Record<string, unknown>> | null,
): NotificationPreferences {
  return normalizeNotificationPreferences({
    ...current,
    ...(patch || {}),
  });
}

export function applyLegacyNewsNotificationPreference(
  legacyNewsEnabled: boolean | null | undefined,
  current?: Partial<Record<string, unknown>> | null,
): NotificationPreferences {
  const next = normalizeNotificationPreferences(current);
  if (legacyNewsEnabled === false) {
    next.player_news = false;
    next.daily_digest = false;
  }
  return next;
}

export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);

export const notificationPreferencesSchema = z.object({
  trade_execution: z.boolean(),
  portfolio_changes: z.boolean(),
  boost_lifecycle: z.boolean(),
  community_boosts: z.boolean(),
  scout_lifecycle: z.boolean(),
  game_lifecycle: z.boolean(),
  player_news: z.boolean(),
  daily_digest: z.boolean(),
  watchlist_alerts: z.boolean(),
  market_alerts: z.boolean(),
  whale_alerts: z.boolean(),
  lp_liquidity: z.boolean(),
  condense_opportunities: z.boolean(),
  leaderboard_competition: z.boolean(),
  account_security: z.boolean(),
  billing_premium: z.boolean(),
  system_operational: z.boolean(),
  product_marketing: z.boolean(),
});

export const notificationSettingsUpdateSchema = z
  .object({
    pushEnabled: z.boolean().optional(),
    categoryPreferences: notificationPreferencesSchema.partial().optional(),
  })
  .refine(
    (value) => typeof value.pushEnabled === "boolean" || Boolean(value.categoryPreferences),
    "At least one notification setting must be provided",
  );

export const pushDeviceRegisterSchema = z.object({
  platform: z.enum(["android"]).default("android"),
  token: z.string().min(10),
  deviceId: z.string().max(128).optional(),
  appVersion: z.string().max(64).optional(),
  permissionStatus: z.enum(["prompt", "prompt-with-rationale", "granted", "denied"]).optional(),
});

export const pushDeviceUnregisterSchema = z.object({
  token: z.string().min(10).optional(),
  deviceId: z.string().min(1).max(128).optional(),
});

export const adminBroadcastNotificationSchema = z.object({
  category: z.enum(["system_operational", "product_marketing"]),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(240),
  deepLink: z.string().max(500).optional(),
  data: z.record(z.string(), z.string()).optional(),
});

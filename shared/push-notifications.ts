export const PUSH_NOTIFICATION_TYPES = [
  "scout_complete",
  "scout_capacity_available",
  "boost_locking_soon",
  "boost_settled",
  "portfolio_movement",
  "order_filled",
  "watchlist_news",
  "watchlist_price_move",
  "premium_reward_available",
  "system_announcements",
] as const;

export type PushNotificationType = (typeof PUSH_NOTIFICATION_TYPES)[number];

export type PushNotificationPlatform = "android";

export const DEFAULT_PUSH_NOTIFICATION_PREFERENCES: Record<PushNotificationType, boolean> = {
  scout_complete: true,
  scout_capacity_available: true,
  boost_locking_soon: true,
  boost_settled: true,
  portfolio_movement: false,
  order_filled: true,
  watchlist_news: false,
  watchlist_price_move: false,
  premium_reward_available: true,
  system_announcements: true,
};

export type PushNotificationPreferenceMap = Record<PushNotificationType, boolean>;

export const ALLOWED_INTERNAL_NOTIFICATION_ROUTES = [
  "/",
  "/boosts",
  "/portfolio",
  "/pools",
  "/watchlists",
  "/premium",
  "/news",
] as const;

const STATIC_ALLOWED_ROUTE_SET = new Set<string>(ALLOWED_INTERNAL_NOTIFICATION_ROUTES);
const PLAYER_ROUTE_PATTERN = /^\/player\/[A-Za-z0-9:_-]+$/;

export function isPushNotificationType(value: unknown): value is PushNotificationType {
  return (
    typeof value === "string" && (PUSH_NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

export function resolvePushNotificationPreferences(
  overrides?: Partial<Record<PushNotificationType, boolean>> | null,
): PushNotificationPreferenceMap {
  const resolved: PushNotificationPreferenceMap = { ...DEFAULT_PUSH_NOTIFICATION_PREFERENCES };

  if (!overrides) {
    return resolved;
  }

  for (const type of PUSH_NOTIFICATION_TYPES) {
    if (typeof overrides[type] === "boolean") {
      resolved[type] = overrides[type] as boolean;
    }
  }

  return resolved;
}

export function normalizeInternalNotificationRoute(route: unknown): string | null {
  if (typeof route !== "string") {
    return null;
  }

  const trimmed = route.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }

  const [pathOnly] = trimmed.split(/[?#]/, 1);
  if (!pathOnly) {
    return null;
  }

  if (STATIC_ALLOWED_ROUTE_SET.has(pathOnly)) {
    return pathOnly;
  }

  if (PLAYER_ROUTE_PATTERN.test(pathOnly)) {
    return pathOnly;
  }

  return null;
}

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
export type PushNotificationAndroidChannelId =
  | "sportfolio_gameplay"
  | "sportfolio_market"
  | "sportfolio_watchlist"
  | "sportfolio_system";

// Temporary quiet mode while we trim push volume.
export const TEMPORARILY_MUTED_PUSH_NOTIFICATION_TYPES = new Set<PushNotificationType>([
  "scout_complete",
  "boost_locking_soon",
  "boost_settled",
]);

export function isTemporarilyMutedPushNotificationType(type: PushNotificationType): boolean {
  return TEMPORARILY_MUTED_PUSH_NOTIFICATION_TYPES.has(type);
}

export const DEFAULT_PUSH_NOTIFICATION_PREFERENCES: Record<PushNotificationType, boolean> = {
  scout_complete: false,
  scout_capacity_available: true,
  boost_locking_soon: false,
  boost_settled: false,
  portfolio_movement: false,
  order_filled: true,
  watchlist_news: false,
  watchlist_price_move: false,
  premium_reward_available: true,
  system_announcements: true,
};

export type PushNotificationPreferenceMap = Record<PushNotificationType, boolean>;

export const PUSH_NOTIFICATION_ANDROID_CHANNELS: Array<{
  id: PushNotificationAndroidChannelId;
  name: string;
  description: string;
  importance: 4;
  visibility: 1;
  lights: true;
  lightColor: string;
  vibration: true;
}> = [
  {
    id: "sportfolio_gameplay",
    name: "Gameplay Alerts",
    description: "Scouting, boosts, orders, and premium reward updates.",
    importance: 4,
    visibility: 1,
    lights: true,
    lightColor: "#3b82f6",
    vibration: true,
  },
  {
    id: "sportfolio_market",
    name: "Market Activity",
    description: "Portfolio movement and trading activity notifications.",
    importance: 4,
    visibility: 1,
    lights: true,
    lightColor: "#22c55e",
    vibration: true,
  },
  {
    id: "sportfolio_watchlist",
    name: "Watchlist Alerts",
    description: "Watchlist news and price movement updates.",
    importance: 4,
    visibility: 1,
    lights: true,
    lightColor: "#f59e0b",
    vibration: true,
  },
  {
    id: "sportfolio_system",
    name: "System Updates",
    description: "Important account, release, and diagnostic messages.",
    importance: 4,
    visibility: 1,
    lights: true,
    lightColor: "#a855f7",
    vibration: true,
  },
];

export const DEFAULT_ANDROID_PUSH_CHANNEL_ID: PushNotificationAndroidChannelId =
  "sportfolio_gameplay";
export const PUSH_NOTIFICATION_APP_LINK_HOSTS = [
  "www.sportfolio.market",
  "sportfolio.market",
] as const;

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

  for (const type of TEMPORARILY_MUTED_PUSH_NOTIFICATION_TYPES) {
    resolved[type] = false;
  }

  return resolved;
}

export function getPushNotificationAndroidChannelId(
  type: PushNotificationType,
): PushNotificationAndroidChannelId {
  switch (type) {
    case "watchlist_news":
    case "watchlist_price_move":
      return "sportfolio_watchlist";
    case "portfolio_movement":
      return "sportfolio_market";
    case "system_announcements":
      return "sportfolio_system";
    case "scout_complete":
    case "scout_capacity_available":
    case "boost_locking_soon":
    case "boost_settled":
    case "order_filled":
    case "premium_reward_available":
    default:
      return "sportfolio_gameplay";
  }
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

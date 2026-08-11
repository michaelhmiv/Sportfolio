export const USER_ACTIVITY_CATEGORIES = [
  "market",
  "scout",
  "boosts",
  "community",
  "liquidity",
  "premium",
  "payouts",
] as const;

export type UserActivityCategory = (typeof USER_ACTIVITY_CATEGORIES)[number];

export const DEFAULT_ACTIVITY_FEED_CATEGORIES: UserActivityCategory[] = [
  "market",
  "scout",
  "boosts",
  "community",
  "liquidity",
  "premium",
  "payouts",
];

export interface UserActivityEntity {
  kind: "player" | "boosts" | "liquidity" | "premium" | "portfolio" | "system";
  id?: string;
  label?: string;
  secondaryLabel?: string;
  href?: string;
}

export interface UserActivityMetadata {
  playerId?: string;
  playerName?: string;
  playerTeam?: string | null;
  tradePrice?: string;
  side?: string;
  quantity?: number;
  shares?: number;
  sharesClaimed?: number;
  sharesConsumed?: number;
  payoutAmount?: string;
  slotTier?: number;
  sport?: string;
  daysGranted?: number;
  premiumExpiresAtAfter?: string;
  reason?: string;
  rank?: number;
  totalEntries?: number;
}

export type UserActivityContext = Record<string, string | number | boolean | null | undefined>;

export interface UserActivityItem {
  id: string;
  timestamp: string;
  category: UserActivityCategory;
  type: string;
  title: string;
  description: string;
  cashDelta?: string;
  shareDelta?: number;
  balanceAfter?: string;
  status?: string;
  entity?: UserActivityEntity;
  context?: UserActivityContext;
  metadata: UserActivityMetadata;
}

export interface UserActivityFeedSummary {
  total: number;
  cashCount: number;
  pendingCount: number;
  gameplayCount: number;
}

export interface UserActivityFeedResponse {
  activities: UserActivityItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  categoryCounts: Partial<Record<UserActivityCategory, number>>;
  summary: UserActivityFeedSummary;
}

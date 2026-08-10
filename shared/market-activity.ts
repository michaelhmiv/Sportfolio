export const MARKET_ACTIVITY_SIGNAL_TAGS = [
  "whale",
  "momentum",
  "value",
  "scout",
  "boost",
  "top_pool",
  "thin_pool",
  "live",
] as const;

export type MarketActivitySignalTag = (typeof MARKET_ACTIVITY_SIGNAL_TAGS)[number];

export const MARKET_ACTIVITY_SIDES = ["all", "buy", "sell", "peer"] as const;
export type MarketActivitySideFilter = (typeof MARKET_ACTIVITY_SIDES)[number];
export type MarketActivitySide = Exclude<MarketActivitySideFilter, "all">;

export const MARKET_ACTIVITY_GAME_STATES = ["all", "none", "upcoming", "live", "ended"] as const;
export type MarketActivityGameStateFilter = (typeof MARKET_ACTIVITY_GAME_STATES)[number];
export type MarketActivityGameState = Exclude<MarketActivityGameStateFilter, "all">;

export const MARKET_ACTIVITY_SORTS = ["recent", "notional", "priceImpact", "activity"] as const;
export type MarketActivitySort = (typeof MARKET_ACTIVITY_SORTS)[number];

export interface MarketActivityFeedItem {
  id: string;
  activityType: "trade";
  timestamp: string;
  playerId: string;
  playerName: string;
  playerFirstName: string;
  playerLastName: string;
  playerTeam: string;
  playerSport: string;
  buyerId: string | null;
  buyerUsername: string | null;
  sellerId: string | null;
  sellerUsername: string | null;
  quantity: number;
  price: number;
  currentPrice: number | null;
  notional: number;
  side: MarketActivitySide;
  gameState: MarketActivityGameState;
  gameStartTime: string | null;
  priceChange24h: number;
  spotMovePct: number;
  poolTvl: number;
  buyPressure: number;
  valueIndex: number;
  globalScoutCount: number;
  communityBoostCount: number;
  isWhale: boolean;
  isTopPool: boolean;
  isThinPool: boolean;
  primarySignal: MarketActivitySignalTag | null;
  signalTags: MarketActivitySignalTag[];
  note: string;
  activityScore: number;
  href: string;
}

export interface MarketActivityHighlight {
  playerId: string;
  playerName: string;
  team: string;
  sport: string;
  href: string;
  currentPrice: number | null;
  priceChange24h: number;
  note: string;
  metricLabel: string;
  metricValue: string;
  signal: MarketActivitySignalTag | "activity";
}

export interface MarketActivityFeedSummary {
  total: number;
  totalNotional: number;
  whaleCount: number;
  liveCount: number;
  activePoolCount: number;
}

export interface MarketActivityFeedHighlights {
  mostActiveNow: MarketActivityHighlight[];
  biggestPrints: MarketActivityHighlight[];
  momentumNames: MarketActivityHighlight[];
  thinPoolPressure: MarketActivityHighlight[];
  scoutBoostNames: MarketActivityHighlight[];
}

export interface MarketActivityFeedResponse {
  activities: MarketActivityFeedItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  summary: MarketActivityFeedSummary;
  sideCounts: Partial<Record<MarketActivitySide, number>>;
  signalCounts: Partial<Record<MarketActivitySignalTag, number>>;
  highlights: MarketActivityFeedHighlights;
}

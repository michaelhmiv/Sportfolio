import type {
  MarketActivityFeedItem,
  MarketActivityFeedResponse,
  MarketActivityGameState,
  MarketActivityGameStateFilter,
  MarketActivityHighlight,
  MarketActivitySide,
  MarketActivitySideFilter,
  MarketActivitySignalTag,
  MarketActivitySort,
} from "@shared/market-activity";

import type { MobileMarketOverview, MobileMarketSignal } from "./market-mobile-overview";

const WHALE_NOTIONAL_THRESHOLD = 5000;
const THIN_POOL_TVL_THRESHOLD = 5000;
const SCOUT_SIGNAL_THRESHOLD = 3;
const MOMENTUM_SIGNAL_THRESHOLD_PCT = 8;
const VALUE_SIGNAL_MAX_INDEX = 12;
const ACTIVITY_SCORE_PRICE_CHANGE_WEIGHT = 1.5;
const ACTIVITY_SCORE_NOTIONAL_WEIGHT = 12;
const ACTIVITY_SCORE_PRESSURE_DIVISOR = 10;
const ACTIVITY_SCORE_SCOUT_WEIGHT = 3;
const ACTIVITY_SCORE_BOOST_WEIGHT = 2;
const ACTIVITY_SCORE_WHALE_BONUS = 20;
const ACTIVITY_SCORE_LIVE_BONUS = 6;
// Prefer the most decision-useful market label when one trade qualifies for multiple tags.
const PRIMARY_SIGNAL_PRIORITY: MarketActivitySignalTag[] = [
  "whale",
  "momentum",
  "boost",
  "scout",
  "top_pool",
  "value",
  "thin_pool",
  "live",
];

export interface RawMarketActivityItem {
  id: string;
  activityType?: "trade";
  playerId: string;
  playerFirstName: string;
  playerLastName: string;
  playerTeam: string;
  playerSport?: string | null;
  buyerId: string | null;
  buyerUsername: string | null;
  sellerId: string | null;
  sellerUsername: string | null;
  quantity: number | string | null;
  price: number | string | null;
  currentPrice?: number | string | null;
  priceChange24h?: number | string | null;
  timestamp: string | Date;
}

export interface BuildMarketActivityFeedParams {
  activity: RawMarketActivityItem[];
  overview: MobileMarketOverview;
  limit: number;
  offset: number;
  filters?: {
    search?: string;
    team?: string;
    playerId?: string;
    side?: MarketActivitySideFilter;
    signal?: MarketActivitySignalTag | "all";
    gameState?: MarketActivityGameStateFilter;
    whalesOnly?: boolean;
    minNotional?: number;
    sort?: MarketActivitySort;
  };
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function dedupeHighlights(items: MarketActivityHighlight[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.playerId)) {
      return false;
    }
    seen.add(item.playerId);
    return true;
  });
}

function getSide(item: RawMarketActivityItem): MarketActivitySide {
  if (item.sellerId === "pool") {
    return "buy";
  }

  if (item.buyerId === "pool") {
    return "sell";
  }

  return "peer";
}

function mapSignalTag(signal: MobileMarketSignal | undefined): MarketActivitySignalTag | null {
  switch (signal?.signal) {
    case "momentum":
      return "momentum";
    case "value":
      return "value";
    case "scout":
      return "scout";
    case "boost":
      return "boost";
    case "pool":
      return "top_pool";
    default:
      return null;
  }
}

function getPrimarySignal(tags: MarketActivitySignalTag[]) {
  for (const tag of PRIMARY_SIGNAL_PRIORITY) {
    if (tags.includes(tag)) {
      return tag;
    }
  }

  return null;
}

function getPlayerName(item: { playerFirstName: string; playerLastName: string }) {
  return `${item.playerFirstName} ${item.playerLastName}`.trim();
}

function buildSignalMap(overview: MobileMarketOverview) {
  const map = new Map<string, MobileMarketSignal>();
  const sources = [
    ...overview.nowMoving,
    ...overview.leaderboards.risers,
    ...overview.leaderboards.topPools,
    ...overview.leaderboards.mostActive,
    ...overview.boostWindow,
    ...overview.scoutSurge,
    ...overview.quietValue,
    ...overview.watchlistMoves,
  ];

  sources.forEach((signal) => {
    if (!map.has(signal.playerId)) {
      map.set(signal.playerId, signal);
    }
  });

  return map;
}

function toHighlight(
  signal: MobileMarketSignal,
  metricLabel: string,
  metricValue: string,
): MarketActivityHighlight {
  return {
    playerId: signal.playerId,
    playerName: `${signal.firstName} ${signal.lastName}`.trim(),
    team: signal.team,
    sport: "",
    href: `/player/${signal.playerId}`,
    currentPrice: signal.currentPrice == null ? null : roundToTwo(signal.currentPrice),
    priceChange24h: roundToTwo(signal.priceChange24h),
    note: signal.note,
    metricLabel,
    metricValue,
    signal:
      signal.signal === "pool"
        ? "top_pool"
        : signal.signal === "activity"
          ? "activity"
          : (mapSignalTag(signal) ?? "activity"),
  };
}

export function getMarketActivitySourceFetchWindow(limit: number, offset: number) {
  // Pull a larger recent-trade window than the rendered page so post-query filtering/sorting
  // still has enough rows to build highlights and paginate without starving the ledger.
  return Math.min(Math.max(limit + offset + 60, 120), 400);
}

export function buildMarketActivityFeed({
  activity,
  overview,
  limit,
  offset,
  filters,
}: BuildMarketActivityFeedParams): MarketActivityFeedResponse {
  const signalMap = buildSignalMap(overview);
  const topPoolIds = new Set(overview.leaderboards.topPools.map((entry) => entry.playerId));
  const normalizedSearch = filters?.search?.trim().toLowerCase() || "";
  const normalizedTeam = filters?.team?.trim().toLowerCase() || "";
  const normalizedSide = filters?.side || "all";
  const normalizedSignal = filters?.signal || "all";
  const normalizedGameState = filters?.gameState || "all";
  const sort = filters?.sort || "recent";
  const minNotional = Math.max(filters?.minNotional || 0, 0);

  const enriched = activity.map<MarketActivityFeedItem>((item) => {
    const signal = signalMap.get(item.playerId);
    const playerName = getPlayerName(item);
    const quantity = toNumber(item.quantity);
    const price = toNumber(item.price);
    const currentPrice =
      item.currentPrice != null
        ? toNumber(item.currentPrice)
        : signal?.marketStatus === "priced"
          ? signal.currentPrice
          : null;
    const notional = roundToTwo(quantity * price);
    const gameState = (signal?.gameStatus || "none") as MarketActivityGameState;
    const poolTvl = roundToTwo(signal?.poolTvl || 0);
    const signalTags = new Set<MarketActivitySignalTag>();
    const mappedSignal = mapSignalTag(signal);
    const isWhale = notional >= WHALE_NOTIONAL_THRESHOLD;
    const isTopPool = topPoolIds.has(item.playerId);
    const isThinPool = poolTvl > 0 && poolTvl < THIN_POOL_TVL_THRESHOLD;

    if (mappedSignal) {
      signalTags.add(mappedSignal);
    }
    if (isWhale) {
      signalTags.add("whale");
    }
    if (isTopPool) {
      signalTags.add("top_pool");
    }
    if (isThinPool) {
      signalTags.add("thin_pool");
    }
    if (gameState === "live") {
      signalTags.add("live");
    }
    if ((signal?.globalScoutCount || 0) >= SCOUT_SIGNAL_THRESHOLD) {
      signalTags.add("scout");
    }
    if ((signal?.communityBoostCount || 0) > 0) {
      signalTags.add("boost");
    }
    if (Math.abs(signal?.priceChange24h || 0) >= MOMENTUM_SIGNAL_THRESHOLD_PCT) {
      signalTags.add("momentum");
    }
    if ((signal?.valueIndex || 0) > 0 && (signal?.valueIndex || 0) <= VALUE_SIGNAL_MAX_INDEX) {
      signalTags.add("value");
    }

    const tags = Array.from(signalTags);
    const primarySignal = getPrimarySignal(tags);
    const spotMovePct =
      price > 0 && currentPrice != null ? roundToTwo(((currentPrice - price) / price) * 100) : 0;
    const activityScore = roundToTwo(
      Math.abs(signal?.priceChange24h || 0) * ACTIVITY_SCORE_PRICE_CHANGE_WEIGHT +
        Math.log10(Math.max(notional, 1)) * ACTIVITY_SCORE_NOTIONAL_WEIGHT +
        (signal?.buyPressure || 50) / ACTIVITY_SCORE_PRESSURE_DIVISOR +
        (signal?.globalScoutCount || 0) * ACTIVITY_SCORE_SCOUT_WEIGHT +
        (signal?.communityBoostCount || 0) * ACTIVITY_SCORE_BOOST_WEIGHT +
        (isWhale ? ACTIVITY_SCORE_WHALE_BONUS : 0) +
        (gameState === "live" ? ACTIVITY_SCORE_LIVE_BONUS : 0),
    );

    const note =
      signal?.note ||
      (isWhale
        ? `Whale print ${quantity.toLocaleString()} sh / $${notional.toLocaleString()}`
        : gameState === "live"
          ? "Live-game pool activity"
          : isThinPool
            ? "Thin pool taking flow"
            : getSide(item) === "buy"
              ? "Pool buy flow"
              : getSide(item) === "sell"
                ? "Pool sell flow"
                : "Peer trade print");

    return {
      id: item.id,
      activityType: "trade",
      timestamp: new Date(item.timestamp).toISOString(),
      playerId: item.playerId,
      playerName,
      playerFirstName: item.playerFirstName,
      playerLastName: item.playerLastName,
      playerTeam: item.playerTeam || "",
      playerSport: String(item.playerSport || overview.sport || "ALL"),
      buyerId: item.buyerId,
      buyerUsername: item.buyerUsername,
      sellerId: item.sellerId,
      sellerUsername: item.sellerUsername,
      quantity: roundToTwo(quantity),
      price: roundToTwo(price),
      currentPrice: currentPrice == null ? null : roundToTwo(currentPrice),
      notional,
      side: getSide(item),
      gameState,
      gameStartTime: signal?.gameStartTime || null,
      priceChange24h: roundToTwo(signal?.priceChange24h || toNumber(item.priceChange24h)),
      spotMovePct,
      poolTvl,
      buyPressure: roundToTwo(signal?.buyPressure || 50),
      valueIndex: roundToTwo(signal?.valueIndex || 0),
      globalScoutCount: signal?.globalScoutCount || 0,
      communityBoostCount: signal?.communityBoostCount || 0,
      isWhale,
      isTopPool,
      isThinPool,
      primarySignal,
      signalTags: tags,
      note,
      activityScore,
      href: `/player/${item.playerId}`,
    };
  });

  const filtered = enriched.filter((item) => {
    if (filters?.playerId && item.playerId !== filters.playerId) {
      return false;
    }

    if (normalizedTeam && item.playerTeam.toLowerCase() !== normalizedTeam) {
      return false;
    }

    if (normalizedSide !== "all" && item.side !== normalizedSide) {
      return false;
    }

    if (normalizedSignal !== "all" && !item.signalTags.includes(normalizedSignal)) {
      return false;
    }

    if (normalizedGameState !== "all" && item.gameState !== normalizedGameState) {
      return false;
    }

    if (filters?.whalesOnly && !item.isWhale) {
      return false;
    }

    if (item.notional < minNotional) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const haystack = [
      item.playerName,
      item.playerTeam,
      item.playerSport,
      item.note,
      item.buyerUsername,
      item.sellerUsername,
      item.primarySignal,
      item.signalTags.join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedSearch);
  });

  filtered.sort((left, right) => {
    switch (sort) {
      case "notional":
        if (right.notional !== left.notional) {
          return right.notional - left.notional;
        }
        break;
      case "priceImpact":
        if (Math.abs(right.spotMovePct) !== Math.abs(left.spotMovePct)) {
          return Math.abs(right.spotMovePct) - Math.abs(left.spotMovePct);
        }
        break;
      case "activity":
        if (right.activityScore !== left.activityScore) {
          return right.activityScore - left.activityScore;
        }
        break;
      default:
        break;
    }

    return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
  });

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  const sideCounts = filtered.reduce<Partial<Record<MarketActivitySide, number>>>((acc, item) => {
    acc[item.side] = (acc[item.side] || 0) + 1;
    return acc;
  }, {});
  const signalCounts = filtered.reduce<Partial<Record<MarketActivitySignalTag, number>>>(
    (acc, item) => {
      item.signalTags.forEach((tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
      return acc;
    },
    {},
  );

  const biggestPrints = filtered
    .slice()
    .sort((left, right) => right.notional - left.notional)
    .slice(0, 4)
    .map<MarketActivityHighlight>((item) => ({
      playerId: item.playerId,
      playerName: item.playerName,
      team: item.playerTeam,
      sport: item.playerSport,
      href: item.href,
      currentPrice: item.currentPrice,
      priceChange24h: item.priceChange24h,
      note: item.note,
      metricLabel: "Print",
      metricValue: `$${item.notional.toLocaleString()}`,
      signal: item.isWhale ? "whale" : "activity",
    }));

  const thinPoolPressure = filtered
    .filter((item) => item.isThinPool)
    .slice()
    .sort((left, right) => right.notional - left.notional)
    .slice(0, 4)
    .map<MarketActivityHighlight>((item) => ({
      playerId: item.playerId,
      playerName: item.playerName,
      team: item.playerTeam,
      sport: item.playerSport,
      href: item.href,
      currentPrice: item.currentPrice,
      priceChange24h: item.priceChange24h,
      note: item.note,
      metricLabel: "TVL",
      metricValue: `$${item.poolTvl.toLocaleString()}`,
      signal: "thin_pool",
    }));

  const highlights = {
    mostActiveNow: dedupeHighlights(
      overview.leaderboards.mostActive
        .slice(0, 4)
        .map((signal) => toHighlight(signal, "Flow", signal.note)),
    ),
    biggestPrints,
    momentumNames: dedupeHighlights(
      overview.leaderboards.risers
        .slice(0, 4)
        .map((signal) =>
          toHighlight(
            signal,
            "24h",
            `${signal.priceChange24h >= 0 ? "+" : ""}${roundToTwo(signal.priceChange24h)}%`,
          ),
        ),
    ),
    thinPoolPressure,
    scoutBoostNames: dedupeHighlights(
      [...overview.scoutSurge.slice(0, 4), ...overview.boostWindow.slice(0, 4)]
        .map((signal) =>
          toHighlight(
            signal,
            signal.signal === "scout" ? "Scouts" : "Boosts",
            signal.signal === "scout"
              ? `${signal.globalScoutCount} active`
              : `+${signal.communityBoostCount} community`,
          ),
        )
        .slice(0, 4),
    ),
  };

  return {
    activities: page,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
    nextOffset: offset + limit < total ? offset + limit : null,
    summary: {
      total,
      totalNotional: roundToTwo(filtered.reduce((sum, item) => sum + item.notional, 0)),
      whaleCount: filtered.filter((item) => item.isWhale).length,
      liveCount: filtered.filter((item) => item.gameState === "live").length,
      activePoolCount: new Set(filtered.map((item) => item.playerId)).size,
    },
    sideCounts,
    signalCounts,
    highlights,
  };
}

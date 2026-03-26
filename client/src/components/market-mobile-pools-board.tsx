import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown, ArrowUpRight, Filter, HelpCircle, Loader2, Search, X } from "lucide-react";

import { PlayerName } from "@/components/player-name";
import { SportSelector } from "@/components/sport-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppState } from "@/hooks/use-app-state";
import { useAuth } from "@/hooks/useAuth";
import { formatCompactCurrency } from "@/lib/currency";
import { authenticatedFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/lib/websocket";
import type { Player } from "@shared/schema";

type SortField =
  | "price"
  | "volume"
  | "change"
  | "tvl"
  | "marketCap"
  | "sentiment"
  | "undervalued"
  | "fantasyPoints"
  | "name"
  | "team";

type SortOrder = "asc" | "desc";
type GameStatus = "none" | "upcoming" | "live" | "ended";
type HeatCheckStatus = "fire" | "ice" | "neutral";
type MarketHealthLabel = "quiet" | "balanced" | "active" | "heated";
type MarketIntelTab = "indicators" | "risers" | "value";
type MarketChipLabel =
  | "Boost live today"
  | "Scouts surging"
  | "Whale trade"
  | "Thin pool"
  | "Buy pressure"
  | "Heat check";

type PlayerWithPool = Player & {
  currentPrice?: string | number | null;
  priceChange24h?: string | number | null;
  volume24h?: number | null;
  marketCap?: string | number | null;
  poolTvl?: number | null;
  buyPressure?: number | null;
  valueIndex?: number | null;
  avgFantasyPointsPerGame?: string | number | null;
  hasGameToday?: boolean;
  gameStatus?: GameStatus;
  gameStartTime?: string | null;
  communityBoostCount?: number | null;
};

interface WatchlistSummary {
  id: string;
  name: string;
}

interface EligiblePlayer {
  playerId: string;
  player: {
    sport?: string | null;
  };
  availableShares: number;
  bestShareMultiplier: number;
  isAlreadyBoosted: boolean;
  gameStatus: GameStatus;
}

interface MobileMarketPulse {
  tradeCount15m: number;
  lowActivity: boolean;
  liveGameCount: number;
  slateGameCount: number;
  openBoostSlots: number | null;
  generatedAt: string;
}

interface MobileMarketTickerItem {
  id: string;
  playerId: string;
  playerName: string;
  symbol: string;
  team: string;
  currentPrice: number;
  priceChange24h: number;
  quantity: number;
  notional: number;
  isWhale: boolean;
  timestamp: string;
}

interface MobileMarketSignal {
  playerId: string;
  firstName: string;
  lastName: string;
  team: string;
  position: string;
  currentPrice: number;
  priceChange24h: number;
  poolTvl: number;
  buyPressure: number;
  valueIndex: number;
  globalScoutCount: number;
  communityBoostCount: number;
  gameStatus: GameStatus;
  gameStartTime: string | null;
  note: string;
  signal:
    | "momentum"
    | "value"
    | "scout"
    | "boost"
    | "watchlist"
    | "ticker"
    | "pool"
    | "activity"
    | "portfolio";
  availableShares: number | null;
  bestShareMultiplier: number | null;
  heatCheckStatus: HeatCheckStatus;
}

interface MobileMarketIndicators {
  healthScore: number;
  healthLabel: MarketHealthLabel;
  healthSummary: string;
  marketIndex24h: number;
  volatilityIndex: number;
  liquidityHealth: number;
  totalVolume24h: number;
  totalPoolShares: number;
  totalMarketTvl: number;
  breadth: {
    risers: number;
    fallers: number;
    flat: number;
  };
}

interface MobileMarketOverview {
  sport: string;
  pulse: MobileMarketPulse;
  marketIndicators: MobileMarketIndicators;
  ticker: MobileMarketTickerItem[];
  leaderboards: {
    risers: MobileMarketSignal[];
    topPools: MobileMarketSignal[];
    mostActive: MobileMarketSignal[];
    boostWindow: MobileMarketSignal[];
  };
  personalEdge: {
    ownedMovers: MobileMarketSignal[];
    watchlistMoves: MobileMarketSignal[];
    boostReady: MobileMarketSignal[];
    lpPositions: Array<{
      playerId: string;
      firstName: string;
      lastName: string;
      team: string;
      position: string;
      ownershipPercentage: number;
      positionValue: number;
      feesEarnedToDate: number;
    }>;
  } | null;
  nowMoving: MobileMarketSignal[];
  boostWindow: MobileMarketSignal[];
  scoutSurge: MobileMarketSignal[];
  quietValue: MobileMarketSignal[];
  watchlistMoves: MobileMarketSignal[];
}

interface PlayerQuickContext {
  availableShares?: number;
  bestShareMultiplier?: number;
  isBoostEligible?: boolean;
  scoutCount?: number;
  isWatchlisted?: boolean;
}

interface MarketMobileHomeProps {
  sport: string;
  players: PlayerWithPool[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  teamFilter: string;
  onTeamFilterChange: (value: string) => void;
  positionFilter: string;
  onPositionFilterChange: (value: string) => void;
  sortField: SortField;
  onSortFieldChange: (value: SortField) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (value: SortOrder) => void;
  filterWatchlistId: string;
  onWatchlistFilterChange: (value: string) => void;
  watchlists?: WatchlistSummary[];
  teams: string[];
  positions: string[];
  hasActiveFilters: boolean;
  showFilters: boolean;
  onShowFiltersChange: (open: boolean) => void;
  onClearFilters: () => void;
  totalPlayers: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onOpenPlayer: (
    player: PlayerWithPool,
    action: "default" | "buy" | "sell" | "boost" | "scout",
    quickContext?: PlayerQuickContext,
  ) => void;
}

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatSignedPercent(value: number, fractionDigits = 1) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(fractionDigits)}%`;
}

function formatCompactCount(value: number) {
  return compactNumberFormatter.format(Math.max(0, Math.round(value)));
}

function formatMarketFreshness(timestamp: number | null, generatedAt?: string) {
  const referenceTime = timestamp ?? (generatedAt ? new Date(generatedAt).getTime() : null);
  if (!referenceTime) {
    return "updated just now";
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - referenceTime) / 1000));
  if (diffSeconds < 60) {
    return `updated ${diffSeconds}s ago`;
  }

  return `updated ${Math.floor(diffSeconds / 60)}m ago`;
}

function getPrimaryChip(
  player: PlayerWithPool,
  signal: MobileMarketSignal | undefined,
  quickContext: PlayerQuickContext | undefined,
  whalePlayerIds: Set<string>,
): MarketChipLabel | null {
  if (quickContext?.isBoostEligible && player.gameStatus && player.gameStatus !== "none") {
    return "Boost live today";
  }

  if ((signal?.globalScoutCount || 0) >= 3) {
    return "Scouts surging";
  }

  if (whalePlayerIds.has(player.id)) {
    return "Whale trade";
  }

  if (toNumber(player.poolTvl) < 5000) {
    return "Thin pool";
  }

  if (toNumber(player.buyPressure || signal?.buyPressure) >= 65) {
    return "Buy pressure";
  }

  if ((signal?.heatCheckStatus || "neutral") === "fire") {
    return "Heat check";
  }

  return null;
}

function getChipClassName(label: MarketChipLabel | null) {
  switch (label) {
    case "Boost live today":
      return "border-yellow-500/30 bg-yellow-500/10 text-yellow-200";
    case "Scouts surging":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
    case "Whale trade":
      return "border-blue-500/30 bg-blue-500/10 text-blue-200";
    case "Thin pool":
      return "border-red-500/30 bg-red-500/10 text-red-200";
    case "Buy pressure":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "Heat check":
      return "border-orange-500/30 bg-orange-500/10 text-orange-200";
    default:
      return "border-border/60 bg-muted/30 text-muted-foreground";
  }
}

function getFreshnessClassName(freshnessState: "live" | "catching_up" | "offline") {
  switch (freshnessState) {
    case "live":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "catching_up":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "offline":
      return "border-red-500/30 bg-red-500/10 text-red-300";
  }
}

function getSortLabel(sortField: SortField) {
  switch (sortField) {
    case "volume":
      return "Volume";
    case "marketCap":
      return "Market Cap";
    case "price":
      return "Price";
    case "change":
      return "24h Change";
    case "tvl":
      return "TVL";
    case "sentiment":
      return "Sentiment";
    case "undervalued":
      return "Undervalued";
    case "fantasyPoints":
      return "Fantasy Pts";
    case "name":
      return "Name";
    case "team":
      return "Team";
  }
}

function getBoardMetricField(sortField: SortField): SortField {
  switch (sortField) {
    case "price":
      return "volume";
    case "name":
      return "team";
    case "team":
      return "volume";
    default:
      return sortField;
  }
}

function getBoardMetricLabel(sortField: SortField) {
  switch (sortField) {
    case "volume":
      return "Vol";
    case "marketCap":
      return "Cap";
    case "price":
      return "Price";
    case "change":
      return "24h";
    case "tvl":
      return "TVL";
    case "sentiment":
      return "Sent";
    case "undervalued":
      return "Value";
    case "fantasyPoints":
      return "FP";
    case "name":
      return "Name";
    case "team":
      return "Team";
  }
}

function formatBoardMetricValue(
  player: PlayerWithPool,
  sortField: SortField,
  signal?: MobileMarketSignal,
) {
  switch (sortField) {
    case "volume":
      return compactNumberFormatter.format(toNumber(player.volume24h));
    case "marketCap":
      return formatCompactCurrency(toNumber(player.marketCap));
    case "price":
      return `$${toNumber(player.currentPrice).toFixed(2)}`;
    case "change":
      return formatSignedPercent(toNumber(player.priceChange24h));
    case "tvl":
      return formatCompactCurrency(toNumber(player.poolTvl));
    case "sentiment":
      return `${toNumber(player.buyPressure || signal?.buyPressure).toFixed(0)}%`;
    case "undervalued":
      return toNumber(player.valueIndex || signal?.valueIndex).toFixed(0);
    case "fantasyPoints":
      return toNumber(player.avgFantasyPointsPerGame).toFixed(1);
    case "name":
      return `${player.lastName}, ${player.firstName}`;
    case "team":
      return player.team || "-";
  }
}

function buildPlayerStub(
  {
    playerId,
    firstName,
    lastName,
    team,
    position,
    currentPrice,
    priceChange24h,
    poolTvl,
    buyPressure,
    valueIndex,
    gameStatus,
    gameStartTime,
    communityBoostCount,
  }: {
    playerId: string;
    firstName: string;
    lastName: string;
    team: string;
    position: string;
    currentPrice?: number | null;
    priceChange24h?: number | null;
    poolTvl?: number | null;
    buyPressure?: number | null;
    valueIndex?: number | null;
    gameStatus?: GameStatus;
    gameStartTime?: string | null;
    communityBoostCount?: number | null;
  },
  sport: string,
): PlayerWithPool {
  return {
    id: playerId,
    firstName,
    lastName,
    team,
    position,
    sport: sport === "ALL" ? "NBA" : sport,
    currentPrice: currentPrice ?? "0",
    lastTradePrice: String(currentPrice ?? 0),
    priceChange24h: String(priceChange24h ?? 0),
    volume24h: 0,
    marketCap: "0",
    jerseyNumber: null,
    isActive: true,
    isEligibleForVesting: false,
    status: "active",
    totalShares: 0,
    totalHolders: 0,
    lastUpdated: new Date(0),
    teamId: null,
    externalId: null,
    league: null,
    metadata: null,
    injuryStatus: null,
    injuryDescription: null,
    injuryReturnDate: null,
    injuryUpdatedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    poolTvl: poolTvl ?? null,
    buyPressure: buyPressure ?? null,
    valueIndex: valueIndex ?? null,
    gameStatus,
    gameStartTime,
    communityBoostCount: communityBoostCount ?? 0,
  } as PlayerWithPool;
}

function MarketIntelList({
  items,
  emptyState,
  metric,
  onOpenPlayer,
  onSeeMore,
}: {
  items: MobileMarketSignal[];
  emptyState: string;
  metric: "change" | "tvl" | "value";
  onOpenPlayer: (item: MobileMarketSignal) => void;
  onSeeMore: () => void;
}) {
  const metricLabel = metric === "change" ? "24h" : metric === "value" ? "Value" : "TVL";

  if (items.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border/70 p-1.5 text-xs text-muted-foreground">
        {emptyState}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-sm border border-border/70 bg-muted/10"
      data-testid={`market-mobile-intel-list-${metric}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_56px_64px] gap-2 border-b border-border/60 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <div className="whitespace-nowrap">Player</div>
        <div className="text-right whitespace-nowrap">Price</div>
        <div className="text-right whitespace-nowrap">{metricLabel}</div>
      </div>
      {items.slice(0, 5).map((item) => {
        const metricText =
          metric === "change"
            ? formatSignedPercent(item.priceChange24h)
            : metric === "value"
              ? `${toNumber(item.valueIndex).toFixed(0)}`
              : formatCompactCurrency(item.poolTvl);

        return (
          <button
            key={`${metric}-${item.playerId}`}
            type="button"
            className="grid w-full grid-cols-[minmax(0,1fr)_56px_64px] items-center gap-2 border-b border-border/60 px-1.5 py-1 text-left transition-colors last:border-b-0 hover:bg-muted/25"
            onClick={() => onOpenPlayer(item)}
          >
            <div className="min-w-0 whitespace-nowrap">
              <div className="truncate text-xs font-semibold leading-none">
                <PlayerName
                  playerId={item.playerId}
                  firstName={item.firstName}
                  lastName={item.lastName}
                />
              </div>
              <div className="truncate pt-0.5 text-[9px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                {item.team}
                {item.position ? `/${item.position}` : ""}
              </div>
            </div>
            <div className="text-right font-mono text-[10px] whitespace-nowrap">
              ${item.currentPrice.toFixed(2)}
            </div>
            <div
              className={cn(
                "text-right font-mono text-[10px] whitespace-nowrap",
                metric === "change" &&
                  (item.priceChange24h >= 0 ? "text-positive" : "text-negative"),
                metric === "value" && "text-primary",
              )}
            >
              {metricText}
            </div>
          </button>
        );
      })}
      <button
        type="button"
        className="flex w-full items-center justify-between border-t border-border/60 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-muted/25"
        onClick={onSeeMore}
      >
        <span className="whitespace-nowrap">See More In Board</span>
        <ArrowUpRight className="h-3 w-3" />
      </button>
    </div>
  );
}

function MarketSummaryStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-sm bg-background/50 px-2 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="pt-0.5 font-mono text-[12px] text-foreground">{value}</div>
      {hint ? (
        <div className="truncate pt-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function MarketTabHeader({
  title,
  description,
  help,
}: {
  title: string;
  description: string;
  help?: string;
}) {
  return (
    <div className="mb-1 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </div>
        <div className="truncate pt-0.5 text-[10px] text-muted-foreground">{description}</div>
      </div>
      {help ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/40 text-muted-foreground transition-colors hover:bg-muted/25 hover:text-foreground"
              aria-label={`Explain ${title}`}
            >
              <HelpCircle className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-64 p-3">
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {title}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

function getCompactStatusToken(params: {
  player: PlayerWithPool;
  signal?: MobileMarketSignal;
  quickContext?: PlayerQuickContext;
  whalePlayerIds: Set<string>;
  hasLpPosition: boolean;
}) {
  const { player, signal, quickContext, whalePlayerIds, hasLpPosition } = params;
  const primaryChip = getPrimaryChip(player, signal, quickContext, whalePlayerIds);

  if (quickContext?.isBoostEligible && player.gameStatus && player.gameStatus !== "none") {
    return {
      label: "Boost Ready",
      className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-200",
    };
  }

  if (player.gameStatus === "live") {
    return {
      label: "Live",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    };
  }

  if (hasLpPosition) {
    return {
      label: "LP",
      className: "border-blue-500/30 bg-blue-500/10 text-blue-200",
    };
  }

  if (quickContext?.isWatchlisted) {
    return {
      label: "Watch",
      className: "border-primary/30 bg-primary/10 text-primary",
    };
  }

  if ((quickContext?.bestShareMultiplier || 1) > 1) {
    return {
      label: `x${quickContext?.bestShareMultiplier}`,
      className: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    };
  }

  if ((player.communityBoostCount || 0) > 0) {
    return {
      label: `C+${player.communityBoostCount}`,
      className: "border-orange-500/30 bg-orange-500/10 text-orange-200",
    };
  }

  if (!primaryChip) {
    return null;
  }

  return {
    label:
      primaryChip === "Scouts surging"
        ? "Scout"
        : primaryChip === "Whale trade"
          ? "Whale"
          : primaryChip === "Thin pool"
            ? "Thin"
            : primaryChip === "Buy pressure"
              ? "BUY"
              : primaryChip === "Heat check"
                ? "Heat"
                : "Boost Ready",
    className: getChipClassName(primaryChip),
  };
}

function getRowActionLabel() {
  return "Trade" as const;
}

function getRowActionType(quickContext: PlayerQuickContext) {
  if (quickContext.isBoostEligible) {
    return "boost" as const;
  }

  if ((quickContext.availableShares || 0) > 0) {
    return "sell" as const;
  }

  return "buy" as const;
}

function syncBoardToIntelSort(
  field: SortField,
  onSortFieldChange: (value: SortField) => void,
  onSortOrderChange: (value: SortOrder) => void,
  sortOrder: SortOrder = "desc",
) {
  onSortFieldChange(field);
  onSortOrderChange(sortOrder);

  if (typeof document !== "undefined") {
    window.requestAnimationFrame(() => {
      document
        .getElementById("market-mobile-trade-board")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

export function MarketMobilePoolsBoard({
  sport,
  players,
  isLoading,
  search,
  onSearchChange,
  teamFilter,
  onTeamFilterChange,
  positionFilter,
  onPositionFilterChange,
  sortField,
  onSortFieldChange,
  sortOrder,
  onSortOrderChange,
  filterWatchlistId,
  onWatchlistFilterChange,
  watchlists,
  teams,
  positions,
  hasActiveFilters,
  showFilters,
  onShowFiltersChange,
  onClearFilters,
  totalPlayers,
  page,
  totalPages,
  onPageChange,
  onOpenPlayer,
}: MarketMobileHomeProps) {
  const { isAuthenticated } = useAuth();
  const { shouldPoll, isMobile } = useAppState();
  const { freshnessState, lastMessageAt } = useWebSocket();
  const [activeIntelTab, setActiveIntelTab] = useState<MarketIntelTab>("indicators");

  const overviewPollingInterval = shouldPoll && isMobile ? 20000 : false;

  const { data: overview, isLoading: overviewLoading } = useQuery<MobileMarketOverview>({
    queryKey: ["/api/market/mobile-overview", sport, isAuthenticated ? "auth" : "public"],
    queryFn: async () => {
      const response = await authenticatedFetch(
        `/api/market/mobile-overview?sport=${encodeURIComponent(sport)}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch mobile market overview");
      }
      return response.json();
    },
    refetchInterval: overviewPollingInterval,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });

  const { data: eligibleData } = useQuery<{ eligiblePlayers: EligiblePlayer[] }>({
    queryKey: ["/api/daily-boosts/eligible-all", "market-mobile", sport],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/daily-boosts/eligible-all");
      if (!response.ok) {
        throw new Error("Failed to fetch boost eligibility");
      }
      return response.json();
    },
    enabled: isAuthenticated,
    refetchInterval: shouldPoll ? 60000 : false,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });

  const { data: watchlistIds = [] } = useQuery<string[]>({
    queryKey: ["/api/watchlist"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/watchlist");
      if (!response.ok) {
        throw new Error("Failed to fetch watchlist");
      }
      return response.json();
    },
    enabled: isAuthenticated,
    placeholderData: (previousData) => previousData,
  });

  const signalMap = useMemo(() => {
    const map = new Map<string, MobileMarketSignal>();
    const allSignals = [
      ...(overview?.leaderboards?.risers || overview?.nowMoving || []),
      ...(overview?.leaderboards?.topPools || []),
      ...(overview?.leaderboards?.mostActive || []),
      ...(overview?.leaderboards?.boostWindow || overview?.boostWindow || []),
      ...(overview?.scoutSurge || []),
      ...(overview?.quietValue || []),
      ...(overview?.watchlistMoves || []),
      ...(overview?.personalEdge?.ownedMovers || []),
      ...(overview?.personalEdge?.watchlistMoves || []),
      ...(overview?.personalEdge?.boostReady || []),
    ];

    allSignals.forEach((entry) => {
      if (!map.has(entry.playerId)) {
        map.set(entry.playerId, entry);
      }
    });

    return map;
  }, [overview]);

  const whalePlayerIds = useMemo(
    () =>
      new Set((overview?.ticker || []).filter((item) => item.isWhale).map((item) => item.playerId)),
    [overview?.ticker],
  );

  const eligibleMap = useMemo(() => {
    const map = new Map<string, EligiblePlayer>();
    const eligiblePlayers = eligibleData?.eligiblePlayers || [];

    eligiblePlayers
      .filter(
        (entry) => sport === "ALL" || entry.player?.sport?.toUpperCase() === sport.toUpperCase(),
      )
      .forEach((entry) => {
        map.set(entry.playerId, entry);
      });

    return map;
  }, [eligibleData?.eligiblePlayers, sport]);

  const watchlistSet = useMemo(() => new Set(watchlistIds), [watchlistIds]);

  const lpEdgeMap = useMemo(
    () =>
      new Map(
        (overview?.personalEdge?.lpPositions || []).map(
          (entry) => [entry.playerId, entry] as const,
        ),
      ),
    [overview?.personalEdge?.lpPositions],
  );

  const ownedPlayerIds = useMemo(
    () =>
      new Set([
        ...(overview?.personalEdge?.ownedMovers || []).map((entry) => entry.playerId),
        ...(overview?.personalEdge?.boostReady || []).map((entry) => entry.playerId),
      ]),
    [overview?.personalEdge?.boostReady, overview?.personalEdge?.ownedMovers],
  );

  const filterPills = [
    teamFilter !== "all" ? `Team ${teamFilter}` : null,
    positionFilter !== "all" ? `Pos ${positionFilter}` : null,
    filterWatchlistId !== "none"
      ? filterWatchlistId === "all"
        ? "My watchlists"
        : watchlists?.find((item) => item.id === filterWatchlistId)?.name || "Watchlist"
      : null,
    search ? `Search ${search}` : null,
  ].filter(Boolean) as string[];

  const boardMetricField = getBoardMetricField(sortField);
  const marketFreshness = formatMarketFreshness(lastMessageAt, overview?.pulse.generatedAt);
  const liveSlateDisplay = `${overview?.pulse.liveGameCount ?? 0}/${overview?.pulse.slateGameCount ?? 0}`;

  const getQuickContext = (playerId: string, signal?: MobileMarketSignal): PlayerQuickContext => {
    const eligible = eligibleMap.get(playerId);

    return {
      availableShares: signal?.availableShares ?? eligible?.availableShares,
      bestShareMultiplier: signal?.bestShareMultiplier ?? eligible?.bestShareMultiplier,
      isBoostEligible:
        signal?.signal === "boost" ||
        (!!eligible &&
          eligible.availableShares >= 1 &&
          !eligible.isAlreadyBoosted &&
          eligible.gameStatus !== "none" &&
          eligible.gameStatus !== "ended"),
      scoutCount: signal?.globalScoutCount,
      isWatchlisted: watchlistSet.has(playerId),
    };
  };

  const getPlayerForSignal = (signal: MobileMarketSignal) =>
    players.find((entry) => entry.id === signal.playerId) ||
    buildPlayerStub(
      {
        playerId: signal.playerId,
        firstName: signal.firstName,
        lastName: signal.lastName,
        team: signal.team,
        position: signal.position,
        currentPrice: signal.currentPrice,
        priceChange24h: signal.priceChange24h,
        poolTvl: signal.poolTvl,
        buyPressure: signal.buyPressure,
        valueIndex: signal.valueIndex,
        gameStatus: signal.gameStatus,
        gameStartTime: signal.gameStartTime,
        communityBoostCount: signal.communityBoostCount,
      },
      sport,
    );

  const intelTabs: Array<{ id: MarketIntelTab; label: string }> = [
    { id: "indicators", label: "Indicators" },
    { id: "risers", label: "Top Risers" },
    { id: "value", label: "Value Scan" },
  ];
  const valueScanHelpText =
    "Value scan ranks players by Sportfolio's value index: current market price relative to recent fantasy production. Lower values suggest cheaper pricing for the output.";

  return (
    <div className="space-y-1.5 md:hidden">
      <Card
        variant="terminal"
        className="overflow-hidden border-border/80"
        data-testid="mobile-market-intel"
      >
        <CardContent className="p-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Market Summary
              </div>
              <div className="flex items-center gap-1 pt-1">
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 whitespace-nowrap px-1 text-[9px] uppercase tracking-[0.08em]",
                    getFreshnessClassName(freshnessState),
                  )}
                >
                  {freshnessState === "live"
                    ? "Live"
                    : freshnessState === "catching_up"
                      ? "Delay"
                      : "Offline"}
                </Badge>
                <div className="truncate text-[9px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                  {marketFreshness}
                </div>
              </div>
            </div>
            <SportSelector size="sm" className="w-[112px] shrink-0" />
          </div>

          <div className="mt-1 grid grid-cols-3 gap-1 rounded-sm border border-border/60 bg-background/30 p-0.5">
            {intelTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  "rounded-sm px-1 py-1 text-center text-[9px] font-semibold uppercase tracking-[0.08em] transition-colors",
                  activeIntelTab === tab.id
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-muted/30",
                )}
                onClick={() => setActiveIntelTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-1">
            {overviewLoading ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : activeIntelTab === "indicators" ? (
              <div className="space-y-1">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border/60 bg-border/60 p-px">
                  <MarketSummaryStat
                    label="Volatility"
                    value={String(Math.round(overview?.marketIndicators.volatilityIndex || 0))}
                    hint="0-100"
                  />
                  <MarketSummaryStat
                    label="24h Volume"
                    value={formatCompactCount(overview?.marketIndicators.totalVolume24h || 0)}
                    hint="shares traded"
                  />
                  <MarketSummaryStat
                    label="Pool Shares"
                    value={formatCompactCount(overview?.marketIndicators.totalPoolShares || 0)}
                    hint="across pools"
                  />
                  <MarketSummaryStat
                    label="Market TVL"
                    value={formatCompactCurrency(overview?.marketIndicators.totalMarketTvl || 0)}
                    hint={sport === "ALL" ? "all sports" : sport}
                  />
                </div>

                <div className="flex flex-wrap gap-1 text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                  <Badge
                    variant="outline"
                    className="h-5 whitespace-nowrap rounded-sm border-border/70 bg-background/30 px-1.5"
                  >
                    <span className="mr-1 font-mono text-foreground">{liveSlateDisplay}</span>
                    live/slate
                  </Badge>
                  <Badge
                    variant="outline"
                    className="h-5 whitespace-nowrap rounded-sm border-border/70 bg-background/30 px-1.5"
                  >
                    <span className="mr-1 font-mono text-foreground">
                      {overview?.pulse.tradeCount15m ?? 0}
                    </span>
                    trades/15m
                  </Badge>
                  <Badge
                    variant="outline"
                    className="h-5 whitespace-nowrap rounded-sm border-border/70 bg-background/30 px-1.5"
                  >
                    <span className="mr-1 font-mono text-foreground">{marketFreshness}</span>
                    feed
                  </Badge>
                </div>
              </div>
            ) : activeIntelTab === "risers" ? (
              <div>
                <MarketTabHeader
                  title="Top Risers"
                  description="Highest positive 24h price moves in the market."
                />
                <MarketIntelList
                  items={overview?.leaderboards?.risers || overview?.nowMoving || []}
                  emptyState="No positive risers yet."
                  metric="change"
                  onOpenPlayer={(signal) =>
                    onOpenPlayer(
                      getPlayerForSignal(signal),
                      "buy",
                      getQuickContext(signal.playerId, signal),
                    )
                  }
                  onSeeMore={() =>
                    syncBoardToIntelSort("change", onSortFieldChange, onSortOrderChange)
                  }
                />
              </div>
            ) : (
              <div>
                <MarketTabHeader
                  title="Value Scan"
                  description="Cheaper market pricing relative to recent fantasy output."
                  help={valueScanHelpText}
                />
                <MarketIntelList
                  items={overview?.quietValue || []}
                  emptyState="No value names yet."
                  metric="value"
                  onOpenPlayer={(signal) =>
                    onOpenPlayer(
                      getPlayerForSignal(signal),
                      "buy",
                      getQuickContext(signal.playerId, signal),
                    )
                  }
                  onSeeMore={() =>
                    syncBoardToIntelSort("undervalued", onSortFieldChange, onSortOrderChange, "asc")
                  }
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card variant="terminal" className="overflow-hidden" id="market-mobile-trade-board">
        <CardContent className="p-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Trade Board
              </div>
              <div className="truncate text-[9px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                {totalPlayers} pools | {getSortLabel(sortField)} | {sortOrder}
              </div>
            </div>
            <Badge
              variant="outline"
              className="h-5 border-border/80 bg-muted/20 px-1 text-[9px] uppercase tracking-[0.08em]"
            >
              {sortOrder}
            </Badge>
          </div>

          <div className="mt-1 space-y-1">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                variant="terminal"
                placeholder="Search players, teams, positions..."
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                className="h-7 pl-7 pr-8 text-xs"
              />
              {search && (
                <Button
                  type="button"
                  variant="terminalOutline"
                  size="sm"
                  className="absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2 p-0"
                  onClick={() => onSearchChange("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_56px_72px] gap-1">
              <select
                value={sortField}
                onChange={(event) => onSortFieldChange(event.target.value as SortField)}
                className="h-7 min-w-0 rounded-sm border border-border bg-[hsl(var(--card)/0.85)] px-2 font-mono text-xs"
              >
                <option value="volume">Volume</option>
                <option value="marketCap">Market Cap</option>
                <option value="price">Price</option>
                <option value="change">24h Change</option>
                <option value="tvl">TVL</option>
                <option value="sentiment">Sentiment</option>
                <option value="undervalued">Undervalued</option>
                <option value="fantasyPoints">Fantasy Pts</option>
                <option value="name">Name</option>
                <option value="team">Team</option>
              </select>

              <Button
                type="button"
                variant="terminalOutline"
                size="sm"
                className="h-7 gap-1 px-0 text-[9px]"
                onClick={() => onSortOrderChange(sortOrder === "asc" ? "desc" : "asc")}
              >
                <ArrowUpDown className="h-3 w-3" />
                {sortOrder === "asc" ? "Asc" : "Desc"}
              </Button>

              <Button
                type="button"
                variant="terminalOutline"
                size="sm"
                className="h-7 gap-1 px-1.5 text-[9px]"
                onClick={() => onShowFiltersChange(!showFilters)}
                data-testid="button-open-market-filters"
              >
                <Filter className="h-3 w-3" />
                Filters
                {hasActiveFilters && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 py-0 text-[9px]">
                    {filterPills.length}
                  </Badge>
                )}
              </Button>
            </div>

            {filterPills.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {filterPills.map((pill) => (
                  <Badge
                    key={pill}
                    variant="outline"
                    className="h-5 border-border/80 bg-muted/20 px-1.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground"
                  >
                    {pill}
                  </Badge>
                ))}
              </div>
            )}

            {showFilters && (
              <div className="grid grid-cols-2 gap-1 rounded-sm border border-border/70 bg-muted/10 p-1.5">
                <div className="space-y-1">
                  <label className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Team
                  </label>
                  <select
                    value={teamFilter}
                    onChange={(event) => onTeamFilterChange(event.target.value)}
                    className="h-7 w-full rounded-sm border border-border bg-[hsl(var(--card)/0.85)] px-2 font-mono text-xs"
                  >
                    <option value="all">All Teams</option>
                    {teams.map((team) => (
                      <option key={team} value={team}>
                        {team}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Position
                  </label>
                  <select
                    value={positionFilter}
                    onChange={(event) => onPositionFilterChange(event.target.value)}
                    className="h-7 w-full rounded-sm border border-border bg-[hsl(var(--card)/0.85)] px-2 font-mono text-xs"
                  >
                    <option value="all">All Positions</option>
                    {positions.map((position) => (
                      <option key={position} value={position}>
                        {position}
                      </option>
                    ))}
                  </select>
                </div>

                {isAuthenticated && (
                  <div className="col-span-2 space-y-1">
                    <label className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Watchlist
                    </label>
                    <select
                      value={filterWatchlistId}
                      onChange={(event) => onWatchlistFilterChange(event.target.value)}
                      className="h-7 w-full rounded-sm border border-border bg-[hsl(var(--card)/0.85)] px-2 font-mono text-xs"
                    >
                      <option value="none">All Players</option>
                      <option value="all">My Watchlists</option>
                      {watchlists?.map((watchlist) => (
                        <option key={watchlist.id} value={watchlist.id}>
                          {watchlist.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="col-span-2 flex items-center gap-1">
                  <Button
                    type="button"
                    variant="terminal"
                    className="h-7 flex-1 px-0 text-[10px]"
                    onClick={onClearFilters}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant="terminalOutline"
                    className="h-7 flex-1 px-0 text-[10px]"
                    onClick={() => onShowFiltersChange(false)}
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-1 overflow-hidden rounded-sm border border-border/70 bg-muted/10">
            <div
              className="grid grid-cols-[minmax(0,1.95fr)_58px_66px_54px] gap-1.5 border-b border-border/70 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              data-testid="market-mobile-trade-board-header"
            >
              <div className="whitespace-nowrap">Player</div>
              <div className="text-right whitespace-nowrap">Price</div>
              <div className="text-right whitespace-nowrap">
                {getBoardMetricLabel(boardMetricField)}
              </div>
              <div className="text-center whitespace-nowrap">Act</div>
            </div>

            {isLoading || overviewLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : players.length === 0 ? (
              <div className="p-4 text-center">
                <div className="text-xs text-muted-foreground">No players match this setup.</div>
                {hasActiveFilters && (
                  <Button
                    type="button"
                    variant="terminalOutline"
                    size="sm"
                    className="mt-2 h-6 px-2 text-[10px]"
                    onClick={onClearFilters}
                  >
                    Reset filters
                  </Button>
                )}
              </div>
            ) : (
              players.map((player) => {
                const signal = signalMap.get(player.id);
                const quickContext = getQuickContext(player.id, signal);
                const currentPrice = toNumber(player.currentPrice);
                const boardMetricValue = formatBoardMetricValue(player, boardMetricField, signal);
                const rowToken = getCompactStatusToken({
                  player,
                  signal,
                  quickContext,
                  whalePlayerIds,
                  hasLpPosition: lpEdgeMap.has(player.id),
                });
                const rowAction = getRowActionType(quickContext);
                const rowActionLabel = getRowActionLabel();

                return (
                  <div
                    key={player.id}
                    className="grid grid-cols-[minmax(0,1.95fr)_58px_66px_54px] items-center gap-1.5 border-b border-border/60 px-1.5 py-1 last:border-b-0"
                    data-testid="market-mobile-player-card"
                  >
                    <button
                      type="button"
                      className="col-span-3 grid grid-cols-[minmax(0,1.95fr)_58px_66px] items-center gap-1.5 text-left whitespace-nowrap"
                      onClick={() => onOpenPlayer(player, "default", quickContext)}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 overflow-hidden whitespace-nowrap">
                          <div
                            className={cn(
                              "truncate text-xs font-semibold leading-none",
                              ownedPlayerIds.has(player.id) && "text-positive",
                            )}
                          >
                            <PlayerName
                              playerId={player.id}
                              firstName={player.firstName}
                              lastName={player.lastName}
                            />
                          </div>
                          <div className="shrink-0 text-[9px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                            {[player.team, player.position].filter(Boolean).join("/") || "-"}
                          </div>
                          {rowToken && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-5 shrink-0 px-1 text-[9px] uppercase tracking-[0.08em]",
                                rowToken.className,
                              )}
                            >
                              {rowToken.label}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="text-right font-mono text-[10px] font-semibold whitespace-nowrap">
                        ${currentPrice.toFixed(2)}
                      </div>

                      <div className="truncate text-right font-mono text-[10px] uppercase tracking-[0.08em] text-foreground whitespace-nowrap">
                        {boardMetricValue}
                      </div>
                    </button>

                    <Button
                      type="button"
                      variant="terminal"
                      size="sm"
                      className="h-6 w-full px-0 text-[9px]"
                      onClick={() => onOpenPlayer(player, rowAction, quickContext)}
                    >
                      {rowActionLabel}
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-1 flex items-center justify-between rounded-sm border border-border/70 bg-muted/15 px-1.5 py-1">
              <div className="text-[9px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                Page {page} / {totalPages}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="terminalOutline"
                  size="sm"
                  className="h-6 px-2 text-[9px]"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="terminalOutline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[9px]"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)}
                >
                  Next
                  <ArrowUpRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

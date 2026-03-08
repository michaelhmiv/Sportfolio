import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  ArrowUpRight,
  Binoculars,
  Filter,
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";

import { PlayerName } from "@/components/player-name";
import { SportSelector } from "@/components/sport-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { useAppState } from "@/hooks/use-app-state";
import { useAuth } from "@/hooks/useAuth";
import { authenticatedFetch } from "@/lib/queryClient";
import { useWebSocket } from "@/lib/websocket";
import { cn } from "@/lib/utils";
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
  signal: "momentum" | "value" | "scout" | "boost" | "watchlist" | "ticker";
  availableShares: number | null;
  bestShareMultiplier: number | null;
  heatCheckStatus: HeatCheckStatus;
}

interface MobileMarketOverview {
  sport: string;
  pulse: MobileMarketPulse;
  ticker: MobileMarketTickerItem[];
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

function formatCompactCurrency(value: number) {
  return `$${compactNumberFormatter.format(value)}`;
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

function formatGameLabel(
  player: PlayerWithPool | MobileMarketSignal,
  quickContext?: PlayerQuickContext,
) {
  if (quickContext?.isBoostEligible && player.gameStatus && player.gameStatus !== "none") {
    return "Boost live today";
  }

  if (player.gameStatus === "live") {
    return "Game live now";
  }

  if (player.gameStatus === "ended") {
    return "Slate complete";
  }

  if (player.gameStartTime) {
    return `Starts ${formatDistanceToNow(new Date(player.gameStartTime), { addSuffix: true })}`;
  }

  return "No game on deck";
}

function getLiquidityLabel(player: PlayerWithPool) {
  const tvl = toNumber(player.poolTvl);
  if (tvl < 5000) {
    return "Thin pool";
  }

  if (tvl < 20000) {
    return "Watch slippage";
  }

  return "Deep pool";
}

function getEngagementLabel(
  player: PlayerWithPool,
  signal: MobileMarketSignal | undefined,
  whalePlayerIds: Set<string>,
) {
  if (whalePlayerIds.has(player.id)) {
    return "Whale tape";
  }

  if ((signal?.globalScoutCount || 0) > 0) {
    return `${signal?.globalScoutCount} active scouts`;
  }

  const buyPressure = toNumber(player.buyPressure || signal?.buyPressure);
  if (buyPressure > 0) {
    return `${buyPressure.toFixed(0)}% buy pressure`;
  }

  return `${compactNumberFormatter.format(toNumber(player.volume24h))} 24h volume`;
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

function NarrativeModule({
  title,
  subtitle,
  items,
  emptyState,
  testId,
  accentClassName,
  onOpenPlayer,
}: {
  title: string;
  subtitle: string;
  items: MobileMarketSignal[];
  emptyState: string;
  testId: string;
  accentClassName: string;
  onOpenPlayer: (item: MobileMarketSignal) => void;
}) {
  return (
    <Card
      variant="terminal"
      className="relative overflow-hidden border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]"
      data-testid={testId}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {title}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className={cn("h-2.5 w-2.5 rounded-full", accentClassName)} />
        </div>

        {items.length === 0 ? (
          <div className="mt-4 rounded-sm border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
            {emptyState}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {items.slice(0, 2).map((item) => (
              <button
                key={`${title}-${item.playerId}`}
                type="button"
                className="w-full rounded-sm border border-border/70 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/35"
                onClick={() => onOpenPlayer(item)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      <PlayerName
                        playerId={item.playerId}
                        firstName={item.firstName}
                        lastName={item.lastName}
                      />
                    </div>
                    <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                      {item.team} {item.position ? `• ${item.position}` : ""}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "shrink-0 text-xs font-mono",
                      item.priceChange24h >= 0 ? "text-positive" : "text-negative",
                    )}
                  >
                    {item.priceChange24h >= 0 ? "+" : ""}
                    {item.priceChange24h.toFixed(1)}%
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-mono uppercase tracking-[0.08em]">
                  <span className="truncate text-muted-foreground">{item.note}</span>
                  <span className="shrink-0">${item.currentPrice.toFixed(2)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MarketMobileHome({
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
      ...(overview?.nowMoving || []),
      ...(overview?.boostWindow || []),
      ...(overview?.scoutSurge || []),
      ...(overview?.quietValue || []),
      ...(overview?.watchlistMoves || []),
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

  const lowActivityMessage = overview?.pulse.lowActivity
    ? "Tape is quiet. Scout spikes, boost windows, and pricing gaps are driving the best setups."
    : "Trade velocity is live. Lean into movers, follow the tape, and work your boost slots.";

  return (
    <div className="space-y-4 md:hidden">
      <div className="sticky top-0 z-30 -mx-3 border-b border-border/70 bg-[hsl(var(--background)/0.94)] px-3 pb-3 pt-3 backdrop-blur">
        <Card
          variant="terminal"
          className="overflow-hidden border-border/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01))]"
          data-testid="mobile-market-pulse"
        >
          <CardContent className="space-y-3 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="terminal-strip">Live Market</div>
                <h1 className="mt-2 text-base font-semibold uppercase tracking-[0.08em]">
                  Player Pools
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">{lowActivityMessage}</p>
              </div>
              <SportSelector size="sm" className="w-[116px] shrink-0" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-sm border border-border/70 bg-muted/15 p-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Trades / 15m
                </div>
                <div className="mt-1 font-mono text-sm font-semibold">
                  {overview?.pulse.tradeCount15m ?? "--"}
                </div>
              </div>
              <div className="rounded-sm border border-border/70 bg-muted/15 p-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Live Games
                </div>
                <div className="mt-1 font-mono text-sm font-semibold">
                  {overview?.pulse.liveGameCount ?? 0}/{overview?.pulse.slateGameCount ?? 0}
                </div>
              </div>
              <div className="rounded-sm border border-border/70 bg-muted/15 p-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Boost Slots
                </div>
                <div className="mt-1 font-mono text-sm font-semibold">
                  {overview?.pulse.openBoostSlots ?? "--"}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "uppercase tracking-[0.12em]",
                    getFreshnessClassName(freshnessState),
                  )}
                >
                  {freshnessState === "live"
                    ? "Live"
                    : freshnessState === "catching_up"
                      ? "Catching up"
                      : "Offline"}
                </Badge>
                <span className="truncate text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                  {formatMarketFreshness(lastMessageAt, overview?.pulse.generatedAt)}
                </span>
              </div>

              <Button
                type="button"
                variant="terminalOutline"
                size="sm"
                className="h-8 gap-1.5 px-3"
                onClick={() => onShowFiltersChange(true)}
                data-testid="button-open-market-filters"
              >
                <Filter className="h-3.5 w-3.5" />
                Filter
                {hasActiveFilters && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                    {filterPills.length}
                  </Badge>
                )}
              </Button>
            </div>

            {filterPills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {filterPills.map((pill) => (
                  <Badge
                    key={pill}
                    variant="outline"
                    className="border-border/80 bg-muted/20 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
                  >
                    {pill}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card variant="terminal" className="overflow-hidden" data-testid="mobile-market-tape">
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Live Tape
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Recent prints, whale clips, and directional flow.
              </p>
            </div>
            <Activity className="h-4 w-4 text-primary" />
          </div>

          <div className="mt-4 flex snap-x gap-3 overflow-x-auto pb-1">
            {(overview?.ticker || []).length === 0 ? (
              <div className="w-full rounded-sm border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">
                Market tape is quiet right now.
              </div>
            ) : (
              (overview?.ticker || []).slice(0, 8).map((item) => {
                const player = players.find((entry) => entry.id === item.playerId);
                const eligible = eligibleMap.get(item.playerId);

                return (
                  <button
                    key={item.id}
                    type="button"
                    className="min-w-[220px] snap-start rounded-sm border border-border/70 bg-muted/20 p-3 text-left transition-colors hover:bg-muted/35"
                    onClick={() => {
                      if (!player) return;

                      onOpenPlayer(player, "buy", {
                        availableShares: eligible?.availableShares,
                        bestShareMultiplier: eligible?.bestShareMultiplier,
                        isBoostEligible:
                          !!eligible &&
                          eligible.availableShares >= 1 &&
                          !eligible.isAlreadyBoosted &&
                          eligible.gameStatus !== "none" &&
                          eligible.gameStatus !== "ended",
                        scoutCount: signalMap.get(item.playerId)?.globalScoutCount,
                        isWatchlisted: watchlistSet.has(item.playerId),
                      });
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{item.symbol}</div>
                        <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                          {item.team}
                        </div>
                      </div>
                      {item.isWhale && (
                        <Badge
                          variant="outline"
                          className="border-blue-500/30 bg-blue-500/10 text-blue-200"
                        >
                          Whale
                        </Badge>
                      )}
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div>
                        <div className="font-mono text-base font-semibold">
                          ${item.currentPrice.toFixed(2)}
                        </div>
                        <div
                          className={cn(
                            "text-xs font-mono",
                            item.priceChange24h >= 0 ? "text-positive" : "text-negative",
                          )}
                        >
                          {item.priceChange24h >= 0 ? "+" : ""}
                          {item.priceChange24h.toFixed(1)}% / 24h
                        </div>
                      </div>
                      <div className="text-right text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                        <div>{item.quantity} sh</div>
                        <div>{formatCompactCurrency(item.notional)}</div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <NarrativeModule
          title="Now Moving"
          subtitle={
            overview?.pulse.lowActivity
              ? "Momentum leaders on a thinner tape"
              : "Fastest movers right now"
          }
          items={overview?.nowMoving || []}
          emptyState="No momentum breakouts yet."
          testId="market-module-now-moving"
          accentClassName="bg-emerald-400"
          onOpenPlayer={(item) => {
            const player = players.find((entry) => entry.id === item.playerId);
            if (!player) return;
            onOpenPlayer(player, "buy", {
              availableShares: item.availableShares || undefined,
              bestShareMultiplier: item.bestShareMultiplier || undefined,
              isBoostEligible: item.signal === "boost",
              scoutCount: item.globalScoutCount,
              isWatchlisted: watchlistSet.has(item.playerId),
            });
          }}
        />
        <NarrativeModule
          title="Boost Window"
          subtitle="Shares with live or same-day burn leverage."
          items={overview?.boostWindow || []}
          emptyState="No boost-ready names on deck."
          testId="market-module-boost-window"
          accentClassName="bg-yellow-400"
          onOpenPlayer={(item) => {
            const player = players.find((entry) => entry.id === item.playerId);
            if (!player) return;
            onOpenPlayer(player, "boost", {
              availableShares: item.availableShares || undefined,
              bestShareMultiplier: item.bestShareMultiplier || undefined,
              isBoostEligible: true,
              scoutCount: item.globalScoutCount,
              isWatchlisted: watchlistSet.has(item.playerId),
            });
          }}
        />
        <NarrativeModule
          title="Scout Surge"
          subtitle="Where attention is piling in fastest."
          items={overview?.scoutSurge || []}
          emptyState="Scout pressure is muted right now."
          testId="market-module-scout-surge"
          accentClassName="bg-cyan-400"
          onOpenPlayer={(item) => {
            const player = players.find((entry) => entry.id === item.playerId);
            if (!player) return;
            onOpenPlayer(player, isAuthenticated ? "scout" : "buy", {
              availableShares: item.availableShares || undefined,
              bestShareMultiplier: item.bestShareMultiplier || undefined,
              isBoostEligible: false,
              scoutCount: item.globalScoutCount,
              isWatchlisted: watchlistSet.has(item.playerId),
            });
          }}
        />
        <NarrativeModule
          title="Quiet Value"
          subtitle="Underowned names with better pricing."
          items={overview?.quietValue || []}
          emptyState="Value scanner is waiting for fresh edges."
          testId="market-module-quiet-value"
          accentClassName="bg-orange-400"
          onOpenPlayer={(item) => {
            const player = players.find((entry) => entry.id === item.playerId);
            if (!player) return;
            onOpenPlayer(player, "buy", {
              availableShares: item.availableShares || undefined,
              bestShareMultiplier: item.bestShareMultiplier || undefined,
              isBoostEligible: false,
              scoutCount: item.globalScoutCount,
              isWatchlisted: watchlistSet.has(item.playerId),
            });
          }}
        />
      </div>

      {(overview?.watchlistMoves || []).length > 0 && (
        <Card
          variant="terminal"
          className="overflow-hidden"
          data-testid="market-module-watchlist-moves"
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Watchlist Moves
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your saved names with the most motion.
                </p>
              </div>
              <Wallet className="h-4 w-4 text-primary" />
            </div>

            <div className="mt-4 space-y-2">
              {overview?.watchlistMoves.slice(0, 3).map((item) => {
                const player = players.find((entry) => entry.id === item.playerId);
                if (!player) {
                  return null;
                }

                return (
                  <button
                    key={item.playerId}
                    type="button"
                    className="flex w-full items-center justify-between rounded-sm border border-border/70 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/35"
                    onClick={() =>
                      onOpenPlayer(player, "default", {
                        availableShares: item.availableShares || undefined,
                        bestShareMultiplier: item.bestShareMultiplier || undefined,
                        isBoostEligible: false,
                        scoutCount: item.globalScoutCount,
                        isWatchlisted: true,
                      })
                    }
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        <PlayerName
                          playerId={item.playerId}
                          firstName={item.firstName}
                          lastName={item.lastName}
                        />
                      </div>
                      <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                        {item.note}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "shrink-0 text-sm font-mono",
                        item.priceChange24h >= 0 ? "text-positive" : "text-negative",
                      )}
                    >
                      {item.priceChange24h >= 0 ? "+" : ""}
                      {item.priceChange24h.toFixed(1)}%
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card variant="terminal" className="overflow-hidden">
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Trade Board
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {totalPlayers} pools sorted by {getSortLabel(sortField).toLowerCase()}.
              </p>
            </div>
            <Badge
              variant="outline"
              className="border-border/80 bg-muted/20 text-[10px] uppercase tracking-[0.08em]"
            >
              {sortOrder === "asc" ? "Asc" : "Desc"}
            </Badge>
          </div>

          <div className="mt-4 space-y-3">
            {isLoading || overviewLoading ? (
              <div className="flex items-center justify-center rounded-sm border border-dashed border-border/70 py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : players.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border/70 p-5 text-center">
                <div className="text-sm text-muted-foreground">No players match this setup.</div>
                {hasActiveFilters && (
                  <Button
                    type="button"
                    variant="terminalOutline"
                    size="sm"
                    className="mt-3"
                    onClick={onClearFilters}
                  >
                    Reset filters
                  </Button>
                )}
              </div>
            ) : (
              players.map((player) => {
                const signal = signalMap.get(player.id);
                const eligible = eligibleMap.get(player.id);
                const quickContext: PlayerQuickContext = {
                  availableShares: eligible?.availableShares,
                  bestShareMultiplier: eligible?.bestShareMultiplier,
                  isBoostEligible:
                    !!eligible &&
                    eligible.availableShares >= 1 &&
                    !eligible.isAlreadyBoosted &&
                    eligible.gameStatus !== "none" &&
                    eligible.gameStatus !== "ended",
                  scoutCount: signal?.globalScoutCount,
                  isWatchlisted: watchlistSet.has(player.id),
                };
                const primaryChip = getPrimaryChip(player, signal, quickContext, whalePlayerIds);
                const liquidityLabel = getLiquidityLabel(player);
                const engagementLabel = getEngagementLabel(player, signal, whalePlayerIds);
                const gameLabel = formatGameLabel(player, quickContext);
                const priceChange = toNumber(player.priceChange24h);
                const currentPrice = toNumber(player.currentPrice);
                const showSell = (quickContext.availableShares || 0) > 0;

                return (
                  <Card
                    key={player.id}
                    variant="terminal"
                    className="overflow-hidden border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]"
                    data-testid="market-mobile-player-card"
                  >
                    <CardContent className="p-3">
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => onOpenPlayer(player, "default", quickContext)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              <PlayerName
                                playerId={player.id}
                                firstName={player.firstName}
                                lastName={player.lastName}
                              />
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                              <span>{player.team}</span>
                              <span>{player.position}</span>
                              {quickContext.isWatchlisted && (
                                <span className="text-primary">Watchlist</span>
                              )}
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-mono text-base font-semibold">
                              ${currentPrice.toFixed(2)}
                            </div>
                            <div
                              className={cn(
                                "text-xs font-mono",
                                priceChange >= 0 ? "text-positive" : "text-negative",
                              )}
                            >
                              {priceChange >= 0 ? "+" : ""}
                              {priceChange.toFixed(1)}%
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {primaryChip && (
                            <Badge variant="outline" className={getChipClassName(primaryChip)}>
                              {primaryChip}
                            </Badge>
                          )}
                          {quickContext.bestShareMultiplier &&
                            quickContext.bestShareMultiplier > 1 && (
                              <Badge
                                variant="outline"
                                className="border-blue-500/30 bg-blue-500/10 text-blue-200"
                              >
                                Multi {quickContext.bestShareMultiplier}x
                              </Badge>
                            )}
                          {(player.communityBoostCount || 0) > 0 && (
                            <Badge
                              variant="outline"
                              className="border-orange-500/30 bg-orange-500/10 text-orange-200"
                            >
                              Community +{player.communityBoostCount}
                            </Badge>
                          )}
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-mono uppercase tracking-[0.08em]">
                          <div className="rounded-sm border border-border/70 bg-muted/15 p-2">
                            <div className="text-muted-foreground">Liquidity</div>
                            <div className="mt-1 text-foreground">{liquidityLabel}</div>
                          </div>
                          <div className="rounded-sm border border-border/70 bg-muted/15 p-2">
                            <div className="text-muted-foreground">Engagement</div>
                            <div className="mt-1 text-foreground">{engagementLabel}</div>
                          </div>
                          <div className="rounded-sm border border-border/70 bg-muted/15 p-2">
                            <div className="text-muted-foreground">Game Day</div>
                            <div className="mt-1 text-foreground">{gameLabel}</div>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                          <div className="rounded-sm border border-border/60 bg-background/40 p-2">
                            TVL {formatCompactCurrency(toNumber(player.poolTvl))}
                          </div>
                          <div className="rounded-sm border border-border/60 bg-background/40 p-2">
                            Buy {toNumber(player.buyPressure || signal?.buyPressure).toFixed(0)}%
                          </div>
                          <div className="rounded-sm border border-border/60 bg-background/40 p-2">
                            Value {toNumber(player.valueIndex || signal?.valueIndex).toFixed(0)}
                          </div>
                        </div>
                      </button>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="terminal"
                          size="sm"
                          className="h-8 flex-1 gap-1.5"
                          onClick={() => onOpenPlayer(player, "buy", quickContext)}
                        >
                          <TrendingUp className="h-3.5 w-3.5" />
                          Buy
                        </Button>
                        {showSell && (
                          <Button
                            type="button"
                            variant="terminalOutline"
                            size="sm"
                            className="h-8 gap-1.5 px-3"
                            onClick={() => onOpenPlayer(player, "sell", quickContext)}
                          >
                            <TrendingDown className="h-3.5 w-3.5" />
                            Sell
                          </Button>
                        )}
                        {quickContext.isBoostEligible && (
                          <Button
                            type="button"
                            variant="terminalOutline"
                            size="sm"
                            className="h-8 gap-1.5 px-3"
                            onClick={() => onOpenPlayer(player, "boost", quickContext)}
                          >
                            <Zap className="h-3.5 w-3.5" />
                            Boost
                          </Button>
                        )}
                        {isAuthenticated && (
                          <Button
                            type="button"
                            variant="terminalOutline"
                            size="sm"
                            className="h-8 gap-1.5 px-3"
                            onClick={() => onOpenPlayer(player, "scout", quickContext)}
                          >
                            <Binoculars className="h-3.5 w-3.5" />
                            Scout
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between rounded-sm border border-border/70 bg-muted/15 p-3">
              <div className="text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                Page {page} / {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="terminalOutline"
                  size="sm"
                  className="h-8 px-3"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="terminalOutline"
                  size="sm"
                  className="h-8 gap-1.5 px-3"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)}
                >
                  Next
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Drawer open={isMobile && showFilters} onOpenChange={onShowFiltersChange}>
        <DrawerContent className="border-border bg-[hsl(var(--background))] text-foreground sm:hidden">
          <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <DrawerHeader className="border-b border-border/60 text-left">
              <DrawerTitle className="text-base uppercase tracking-[0.08em]">
                Search & Filters
              </DrawerTitle>
              <DrawerDescription>
                Tune the board without consuming the first screen.
              </DrawerDescription>
            </DrawerHeader>
            <div className="space-y-4 px-4 pt-4">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Search
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    variant="terminal"
                    placeholder="Search players, teams, positions..."
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Sort
                  </label>
                  <select
                    value={sortField}
                    onChange={(event) => onSortFieldChange(event.target.value as SortField)}
                    className="h-10 w-full rounded-sm border border-border bg-[hsl(var(--card)/0.85)] px-3 font-mono text-sm"
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
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Order
                  </label>
                  <select
                    value={sortOrder}
                    onChange={(event) => onSortOrderChange(event.target.value as SortOrder)}
                    className="h-10 w-full rounded-sm border border-border bg-[hsl(var(--card)/0.85)] px-3 font-mono text-sm"
                  >
                    <option value="desc">Descending</option>
                    <option value="asc">Ascending</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Team
                  </label>
                  <select
                    value={teamFilter}
                    onChange={(event) => onTeamFilterChange(event.target.value)}
                    className="h-10 w-full rounded-sm border border-border bg-[hsl(var(--card)/0.85)] px-3 font-mono text-sm"
                  >
                    <option value="all">All Teams</option>
                    {teams.map((team) => (
                      <option key={team} value={team}>
                        {team}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Position
                  </label>
                  <select
                    value={positionFilter}
                    onChange={(event) => onPositionFilterChange(event.target.value)}
                    className="h-10 w-full rounded-sm border border-border bg-[hsl(var(--card)/0.85)] px-3 font-mono text-sm"
                  >
                    <option value="all">All Positions</option>
                    {positions.map((position) => (
                      <option key={position} value={position}>
                        {position}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {isAuthenticated && (
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Watchlist
                  </label>
                  <select
                    value={filterWatchlistId}
                    onChange={(event) => onWatchlistFilterChange(event.target.value)}
                    className="h-10 w-full rounded-sm border border-border bg-[hsl(var(--card)/0.85)] px-3 font-mono text-sm"
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

              <div className="flex items-center gap-2 pb-2">
                <Button
                  type="button"
                  variant="terminal"
                  className="flex-1"
                  onClick={() => onShowFiltersChange(false)}
                >
                  Done
                </Button>
                <Button
                  type="button"
                  variant="terminalOutline"
                  className="flex-1"
                  onClick={onClearFilters}
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

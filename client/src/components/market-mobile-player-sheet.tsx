import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Link, useLocation } from "wouter";
import {
  ArrowUpRight,
  Binoculars,
  Droplets,
  Flame,
  Loader2,
  SearchCheck,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

import { AmmTradePanel } from "@/components/amm-trade-panel";
import { PlayerName } from "@/components/player-name";
import { ScoutSelector } from "@/components/scout-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/use-app-state";
import { formatCompactCurrency } from "@/lib/currency";
import { authenticatedFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export type MarketSheetAction = "default" | "buy" | "sell" | "boost" | "scout";

interface MarketSheetPlayer {
  id: string;
  firstName: string;
  lastName: string;
  team: string;
  position: string;
  currentPrice?: string | number | null;
  priceChange24h?: string | number | null;
  poolTvl?: number | null;
  buyPressure?: number | null;
  valueIndex?: number | null;
  avgFantasyPointsPerGame?: string | number | null;
  gameStatus?: "none" | "upcoming" | "live" | "ended";
  gameStartTime?: string | null;
  communityBoostCount?: number | null;
}

interface MarketSheetQuickContext {
  availableShares?: number;
  bestShareMultiplier?: number;
  isBoostEligible?: boolean;
  scoutCount?: number;
  isWatchlisted?: boolean;
}

interface MarketActivityEntry {
  id: string;
  playerId: string;
  buyerUsername: string | null;
  sellerUsername: string | null;
  quantity: number;
  price: string | null;
  timestamp: string;
}

interface MarketSheetPlayerData {
  player: MarketSheetPlayer;
  userBalance: string;
  userHolding?: { quantity: number; avgCostBasis: string };
}

interface AmmPoolData {
  currentPrice: number;
  totalTrades: number;
  totalVolume: number;
  playMoney: number;
  shares: number;
}

interface PlayerFinancialMetrics {
  valueIndex: number;
  sentiment: {
    buyPressure: number;
    totalVolume24h: number;
    trend: "bullish" | "bearish" | "neutral";
  };
  heatCheck: {
    status: "fire" | "ice" | "neutral";
  };
}

interface MarketMobilePlayerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: MarketSheetPlayer | null;
  action: MarketSheetAction;
  quickContext?: MarketSheetQuickContext;
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatGameStatus(player: MarketSheetPlayer | null) {
  if (!player || !player.gameStatus || player.gameStatus === "none") {
    return "No game on deck";
  }

  if (player.gameStatus === "live") {
    return "Game live now";
  }

  if (player.gameStatus === "ended") {
    return "Game completed";
  }

  if (player.gameStartTime) {
    return `Starts ${formatDistanceToNow(new Date(player.gameStartTime), { addSuffix: true })}`;
  }

  return "Upcoming game";
}

export function MarketMobilePlayerSheet({
  open,
  onOpenChange,
  player,
  action,
  quickContext,
}: MarketMobilePlayerSheetProps) {
  const { isAuthenticated } = useAuth();
  const { shouldPoll, isMobile } = useAppState();
  const [, setLocation] = useLocation();
  const [activeAction, setActiveAction] = useState<MarketSheetAction>(action);

  useEffect(() => {
    if (open) {
      setActiveAction(action);
    }
  }, [action, open, player?.id]);

  const pollingInterval = shouldPoll ? (isMobile ? 20000 : 10000) : false;
  const playerId = player?.id || "";

  const { data: userPlayerData } = useQuery<MarketSheetPlayerData>({
    queryKey: ["/api/player", playerId, "sheet-detail"],
    queryFn: async () => {
      const response = await authenticatedFetch(`/api/player/${encodeURIComponent(playerId)}`);
      if (!response.ok) {
        throw new Error("Failed to fetch player details");
      }
      return response.json();
    },
    enabled: open && isAuthenticated && Boolean(playerId),
  });

  const { data: poolData, isLoading: poolLoading } = useQuery<AmmPoolData>({
    queryKey: ["/api/amm", playerId, "sheet"],
    queryFn: async () => {
      const response = await fetch(`/api/amm/${encodeURIComponent(playerId)}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch pool data");
      }
      return response.json();
    },
    enabled: open && Boolean(playerId),
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: false,
  });

  const { data: activity = [] } = useQuery<MarketActivityEntry[]>({
    queryKey: ["/api/market/activity", playerId, "sheet"],
    queryFn: async () => {
      const response = await fetch(
        `/api/market/activity?playerId=${encodeURIComponent(playerId)}&limit=6`,
        {
          credentials: "include",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to fetch market activity");
      }
      return response.json();
    },
    enabled: open && Boolean(playerId),
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: false,
  });

  const { data: financials } = useQuery<PlayerFinancialMetrics>({
    queryKey: ["/api/player", playerId, "sheet-financials"],
    queryFn: async () => {
      const response = await fetch(`/api/player/${encodeURIComponent(playerId)}/financials`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch financials");
      }
      return response.json();
    },
    enabled: open && Boolean(playerId),
  });

  const priceChange = toNumber(player?.priceChange24h);
  const currentPrice = poolData?.currentPrice ?? toNumber(player?.currentPrice);
  const userBalance = toNumber(userPlayerData?.userBalance);
  const userShares = toNumber(userPlayerData?.userHolding?.quantity);
  const showBoostContext = Boolean(quickContext?.isBoostEligible);

  const actionButtons = useMemo(
    () =>
      [
        {
          id: "buy" as const,
          label: "Buy",
          icon: ShoppingCart,
          show: true,
        },
        {
          id: "sell" as const,
          label: "Sell",
          icon: TrendingDown,
          show: userShares > 0 || (quickContext?.availableShares || 0) > 0,
        },
        {
          id: "boost" as const,
          label: "Boost",
          icon: Zap,
          show: showBoostContext,
        },
        {
          id: "scout" as const,
          label: "Scout",
          icon: Binoculars,
          show: isAuthenticated,
        },
      ].filter((item) => item.show),
    [isAuthenticated, quickContext?.availableShares, showBoostContext, userShares],
  );

  if (!player) {
    return null;
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="border-border bg-[hsl(var(--background))] text-foreground sm:hidden"
        data-testid="market-mobile-player-sheet"
      >
        <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="gap-2 border-b border-border/60 pb-3 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DrawerTitle className="text-base font-semibold uppercase tracking-[0.08em]">
                  <PlayerName
                    playerId={player.id}
                    firstName={player.firstName}
                    lastName={player.lastName}
                  />
                </DrawerTitle>
                <DrawerDescription className="mt-1 flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground">
                  <span>{player.team}</span>
                  <span>{player.position}</span>
                  <span>{formatGameStatus(player)}</span>
                </DrawerDescription>
              </div>

              <div className="rounded-sm border border-border bg-muted/20 px-2 py-1 text-right">
                <div className="font-mono text-sm font-semibold">
                  {currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : "--"}
                </div>
                <div
                  className={cn(
                    "font-mono text-[11px]",
                    priceChange >= 0 ? "text-positive" : "text-negative",
                  )}
                >
                  {priceChange >= 0 ? "+" : ""}
                  {priceChange.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {showBoostContext && (
                <Badge
                  variant="outline"
                  className="border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                >
                  Boost Ready
                </Badge>
              )}
              {(quickContext?.bestShareMultiplier || 1) > 1 && (
                <Badge
                  variant="outline"
                  className="border-blue-500/30 bg-blue-500/10 text-blue-300"
                >
                  Multi {quickContext?.bestShareMultiplier}x
                </Badge>
              )}
              {(player.communityBoostCount || 0) > 0 && (
                <Badge
                  variant="outline"
                  className="border-orange-500/30 bg-orange-500/10 text-orange-300"
                >
                  Community +{player.communityBoostCount}
                </Badge>
              )}
              {financials?.heatCheck.status === "fire" && (
                <Badge
                  variant="outline"
                  className="border-orange-500/30 bg-orange-500/10 text-orange-300"
                >
                  <Flame className="mr-1 h-3 w-3" />
                  Heat check
                </Badge>
              )}
              {quickContext?.isWatchlisted && (
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                  Watchlist
                </Badge>
              )}
            </div>
          </DrawerHeader>

          <div className="space-y-4 px-4 pt-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-sm border border-border bg-muted/20 p-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  TVL
                </div>
                <div className="mt-1 font-mono text-sm font-semibold">
                  {formatCompactCurrency(toNumber(player.poolTvl))}
                </div>
              </div>
              <div className="rounded-sm border border-border bg-muted/20 p-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Buy Vol
                </div>
                <div className="mt-1 font-mono text-sm font-semibold">
                  {toNumber(player.buyPressure).toFixed(0)}%
                </div>
              </div>
              <div className="rounded-sm border border-border bg-muted/20 p-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Value
                </div>
                <div className="mt-1 font-mono text-sm font-semibold">
                  {toNumber(player.valueIndex).toFixed(0)}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {actionButtons.map((entry) => {
                const Icon = entry.icon;
                return (
                  <Button
                    key={entry.id}
                    type="button"
                    variant={activeAction === entry.id ? "terminal" : "terminalOutline"}
                    size="sm"
                    className="h-8 gap-1.5 px-3"
                    onClick={() => setActiveAction(entry.id)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {entry.label}
                  </Button>
                );
              })}

              <Link href={`/player/${player.id}?panel=lp`} onClick={() => onOpenChange(false)}>
                <Button
                  type="button"
                  variant="terminalOutline"
                  size="sm"
                  className="h-8 gap-1.5 px-3"
                >
                  <Droplets className="h-3.5 w-3.5" />
                  Pool
                </Button>
              </Link>
            </div>

            {activeAction === "boost" && showBoostContext && (
              <div className="rounded-sm border border-yellow-500/30 bg-yellow-500/10 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-yellow-200">
                      Tonight's Boost Window
                    </div>
                    <p className="mt-1 text-sm text-yellow-50/90">
                      {quickContext?.availableShares || 0} share
                      {(quickContext?.availableShares || 0) === 1 ? "" : "s"} available.
                      {(quickContext?.bestShareMultiplier || 1) > 1
                        ? ` Best share multiplier is ${quickContext?.bestShareMultiplier}x.`
                        : " A regular share is ready to burn."}
                    </p>
                  </div>
                  <SearchCheck className="mt-0.5 h-4 w-4 text-yellow-200" />
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.08em] text-yellow-100/80">
                  <span>{formatGameStatus(player)}</span>
                  <span>Community +{player.communityBoostCount || 0}</span>
                </div>
                <Button
                  type="button"
                  variant="terminal"
                  size="sm"
                  className="mt-3 h-8 w-full gap-1.5"
                  onClick={() => {
                    onOpenChange(false);
                    setLocation("/boosts");
                  }}
                >
                  Open Boost Desk
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {isAuthenticated && activeAction === "scout" && <ScoutSelector playerId={player.id} />}

            {(activeAction === "buy" || activeAction === "sell" || activeAction === "default") && (
              <div className="rounded-sm border border-border bg-muted/10 p-3">
                {poolLoading ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <AmmTradePanel
                    key={`${player.id}-${activeAction}`}
                    playerId={player.id}
                    playerName={`${player.firstName} ${player.lastName}`}
                    currentPrice={currentPrice || null}
                    userBalance={userBalance}
                    userShares={quickContext?.availableShares ?? userShares}
                    initialTradeType={activeAction === "sell" ? "sell" : "buy"}
                  />
                )}
              </div>
            )}

            <div className="rounded-sm border border-border bg-muted/10 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Live Context
                </div>
                <div className="text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                  {poolData?.totalTrades || 0} trades
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-sm border border-border/60 bg-background/40 p-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Pool Depth
                  </div>
                  <div className="mt-1 font-mono">
                    {formatCompactCurrency(toNumber(poolData?.playMoney))}
                  </div>
                </div>
                <div className="rounded-sm border border-border/60 bg-background/40 p-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Sentiment
                  </div>
                  <div className="mt-1 font-mono">{financials?.sentiment.trend || "neutral"}</div>
                </div>
              </div>
            </div>

            <div className="rounded-sm border border-border bg-muted/10 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Recent Tape
              </div>
              <div className="mt-3 space-y-2">
                {activity.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No recent trades on this name.
                  </div>
                ) : (
                  activity.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-sm border border-border/60 bg-background/40 p-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {entry.buyerUsername || "Pool"} from {entry.sellerUsername || "Pool"}
                        </div>
                        <div className="text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
                          {entry.quantity} shares
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm">
                          {entry.price ? `$${toNumber(entry.price).toFixed(2)}` : "--"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <Link href={`/player/${player.id}`} onClick={() => onOpenChange(false)}>
              <Button type="button" variant="terminalOutline" className="mb-2 w-full gap-1.5">
                Open Full Player Page
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

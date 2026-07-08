import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp,
  ArrowRight,
  Gift,
  Flame,
  Snowflake,
  Activity,
  Zap,
  TicketPercent,
  ShoppingCart,
  Droplets,
  Heart,
  Eye,
} from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ScoutSelector } from "@/components/scout-selector";
import {
  MlbPlayerContextPanel,
  type MlbPlayerContext,
} from "@/components/mlb-player-context-panel";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { InjuryIndicator } from "@/components/player-name";
import { useInjuries } from "@/lib/injury-context";

interface PlayerModalProps {
  playerId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PlayerFinancialMetrics {
  peRatio: number;
  valueIndex: number;
  isUndervalued: boolean;
  sentiment: {
    buyPressure: number;
    totalVolume24h: number;
    trend: "bullish" | "bearish" | "neutral";
  };
  heatCheck: {
    l5Avg: number;
    seasonAvg: number;
    status: "fire" | "ice" | "neutral";
  };
  marketCapRank: {
    tier: "blue_chip" | "mid_cap" | "moonshot";
    percentile: number;
  };
}

// Sport configuration for dynamic display
const SPORT_CONFIG: Record<
  string,
  {
    seasonStats: {
      key: string;
      label: string;
      highlight?: boolean;
      format?: (val: any) => string;
    }[];
    recentGames: { key: string; label: string; format?: (val: any) => string }[];
  }
> = {
  NBA: {
    seasonStats: [
      { key: "avgFantasyPointsPerGame", label: "FP/G", highlight: true },
      { key: "fieldGoalPct", label: "FG%", format: (v) => `${v}%` },
      { key: "pointsPerGame", label: "PPG" },
      { key: "threePointPct", label: "3P%", format: (v) => `${v}%` },
      { key: "reboundsPerGame", label: "RPG" },
      { key: "freeThrowPct", label: "FT%", format: (v) => `${v}%` },
      { key: "assistsPerGame", label: "APG" },
      { key: "minutesPerGame", label: "MPG" },
    ],
    recentGames: [
      { key: "points", label: "PTS" },
      { key: "rebounds", label: "REB" },
      { key: "assists", label: "AST" },
    ],
  },
  NFL: {
    seasonStats: [
      { key: "avgFantasyPointsPerGame", label: "FP/G", highlight: true },
      { key: "gamesPlayed", label: "GP" },
      { key: "passingYards", label: "Pas Yds" },
      { key: "passingTouchdowns", label: "Pas TD" },
      { key: "rushingYards", label: "Rus Yds" },
      { key: "rushingTouchdowns", label: "Rus TD" },
      { key: "receivingYards", label: "Rec Yds" },
      { key: "receivingTouchdowns", label: "Rec TD" },
    ],
    recentGames: [
      { key: "passingYards", label: "P.YDS" },
      { key: "rushingYards", label: "R.YDS" },
      { key: "receivingYards", label: "R.YDS" },
    ],
  },
  MLB: {
    seasonStats: [
      { key: "avgFantasyPointsPerGame", label: "FP/G", highlight: true },
      { key: "gamesPlayed", label: "GP" },
      { key: "battingAverage", label: "AVG" },
      { key: "hits", label: "H" },
      { key: "runs", label: "R" },
      { key: "runsBattedIn", label: "RBI" },
      { key: "homeRuns", label: "HR" },
      { key: "stolenBases", label: "SB" },
      { key: "walks", label: "BB" },
      { key: "strikeouts", label: "K" },
      { key: "inningsPitched", label: "IP" },
      { key: "pitchingStrikeouts", label: "P-K" },
      { key: "wins", label: "W" },
      { key: "saves", label: "SV" },
    ],
    recentGames: [
      { key: "hits", label: "H" },
      { key: "runs", label: "R" },
      { key: "runsBattedIn", label: "RBI" },
      { key: "homeRuns", label: "HR" },
      { key: "stolenBases", label: "SB" },
    ],
  },
  NASCAR: {
    seasonStats: [
      { key: "avgFantasyPointsPerGame", label: "FP/G", highlight: true },
      { key: "totalLapsLed", label: "Laps Led" },
      { key: "totalFastestLaps", label: "Fast Laps" },
      { key: "wins", label: "Wins" },
      { key: "top5s", label: "Top 5" },
      { key: "top10s", label: "Top 10" },
      { key: "racesCompleted", label: "Races" },
      { key: "winRate", label: "Win%", format: (v) => `${v}%` },
    ],
    recentGames: [
      { key: "finishPosition", label: "Pos" },
      { key: "lapsLed", label: "Led" },
      { key: "fantasyPoints", label: "FP" },
    ],
  },
};

interface RecentGame {
  game: {
    id: number;
    date: string;
    opponent: string;
    isHome: boolean;
  };
  stats: Record<string, any>;
  sport?: string;
}

export function PlayerModal({ playerId, open, onOpenChange }: PlayerModalProps) {
  const cleanPlayerId = (playerId || "").split("?")[0].split("#")[0].trim();
  const [gamesToShow, setGamesToShow] = useState(5);
  const { isAuthenticated } = useAuth();
  const { getInjury } = useInjuries();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all player data
  const { data: statsData, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["/api/player", cleanPlayerId, "stats"],
    enabled: open && !!cleanPlayerId,
  });

  const { data: recentGamesData, isLoading: gamesLoading } = useQuery<any>({
    queryKey: ["/api/player", cleanPlayerId, "recent-games"],
    enabled: open && !!cleanPlayerId,
  });

  const { data: sharesData, isLoading: sharesLoading } = useQuery<any>({
    queryKey: ["/api/player", cleanPlayerId, "shares-info"],
    enabled: open && !!cleanPlayerId,
  });

  const { data: financialMetrics, isLoading: financialsLoading } = useQuery<PlayerFinancialMetrics>(
    {
      queryKey: ["/api/player", cleanPlayerId, "financials"],
      enabled: open && !!cleanPlayerId,
    },
  );

  const modalPlayerSport = statsData?.stats?.sport || statsData?.player?.sport;
  const { data: mlbContext, isLoading: mlbContextLoading } = useQuery<MlbPlayerContext>({
    queryKey: ["/api/player", cleanPlayerId, "mlb-context"],
    enabled: open && !!cleanPlayerId && modalPlayerSport === "MLB",
  });

  // Watchlist state
  const { data: watchlistIds = [] } = useQuery<string[]>({
    queryKey: ["/api/watchlist"],
    enabled: open && isAuthenticated,
  });
  const isWatchlisted = watchlistIds.includes(cleanPlayerId);

  const toggleWatchlistMutation = useMutation({
    mutationFn: async (currentlyWatchlisted: boolean) => {
      if (currentlyWatchlisted) {
        await apiRequest("DELETE", `/api/watchlist/${cleanPlayerId}`);
      } else {
        await apiRequest("POST", `/api/watchlist/${cleanPlayerId}`);
      }
    },
    onSuccess: (_data, wasWatchlisted) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: wasWatchlisted ? "Removed from watchlist" : "Added to Favorites" });
    },
    onError: () => {
      toast({ title: "Failed to update watchlist", variant: "destructive" });
    },
  });

  if (!cleanPlayerId) return null;

  const player = statsData?.player;
  const team = statsData?.team;
  const sport =
    statsData?.stats?.sport ||
    (player?.sport === "NFL"
      ? "NFL"
      : player?.sport === "MLB"
        ? "MLB"
        : player?.sport === "NASCAR"
          ? "NASCAR"
          : "NBA");
  const stats = statsData?.stats;
  const recentGames: RecentGame[] = recentGamesData?.recentGames || [];
  const sharesInfo: any = sharesData?.sharesInfo;

  const isLoading = statsLoading || gamesLoading || sharesLoading || financialsLoading;
  const displayedGames = recentGames.slice(0, gamesToShow);
  const hasMoreGames = recentGames.length > gamesToShow;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto px-3 pb-3 pt-10 sm:p-3"
        data-testid="dialog-player-modal"
      >
        <DialogHeader className="pb-1">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle
              className="flex items-center gap-2 text-base"
              data-testid="text-player-modal-title"
            >
              {player ? (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    {player.firstName} {player.lastName}
                    {getInjury(player.id) && <InjuryIndicator injury={getInjury(player.id)!} />}
                  </span>
                  {team && (
                    <Badge variant="secondary" className="text-xs h-5" data-testid="badge-team">
                      {team.abbreviation}
                    </Badge>
                  )}

                  {/* Heat Check Badge */}
                  {!isLoading && financialMetrics?.heatCheck?.status === "fire" && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center text-orange-500 animate-pulse cursor-help">
                            <Flame className="w-4 h-4 fill-orange-500" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Heating Up: Last 5 games are 15% above season avg</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {!isLoading && financialMetrics?.heatCheck?.status === "ice" && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center text-blue-400 cursor-help">
                            <Snowflake className="w-4 h-4" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Cold Streak: Last 5 games are 15% below season avg</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </>
              ) : (
                <Skeleton className="h-5 w-48" />
              )}
            </DialogTitle>
            <div className="flex items-center justify-end flex-wrap gap-2">
              {cleanPlayerId && (
                <div className="flex items-center flex-wrap justify-end gap-2">
                  {/* Watchlist toggle */}
                  {isAuthenticated && (
                    <Button
                      size="sm"
                      variant={isWatchlisted ? "default" : "outline"}
                      className="h-8 px-2"
                      onClick={() => toggleWatchlistMutation.mutate(isWatchlisted)}
                      disabled={toggleWatchlistMutation.isPending}
                      data-testid="button-modal-watchlist"
                      aria-label={isWatchlisted ? "Remove from watchlist" : "Add to watchlist"}
                    >
                      <Heart className={`w-4 h-4 ${isWatchlisted ? "fill-current" : ""}`} />
                    </Button>
                  )}
                  {/* Boost shortcut (links to /boosts?preselect=<id> — PR 1) */}
                  {isAuthenticated && (
                    <Link
                      href={`/boosts?preselect=${cleanPlayerId}`}
                      onClick={() => onOpenChange(false)}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        data-testid="button-modal-boost"
                      >
                        <Zap className="w-4 h-4 mr-1" />
                        Boost
                      </Button>
                    </Link>
                  )}
                  <Link
                    href={`/player/${cleanPlayerId}?tab=buy`}
                    onClick={() => onOpenChange(false)}
                  >
                    <Button size="sm" className="h-8 px-2 text-xs" data-testid="button-modal-buy">
                      <ShoppingCart className="w-4 h-4 mr-1" />
                      Buy
                    </Button>
                  </Link>
                  <Link
                    href={`/player/${cleanPlayerId}?tab=sell`}
                    onClick={() => onOpenChange(false)}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      data-testid="button-modal-sell"
                    >
                      Sell
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Link>
                  <Link
                    href={`/player/${cleanPlayerId}?panel=lp`}
                    onClick={() => onOpenChange(false)}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      data-testid="button-modal-pool"
                    >
                      <Droplets className="w-4 h-4 mr-1" />
                      Pool
                    </Button>
                  </Link>
                  {/* View full player detail page */}
                  <Link href={`/player/${cleanPlayerId}`} onClick={() => onOpenChange(false)}>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      data-testid="button-modal-detail"
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      Detail
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2">
          {/* --- NEW: Financial Health Bar --- */}
          {!isLoading && financialMetrics && (
            <div className="grid grid-cols-2 gap-2">
              {/* Value Index Card */}
              <div className="border rounded-md p-2 bg-accent/5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                    Value Index
                  </span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <TicketPercent className="w-3 h-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>P/E Index (Base 100). Lower is Cheaper relative to League Avg.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-bold">
                    {financialMetrics.valueIndex !== undefined &&
                    financialMetrics.valueIndex !== null
                      ? financialMetrics.valueIndex.toFixed(0)
                      : "N/A"}
                  </span>
                  {(financialMetrics.valueIndex || 0) < 100 ? (
                    <Badge
                      variant="default"
                      className="bg-green-500/15 text-green-600 hover:bg-green-500/25 border-green-500/20 text-[10px] px-1.5 h-5"
                    >
                      🔥 Undervalued
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-red-500 border-red-500/30 text-[10px] px-1.5 h-5 bg-red-500/5"
                    >
                      Premium
                    </Badge>
                  )}
                </div>
              </div>

              {/* Sentiment Gauge */}
              <div className="border rounded-md p-2 bg-accent/5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                    Trader Sentiment
                  </span>
                  <span
                    className={`text-[10px] font-bold ${
                      financialMetrics.sentiment?.trend === "bullish"
                        ? "text-green-500"
                        : financialMetrics.sentiment?.trend === "bearish"
                          ? "text-red-500"
                          : "text-yellow-500"
                    }`}
                  >
                    {financialMetrics.sentiment?.buyPressure?.toFixed(0) || 0}% Buy Vol
                  </span>
                </div>
                <Progress
                  value={financialMetrics.sentiment?.buyPressure || 0}
                  className="h-1.5 bg-red-100 dark:bg-red-950/30"
                  indicatorClassName="bg-amber-500"
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[8px] text-muted-foreground">Bearish</span>
                  <span className="text-[8px] text-muted-foreground">Bullish</span>
                </div>
              </div>
            </div>
          )}

          {/* Market Info - Compact Grid */}
          <div className="border rounded-md p-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                <span className="text-xs font-semibold">Market Data</span>
              </div>
              {!isLoading && financialMetrics?.marketCapRank && (
                <Badge
                  variant="secondary"
                  className="text-[10px] h-4 font-normal bg-blue-500/10 text-blue-600 dark:text-blue-400"
                >
                  {financialMetrics.marketCapRank.tier === "blue_chip"
                    ? "🐋 Blue Chip"
                    : financialMetrics.marketCapRank.tier === "mid_cap"
                      ? "🏢 Mid Cap"
                      : "🌑 Moonshot"}
                </Badge>
              )}
            </div>

            {isLoading ? (
              <div className="grid grid-cols-3 gap-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-2 w-16 mb-0.5" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))}
              </div>
            ) : sharesInfo ? (
              <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs">
                <div>
                  <div className="text-muted-foreground text-[10px]">Price</div>
                  <div className="font-bold" data-testid="text-share-price">
                    {sharesInfo.currentSharePrice ? (
                      `$${sharesInfo.currentSharePrice}`
                    ) : (
                      <span className="text-muted-foreground text-[10px] font-normal">-</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Market Cap</div>
                  <div className="font-bold" data-testid="text-market-cap">
                    {sharesInfo.marketCap ? (
                      `$${sharesInfo.marketCap}`
                    ) : (
                      <span className="text-muted-foreground text-[10px] font-normal">-</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Shares</div>
                  <div className="font-bold" data-testid="text-total-shares">
                    {sharesInfo.totalSharesOutstanding.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Holders</div>
                  <div className="font-bold" data-testid="text-holders">
                    {sharesInfo.totalHolders}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">24h Vol</div>
                  <div className="font-bold" data-testid="text-volume">
                    {Number(sharesInfo.volume24h || 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">24h Chg</div>
                  <div
                    className={`font-bold ${
                      parseFloat(sharesInfo.priceChange24h) >= 0 ? "text-positive" : "text-negative"
                    }`}
                    data-testid="text-price-change"
                  >
                    {parseFloat(sharesInfo.priceChange24h) >= 0 ? "+" : ""}
                    {sharesInfo.priceChange24h}%
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-xs text-muted-foreground py-2">No data</div>
            )}
          </div>

          {/* Scout Assignment - Only for authenticated users */}
          {isAuthenticated && playerId && <ScoutSelector playerId={playerId} />}

          {sport === "MLB" && (
            <MlbPlayerContextPanel context={mlbContext} isLoading={mlbContextLoading} />
          )}

          {/* Season Stats - Compact List */}
          <div className="border rounded-md p-2">
            <div className="text-xs font-semibold mb-1.5">Season Stats</div>
            {isLoading ? (
              <div className="space-y-1">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                ))}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                {(SPORT_CONFIG[sport]?.seasonStats || SPORT_CONFIG.NBA.seasonStats).map(
                  (statConfig) => {
                    const value = stats[statConfig.key];
                    if (value === undefined || value === null) return null;

                    return (
                      <div key={statConfig.key} className="flex justify-between">
                        <span className="text-muted-foreground">{statConfig.label}</span>
                        <span
                          className={`font-bold ${statConfig.highlight ? "text-primary" : ""}`}
                          data-testid={`stat-${statConfig.key}`}
                        >
                          {statConfig.format ? statConfig.format(value) : value}
                        </span>
                      </div>
                    );
                  },
                )}
              </div>
            ) : (
              <div className="text-center text-xs text-muted-foreground py-2">No stats</div>
            )}
          </div>

          {/* Recent Games - Expandable List */}
          <div className="border rounded-md p-2">
            <div className="text-xs font-semibold mb-1.5">Recent Games</div>
            {isLoading ? (
              <div className="space-y-1">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : displayedGames.length > 0 ? (
              <>
                <div className="space-y-1">
                  {displayedGames.map((game: RecentGame, i: number) => (
                    <div
                      key={i}
                      className="border rounded p-1.5 hover-elevate"
                      data-testid={`card-game-${i}`}
                    >
                      <div className="flex justify-between items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-xs font-medium">
                              {game.game.isHome ? "vs" : "@"} {game.game.opponent}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {format(new Date(game.game.date), "MMM d")}
                            </span>
                          </div>
                          <div className="flex gap-2 text-[10px]">
                            {(SPORT_CONFIG[sport]?.recentGames || SPORT_CONFIG.NBA.recentGames).map(
                              (statConfig) => {
                                const value = game.stats[statConfig.key];
                                // Skip 0 values for cleaner look, unless it's a key stat
                                if (!value) return null;

                                return (
                                  <span key={statConfig.key} className="text-muted-foreground">
                                    <span className="font-semibold text-foreground">{value}</span>{" "}
                                    {statConfig.label}
                                  </span>
                                );
                              },
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-[10px] text-muted-foreground">FP</div>
                          <div className="text-sm font-bold text-primary">
                            {game.stats.fantasyPoints.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {hasMoreGames && (
                  <div className="mt-1.5 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setGamesToShow(gamesToShow + 5)}
                      data-testid="button-see-more-games"
                    >
                      See more
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center text-xs text-muted-foreground py-2">No games</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

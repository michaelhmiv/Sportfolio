import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calendar,
  Search,
  ChevronDown,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ArrowUpDown,
  LogIn,
  Zap,
  Flame,
  Activity,
  Trophy,
  Clock,
  ShoppingCart,
  Radio,
} from "lucide-react";
import { useAppState } from "@/hooks/use-app-state";
import { Link, useLocation } from "wouter";
import type { Player, Trade } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { DashboardScanners } from "@/components/marketplace-scanners";
import { PlayerName } from "@/components/player-name";
import { SportSelector } from "@/components/sport-selector";
import {
  Shimmer,
  ShimmerCard,
  ScrollReveal,
  PullToRefreshIndicator,
} from "@/components/ui/animations";
import { SPORTS, useSport } from "@/lib/sport-context";
import { authenticatedFetch, queryClient } from "@/lib/queryClient";
import { OnboardingMissions } from "@/components/onboarding-missions";
import { MarketTicker } from "@/components/market-ticker";
import { GameCommandCenterModal } from "@/components/game-command-center-modal";
import { BackgroundPattern, CardAccent } from "@/components/ui/decorative-elements";
import { DashboardShowcaseCard } from "@/components/dashboard-showcase-card";
import { formatAdaptiveCurrency, formatSignedAdaptiveCurrency } from "@/lib/currency";
import { getEffectiveGameStatus, type EffectiveGameStatus } from "@shared/game-status";
import type {
  DashboardShowcaseEligiblePlayer,
  DashboardShowcaseGameEntry,
  DashboardShowcaseRace,
  DashboardShowcaseRaceHolding,
  DashboardShowcaseSlatePlayer,
} from "@/components/dashboard-showcase-card.helpers";
import { MobilePortfolioStatsSheet } from "@/components/mobile-portfolio-stats-sheet";
import { MlbProbableBadge } from "@/components/mlb-probable-badge";
import type { GameInsight, GameInsightsResponse } from "@/types/game-insights";
import { AnimatedPrice } from "@/components/ui/animated-price";
import { cn } from "@/lib/utils";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { openPlayerModal } from "@/lib/player-modal-events";

interface NetWorthChangeSummary {
  amount: number | null;
  percent: number | null;
  rank: number | null;
}

interface DashboardData {
  user: {
    balance: string;
    portfolioValue: string;
    netWorth: string;
    cashRank: number;
    portfolioRank: number;
    cashRankChange: number | null;
    portfolioRankChange: number | null;
    change24h: NetWorthChangeSummary;
    change7d: NetWorthChangeSummary;
    change30d: NetWorthChangeSummary;
  } | null; // Null for non-authenticated users
  recentTrades: (Trade & { player: Player })[];
  portfolioHistory: { date: string; value: number }[];
  topHoldings: {
    player: Player;
    quantity: number;
    value: string;
    pnl: string;
    pnlPercent: string;
  }[];
  boosts: {
    activeBoosts: number;
    lockedBoosts: number;
    processedBoosts: number;
    totalBoosts: number;
    slotsRemaining: number;
    availableSlots: number[];
    communityBoostCount: number;
    userCommunityShares: number;
    totalLivePayout: string;
    totalProcessedPayout: string;
  } | null;
}

interface RaceInsightsResponse {
  date: string;
  sport: "NASCAR";
  boostSlotsRemaining: number | null;
  races: DashboardShowcaseRace[];
  userHoldings: DashboardShowcaseRaceHolding[];
  slateDrivers: DashboardShowcaseSlatePlayer[];
}

interface BoostEligibilityResponse {
  eligiblePlayers: DashboardShowcaseEligiblePlayer[];
  totalEligible: number;
}

const formatCompactPitcherName = (name: string | null | undefined) => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return trimmed;
  return `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`;
};

// ──────────────────────────────────────────────────────────────
// Active Positions Today
// Cross-references the user's top holdings with today's game slate.
// Shows players you own who are active today with live market context.
// ──────────────────────────────────────────────────────────────
interface ActivePositionsTodayProps {
  topHoldings: DashboardData["topHoldings"];
  slatePlayers: DashboardShowcaseSlatePlayer[];
  eligiblePlayers: DashboardShowcaseEligiblePlayer[];
  onTrade: (playerId: string) => void;
  onBoost: (playerId: string) => void;
}

function ActivePositionsToday({
  topHoldings,
  slatePlayers,
  eligiblePlayers,
  onTrade,
  onBoost,
}: ActivePositionsTodayProps) {
  const slatePlayerIds = new Set(slatePlayers.map((sp) => sp.playerId));
  const eligibleSet = new Map(eligiblePlayers.map((ep) => [ep.playerId, ep]));

  // Positions the user owns that appear on today's slate
  const activePositions = topHoldings.filter((h) => slatePlayerIds.has(h.player.id));

  if (activePositions.length === 0) return null;

  const getLiveSlateStatus = (playerId: string) => {
    const slateEntry = slatePlayers.find((sp) => sp.playerId === playerId);
    return slateEntry?.status ?? null;
  };

  const getChangeClass = (val: string | null | undefined) => {
    const n = parseFloat(val ?? "0");
    if (n > 0) return "text-emerald-500";
    if (n < 0) return "text-red-500";
    return "text-muted-foreground";
  };

  return (
    <ScrollReveal delay={0.08}>
      <Card className="relative overflow-hidden">
        <CardAccent variant="left" color="primary" intensity="medium" />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
          <CardTitle className="text-sm font-medium uppercase tracking-wide flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 text-primary" />
            Your Positions Today
          </CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {activePositions.length}
          </Badge>
        </CardHeader>
        <CardContent className="relative z-10 p-0">
          <div className="divide-y divide-border/60">
            {activePositions.slice(0, 5).map((holding) => {
              const slateStatus = getLiveSlateStatus(holding.player.id);
              const isLiveGame = slateStatus === "inprogress";
              const eligibleEntry = eligibleSet.get(holding.player.id);
              const isBoostEligible =
                eligibleEntry &&
                !eligibleEntry.isAlreadyBoosted &&
                eligibleEntry.availableShares > 0;
              const price = parseFloat(
                holding.player.lastTradePrice ?? holding.player.currentPrice ?? "0",
              );
              const change24h = parseFloat(holding.player.priceChange24h ?? "0");

              return (
                <div
                  key={holding.player.id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/20",
                    isLiveGame && "bg-emerald-500/[0.03]",
                  )}
                >
                  {/* Status indicator */}
                  <div
                    className={cn(
                      "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                      isLiveGame
                        ? "animate-pulse bg-emerald-500"
                        : slateStatus === "scheduled"
                          ? "bg-blue-400"
                          : "bg-muted-foreground/40",
                    )}
                  />

                  {/* Player info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <PlayerName
                        playerId={holding.player.id}
                        firstName={holding.player.firstName}
                        lastName={holding.player.lastName}
                        className="text-sm font-semibold truncate"
                      />
                      {isLiveGame && (
                        <span className="inline-flex items-center gap-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1 py-0 text-[10px] font-semibold uppercase text-emerald-500">
                          Live
                        </span>
                      )}
                      {isBoostEligible && (
                        <button
                          onClick={() => onBoost(holding.player.id)}
                          className="inline-flex items-center gap-0.5 rounded-sm border border-yellow-500/40 bg-yellow-500/10 px-1 py-0 text-[10px] font-semibold uppercase text-yellow-500 hover:bg-yellow-500/20 transition-colors cursor-pointer"
                        >
                          <Zap className="h-2.5 w-2.5" />
                          Boost
                        </button>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {holding.quantity} sh · {holding.player.team}
                    </div>
                  </div>

                  {/* Price + change */}
                  <div className="text-right flex-shrink-0">
                    {price > 0 ? (
                      <AnimatedPrice
                        value={price}
                        size="sm"
                        className="font-mono font-semibold justify-end"
                      />
                    ) : (
                      <span className="font-mono text-sm font-semibold text-muted-foreground">
                        --
                      </span>
                    )}
                    {change24h !== 0 && (
                      <div
                        className={cn(
                          "font-mono text-[10px] font-medium",
                          getChangeClass(holding.player.priceChange24h),
                        )}
                      >
                        {change24h > 0 ? "+" : ""}
                        {change24h.toFixed(2)}%
                      </div>
                    )}
                  </div>

                  {/* Trade button */}
                  <Button
                    size="sm"
                    variant="terminal"
                    className="h-7 px-2.5 text-xs flex-shrink-0"
                    onClick={() => onTrade(holding.player.id)}
                  >
                    <ShoppingCart className="h-3 w-3 mr-1" />
                    Trade
                  </Button>
                </div>
              );
            })}
          </div>
          {activePositions.length > 5 && (
            <div className="border-t border-border/60 px-3 py-2 text-center">
              <Link href="/portfolio">
                <span className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  +{activePositions.length - 5} more positions →
                </span>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </ScrollReveal>
  );
}

export default function Dashboard() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const authStateRef = useRef(isAuthenticated);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const { sport, setSport } = useSport();
  const [activeGame, setActiveGame] = useState<GameInsight | null>(null);
  const [selectedRace, setSelectedRace] = useState<any>(null);
  const { shouldPoll } = useAppState();

  // Disable polling when app is backgrounded or offline; reduce frequency on mobile
  const pollingInterval = shouldPoll ? 60000 : false;

  const {
    data,
    isLoading,
    refetch: dashboardRefetch,
  } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
    queryFn: async () => {
      // Add 10-second timeout to prevent infinite loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 10000);

      try {
        const res = isAuthenticated
          ? await authenticatedFetch("/api/dashboard", {
              signal: controller.signal,
            })
          : await fetch("/api/dashboard", {
              credentials: "include",
              signal: controller.signal,
            });
        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        return data;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error("Dashboard request timed out after 10 seconds");
        }
        throw err;
      }
    },
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => {
    if (!authStateRef.current && isAuthenticated) {
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    }

    authStateRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // Format date as YYYY-MM-DD
  const formatDateForAPI = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Check if selected date is today
  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  // Validate date is within allowed range (7 days back to 14 days forward)
  const isDateInRange = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    const minDate = new Date(today);
    minDate.setDate(today.getDate() - 7);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 14);

    return checkDate >= minDate && checkDate <= maxDate;
  };

  // Get date range boundaries
  const getDateRange = () => {
    const today = new Date();
    const minDate = new Date(today);
    minDate.setDate(today.getDate() - 7);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 14);
    return { minDate, maxDate };
  };

  const formattedDate = formatDateForAPI(selectedDate);
  const isNascar = sport === "NASCAR";

  // NASCAR-specific query using /api/races/insights
  const { data: raceInsights, isLoading: isLoadingRaces } = useQuery<RaceInsightsResponse>({
    queryKey: ["/api/races/insights", formattedDate],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/races/insights?date=${formattedDate}`);
      if (!res.ok) throw new Error("Failed to fetch race insights");
      return res.json();
    },
    enabled: isNascar,
    refetchInterval: isToday(selectedDate) ? pollingInterval : false,
    refetchIntervalInBackground: false,
  });

  // NBA/NFL query using /api/games/insights
  const { data: gameInsights, isLoading: isLoadingGames } = useQuery<GameInsightsResponse>({
    queryKey: ["/api/games/insights", sport, formattedDate],
    queryFn: async () => {
      const res = await authenticatedFetch(
        `/api/games/insights?sport=${sport}&date=${formattedDate}`,
      );
      if (!res.ok) throw new Error("Failed to fetch game insights");
      return res.json();
    },
    enabled: !isNascar,
    refetchInterval: isToday(selectedDate) ? pollingInterval : false,
    refetchIntervalInBackground: false,
  });

  const { data: boostEligibility } = useQuery<BoostEligibilityResponse>({
    queryKey: ["/api/daily-boosts/eligible-all", formattedDate],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/daily-boosts/eligible-all?date=${formattedDate}`);
      if (!res.ok) throw new Error("Failed to fetch boost eligibility");
      return res.json();
    },
    enabled: isAuthenticated,
    refetchInterval: isToday(selectedDate) ? 60000 : false,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });

  const games = gameInsights?.games || [];
  const races = raceInsights?.races || [];
  const raceHoldings = raceInsights?.userHoldings || [];
  const slatePlayers = isNascar
    ? raceInsights?.slateDrivers || []
    : gameInsights?.slatePlayers || [];
  const eligiblePlayers = boostEligibility?.eligiblePlayers || [];
  const filterTabs = ["ALL", ...SPORTS.filter((sportOption) => sportOption !== "ALL")] as const;
  // Use global sport context for filtering (syncs with other pages)
  const globalSportFilter = sport === "ALL" ? "ALL" : sport;
  const filteredGamesBySport =
    globalSportFilter === "ALL"
      ? games
      : games.filter((game) => (game.sport || "").toUpperCase() === globalSportFilter);
  const gameEntries: DashboardShowcaseGameEntry[] = filteredGamesBySport.map((game) => ({
    game,
    effectiveStatus: getEffectiveGameStatus(game),
  }));

  const sortGamesByStartAsc = (a: GameInsight, b: GameInsight) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  const sortGamesByStartDesc = (a: GameInsight, b: GameInsight) =>
    new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
  const sortRacesByDateAsc = (a: DashboardShowcaseRace, b: DashboardShowcaseRace) =>
    new Date(a.raceDate).getTime() - new Date(b.raceDate).getTime();
  const sortRacesByDateDesc = (a: DashboardShowcaseRace, b: DashboardShowcaseRace) =>
    new Date(b.raceDate).getTime() - new Date(a.raceDate).getTime();

  const liveGames = gameEntries
    .filter((entry) => entry.effectiveStatus === "inprogress")
    .map((entry) => entry.game)
    .sort(sortGamesByStartAsc);
  const upcomingGames = gameEntries
    .filter((entry) => entry.effectiveStatus === "scheduled")
    .map((entry) => entry.game)
    .sort(sortGamesByStartAsc);
  const finalGames = gameEntries
    .filter(
      (entry) => entry.effectiveStatus === "completed" || entry.effectiveStatus === "postponed",
    )
    .map((entry) => entry.game)
    .sort(sortGamesByStartDesc);

  // NASCAR race filtering
  const liveRaces = races
    .filter((race: any) => race.status === "inprogress")
    .sort(sortRacesByDateAsc);
  const upcomingRaces = races
    .filter((race: any) => race.status === "scheduled")
    .sort(sortRacesByDateAsc);
  const completedRaces = races
    .filter((race: any) => race.status === "completed")
    .sort(sortRacesByDateDesc);
  const isLoadingInsights = isNascar ? isLoadingRaces : isLoadingGames;

  // Pull-to-refresh
  const { containerRef, isRefreshing, pullDistance } = usePullToRefresh<HTMLDivElement>({
    onRefresh: async () => {
      await dashboardRefetch();
    },
  });

  // Navigation helpers with validation
  const goToPrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    if (isDateInRange(prev)) {
      setSelectedDate(prev);
    }
  };

  const goToNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    if (isDateInRange(next)) {
      setSelectedDate(next);
    }
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date && isDateInRange(date)) {
      setSelectedDate(date);
      setShowDatePicker(false);
    }
  };

  const formatSignedCurrency = (value: number | null) => {
    return formatSignedAdaptiveCurrency(value, { nullDisplay: "--", zeroDisplay: "$0.00" });
  };

  const formatSignedPercent = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return "—";
    const absolute = Math.abs(value).toFixed(2);
    if (value > 0) return `+${absolute}%`;
    if (value < 0) return `-${absolute}%`;
    return "0.00%";
  };

  const getChangeClassName = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return "text-muted-foreground";
    if (value > 0) return "text-positive";
    if (value < 0) return "text-negative";
    return "text-muted-foreground";
  };

  const getEarningsDisplay = ({
    value,
    status,
    canShow,
  }: {
    value: number | null | undefined;
    status: string;
    canShow: boolean;
  }) => {
    if (!canShow) {
      return { label: "--", className: "text-muted-foreground" };
    }

    if (status === "scheduled" || status === "postponed") {
      return { label: "--", className: "text-muted-foreground" };
    }

    if (typeof value !== "number" || Number.isNaN(value)) {
      return { label: "--", className: "text-muted-foreground" };
    }

    const amount = value;
    return {
      label: formatSignedAdaptiveCurrency(amount, { zeroDisplay: "$0.00" }),
      className:
        amount > 0 ? "text-emerald-500" : amount < 0 ? "text-rose-500" : "text-muted-foreground",
    };
  };

  if (isLoading && !data) {
    return (
      <div className="terminal-page p-3 sm:p-4">
        <div className="mb-4">
          <div className="flex flex-row justify-between gap-3">
            <div className="flex-1">
              <Shimmer height="14px" width="80px" className="mb-2" />
              <Shimmer height="32px" width="120px" />
            </div>
            <div className="flex-1 flex flex-col items-end">
              <Shimmer height="14px" width="100px" className="mb-2" />
              <Shimmer height="32px" width="140px" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
          <div className="lg:col-span-2 space-y-3">
            <ShimmerCard lines={4} />
            <ShimmerCard lines={6} />
          </div>
          <div className="space-y-3">
            <ShimmerCard lines={3} />
            <ShimmerCard lines={5} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className="terminal-page max-w-full overflow-x-hidden">
        <PullToRefreshIndicator pullProgress={pullDistance / 72} isRefreshing={isRefreshing} />
        {/* Login Banner for Non-Authenticated Users */}
        {!isAuthenticated && (
          <div className="bg-primary text-primary-foreground border-b border-primary/20">
            <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm sm:text-base">
                <LogIn className="w-4 h-4 flex-shrink-0" />
                <span className="font-medium">
                  Sign in to start trading, scouting, and competing.
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                asChild
                className="flex-shrink-0"
                data-testid="button-banner-login"
              >
                <Link href="/login" className="flex items-center gap-2">
                  Sign In
                  <LogIn className="w-3 h-3" />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Market Activity Ticker */}
        <MarketTicker />

        {/* Main Dashboard Grid */}
        <div className="p-3 sm:p-4 max-w-full overflow-x-hidden space-y-4 sm:space-y-6">
          {/* Sport filter chips — visible at page top so users can switch context instantly */}
          <div
            className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
            data-testid="strip-sport-filter"
          >
            {filterTabs.map((sportOption) => {
              const isActive = sport === sportOption;
              return (
                <button
                  key={sportOption}
                  type="button"
                  onClick={() => setSport(sportOption as typeof sport)}
                  data-testid={`sport-chip-${sportOption.toLowerCase()}`}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase whitespace-nowrap transition-colors",
                    isActive
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/70 bg-background/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {sportOption === "ALL" ? "All" : sportOption}
                </button>
              );
            })}
          </div>

          <ScrollReveal delay={0.05}>
            <DashboardShowcaseCard
              isAuthenticated={isAuthenticated}
              sport={sport}
              selectedDate={selectedDate}
              gameEntries={gameEntries}
              slatePlayers={slatePlayers}
              races={races}
              raceHoldings={raceHoldings}
              eligiblePlayers={eligiblePlayers}
              onNavigate={(href) => setLocation(href)}
            />
          </ScrollReveal>

          {/* Mobile portfolio snapshot trigger + bottom sheet */}
          {isAuthenticated && data?.user && (
            <MobilePortfolioStatsSheet
              user={data.user}
              onOpenPortfolio={() => setLocation("/portfolio")}
              onOpenLeaderboard={(target) => setLocation(`/leaderboards#${target}`)}
            />
          )}

          {/* Balance Header - Only show for authenticated users */}
          {isAuthenticated &&
            data?.user &&
            (() => {
              const change24hAmount = data.user.change24h?.amount ?? 0;
              return (
                <div
                  className={cn(
                    "terminal-shell group relative hidden p-1.5 shadow-sm sm:block sm:p-2 transition-colors duration-700",
                    change24hAmount > 0 && "border-emerald-500/25 bg-emerald-500/[0.04]",
                    change24hAmount < 0 && "border-red-500/20 bg-red-500/[0.04]",
                  )}
                >
                  {/* Background Pattern */}
                  <BackgroundPattern variant="gradient-mesh" color="primary" opacity={0.05} />

                  <div className="grid grid-cols-4 gap-3 sm:gap-6 relative z-10">
                    <div className="col-span-1 flex flex-col justify-center min-w-0">
                      <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-1">
                        Portfolio
                      </div>
                      <div className="flex items-center gap-1 min-w-0">
                        <div
                          className="font-mono font-bold text-sm sm:text-lg text-foreground truncate"
                          data-testid="text-portfolio-value"
                          title={`$${data?.user?.portfolioValue || "0"}`}
                        >
                          {formatAdaptiveCurrency(parseFloat(data?.user?.portfolioValue || "0"))}
                        </div>
                        {data?.user?.portfolioRank && data?.user.portfolioRank > 0 && (
                          <button
                            onClick={() => setLocation("/leaderboards#portfolioValue")}
                            className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-sm border border-border px-1 py-0 text-[9px] transition-colors hover:bg-secondary"
                            data-testid="badge-portfolio-rank"
                            aria-label={`Portfolio value rank #${data?.user.portfolioRank}, click to view leaderboard`}
                          >
                            #{data?.user.portfolioRank}
                            {data?.user.portfolioRankChange !== null &&
                              data?.user.portfolioRankChange !== 0 && (
                                <span
                                  className={
                                    data?.user.portfolioRankChange > 0
                                      ? "text-positive"
                                      : "text-negative"
                                  }
                                >
                                  {data?.user.portfolioRankChange > 0 ? "↑" : "↓"}
                                </span>
                              )}
                          </button>
                        )}
                      </div>
                      <div className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5 truncate">
                        Cash: {formatAdaptiveCurrency(parseFloat(data?.user?.balance || "0"))}
                        {data?.user?.cashRank && data?.user.cashRank > 0 && (
                          <button
                            onClick={() => setLocation("/leaderboards#cashBalance")}
                            className="inline-flex items-center gap-0.5 border border-border px-0.5 py-0 rounded text-[9px] hover:bg-secondary transition-colors cursor-pointer flex-shrink-0 ml-0.5"
                            data-testid="badge-cash-rank"
                          >
                            #{data?.user.cashRank}
                            {data?.user.cashRankChange !== null &&
                              data?.user.cashRankChange !== 0 && (
                                <span
                                  className={
                                    data?.user.cashRankChange > 0
                                      ? "text-positive"
                                      : "text-negative"
                                  }
                                >
                                  {data?.user.cashRankChange > 0 ? "↑" : "↓"}
                                </span>
                              )}
                          </button>
                        )}
                      </div>
                    </div>

                    {[
                      { key: "24h", change: data?.user?.change24h, testId: "button-networth-24h" },
                      { key: "7d", change: data?.user?.change7d, testId: "button-networth-7d" },
                      { key: "30d", change: data?.user?.change30d, testId: "button-networth-30d" },
                    ].map((metric) => {
                      const change = metric.change ?? { amount: null, percent: null, rank: null };
                      return (
                        <button
                          key={metric.key}
                          onClick={() => setLocation("/portfolio")}
                          className="flex flex-col justify-center text-center rounded-md hover:bg-secondary/40 transition-colors p-1 -m-1 min-w-0"
                          data-testid={metric.testId}
                          aria-label={`Open portfolio details for ${metric.key} net worth change`}
                        >
                          <div className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                            {metric.key}
                          </div>
                          <div className="flex items-center justify-center gap-0.5 min-w-0">
                            <div
                              className={`font-mono font-semibold text-xs sm:text-sm truncate ${getChangeClassName(change.amount)}`}
                            >
                              {formatSignedCurrency(change.amount)}
                            </div>
                            {change.rank !== null && change.rank > 0 && (
                              <span className="inline-flex items-center border border-border px-0.5 rounded text-[8px] text-muted-foreground flex-shrink-0">
                                #{change.rank}
                              </span>
                            )}
                          </div>
                          <div
                            className={`text-[9px] sm:text-[10px] font-medium ${getChangeClassName(change.percent)}`}
                          >
                            {formatSignedPercent(change.percent)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          {/* Today's Actions chip strip */}
          {isAuthenticated && (
            <div
              className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar"
              data-testid="strip-todays-actions"
            >
              <Link href="/scout">
                <button className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/20">
                  <Activity className="h-3 w-3" />
                  Scout
                </button>
              </Link>
              {(data?.boosts?.slotsRemaining ?? 0) > 0 && (
                <Link href="/boosts">
                  <button className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-500 transition-colors hover:bg-amber-500/20">
                    <Zap className="h-3 w-3" />
                    {data!.boosts!.slotsRemaining} boost slot
                    {data!.boosts!.slotsRemaining !== 1 ? "s" : ""} open
                  </button>
                </Link>
              )}
              {liveGames.length > 0 && (
                <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-500">
                  <Radio className="h-3 w-3 animate-pulse" />
                  {liveGames.length} live now
                </span>
              )}
            </div>
          )}

          {/* Boost Live Earnings Strip */}
          {isAuthenticated && data?.boosts && data.boosts.lockedBoosts > 0 && (
            <Link href="/boosts">
              <div className="flex cursor-pointer items-center justify-between rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 transition-colors hover:bg-yellow-500/15">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-yellow-500/20">
                    <Zap className="h-3 w-3 text-yellow-500" />
                  </span>
                  <span className="text-sm font-semibold text-yellow-500">
                    {`${data.boosts.lockedBoosts} boost${data.boosts.lockedBoosts !== 1 ? "s" : ""} live now`}
                  </span>
                  {data.boosts.totalLivePayout !== "0.00" && (
                    <span className="text-xs text-muted-foreground">
                      · Est.{" "}
                      <span className="font-mono font-semibold text-emerald-500">
                        +${data.boosts.totalLivePayout}
                      </span>
                    </span>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-yellow-500/60" />
              </div>
            </Link>
          )}

          {/* Your Active Positions Today */}
          {isAuthenticated &&
            data?.topHoldings &&
            data.topHoldings.length > 0 &&
            slatePlayers.length > 0 && (
              <ActivePositionsToday
                topHoldings={data.topHoldings}
                slatePlayers={slatePlayers}
                eligiblePlayers={eligiblePlayers}
                onTrade={(playerId) => openPlayerModal(playerId)}
                onBoost={(playerId) => setLocation(`/boosts?preselect=${playerId}`)}
              />
            )}

          {/* Games Section */}
          <ScrollReveal delay={0.1}>
            <Card className="mb-3 sm:mb-6 relative overflow-hidden">
              <CardAccent variant="top" color="primary" intensity="medium" />
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 space-y-0 pb-2 relative z-10">
                <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">
                    Games
                  </CardTitle>
                </div>

                {/* Right side: Date controls */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToPrevDay}
                    disabled={!isDateInRange(new Date(selectedDate.getTime() - 86400000))}
                    className="h-8 px-2 sm:px-3"
                    data-testid="button-prev-day"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>

                  <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2 px-2 sm:px-3"
                        data-testid="button-open-calendar"
                      >
                        <Calendar className="w-4 h-4" />
                        <span className="text-sm">
                          {selectedDate.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year:
                              selectedDate.getFullYear() !== new Date().getFullYear()
                                ? "numeric"
                                : undefined,
                          })}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <CalendarComponent
                        mode="single"
                        selected={selectedDate}
                        onSelect={handleDateSelect}
                        disabled={(date) => !isDateInRange(date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToNextDay}
                    disabled={!isDateInRange(new Date(selectedDate.getTime() + 86400000))}
                    className="h-8 px-2 sm:px-3"
                    data-testid="button-next-day"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>

                  {!isToday(selectedDate) && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={goToToday}
                      className="h-8 px-2 sm:px-3"
                      data-testid="button-today"
                    >
                      Today
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                  {filterTabs.map((sportOption) => {
                    const isActive = sport === sportOption;
                    return (
                      <button
                        key={sportOption}
                        type="button"
                        onClick={() => setSport(sportOption as typeof sport)}
                        className={`inline-flex items-center rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap transition-colors ${
                          isActive
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border/70 bg-background/40 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {sportOption === "ALL" ? "All" : sportOption}
                      </button>
                    );
                  })}
                </div>
                {isLoadingInsights ? (
                  <div className="space-y-3">
                    <ShimmerCard lines={3} />
                    <ShimmerCard lines={3} />
                  </div>
                ) : isNascar ? (
                  // NASCAR Races
                  races.length > 0 ? (
                    <>
                      {[
                        { title: "Live", raceList: liveRaces, empty: "No live races right now." },
                        {
                          title: "Upcoming",
                          raceList: upcomingRaces,
                          empty: "No upcoming races scheduled.",
                        },
                        {
                          title: "Completed",
                          raceList: completedRaces,
                          empty: "No completed races.",
                        },
                      ].map((section) => (
                        <div key={section.title} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                              {section.title}
                            </div>
                            <Badge variant="outline">{section.raceList.length}</Badge>
                          </div>
                          {section.raceList.length > 0 ? (
                            <div className="overflow-hidden rounded-md border border-border/70 bg-background/40">
                              <table className="w-full table-fixed text-xs sm:text-sm">
                                <thead>
                                  <tr className="border-b border-border/70 bg-muted/20">
                                    <th className="w-[22%] px-1.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-2 sm:text-[11px]">
                                      <span className="sm:hidden">Mkt</span>
                                      <span className="hidden sm:inline">Market</span>
                                    </th>
                                    <th className="w-[36%] px-1.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-2 sm:text-[11px]">
                                      Race
                                    </th>
                                    <th className="w-[22%] px-1.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-2 sm:text-[11px]">
                                      <span className="sm:hidden">Prog</span>
                                      <span className="hidden sm:inline">Progress</span>
                                    </th>
                                    <th className="w-[20%] px-1.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-2 sm:text-[11px]">
                                      <span className="sm:hidden">Earn</span>
                                      <span className="hidden sm:inline">Live Earned</span>
                                    </th>
                                    <th className="hidden w-[12%] px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                                      Field
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.raceList.map((race: any, index: number) => {
                                    const raceDate = new Date(race.raceDate);
                                    const raceDateLabel = raceDate.toLocaleDateString([], {
                                      month: "short",
                                      day: "numeric",
                                    });
                                    const raceTimeLabel = raceDate.toLocaleTimeString([], {
                                      hour: "numeric",
                                      minute: "2-digit",
                                    });
                                    const raceMarketState =
                                      race.status === "scheduled"
                                        ? raceTimeLabel
                                        : race.status === "inprogress"
                                          ? "LIVE"
                                          : "FINAL";
                                    const raceMarketStateClass =
                                      race.status === "inprogress"
                                        ? "text-emerald-500"
                                        : race.status === "completed"
                                          ? "text-slate-300"
                                          : "text-blue-400";
                                    const leader = race.driverStandings?.[0];
                                    const hasRaceLapProgress =
                                      Boolean(race.lapInfo) &&
                                      Number(race.lapInfo.currentLap || 0) > 0 &&
                                      Number(race.lapInfo.totalLaps || 0) > 0;
                                    const progressValue =
                                      race.status === "inprogress" && hasRaceLapProgress
                                        ? `L${race.lapInfo.currentLap}/${race.lapInfo.totalLaps}`
                                        : race.status === "completed"
                                          ? "Final"
                                          : "--";
                                    const progressMeta =
                                      race.status === "inprogress" && hasRaceLapProgress
                                        ? `${race.lapInfo.lapsToGo} to go`
                                        : race.status === "completed"
                                          ? "Closed"
                                          : "--";
                                    const earningsDisplay = getEarningsDisplay({
                                      value: race.liveEarned,
                                      status: race.status,
                                      canShow: isAuthenticated,
                                    });

                                    return (
                                      <tr
                                        key={race.raceId}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedRace(race)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            setSelectedRace(race);
                                          }
                                        }}
                                        className={`cursor-pointer border-b border-border/60 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${index === section.raceList.length - 1 ? "border-b-0" : ""}`}
                                      >
                                        <td className="px-1.5 py-1.5 align-middle sm:px-2 sm:py-2">
                                          <div className="truncate font-mono text-[10px] font-semibold uppercase tracking-wide sm:text-[11px]">
                                            <span className="text-foreground">NASCAR</span>{" "}
                                            <span className={raceMarketStateClass}>
                                              {raceMarketState}
                                            </span>
                                          </div>
                                          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground sm:text-[11px]">
                                            {raceDateLabel}
                                          </div>
                                        </td>
                                        <td className="px-1.5 py-1.5 align-middle sm:px-2 sm:py-2">
                                          <div className="truncate font-semibold text-foreground text-xs sm:text-sm">
                                            {race.trackName}
                                          </div>
                                          <div className="truncate text-[10px] text-muted-foreground sm:text-xs">
                                            {race.series} Series
                                          </div>
                                        </td>
                                        <td className="px-1.5 py-1.5 align-middle sm:px-2 sm:py-2">
                                          <div className="truncate font-mono font-semibold text-foreground text-xs sm:text-sm">
                                            {progressValue}
                                          </div>
                                          <div className="truncate text-[10px] text-muted-foreground sm:text-xs">
                                            {progressMeta}
                                          </div>
                                        </td>
                                        <td className="px-1.5 py-1.5 align-middle text-right sm:px-2 sm:py-2">
                                          <div
                                            className={`truncate font-mono font-semibold text-xs sm:text-sm ${earningsDisplay.className}`}
                                          >
                                            {earningsDisplay.label}
                                          </div>
                                        </td>
                                        <td className="hidden px-2 py-2 align-middle text-right sm:table-cell">
                                          <div className="font-mono text-xs font-semibold text-foreground">
                                            {race.totalDrivers || 0}
                                          </div>
                                          <div className="truncate text-[11px] text-muted-foreground">
                                            {leader ? `P1 ${leader.driverName}` : "TBD"}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">{section.empty}</div>
                          )}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      No races scheduled for this date
                    </div>
                  )
                ) : filteredGamesBySport.length > 0 ? (
                  <>
                    {[
                      { title: "Live", games: liveGames, empty: "No live games right now." },
                      {
                        title: "Upcoming",
                        games: upcomingGames,
                        empty: "No upcoming games scheduled.",
                      },
                      { title: "Final", games: finalGames, empty: "No final scores yet." },
                    ].map((section) => (
                      <div key={section.title} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            {section.title}
                          </div>
                          <Badge variant="outline">{section.games.length}</Badge>
                        </div>
                        {section.games.length > 0 ? (
                          <div className="overflow-hidden rounded-md border border-border/70 bg-background/40">
                            <table className="w-full table-fixed text-xs sm:text-sm">
                              <thead>
                                <tr className="border-b border-border/70 bg-muted/20">
                                  <th className="w-[24%] px-1.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-[20%] sm:px-2 sm:text-[11px]">
                                    <span className="sm:hidden">Mkt</span>
                                    <span className="hidden sm:inline">Market</span>
                                  </th>
                                  <th className="w-[28%] px-1.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:hidden">
                                    Match
                                  </th>
                                  <th className="hidden w-[13%] px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                                    Away
                                  </th>
                                  <th className="hidden w-[13%] px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                                    Home
                                  </th>
                                  <th className="w-[23%] px-1.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-[18%] sm:px-2 sm:text-[11px]">
                                    <span className="sm:hidden">Prog</span>
                                    <span className="hidden sm:inline">Progress</span>
                                  </th>
                                  <th className="w-[25%] px-1.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-[16%] sm:px-2 sm:text-[11px]">
                                    <span className="sm:hidden">Earn</span>
                                    <span className="hidden sm:inline">Live Earned</span>
                                  </th>
                                  <th className="hidden w-[16%] px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                                    Owned
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {section.games.map((game, index) => {
                                  const effectiveStatus = getEffectiveGameStatus(game);
                                  const startTime = new Date(game.startTime);
                                  const dateLabel = startTime.toLocaleDateString([], {
                                    month: "short",
                                    day: "numeric",
                                  });
                                  const timeLabel = startTime.toLocaleTimeString([], {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  });
                                  const liveMarketLabel = String(
                                    game.liveMarketStatus || "",
                                  ).trim();
                                  const gameMarketState =
                                    effectiveStatus === "scheduled"
                                      ? "SCHED"
                                      : effectiveStatus === "inprogress"
                                        ? "LIVE"
                                        : effectiveStatus === "completed"
                                          ? "FINAL"
                                          : "POST";
                                  const gameMarketMeta =
                                    effectiveStatus === "scheduled"
                                      ? timeLabel
                                      : effectiveStatus === "inprogress"
                                        ? liveMarketLabel || "In Progress"
                                        : dateLabel;
                                  const gameMarketStateClass =
                                    effectiveStatus === "inprogress"
                                      ? "text-emerald-500"
                                      : effectiveStatus === "completed"
                                        ? "text-slate-300"
                                        : effectiveStatus === "postponed"
                                          ? "text-amber-500"
                                          : "text-blue-400";
                                  const ownedTeams = new Set(
                                    [
                                      ...(game.userContext?.ownedPlayers || []).map(
                                        (player) => player.team,
                                      ),
                                      ...(game.userContext?.topMultiplierPlayers || []).map(
                                        (player) => player.team,
                                      ),
                                    ].filter(Boolean),
                                  );
                                  const earningsDisplay = getEarningsDisplay({
                                    value: game.userContext?.liveEarned,
                                    status: game.userContext?.earningsStatus || effectiveStatus,
                                    canShow: isAuthenticated && game.userContext !== null,
                                  });
                                  const ownedCount = game.userContext?.ownedPlayers?.length || 0;
                                  const powerLeader = game.userContext?.topMultiplierPlayers?.[0];
                                  const isMlbGame = (game.sport || "").toUpperCase() === "MLB";
                                  const mlbPregame = isMlbGame ? game.mlbPregame || null : null;
                                  const mlbEnrichment = isMlbGame
                                    ? game.mlbEnrichment || null
                                    : null;
                                  const awayProbable = formatCompactPitcherName(
                                    mlbPregame?.probablePitchers.away?.name,
                                  );
                                  const homeProbable = formatCompactPitcherName(
                                    mlbPregame?.probablePitchers.home?.name,
                                  );
                                  const probableLine =
                                    awayProbable && homeProbable
                                      ? `${awayProbable} vs ${homeProbable}`
                                      : awayProbable || homeProbable || null;
                                  const mlbFallbackLabel =
                                    mlbEnrichment?.state === "unavailable"
                                      ? null
                                      : mlbEnrichment?.state === "pending"
                                        ? "Probables pending"
                                        : null;
                                  const progressValue =
                                    effectiveStatus === "inprogress" ||
                                    effectiveStatus === "completed"
                                      ? `${game.awayScore ?? "-"}-${game.homeScore ?? "-"}`
                                      : probableLine || mlbFallbackLabel || "--";
                                  const progressMeta =
                                    effectiveStatus === "inprogress"
                                      ? "Live"
                                      : effectiveStatus === "completed"
                                        ? "Final"
                                        : mlbPregame?.matchupSummary ||
                                          (mlbPregame ? "Probables pending" : "--");

                                  return (
                                    <tr
                                      key={game.gameId}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => setActiveGame(game)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          setActiveGame(game);
                                        }
                                      }}
                                      className={`cursor-pointer border-b border-border/60 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${index === section.games.length - 1 ? "border-b-0" : ""}`}
                                    >
                                      <td className="px-1.5 py-1.5 align-middle sm:px-2 sm:py-2">
                                        <div className="truncate font-mono text-[10px] font-semibold uppercase tracking-wide sm:text-[11px]">
                                          <span className="text-foreground">{game.sport}</span>{" "}
                                          <span className={gameMarketStateClass}>
                                            {gameMarketState}
                                          </span>
                                        </div>
                                        <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground sm:text-[11px]">
                                          {gameMarketMeta}
                                        </div>
                                      </td>
                                      <td className="px-1.5 py-1.5 align-middle sm:hidden">
                                        <div className="truncate font-semibold text-foreground">
                                          {game.awayTeam}
                                          <span className="mx-1 text-muted-foreground">@</span>
                                          {game.homeTeam}
                                        </div>
                                        {probableLine ? (
                                          <div className="mt-1 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                                            <MlbProbableBadge compact className="shrink-0" />
                                            <span className="truncate">{probableLine}</span>
                                          </div>
                                        ) : effectiveStatus === "scheduled" && mlbFallbackLabel ? (
                                          <div className="mt-1 truncate text-[10px] text-muted-foreground">
                                            {mlbFallbackLabel}
                                          </div>
                                        ) : null}
                                      </td>
                                      <td className="hidden px-2 py-2 align-middle sm:table-cell">
                                        <div
                                          className={`truncate font-semibold ${ownedTeams.has(game.awayTeam) ? "text-primary" : "text-foreground"}`}
                                        >
                                          {game.awayTeam}
                                        </div>
                                        {awayProbable ? (
                                          <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                                            <MlbProbableBadge compact className="shrink-0" />
                                            <span className="truncate">{awayProbable}</span>
                                          </div>
                                        ) : effectiveStatus === "scheduled" && mlbFallbackLabel ? (
                                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                            {mlbFallbackLabel}
                                          </div>
                                        ) : null}
                                      </td>
                                      <td className="hidden px-2 py-2 align-middle sm:table-cell">
                                        <div
                                          className={`truncate font-semibold ${ownedTeams.has(game.homeTeam) ? "text-primary" : "text-foreground"}`}
                                        >
                                          {game.homeTeam}
                                        </div>
                                        {homeProbable ? (
                                          <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                                            <MlbProbableBadge compact className="shrink-0" />
                                            <span className="truncate">{homeProbable}</span>
                                          </div>
                                        ) : effectiveStatus === "scheduled" && mlbFallbackLabel ? (
                                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                            {mlbFallbackLabel}
                                          </div>
                                        ) : null}
                                      </td>
                                      <td className="px-1.5 py-1.5 align-middle sm:px-2 sm:py-2">
                                        <div className="truncate font-mono font-semibold text-foreground text-xs sm:text-sm">
                                          {progressValue}
                                        </div>
                                        <div className="truncate text-[10px] text-muted-foreground sm:text-xs">
                                          {progressMeta}
                                        </div>
                                      </td>
                                      <td className="px-1.5 py-1.5 align-middle text-right sm:px-2 sm:py-2">
                                        <div
                                          className={`truncate font-mono font-semibold text-xs sm:text-sm ${earningsDisplay.className}`}
                                        >
                                          {earningsDisplay.label}
                                        </div>
                                      </td>
                                      <td className="hidden px-2 py-2 align-middle text-right sm:table-cell">
                                        <div className="font-mono text-xs font-semibold text-foreground">
                                          {isAuthenticated ? ownedCount : "--"}
                                        </div>
                                        <div className="truncate text-[11px] text-muted-foreground">
                                          {isAuthenticated && powerLeader
                                            ? `Multi ${powerLeader.multiplier.toFixed(1)}x`
                                            : "--"}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">{section.empty}</div>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No games scheduled for this date
                  </div>
                )}
              </CardContent>
            </Card>
          </ScrollReveal>

          {/* Missions Section */}
          {isAuthenticated && (
            <div className="mb-1">
              <OnboardingMissions />
            </div>
          )}

          {/* Market Scanners Carousel */}
          <ScrollReveal delay={0.15}>
            <DashboardScanners />
          </ScrollReveal>

          {/* Widgets Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
            {/* Boosts Summary */}
            <ScrollReveal delay={0.35}>
              <Card className="lg:col-span-1 relative overflow-hidden">
                {/* Card Accent */}
                <CardAccent variant="top" color="warning" intensity="medium" />
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">
                    Boosts
                  </CardTitle>
                  <Zap className="w-4 h-4 text-yellow-500" />
                </CardHeader>
                <CardContent className="space-y-2 sm:space-y-3">
                  {isAuthenticated && data?.boosts ? (
                    <>
                      {/* Active Boosts Stats */}
                      <div className="grid grid-cols-2 gap-2 relative z-10">
                        <div className="p-2 bg-primary/10 rounded-md">
                          <div className="flex items-center gap-1 mb-1">
                            <Flame className="w-3 h-3 text-orange-500" />
                            <span className="text-xs text-muted-foreground">Active</span>
                          </div>
                          <div className="text-lg font-bold">{data.boosts.activeBoosts}/4</div>
                        </div>
                        <div className="p-2 bg-yellow-500/10 rounded-md">
                          <div className="flex items-center gap-1 mb-1">
                            <span className="h-2 w-2 rounded-sm bg-yellow-500 animate-pulse" />
                            <span className="text-xs text-muted-foreground">Live</span>
                          </div>
                          <div className="text-lg font-bold">{data.boosts.lockedBoosts}</div>
                        </div>
                      </div>

                      {/* Slots Remaining */}
                      <div className="flex items-center gap-2 p-2 border rounded-md relative z-10">
                        <div className="flex-1">
                          <div className="text-xs text-muted-foreground mb-1">Slots Available</div>
                          <div className="flex gap-1 mt-1">
                            {data.boosts.availableSlots.map((slot) => (
                              <Badge key={slot} variant="outline" className="text-xs">
                                {slot}x
                              </Badge>
                            ))}
                          </div>
                        </div>
                        {data.boosts.slotsRemaining > 0 && (
                          <div className="text-sm text-muted-foreground">
                            {data.boosts.slotsRemaining} open
                          </div>
                        )}
                      </div>

                      {/* Community Boost Count */}
                      {data.boosts.communityBoostCount > 0 && (
                        <div className="flex items-center gap-2 p-2 bg-amber-500/10 rounded-md border border-amber-500/20">
                          <div className="flex-1">
                            <div className="text-xs text-muted-foreground">Community Boosts</div>
                            <div className="text-sm font-medium">
                              {data.boosts.communityBoostCount} active today
                            </div>
                          </div>
                          <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30">
                            +{data.boosts.communityBoostCount}x
                          </Badge>
                        </div>
                      )}

                      {/* Today's Payout */}
                      {(data.boosts.totalLivePayout !== "0.00" ||
                        data.boosts.totalProcessedPayout !== "0.00") && (
                        <div className="p-2 bg-green-500/10 rounded-md border border-green-500/20">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Today's Payout</span>
                            <span className="text-lg font-bold text-green-500">
                              $
                              {(
                                parseFloat(data.boosts.totalLivePayout) +
                                parseFloat(data.boosts.totalProcessedPayout)
                              ).toFixed(2)}
                            </span>
                          </div>
                          {data.boosts.totalLivePayout !== "0.00" && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Est. ${data.boosts.totalLivePayout} live
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      Sign in to use Boosts
                    </div>
                  )}

                  <Link href="/boosts">
                    <Button variant="outline" className="w-full" data-testid="button-view-boosts">
                      Open Boosts Tab
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </ScrollReveal>

            {/* Portfolio Summary - Only show for authenticated users */}
            {isAuthenticated && data?.topHoldings && data.topHoldings.length > 0 && (
              <ScrollReveal delay={0.45}>
                <Card className="lg:col-span-1">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium uppercase tracking-wide">
                      Top Holdings
                    </CardTitle>
                    <DollarSign className="w-4 h-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent className="space-y-2 sm:space-y-3">
                    {data.topHoldings.slice(0, 3).map((holding) => (
                      <Link key={holding.player.id} href={`/player/${holding.player.id}`}>
                        <div className="p-2 rounded-md hover-elevate">
                          <div className="flex items-center justify-between mb-1">
                            <PlayerName
                              playerId={holding.player.id}
                              firstName={holding.player.firstName}
                              lastName={holding.player.lastName}
                              className="font-medium text-sm"
                            />
                            {holding.value !== null ? (
                              <span className="font-mono font-bold text-sm">${holding.value}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">No value</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{holding.quantity} shares</span>
                            {holding.pnl !== null ? (
                              <span
                                className={
                                  parseFloat(holding.pnl) >= 0 ? "text-positive" : "text-negative"
                                }
                              >
                                {parseFloat(holding.pnl) >= 0 ? "+" : ""}${holding.pnl} (
                                {holding.pnlPercent}%)
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                    <Link href="/portfolio">
                      <Button
                        variant="outline"
                        className="w-full"
                        data-testid="button-view-portfolio"
                      >
                        View Full Portfolio
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </ScrollReveal>
            )}
          </div>
        </div>
      </div>

      {activeGame && (
        <GameCommandCenterModal
          gameId={activeGame.gameId}
          sport={sport}
          date={formattedDate}
          initialInsight={activeGame}
          onClose={() => setActiveGame(null)}
        />
      )}

      {selectedRace && (
        <Dialog open={!!selectedRace} onOpenChange={() => setSelectedRace(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedRace.trackName}</DialogTitle>
              <DialogDescription>
                {selectedRace.series} Series -{" "}
                {selectedRace.status === "completed"
                  ? "Final Results"
                  : selectedRace.status === "inprogress"
                    ? "Live Race"
                    : "Starting Grid"}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              {selectedRace.lapInfo && selectedRace.status !== "scheduled" && (
                <div className="mb-4 flex items-center gap-4 text-sm">
                  <Badge variant={selectedRace.status === "completed" ? "secondary" : "default"}>
                    {selectedRace.status === "completed"
                      ? "Final"
                      : `Lap ${selectedRace.lapInfo.currentLap}/${selectedRace.lapInfo.totalLaps}`}
                  </Badge>
                  {selectedRace.lapInfo.lapsToGo > 0 && (
                    <span className="text-muted-foreground">
                      {selectedRace.lapInfo.lapsToGo} laps to go
                    </span>
                  )}
                  {selectedRace.lapInfo.flagState && (
                    <span className="text-muted-foreground">
                      Flag: {selectedRace.lapInfo.flagState}
                    </span>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground pb-2 border-b">
                  <div className="col-span-1">Pos</div>
                  <div className="col-span-1">Start</div>
                  <div className="col-span-4">Driver</div>
                  <div className="col-span-1">Car</div>
                  <div className="col-span-2">Manufacturer</div>
                  <div className="col-span-1">Laps</div>
                  <div className="col-span-1">Led</div>
                  <div className="col-span-1 text-right">FP</div>
                </div>
                {selectedRace.driverStandings?.slice(0, 40).map((driver: any, index: number) => {
                  const posDiff = driver.startingPosition - driver.position;
                  const posDiffClass =
                    posDiff > 0
                      ? "text-green-500"
                      : posDiff < 0
                        ? "text-red-500"
                        : "text-muted-foreground";
                  return (
                    <div
                      key={driver.playerId}
                      className="grid grid-cols-12 gap-2 text-sm py-2 border-b items-center"
                    >
                      <div className={`col-span-1 font-bold ${index < 3 ? "text-yellow-500" : ""}`}>
                        {driver.position}
                      </div>
                      <div className="col-span-1">
                        <span className="text-muted-foreground">
                          {driver.startingPosition || "-"}
                        </span>
                        {driver.startingPosition > 0 &&
                          driver.position > 0 &&
                          driver.startingPosition !== driver.position && (
                            <span className={`text-xs ml-1 ${posDiffClass}`}>
                              ({posDiff > 0 ? "+" : ""}
                              {posDiff})
                            </span>
                          )}
                      </div>
                      <div className="col-span-4 font-medium truncate">{driver.driverName}</div>
                      <div className="col-span-1 text-muted-foreground">#{driver.carNumber}</div>
                      <div className="col-span-2 text-muted-foreground text-xs">
                        {driver.manufacturer}
                      </div>
                      <div className="col-span-1 text-muted-foreground text-xs">
                        {driver.lapsCompleted || "-"}
                      </div>
                      <div className="col-span-1">
                        {driver.lapsLed > 0 && (
                          <span className="text-yellow-500 text-xs">{driver.lapsLed} laps</span>
                        )}
                      </div>
                      <div className="col-span-1 text-right font-mono text-purple-400">
                        {driver.fantasyPoints?.toFixed(1)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { useAppState } from "@/hooks/use-app-state";
import { Link, useLocation } from "wouter";
import type { Player, Trade } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { DashboardScanners } from "@/components/marketplace-scanners";
import { PlayerName } from "@/components/player-name";
import { SportSelector } from "@/components/sport-selector";
import { Shimmer, ShimmerCard, ScrollReveal } from "@/components/ui/animations";
import { SPORTS, useSport } from "@/lib/sport-context";
import { authenticatedFetch } from "@/lib/queryClient";
import { OnboardingMissions } from "@/components/onboarding-missions";
import { MarketTicker } from "@/components/market-ticker";
import { GameCommandCenterModal } from "@/components/game-command-center-modal";
import { BackgroundPattern, CardAccent } from "@/components/ui/decorative-elements";
import { MobilePortfolioStatsSheet } from "@/components/mobile-portfolio-stats-sheet";
import type { GameInsight, GameInsightsResponse } from "@/types/game-insights";

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
  power: {
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

type EffectiveGameStatus = "scheduled" | "inprogress" | "completed" | "postponed";

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Helper to determine effective game status based on current time
const getEffectiveGameStatus = (
  game: Pick<GameInsight, "startTime" | "status" | "liveMarketStatus" | "homeScore" | "awayScore">,
): EffectiveGameStatus => {
  const now = new Date();
  const startTime = new Date(game.startTime);
  const timeSinceStart = now.getTime() - startTime.getTime();
  const threeHoursInMs = 3 * 60 * 60 * 1000;
  const hasLiveSignal =
    String(game.liveMarketStatus || "").trim().length > 0 ||
    game.homeScore !== null ||
    game.awayScore !== null;

  // If DB says postponed, trust it
  if (game.status === "postponed") {
    return "postponed";
  }

  // If DB says completed, trust it
  if (game.status === "completed") {
    return "completed";
  }

  // If DB says inprogress, trust it
  if (game.status === "inprogress") {
    return "inprogress";
  }

  // Treat scheduled games as live only when backend has live evidence (status label or score signal).
  if (
    game.status === "scheduled" &&
    hasLiveSignal &&
    timeSinceStart > 0 &&
    timeSinceStart < threeHoursInMs
  ) {
    return "inprogress";
  }

  // If more than 3 hours have passed since start and still scheduled, likely completed but not synced
  if (game.status === "scheduled" && timeSinceStart >= threeHoursInMs) {
    return "completed";
  }

  return game.status as EffectiveGameStatus;
};

export default function Dashboard() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const { sport, setSport } = useSport();
  const [activeGame, setActiveGame] = useState<GameInsight | null>(null);
  const [selectedRace, setSelectedRace] = useState<any>(null);
  const { shouldPoll, isMobile } = useAppState();

  // Disable polling when app is backgrounded or offline; reduce frequency on mobile
  const pollingInterval = shouldPoll ? (isMobile ? 20000 : 10000) : false;

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
    queryFn: async () => {
      // Add 10-second timeout to prevent infinite loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 10000);

      try {
        const res = await authenticatedFetch("/api/dashboard", {
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
  const { data: raceInsights, isLoading: isLoadingRaces } = useQuery<any>({
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
    queryKey: ["/api/games/insights", "ALL", formattedDate],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/games/insights?sport=ALL&date=${formattedDate}`);
      if (!res.ok) throw new Error("Failed to fetch game insights");
      return res.json();
    },
    enabled: true,
    refetchInterval: isToday(selectedDate) ? pollingInterval : false,
    refetchIntervalInBackground: false,
  });

  const games = gameInsights?.games || [];
  const races = raceInsights?.races || [];
  const filterTabs = ["ALL", ...SPORTS.filter((sportOption) => sportOption !== "ALL")] as const;
  // Use global sport context for filtering (syncs with other pages)
  const globalSportFilter = sport === "ALL" ? "ALL" : sport;
  const filteredGamesBySport =
    globalSportFilter === "ALL"
      ? games
      : games.filter((game) => (game.sport || "").toUpperCase() === globalSportFilter);

  const sortGamesByStartAsc = (a: GameInsight, b: GameInsight) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  const sortGamesByStartDesc = (a: GameInsight, b: GameInsight) =>
    new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
  const sortRacesByDateAsc = (a: any, b: any) =>
    new Date(a.raceDate).getTime() - new Date(b.raceDate).getTime();
  const sortRacesByDateDesc = (a: any, b: any) =>
    new Date(b.raceDate).getTime() - new Date(a.raceDate).getTime();

  const liveGames = filteredGamesBySport
    .filter((game) => getEffectiveGameStatus(game) === "inprogress")
    .sort(sortGamesByStartAsc);
  const upcomingGames = filteredGamesBySport
    .filter((game) => getEffectiveGameStatus(game) === "scheduled")
    .sort(sortGamesByStartAsc);
  const finalGames = filteredGamesBySport
    .filter((game) => {
      const status = getEffectiveGameStatus(game);
      return status === "completed" || status === "postponed";
    })
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
    if (value === null || Number.isNaN(value)) return "—";
    const absolute = compactNumberFormatter
      .format(Math.abs(value))
      .replace("K", "k")
      .replace("M", "m")
      .replace("B", "b")
      .replace("T", "t");
    if (value > 0) return `+${absolute}`;
    if (value < 0) return `-${absolute}`;
    return "0";
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

  const formatCompactCurrency = (value: number) => compactCurrencyFormatter.format(value);

  const standardCurrencyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

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

    const amount = typeof value === "number" ? value : 0;
    const formatter =
      Math.abs(amount) >= 1000 ? compactCurrencyFormatter : standardCurrencyFormatter;
    const absolute = formatter.format(Math.abs(amount));

    if (amount > 0) {
      return { label: `+${absolute}`, className: "text-emerald-500" };
    }

    if (amount < 0) {
      return { label: `-${absolute}`, className: "text-rose-500" };
    }

    return { label: "$0.00", className: "text-muted-foreground" };
  };

  if (isLoading && !data) {
    return (
      <div className="min-h-screen bg-background p-3 sm:p-4">
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
      <div className="min-h-screen bg-background overflow-x-hidden max-w-full">
        {/* Login Banner for Non-Authenticated Users */}
        {!isAuthenticated && (
          <div className="bg-primary text-primary-foreground border-b border-primary/20">
            <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm sm:text-base">
                <LogIn className="w-4 h-4 flex-shrink-0" />
                <span className="font-medium">
                  See live NBA trading in action.{" "}
                  <span className="hidden sm:inline">
                    Sign in to start trading, scouting, and competing.
                  </span>
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
          {/* Missions Section */}
          {isAuthenticated && (
            <div className="mb-4">
              <OnboardingMissions />
            </div>
          )}

          {/* Mobile portfolio snapshot trigger + bottom sheet */}
          {isAuthenticated && data?.user && (
            <MobilePortfolioStatsSheet
              user={data.user}
              onOpenPortfolio={() => setLocation("/portfolio")}
              onOpenLeaderboard={(target) => setLocation(`/leaderboards#${target}`)}
            />
          )}

          {/* Balance Header - Only show for authenticated users */}
          {isAuthenticated && data?.user && (
            <div className="hidden sm:block p-1.5 sm:p-2 rounded-lg bg-card border shadow-sm relative overflow-hidden group">
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
                      {formatCompactCurrency(parseFloat(data?.user?.portfolioValue || "0"))}
                    </div>
                    {data?.user?.portfolioRank && data?.user.portfolioRank > 0 && (
                      <button
                        onClick={() => setLocation("/leaderboards#portfolioValue")}
                        className="inline-flex items-center gap-0.5 border border-border px-1 py-0 rounded-full text-[9px] hover:bg-secondary transition-colors cursor-pointer flex-shrink-0"
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
                    Cash: {formatCompactCurrency(parseFloat(data?.user?.balance || "0"))}
                    {data?.user?.cashRank && data?.user.cashRank > 0 && (
                      <button
                        onClick={() => setLocation("/leaderboards#cashBalance")}
                        className="inline-flex items-center gap-0.5 border border-border px-0.5 py-0 rounded text-[9px] hover:bg-secondary transition-colors cursor-pointer flex-shrink-0 ml-0.5"
                        data-testid="badge-cash-rank"
                      >
                        #{data?.user.cashRank}
                        {data?.user.cashRankChange !== null && data?.user.cashRankChange !== 0 && (
                          <span
                            className={
                              data?.user.cashRankChange > 0 ? "text-positive" : "text-negative"
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
                      className="h-8 px-2 sm:px-3 hidden sm:inline-flex"
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
                                  const progressValue =
                                    effectiveStatus === "inprogress" ||
                                    effectiveStatus === "completed"
                                      ? `${game.awayScore ?? "-"}-${game.homeScore ?? "-"}`
                                      : "--";
                                  const progressMeta =
                                    effectiveStatus === "inprogress"
                                      ? "Live"
                                      : effectiveStatus === "completed"
                                        ? "Final"
                                        : "--";
                                  const ownedTeams = new Set(
                                    [
                                      ...(game.userContext?.ownedPlayers || []).map(
                                        (player) => player.team,
                                      ),
                                      ...(game.userContext?.topPowerPlayers || []).map(
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
                                  const powerLeader = game.userContext?.topPowerPlayers?.[0];

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
                                      </td>
                                      <td className="hidden px-2 py-2 align-middle sm:table-cell">
                                        <div
                                          className={`truncate font-semibold ${ownedTeams.has(game.awayTeam) ? "text-primary" : "text-foreground"}`}
                                        >
                                          {game.awayTeam}
                                        </div>
                                      </td>
                                      <td className="hidden px-2 py-2 align-middle sm:table-cell">
                                        <div
                                          className={`truncate font-semibold ${ownedTeams.has(game.homeTeam) ? "text-primary" : "text-foreground"}`}
                                        >
                                          {game.homeTeam}
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
                                          {isAuthenticated ? ownedCount : "--"}
                                        </div>
                                        <div className="truncate text-[11px] text-muted-foreground">
                                          {isAuthenticated && powerLeader
                                            ? `Pwr ${powerLeader.powerLevel.toFixed(1)}`
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

          {/* Market Scanners Carousel */}
          <ScrollReveal delay={0.15}>
            <DashboardScanners />
          </ScrollReveal>

          {/* Widgets Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
            {/* Power Summary */}
            <ScrollReveal delay={0.35}>
              <Card className="lg:col-span-1 relative overflow-hidden">
                {/* Card Accent */}
                <CardAccent variant="top" color="warning" intensity="medium" />
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">
                    Power
                  </CardTitle>
                  <Zap className="w-4 h-4 text-yellow-500" />
                </CardHeader>
                <CardContent className="space-y-2 sm:space-y-3">
                  {isAuthenticated && data?.power ? (
                    <>
                      {/* Active Boosts Stats */}
                      <div className="grid grid-cols-2 gap-2 relative z-10">
                        <div className="p-2 bg-primary/10 rounded-md">
                          <div className="flex items-center gap-1 mb-1">
                            <Flame className="w-3 h-3 text-orange-500" />
                            <span className="text-xs text-muted-foreground">Active</span>
                          </div>
                          <div className="text-lg font-bold">{data.power.activeBoosts}/4</div>
                        </div>
                        <div className="p-2 bg-yellow-500/10 rounded-md">
                          <div className="flex items-center gap-1 mb-1">
                            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                            <span className="text-xs text-muted-foreground">Live</span>
                          </div>
                          <div className="text-lg font-bold">{data.power.lockedBoosts}</div>
                        </div>
                      </div>

                      {/* Slots Remaining */}
                      <div className="flex items-center gap-2 p-2 border rounded-md relative z-10">
                        <div className="flex-1">
                          <div className="text-xs text-muted-foreground mb-1">Slots Available</div>
                          <div className="flex gap-1 mt-1">
                            {data.power.availableSlots.map((slot) => (
                              <Badge key={slot} variant="outline" className="text-xs">
                                {slot}x
                              </Badge>
                            ))}
                          </div>
                        </div>
                        {data.power.slotsRemaining > 0 && (
                          <div className="text-sm text-muted-foreground">
                            {data.power.slotsRemaining} open
                          </div>
                        )}
                      </div>

                      {/* Community Boost Count */}
                      {data.power.communityBoostCount > 0 && (
                        <div className="flex items-center gap-2 p-2 bg-amber-500/10 rounded-md border border-amber-500/20">
                          <div className="flex-1">
                            <div className="text-xs text-muted-foreground">Community Boosts</div>
                            <div className="text-sm font-medium">
                              {data.power.communityBoostCount} active today
                            </div>
                          </div>
                          <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30">
                            +{data.power.communityBoostCount}x
                          </Badge>
                        </div>
                      )}

                      {/* Today's Payout */}
                      {(data.power.totalLivePayout !== "0.00" ||
                        data.power.totalProcessedPayout !== "0.00") && (
                        <div className="p-2 bg-green-500/10 rounded-md border border-green-500/20">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Today's Payout</span>
                            <span className="text-lg font-bold text-green-500">
                              $
                              {(
                                parseFloat(data.power.totalLivePayout) +
                                parseFloat(data.power.totalProcessedPayout)
                              ).toFixed(2)}
                            </span>
                          </div>
                          {data.power.totalLivePayout !== "0.00" && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Est. ${data.power.totalLivePayout} live
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      Sign in to use Power
                    </div>
                  )}

                  <Link href="/power">
                    <Button variant="outline" className="w-full" data-testid="button-view-power">
                      Open Power Tab
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

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
import { Shimmer, ShimmerCard, ScrollReveal } from "@/components/ui/animations";
import { AnimatedPrice } from "@/components/ui/animated-price";
import { useSport } from "@/lib/sport-context";
import { SportSelector } from "@/components/sport-selector";
import { OnboardingMissions } from "@/components/onboarding-missions";
import { MarketTicker } from "@/components/market-ticker";
import { GameCommandCenterCard } from "@/components/game-command-center-card";
import { GameCommandCenterModal } from "@/components/game-command-center-modal";
import { BackgroundPattern, CardAccent } from "@/components/ui/decorative-elements";
import type { GameInsight, GameInsightsResponse } from "@/types/game-insights";

interface DashboardData {
  user: {
    balance: string;
    portfolioValue: string;
    cashRank: number;
    portfolioRank: number;
    cashRankChange: number | null;
    portfolioRankChange: number | null;
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

// Helper to determine effective game status based on current time
const getEffectiveGameStatus = (
  game: Pick<GameInsight, "startTime" | "status">,
): EffectiveGameStatus => {
  const now = new Date();
  const startTime = new Date(game.startTime);
  const timeSinceStart = now.getTime() - startTime.getTime();
  const threeHoursInMs = 3 * 60 * 60 * 1000;

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

  // If game is scheduled but should have started (and it's been less than 3 hours), assume it's live
  if (game.status === "scheduled" && timeSinceStart > 0 && timeSinceStart < threeHoursInMs) {
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
  const { sport } = useSport();
  const [activeGame, setActiveGame] = useState<GameInsight | null>(null);
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
        const res = await fetch("/api/dashboard", {
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

  const { data: gameInsights, isLoading: isLoadingGames } = useQuery<GameInsightsResponse>({
    queryKey: ["/api/games/insights", sport, formattedDate],
    queryFn: async () => {
      const res = await fetch(`/api/games/insights?sport=${sport}&date=${formattedDate}`);
      if (!res.ok) throw new Error("Failed to fetch game insights");
      return res.json();
    },
    refetchInterval: isToday(selectedDate) ? pollingInterval : false,
    refetchIntervalInBackground: false,
  });

  const games = gameInsights?.games || [];
  const boostSlotsRemaining = gameInsights?.boostSlotsRemaining ?? null;
  const liveGames = games.filter((game) => getEffectiveGameStatus(game) === "inprogress");
  const upcomingGames = games.filter((game) => getEffectiveGameStatus(game) === "scheduled");
  const finalGames = games.filter((game) => {
    const status = getEffectiveGameStatus(game);
    return status === "completed" || status === "postponed";
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

  if (isLoading) {
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

          {/* Balance Header - Only show for authenticated users */}
          {isAuthenticated && data?.user && (
            <div className="p-4 sm:p-6 rounded-lg bg-card border shadow-sm relative overflow-hidden group">
              {/* Background Pattern */}
              <BackgroundPattern variant="gradient-mesh" color="primary" opacity={0.05} />

              {/* Labels row */}
              <div className="flex justify-between gap-4 mb-4 relative z-10">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-sans">
                  Cash Balance
                </div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-sans">
                  Portfolio Value
                </div>
              </div>

              {/* Values row */}
              <div className="flex justify-between gap-4 items-center relative z-10">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    className="fintech-balance text-foreground truncate"
                    data-testid="text-balance"
                  >
                    <AnimatedPrice
                      value={parseFloat(data?.user?.balance || "0")}
                      size="lg"
                      showArrow={false}
                      className="text-2xl sm:text-3xl font-bold font-mono"
                    />
                  </div>
                  {data?.user?.cashRank && data?.user.cashRank > 0 && (
                    <button
                      onClick={() => setLocation("/leaderboards#cashBalance")}
                      className="inline-flex items-center gap-1 border border-border px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-xs hover:bg-secondary transition-colors cursor-pointer flex-shrink-0"
                      data-testid="badge-cash-rank"
                      aria-label={`Cash balance rank #${data?.user.cashRank}, click to view leaderboard`}
                    >
                      #{data?.user.cashRank}
                      {data?.user.cashRankChange !== null && data?.user.cashRankChange !== 0 && (
                        <span
                          className={
                            data?.user.cashRankChange > 0 ? "text-positive" : "text-negative"
                          }
                        >
                          {data?.user.cashRankChange > 0 ? (
                            <TrendingUp className="w-2.5 h-2.5 inline" />
                          ) : (
                            <TrendingDown className="w-2.5 h-2.5 inline" />
                          )}
                        </span>
                      )}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                  <div
                    className="fintech-balance text-foreground"
                    data-testid="text-portfolio-value"
                  >
                    <AnimatedPrice
                      value={parseFloat(data?.user?.portfolioValue || "0")}
                      size="lg"
                      showArrow={false}
                      className="text-2xl sm:text-3xl font-bold font-mono"
                    />
                  </div>
                  {data?.user?.portfolioRank && data?.user.portfolioRank > 0 && (
                    <button
                      onClick={() => setLocation("/leaderboards#portfolioValue")}
                      className="inline-flex items-center gap-1 border border-border px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-xs hover:bg-secondary transition-colors cursor-pointer flex-shrink-0"
                      data-testid="badge-portfolio-rank"
                      aria-label={`Portfolio value rank #${data?.user.portfolioRank}, click to view leaderboard`}
                    >
                      #{data?.user.portfolioRank}
                      {data?.user.portfolioRankChange !== null &&
                        data?.user.portfolioRankChange !== 0 && (
                          <span
                            className={
                              data?.user.portfolioRankChange > 0 ? "text-positive" : "text-negative"
                            }
                          >
                            {data?.user.portfolioRankChange > 0 ? (
                              <TrendingUp className="w-2.5 h-2.5 inline" />
                            ) : (
                              <TrendingDown className="w-2.5 h-2.5 inline" />
                            )}
                          </span>
                        )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Games Section */}
          <ScrollReveal delay={0.1}>
            <Card className="mb-3 sm:mb-6 relative overflow-hidden">
              <CardAccent variant="top" color="primary" intensity="medium" />
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 space-y-0 pb-2 relative z-10">
                {/* Left side: Sport selector on mobile, Title + Sport on desktop */}
                <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide hidden sm:block">
                    Games
                  </CardTitle>
                  <SportSelector size="sm" />
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
                {isLoadingGames ? (
                  <div className="space-y-3">
                    <ShimmerCard lines={3} />
                    <ShimmerCard lines={3} />
                  </div>
                ) : games.length > 0 ? (
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
                          <div className="grid grid-cols-2 gap-2">
                            {section.games.map((game) => {
                              const effectiveStatus = getEffectiveGameStatus(game);
                              return (
                                <GameCommandCenterCard
                                  key={game.gameId}
                                  game={game}
                                  effectiveStatus={effectiveStatus}
                                  boostSlotsRemaining={boostSlotsRemaining}
                                  isAuthenticated={isAuthenticated}
                                  onOpen={() => setActiveGame(game)}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">{section.empty}</div>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    ⊡ No games scheduled for this date
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
    </>
  );
}

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Zap,
  TrendingUp,
  History,
  AlertTriangle,
  Flame,
  Search,
  X,
  Clock,
  ChevronLeft,
  ChevronRight,
  Users,
  Star,
  Trophy,
  Plus,
} from "lucide-react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { Player, DailyGame } from "@shared/schema";
import { PlayerName } from "@/components/player-name";
import { format, addDays, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";
import { CommunityBoostSelector } from "@/components/community-boost-selector";
import { BoostCeremonyOverlay } from "@/components/ceremonies/boost-ceremony-overlay";
import { BoostResultsPodium } from "@/components/ceremonies/boost-results-podium";
import { LiveFantasyPoints, BoostThresholdWarning } from "@/components/boost/live-fantasy-points";
import { useBoostNearMissDetector } from "@/components/boost/boost-near-miss";

interface BoostCeremonyData {
  playerName: string;
  playerTeam: string;
  slotTier: number;
  powerLevel: string;
  totalMultiplier: number;
  sharesBurned: number;
}

// Helper to determine effective game status (same as dashboard)
// Trust DB status from BallDon'tLie API - see https://docs.balldontlie.io/#games
// Status values: 'scheduled', 'inprogress', 'completed', 'ended', 'postponed', 'cancelled'
const getEffectiveGameStatus = (game: DailyGame): string => {
  const now = new Date();
  const startTime = new Date(game.startTime);
  const timeSinceStart = now.getTime() - startTime.getTime();
  const threeHoursInMs = 3 * 60 * 60 * 1000;

  // If DB says completed or ended, trust it
  if (game.status === "completed" || game.status === "ended") {
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

  return game.status;
};

interface BoostSlot {
  id: string;
  playerId: string;
  slotTier: number;
  sharesEntered: number;
  status: string;
  fantasyPoints?: string;
  payout?: string;
  gameId?: string;
  player?: Player;
  powerLevel: string;
  communityBoostCount: number;
  sport: string;
  // Live stats (populated when game is in progress)
  liveFantasyPoints?: number | null;
  liveGameStats?: {
    points: number;
    rebounds: number;
    assists: number;
    threePointersMade: number;
    minutes: number;
  } | null;
}

interface EligiblePlayer {
  holdingId?: string;
  playerId: string;
  player: Player;
  availableShares: number;
  powerLevel: string;
  totalShares: number;
  gameId: string | null;
  gameStartTime: string | null;
  hasGameToday: boolean;
  gameStatus: "none" | "upcoming" | "live" | "ended";
  gameDbStatus: string; // Raw status from database: 'scheduled' | 'inprogress' | 'completed'
  isAlreadyBoosted: boolean;
  communityBoostCount: number;
  hasCommunityBoost: boolean;
  userPremiumShares: number;
  sport: string;
}

interface CommunityBoostEntry {
  playerId: string;
  player: Player;
  communityBoostCount: number;
  sport: string;
  boostDate: string;
}

interface BoostHistory {
  id: string;
  playerId: string;
  sharesUsed: number;
  fantasyPoints: string;
  multiplier: number;
  payoutAmount: string;
  createdAt: string;
  player?: Player;
}

const MULTIPLIER_SLOTS = [
  { tier: 5, label: "5x", color: "bg-yellow-500", icon: Flame },
  { tier: 4, label: "4x", color: "bg-orange-500", icon: Zap },
  { tier: 3, label: "3x", color: "bg-purple-500", icon: TrendingUp },
  { tier: 2, label: "2x", color: "bg-blue-500", icon: TrendingUp },
];

const SPORTS = ["All", "NBA", "NFL"];

// Helper to get today's date in Eastern Time
function getTodayET(): Date {
  const now = new Date();
  // Convert to ET by subtracting 5 hours (EST) or 4 hours (EDT)
  // Simpler: just use midnight ET as the day boundary
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et;
}

// Helper to format date as YYYY-MM-DD in ET
function formatDateET(date: Date): string {
  const et = new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return format(et, "yyyy-MM-dd");
}

export default function Power() {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();

  // Initialize with Eastern Time date
  const [selectedDate, setSelectedDate] = useState<Date>(() => getTodayET());
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [communitySportFilter, setCommunitySportFilter] = useState("All");
  const [playerSelectorOpen, setPlayerSelectorOpen] = useState(false);
  const [communityBoostSelectorOpen, setCommunityBoostSelectorOpen] = useState(false);
  const [boostCeremonyOpen, setBoostCeremonyOpen] = useState(false);
  const [boostCeremonyData, setBoostCeremonyData] = useState<BoostCeremonyData | null>(null);
  const [resultsPodiumOpen, setResultsPodiumOpen] = useState(false);

  // Fetch all boosts across sports
  const {
    data: boostsData,
    isLoading: loadingBoosts,
    refetch: refetchBoosts,
  } = useQuery<{
    boosts: BoostSlot[];
    slotsRemaining: number;
    availableSlots: number[];
  }>({
    queryKey: ["/api/daily-boosts/all", formatDateET(selectedDate)],
    queryFn: async () => {
      const dateStr = formatDateET(selectedDate);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/daily-boosts/all?date=${dateStr}`, { headers });
      if (!res.ok) throw new Error("Failed to fetch boosts");
      return res.json();
    },
    refetchInterval: 10000, // Poll every 10 seconds for live updates
  });

  // Fetch all eligible players across sports (for player selector)
  const {
    data: eligibleData,
    isLoading: loadingEligible,
    refetch: refetchEligible,
    error: eligibleError,
  } = useQuery<{
    eligiblePlayers: EligiblePlayer[];
    totalEligible: number;
  }>({
    queryKey: ["/api/daily-boosts/eligible-all", formatDateET(selectedDate)],
    queryFn: async () => {
      const dateStr = formatDateET(selectedDate);
      console.log("[Power] Fetching eligible players for date:", dateStr);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/daily-boosts/eligible-all?date=${dateStr}`, { headers });
      console.log("[Power] Response status:", res.status);
      if (!res.ok) {
        const responseText = await res.text();
        console.error("[Power] Eligible fetch failed:", res.status, responseText);
        try {
          const errorData = JSON.parse(responseText);
          throw new Error(`${errorData.error || "Unknown error"}`);
        } catch {
          throw new Error(`Server error (${res.status})`);
        }
      }
      const data = await res.json();
      console.log("[Power] Eligible data received:", data.eligiblePlayers?.length, "players");
      return data;
    },
    refetchInterval: 60000,
  });

  if (eligibleError) {
    console.error("[Power] Eligible query error:", eligibleError);
  }

  // Debug query to test storage
  const { data: debugData } = useQuery<any>({
    queryKey: ["/api/daily-boosts/debug"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/daily-boosts/debug`, { headers });
      if (!res.ok) throw new Error("Debug endpoint failed");
      return res.json();
    },
    retry: false,
  });

  if (debugData) {
    console.log("[DEBUG] Storage test:", debugData);
  }

  // Fetch community boosts across all sports
  const { data: communityData, refetch: refetchCommunity } = useQuery<{
    communityBoosts: CommunityBoostEntry[];
  }>({
    queryKey: ["/api/community-boosts/all", formatDateET(selectedDate)],
    queryFn: async () => {
      const dateStr = formatDateET(selectedDate);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/community-boosts/all?date=${dateStr}`, { headers });
      if (!res.ok) throw new Error("Failed to fetch community boosts");
      return res.json();
    },
    refetchInterval: 60000,
  });

  // Fetch history
  const { data: historyData } = useQuery<{
    payouts: BoostHistory[];
    totalEarned: string;
    totalBoosts: number;
  }>({
    queryKey: ["/api/daily-boosts/history"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/daily-boosts/history", { headers });
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
  });

  // Assign boost mutation
  const assignBoostMutation = useMutation({
    mutationFn: async (data: {
      playerId: string;
      slotTier: number;
      sharesEntered: number;
      sport: string;
    }) => {
      return await apiRequest("POST", "/api/daily-boosts/assign", {
        ...data,
        date: formatDateET(selectedDate),
      });
    },
    onSuccess: (response, variables) => {
      // Get player details for ceremony
      const player = eligibleData?.eligiblePlayers?.find(
        (ep) => ep.playerId === variables.playerId,
      );

      if (player) {
        const communityBoostCount = player.communityBoostCount || 0;
        const totalMultiplier = variables.slotTier + communityBoostCount;

        setBoostCeremonyData({
          playerName: `${player.player.firstName} ${player.player.lastName}`,
          playerTeam: player.player.team,
          slotTier: variables.slotTier,
          powerLevel: player.powerLevel,
          totalMultiplier: totalMultiplier,
          sharesBurned: variables.sharesEntered,
        });
        setBoostCeremonyOpen(true);
      }

      toast({
        title: "Player boosted!",
        description: "Share will be burned when the game starts.",
      });
      refetchBoosts();
      refetchEligible();
      setSelectedSlot(null);
      setPlayerSelectorOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Boost failed", description: error.message, variant: "destructive" });
    },
  });

  // Remove boost mutation
  const removeBoostMutation = useMutation({
    mutationFn: async (boostId: string) => {
      return await apiRequest("DELETE", `/api/daily-boosts/${boostId}`);
    },
    onSuccess: () => {
      toast({ title: "Boost removed" });
      refetchBoosts();
      refetchEligible();
    },
    onError: (error: Error) => {
      toast({ title: "Remove failed", description: error.message, variant: "destructive" });
    },
  });

  // Create community boost mutation
  const createCommunityBoostMutation = useMutation({
    mutationFn: async (data: { playerId: string; sport: string }) => {
      return await apiRequest("POST", "/api/community-boosts/create", data);
    },
    onSuccess: () => {
      toast({
        title: "Community Boost activated!",
        description: "1 Premium Share redeemed. +1x multiplier applied.",
      });
      refetchBoosts();
      refetchEligible();
      refetchCommunity();
    },
    onError: (error: Error) => {
      toast({
        title: "Community Boost failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getSlotBoost = (tier: number) => {
    return boostsData?.boosts?.find((b) => b.slotTier === tier);
  };

  const filteredPlayers =
    eligibleData?.eligiblePlayers?.filter((ep) => {
      const name = `${ep.player.firstName} ${ep.player.lastName}`.toLowerCase();
      const matchesSearch = name.includes(search.toLowerCase());
      return matchesSearch;
    }) || [];

  // Debug logging
  console.log(`[Power] eligibleData:`, eligibleData);
  if (eligibleData?.eligiblePlayers) {
    console.log(
      `[Power] Total eligible: ${eligibleData.eligiblePlayers.length}, Filtered: ${filteredPlayers.length}, Search: "${search}"`,
    );
    eligibleData.eligiblePlayers.forEach((ep, i) => {
      console.log(
        `[Power] ${i}: ${ep.player?.firstName} ${ep.player?.lastName} - qty: ${ep.totalShares}, pl: ${ep.powerLevel}`,
      );
    });
  }

  const filteredCommunityBoosts =
    communityData?.communityBoosts?.filter((cb) => {
      return communitySportFilter === "All" || cb.sport === communitySportFilter;
    }) || [];

  const totalEstimated = "0.00";
  const activeBoosts = boostsData?.boosts?.filter((b) => b.status === "active").length || 0;
  const lockedBoosts = boostsData?.boosts?.filter((b) => b.status === "locked").length || 0;
  const userPremiumShares = eligibleData?.eligiblePlayers?.[0]?.userPremiumShares || 0;

  const handleSlotClick = (tier: number) => {
    console.log("[Power] handleSlotClick called for tier:", tier);
    const boost = getSlotBoost(tier);
    console.log("[Power] boost found:", boost);
    if (!boost) {
      console.log("[Power] Setting selectedSlot and opening dialog");
      setSelectedSlot(tier);
      setPlayerSelectorOpen(true);
    } else {
      console.log("[Power] Slot already has a boost, skipping");
    }
  };

  const handleAssignBoost = (playerId: string, sport: string) => {
    if (!selectedSlot) return;
    assignBoostMutation.mutate({
      playerId,
      slotTier: selectedSlot,
      sharesEntered: 1, // Only 1 share per boost slot - power is added to that share
      sport,
    });
  };

  return (
    <div className="min-h-screen bg-background p-3">
      <div className="max-w-5xl mx-auto">
        <ErrorBoundary>
          {/* Header */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                <h1 className="text-lg font-bold">Power</h1>
              </div>
            </div>

            {/* Date selector */}
            <div className="flex items-center gap-2 mb-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedDate(subDays(selectedDate, 1))}
                className="h-8 w-8"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex-1 text-center text-sm font-medium">
                {format(selectedDate, "EEE, MMM d")}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedDate(addDays(selectedDate, 1))}
                className="h-8 w-8"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Quick stats */}
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <Badge variant="outline" className="gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {activeBoosts}/4 active
              </Badge>
              {lockedBoosts > 0 && (
                <Badge variant="outline" className="gap-1">
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  {lockedBoosts} live
                </Badge>
              )}
              {userPremiumShares > 0 && (
                <Badge className="gap-1 bg-amber-500/20 text-amber-500 border-amber-500/30">
                  <Star className="w-3 h-3" />
                  {userPremiumShares} Premium
                </Badge>
              )}
            </div>
          </div>

          {/* Warning */}
          <Card className="mb-3 bg-destructive/5 border-destructive/20">
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Shares are <span className="text-destructive font-medium">burned</span> when games
                  start.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Boost Slots */}
          <div className="mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-2">Boost Slots</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MULTIPLIER_SLOTS.map(({ tier, label, color }) => {
                const boost = getSlotBoost(tier);
                const isAvailable = boostsData?.availableSlots?.includes(tier);

                return (
                  <Card
                    key={tier}
                    className={cn(
                      "relative overflow-hidden cursor-pointer transition-all",
                      !boost && isAvailable && "hover:border-primary/50 hover:bg-primary/5",
                      boost && "border-primary/50",
                    )}
                    onClick={() => handleSlotClick(tier)}
                  >
                    <div
                      className={cn(
                        "absolute top-0 right-0 px-2 py-0.5 text-white text-xs font-bold",
                        color,
                      )}
                    >
                      {label}
                    </div>
                    <CardContent className="p-2">
                      {boost ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1 mb-1">
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-5">
                              {boost.sport}
                            </Badge>
                          </div>
                          <div className="flex items-start justify-between gap-1 min-w-0">
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">
                                {boost.player && (
                                  <PlayerName
                                    playerId={boost.player.id}
                                    firstName={boost.player.firstName}
                                    lastName={boost.player.lastName}
                                    className="text-sm"
                                  />
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-muted-foreground">Power</span>
                                <span className="font-mono text-purple-400 font-medium">
                                  {boost.powerLevel}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-muted-foreground">Total</span>
                                <span className="font-mono font-bold text-primary">
                                  {(
                                    parseFloat(boost.powerLevel) *
                                    (tier + boost.communityBoostCount)
                                  ).toFixed(2)}
                                </span>
                                {boost.communityBoostCount > 0 && (
                                  <span className="text-xs text-amber-500">
                                    ({tier}+{boost.communityBoostCount}x)
                                  </span>
                                )}
                              </div>
                            </div>
                            {boost.status === "active" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeBoostMutation.mutate(boost.id);
                                }}
                                disabled={removeBoostMutation.isPending}
                                className="h-6 w-6 shrink-0"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                          {boost.communityBoostCount > 0 && (
                            <div className="flex items-center gap-1">
                              <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 text-xs">
                                <Zap className="w-3 h-3 mr-0.5" />+{boost.communityBoostCount}
                              </Badge>
                            </div>
                          )}
                          {/* Status and Live Fantasy Points */}
                          {boost.status === "active" && (
                            <Badge variant="secondary" className="w-full justify-center text-xs">
                              <Clock className="w-3 h-3 mr-1" />
                              Waiting
                            </Badge>
                          )}
                          {boost.status === "locked" &&
                            boost.liveFantasyPoints !== null &&
                            boost.liveFantasyPoints !== undefined && (
                              <div className="space-y-2">
                                <Badge className="w-full justify-center text-xs bg-yellow-500/20 text-yellow-600 border-yellow-500/30 animate-pulse">
                                  <span className="animate-pulse">●</span> Live
                                </Badge>

                                {/* Enhanced Live Fantasy Points Display */}
                                <div className="flex justify-center">
                                  <LiveFantasyPoints
                                    points={boost.liveFantasyPoints}
                                    multiplier={tier + boost.communityBoostCount}
                                    powerLevel={parseFloat(boost.powerLevel)}
                                    className="w-full max-w-[180px]"
                                  />
                                </div>

                                {/* Near-threshold warning */}
                                <BoostThresholdWarning
                                  currentPoints={boost.liveFantasyPoints}
                                  nextThreshold={Math.ceil(boost.liveFantasyPoints / 5) * 5}
                                  estimatedPayout={
                                    (Math.ceil(boost.liveFantasyPoints / 5) * 5 -
                                      boost.liveFantasyPoints) *
                                    (tier + boost.communityBoostCount) *
                                    parseFloat(boost.powerLevel)
                                  }
                                  className="w-full justify-center"
                                />

                                {boost.liveGameStats && (
                                  <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground pt-1">
                                    <span>{boost.liveGameStats.points} pts</span>
                                    <span>•</span>
                                    <span>{boost.liveGameStats.rebounds} reb</span>
                                    <span>•</span>
                                    <span>{boost.liveGameStats.assists} ast</span>
                                  </div>
                                )}
                              </div>
                            )}
                          {boost.status === "locked" &&
                            (boost.liveFantasyPoints === null ||
                              boost.liveFantasyPoints === undefined) && (
                              <Badge className="w-full justify-center text-xs bg-yellow-500/20 text-yellow-600 border-yellow-500/30">
                                <span className="animate-pulse">●</span> Live
                              </Badge>
                            )}
                          {boost.status === "processed" && (
                            <Badge className="w-full justify-center text-xs bg-green-500/20 text-green-600 border-green-500/30">
                              ${boost.payout}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-3">
                          {isAvailable ? (
                            <div className="text-xs text-muted-foreground">
                              <Zap className="w-4 h-4 mx-auto mb-1 opacity-50" />
                              Tap to add
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Filled</span>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Community Boosts List */}
          <Card className="mb-3">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Community Boosts
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCommunityBoostSelectorOpen(true)}
                    className="h-6 text-xs px-2 bg-amber-500/10 border-amber-500/30 text-amber-600 hover:bg-amber-500/20"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                  {SPORTS.map((sport) => (
                    <Button
                      key={sport}
                      size="sm"
                      variant={communitySportFilter === sport ? "default" : "ghost"}
                      onClick={() => setCommunitySportFilter(sport)}
                      className="h-6 text-xs px-2"
                    >
                      {sport}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredCommunityBoosts.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground text-sm">
                  No community boosts today
                </div>
              ) : (
                <div className="divide-y">
                  {filteredCommunityBoosts.map((cb) => (
                    <div key={cb.playerId} className="p-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-amber-500">
                            {cb.player.firstName[0]}
                            {cb.player.lastName[0]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            <PlayerName
                              playerId={cb.player.id}
                              firstName={cb.player.firstName}
                              lastName={cb.player.lastName}
                              className="text-sm"
                            />
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span>{cb.player.team}</span>
                            <span>•</span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              {cb.sport}
                            </Badge>
                            <span>•</span>
                            <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 text-[10px] px-1.5 py-0 h-5">
                              <Zap className="w-2.5 h-2.5 mr-0.5" />+{cb.communityBoostCount}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* History */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="w-4 h-4" />
                  Payouts
                </CardTitle>
                {historyData && <Badge variant="outline">Total: ${historyData.totalEarned}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!historyData?.payouts || historyData.payouts.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">No payouts yet</div>
              ) : (
                <div className="divide-y max-h-[300px] overflow-y-auto">
                  {historyData.payouts.map((payout) => (
                    <div key={payout.id} className="p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {payout.player && (
                            <PlayerName
                              playerId={payout.player.id}
                              firstName={payout.player.firstName}
                              lastName={payout.player.lastName}
                              className="text-sm"
                            />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {payout.sharesUsed} × {payout.fantasyPoints} FP × {payout.multiplier}x •{" "}
                          {format(new Date(payout.createdAt), "MMM d")}
                        </div>
                      </div>
                      <span className="font-mono font-bold text-green-500 shrink-0">
                        +${payout.payoutAmount}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Player Selector Dialog */}
          <Dialog
            open={playerSelectorOpen}
            onOpenChange={(open) => {
              console.log("[Power] Dialog onOpenChange:", open);
              setPlayerSelectorOpen(open);
              if (!open) {
                setSearch("");
                setSelectedSlot(null);
              }
            }}
          >
            <DialogContent
              className="max-w-md max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <DialogHeader>
                <DialogTitle>Select Player</DialogTitle>
                <DialogDescription>
                  Choose a player for {MULTIPLIER_SLOTS.find((s) => s.tier === selectedSlot)?.label}{" "}
                  slot
                </DialogDescription>
              </DialogHeader>

              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search players..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingEligible ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Loading...</div>
                ) : eligibleError ? (
                  <div className="py-8 text-center text-destructive text-sm">
                    <div className="font-medium mb-2">Server Error</div>
                    <div className="text-xs font-mono bg-destructive/10 p-2 rounded mb-2 overflow-auto max-h-32">
                      {eligibleError.message}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refetchEligible()}
                      className="mt-2"
                    >
                      Retry
                    </Button>
                  </div>
                ) : !eligibleData?.eligiblePlayers || eligibleData.eligiblePlayers.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    No players held
                    <br />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refetchEligible()}
                      className="mt-2"
                    >
                      Refresh
                    </Button>
                  </div>
                ) : filteredPlayers.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    {search ? `No players match "${search}"` : "No players available for boosting"}
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredPlayers.map((ep) => {
                      const hasPowerLevel = parseFloat(ep.powerLevel || "0") > 0;
                      const playerBoost = boostsData?.boosts?.find(
                        (b) => b.playerId === ep.playerId,
                      );

                      // Determine if player can be boosted
                      const canBoost =
                        ep.hasGameToday && ep.gameStatus === "upcoming" && !playerBoost;

                      return (
                        <div
                          key={ep.holdingId || ep.playerId}
                          className={cn(
                            "p-3 flex items-center justify-between gap-2",
                            ep.gameStatus === "live" && "bg-yellow-500/5",
                            ep.gameStatus === "ended" && "bg-muted/30",
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div
                              className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                ep.hasGameToday ? "bg-primary/10" : "bg-muted",
                              )}
                            >
                              <span className="text-xs font-bold">
                                {ep.player.firstName[0]}
                                {ep.player.lastName[0]}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">
                                <PlayerName
                                  playerId={ep.player.id}
                                  firstName={ep.player.firstName}
                                  lastName={ep.player.lastName}
                                  className="text-sm"
                                />
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
                                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                                  {ep.sport}
                                </Badge>
                                <span>{ep.player.team}</span>
                                {hasPowerLevel && (
                                  <>
                                    <span>•</span>
                                    <span className="text-purple-400">⚡ {ep.powerLevel}</span>
                                  </>
                                )}
                                {/* Game status indicator */}
                                {!ep.hasGameToday && (
                                  <>
                                    <span>•</span>
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] px-1 py-0 h-4"
                                    >
                                      No game
                                    </Badge>
                                  </>
                                )}
                                {ep.hasGameToday &&
                                  ep.gameStatus === "upcoming" &&
                                  ep.gameStartTime && (
                                    <>
                                      <span>•</span>
                                      <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30 text-[10px] px-1 py-0 h-4">
                                        {format(new Date(ep.gameStartTime), "h:mm a")}
                                      </Badge>
                                    </>
                                  )}
                                {ep.hasGameToday && ep.gameStatus === "live" && (
                                  <>
                                    <span>•</span>
                                    <Badge
                                      variant="destructive"
                                      className="text-[10px] px-1 py-0 h-4 animate-pulse"
                                    >
                                      Live
                                    </Badge>
                                  </>
                                )}
                                {ep.hasGameToday && ep.gameStatus === "ended" && (
                                  <>
                                    <span>•</span>
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] px-1 py-0 h-4"
                                    >
                                      Ended
                                    </Badge>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {playerBoost ? (
                              <Badge className="bg-green-500/20 text-green-500 border-green-500/30 text-xs">
                                <Zap className="w-3 h-3 mr-0.5" />
                                Boosted
                              </Badge>
                            ) : canBoost ? (
                              <Button
                                size="sm"
                                onClick={() => handleAssignBoost(ep.playerId, ep.sport)}
                                disabled={assignBoostMutation.isPending}
                                className="h-8"
                              >
                                <Zap className="w-3 h-3 mr-1" />
                                {MULTIPLIER_SLOTS.find((s) => s.tier === selectedSlot)?.label}
                              </Button>
                            ) : ep.hasGameToday && ep.gameStatus === "live" ? (
                              <Badge variant="destructive" className="text-xs">
                                Live
                              </Badge>
                            ) : ep.hasGameToday && ep.gameStatus === "ended" ? (
                              <Badge variant="secondary" className="text-xs">
                                Ended
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                No game
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* Community Boost Selector Dialog */}
          <CommunityBoostSelector
            open={communityBoostSelectorOpen}
            onOpenChange={setCommunityBoostSelectorOpen}
            selectedDate={selectedDate}
          />

          {/* Boost Ceremony Overlay */}
          <BoostCeremonyOverlay
            isOpen={boostCeremonyOpen}
            data={boostCeremonyData}
            onClose={() => setBoostCeremonyOpen(false)}
          />

          {/* Boost Results Podium */}
          <BoostResultsPodium
            isOpen={resultsPodiumOpen}
            results={
              boostsData?.boosts
                ?.filter((b) => b.status === "processed")
                ?.map((b) => ({
                  slotTier: b.slotTier,
                  playerName: b.player ? `${b.player.firstName} ${b.player.lastName}` : "Unknown",
                  playerTeam: b.player?.team || "",
                  fantasyPoints: parseFloat(b.fantasyPoints || "0"),
                  multiplier: b.slotTier + b.communityBoostCount,
                  powerLevel: parseFloat(b.powerLevel),
                  payout: parseFloat(b.payout || "0"),
                })) || []
            }
            totalPayout={parseFloat(historyData?.totalEarned || "0")}
            onClose={() => setResultsPodiumOpen(false)}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}

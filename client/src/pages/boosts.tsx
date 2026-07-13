import { useMemo, useState, useEffect } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { apiRequest, authenticatedFetch, getAuthHeaders } from "@/lib/queryClient";
import { useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Player } from "@shared/schema";
import { PlayerName } from "@/components/player-name";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";
import { CommunityBoostSelector } from "@/components/community-boost-selector";
import { BoostCeremonyOverlay } from "@/components/ceremonies/boost-ceremony-overlay";
import { BoostResultsPodium } from "@/components/ceremonies/boost-results-podium";
import { LiveFantasyPoints } from "@/components/boost/live-fantasy-points";
import { useBoostNearMissDetector } from "@/components/boost/boost-near-miss";
import { SPORTS as GLOBAL_SPORTS } from "@/lib/sport-context";
import { matchesPlayerSearch } from "@/lib/player-search";
import { useBoostsDate } from "@/features/boosts/use-boosts-date";
import {
  getBoostDisplayPlayerName,
  getTotalEstimatedBoostPayout,
  resolveAssignBoostFeedback,
} from "@/features/boosts/assign-boost-feedback";

interface BoostCeremonyData {
  playerName: string;
  playerTeam: string;
  slotTier: number;
  shareMultiplier: number; // Multiplier carried by the share used for the boost
  totalMultiplier: number;
  sharesBurned: number;
}

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
  shareMultiplier: string;
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
  effectiveShares: string;
  multiplier: string;
  bestShareMultiplier: number;
  totalShares: string;
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

interface AssignBoostResponse {
  success: boolean;
  boost: {
    player?: Player | null;
    shareMultiplier?: string | null;
  };
  estimatedPayout: string;
}

function formatCountdown(gameStartTime: string, now: Date): string | null {
  const target = new Date(gameStartTime);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return null;
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
const MULTIPLIER_SLOTS = [
  { tier: 5, label: "5x", color: "bg-premium", icon: Flame },
  { tier: 4, label: "4x", color: "bg-boost", icon: Zap },
  { tier: 3, label: "3x", color: "bg-chart-4", icon: TrendingUp },
  { tier: 2, label: "2x", color: "bg-chart-2", icon: TrendingUp },
];

const COMMUNITY_FILTER_SPORTS = ["All", ...GLOBAL_SPORTS.filter((sport) => sport !== "ALL")];

export default function BoostsPage() {
  const { toast } = useToast();
  const { selectedDate, selectedDateKey, goToPreviousDay, goToNextDay } = useBoostsDate();
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [communitySportFilter, setCommunitySportFilter] = useState("All");
  const [playerSelectorOpen, setPlayerSelectorOpen] = useState(false);
  const [communityBoostSelectorOpen, setCommunityBoostSelectorOpen] = useState(false);
  const [boostCeremonyOpen, setBoostCeremonyOpen] = useState(false);
  const [boostCeremonyData, setBoostCeremonyData] = useState<BoostCeremonyData | null>(null);
  const [resultsPodiumOpen, setResultsPodiumOpen] = useState(false);

  // Countdown clock — ticks every second for active boost slot timers
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Parse ?preselect=<playerId> from the URL — one-shot: handled flag prevents re-trigger
  const searchString = useSearch();
  const preselectPlayerId = useMemo(
    () => new URLSearchParams(searchString).get("preselect") || null,
    [searchString],
  );
  const [preselectHandled, setPreselectHandled] = useState(false);
  const {
    data: boostsData,
    isLoading: loadingBoosts,
    refetch: refetchBoosts,
  } = useQuery<{
    boosts: BoostSlot[];
    slotsRemaining: number;
    availableSlots: number[];
  }>({
    queryKey: ["/api/daily-boosts/all", selectedDateKey],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await authenticatedFetch(`/api/daily-boosts/all?date=${selectedDateKey}`, {
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch boosts");
      return res.json();
    },
    refetchInterval: 10000, // Poll every 10 seconds for live updates
    staleTime: 5000,
    placeholderData: keepPreviousData,
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
    queryKey: ["/api/daily-boosts/eligible-all", selectedDateKey],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await authenticatedFetch(
        `/api/daily-boosts/eligible-all?date=${selectedDateKey}`,
        {
          headers,
        },
      );
      if (!res.ok) {
        const responseText = await res.text();
        try {
          const errorData = JSON.parse(responseText);
          throw new Error(`${errorData.error || "Unknown error"}`);
        } catch {
          throw new Error(`Server error (${res.status})`);
        }
      }
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 15000,
    placeholderData: keepPreviousData,
  });

  // Fetch community boosts across all sports
  const { data: communityData } = useQuery<{
    communityBoosts: CommunityBoostEntry[];
  }>({
    queryKey: ["/api/community-boosts/all", selectedDateKey],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await authenticatedFetch(`/api/community-boosts/all?date=${selectedDateKey}`, {
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch community boosts");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 15000,
    placeholderData: keepPreviousData,
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
      const res = await authenticatedFetch("/api/daily-boosts/history", { headers });
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    staleTime: 60000,
    placeholderData: keepPreviousData,
  });

  // Assign boost mutation
  const assignBoostMutation = useMutation({
    mutationFn: async (data: {
      playerId: string;
      slotTier: number;
      sharesEntered: number;
      sport: string;
    }) => {
      const response = await apiRequest("POST", "/api/daily-boosts/assign", {
        ...data,
        date: selectedDateKey,
      });
      return (await response.json()) as AssignBoostResponse;
    },
    onSuccess: (response, variables) => {
      // Get player details for ceremony
      const eligiblePlayer = eligibleData?.eligiblePlayers?.find(
        (ep) => ep.playerId === variables.playerId,
      );
      const feedback = resolveAssignBoostFeedback({
        response,
        eligiblePlayer,
        slotTier: variables.slotTier,
      });

      if (response.boost.player || eligiblePlayer?.player) {
        setBoostCeremonyData({
          playerName: feedback.playerName,
          playerTeam: feedback.playerTeam,
          slotTier: variables.slotTier,
          shareMultiplier: feedback.shareMultiplier,
          totalMultiplier: feedback.totalMultiplier,
          sharesBurned: variables.sharesEntered,
        });
        setBoostCeremonyOpen(true);
      }

      const slotLabel =
        MULTIPLIER_SLOTS.find((s) => s.tier === variables.slotTier)?.label ||
        `${variables.slotTier}x`;
      toast({
        title: "Boost slot filled!",
        description: `Added 1 share to the ${slotLabel} slot (share multiplier ${feedback.shareMultiplier}). Share will be burned when the game starts.`,
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

  const getSlotBoost = (tier: number) => {
    return boostsData?.boosts?.find((b) => b.slotTier === tier);
  };

  const filteredPlayers = useMemo(() => {
    const players = (eligibleData?.eligiblePlayers || []).filter((eligiblePlayer) =>
      matchesPlayerSearch(eligiblePlayer.player, search),
    );
    // Surface the preselected player first when a ?preselect param is present
    if (preselectPlayerId) {
      const idx = players.findIndex((p) => p.playerId === preselectPlayerId);
      if (idx > 0) {
        const [target] = players.splice(idx, 1);
        players.unshift(target);
      }
    }
    return players;
  }, [eligibleData?.eligiblePlayers, search, preselectPlayerId]);

  const filteredCommunityBoosts = useMemo(
    () =>
      (communityData?.communityBoosts || []).filter(
        (communityBoost) =>
          communitySportFilter === "All" || communityBoost.sport === communitySportFilter,
      ),
    [communityData?.communityBoosts, communitySportFilter],
  );

  const processedBoostResults = useMemo(
    () =>
      (boostsData?.boosts || [])
        .filter((boost) => boost.status === "processed")
        .map((boost) => ({
          slotTier: boost.slotTier,
          playerName: getBoostDisplayPlayerName(boost.player),
          playerTeam: boost.player?.team || "",
          fantasyPoints: parseFloat(boost.fantasyPoints || "0"),
          multiplier: boost.slotTier + boost.communityBoostCount,
          shareMultiplier: parseFloat(boost.shareMultiplier),
          payout: parseFloat(boost.payout || "0"),
        })),
    [boostsData?.boosts],
  );
  const totalEstimated = getTotalEstimatedBoostPayout(boostsData?.boosts).toFixed(2);
  const preselectEligiblePlayer = useMemo(
    () =>
      preselectPlayerId
        ? ((eligibleData?.eligiblePlayers || []).find((ep) => ep.playerId === preselectPlayerId) ??
          null)
        : null,
    [preselectPlayerId, eligibleData?.eligiblePlayers],
  );

  const preselectIneligibleMsg = useMemo<string | null>(() => {
    if (!preselectPlayerId || loadingEligible) return null;
    if (!preselectEligiblePlayer) return "This player is not eligible for today's boost.";
    if (preselectEligiblePlayer.isAlreadyBoosted) return "This player is already boosted today.";
    if (!preselectEligiblePlayer.hasGameToday || preselectEligiblePlayer.gameStatus !== "upcoming")
      return "This player is not eligible for today's boost.";
    return null;
  }, [preselectPlayerId, loadingEligible, preselectEligiblePlayer]);

  // Auto-open the player selector for the first available slot when ?preselect is set
  useEffect(() => {
    if (!preselectPlayerId || preselectHandled || loadingBoosts) return;
    if (!boostsData?.availableSlots?.length) return;
    const firstAvailableSlot = MULTIPLIER_SLOTS.find((s) =>
      boostsData.availableSlots.includes(s.tier),
    );
    if (firstAvailableSlot) {
      setSelectedSlot(firstAvailableSlot.tier);
      setPlayerSelectorOpen(true);
      setPreselectHandled(true);
    }
  }, [preselectPlayerId, preselectHandled, loadingBoosts, boostsData]);
  const activeBoosts = boostsData?.boosts?.filter((b) => b.status === "active").length || 0;
  const lockedBoosts = boostsData?.boosts?.filter((b) => b.status === "locked").length || 0;
  const userPremiumShares = eligibleData?.eligiblePlayers?.[0]?.userPremiumShares || 0;

  const openResultsPodium = () => {
    if (processedBoostResults.length === 0) {
      return;
    }
    setResultsPodiumOpen(true);
  };

  const handleSlotClick = (tier: number) => {
    const boost = getSlotBoost(tier);
    if (!boost) {
      setSelectedSlot(tier);
      setPlayerSelectorOpen(true);
    }
  };

  const handleAssignBoost = (playerId: string, sport: string) => {
    if (!selectedSlot) return;
    assignBoostMutation.mutate({
      playerId,
      slotTier: selectedSlot,
      sharesEntered: 1, // Only 1 share per boost slot - that share's multiplier is used
      sport,
    });
  };

  return (
    <div className="terminal-page px-2 py-3 sm:p-3">
      <div className="mx-auto max-w-5xl py-1 space-y-3">
        <ErrorBoundary>
          {/* Header */}
          <div className="terminal-shell mb-2 p-2.5 sm:mb-3 sm:p-4">
            <div className="mb-2 flex flex-col gap-2.5 sm:mb-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5 sm:space-y-2">
                <div className="terminal-strip">
                  <Zap className="h-3.5 w-3.5 text-status-warning" />
                  Boost Desk
                </div>
                <div>
                  <p className="terminal-kicker">Daily Boost Slots</p>
                  <h1 className="terminal-heading mt-1 text-xl sm:text-2xl">Boosts</h1>
                </div>
                <p className="max-w-2xl text-xs text-muted-foreground sm:text-sm">
                  Queue one share per slot, lock in your multiplier before tipoff, and monitor live
                  boost settlement from a single board.
                </p>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 sm:self-center">
                <Button
                  variant="terminalOutline"
                  size="icon"
                  onClick={goToPreviousDay}
                  className="h-8 w-8"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="terminal-shell min-w-[9rem] px-2 py-1.5 text-center sm:min-w-[10rem] sm:px-3 sm:py-2">
                  <p className="terminal-label">Session Date</p>
                  <p className="terminal-value text-sm">{format(selectedDate, "EEE, MMM d")}</p>
                </div>
                <Button
                  variant="terminalOutline"
                  size="icon"
                  onClick={goToNextDay}
                  className="h-8 w-8"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Quick stats */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs sm:grid sm:overflow-visible sm:pb-0 sm:gap-2 sm:grid-cols-3 xl:grid-cols-4">
              <div className="terminal-shell min-w-[8rem] px-2.5 py-1.5 sm:min-w-0 sm:px-3 sm:py-2">
                <p className="terminal-label">Active Slots</p>
                <p className="terminal-value text-sm">{activeBoosts}/4</p>
              </div>
              {lockedBoosts > 0 && (
                <div className="terminal-shell min-w-[8rem] px-2.5 py-1.5 sm:min-w-0 sm:px-3 sm:py-2">
                  <p className="terminal-label">Live Slots</p>
                  <p className="terminal-value text-sm">{lockedBoosts}</p>
                </div>
              )}
              {userPremiumShares > 0 && (
                <div className="terminal-shell min-w-[8rem] px-2.5 py-1.5 sm:min-w-0 sm:px-3 sm:py-2">
                  <p className="terminal-label">Premium Shares</p>
                  <p className="terminal-value text-sm">{userPremiumShares}</p>
                </div>
              )}
              <div className="terminal-shell min-w-[8rem] px-2.5 py-1.5 sm:min-w-0 sm:px-3 sm:py-2">
                <p className="terminal-label">Est. Payout</p>
                <p className="terminal-value text-sm">${totalEstimated}</p>
              </div>
            </div>
          </div>

          {/* Warning */}
          <Card variant="terminal" className="mb-3 border-status-warning/20 bg-status-warning/5">
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
                <p className="terminal-subtle">
                  Shares are <span className="font-semibold text-status-warning">burned</span> when
                  games begin. Only assign slots you intend to settle.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Boost Slots */}
          <div className="mb-2 sm:mb-3">
            <div className="mb-1.5 flex items-center gap-2 sm:mb-2">
              <div className="terminal-strip">Boost Slots</div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2 sm:grid-cols-4">
              {MULTIPLIER_SLOTS.map(({ tier, label, color }) => {
                const boost = getSlotBoost(tier);
                const isAvailable = boostsData?.availableSlots?.includes(tier);
                const boostEp = boost
                  ? (eligibleData?.eligiblePlayers?.find((p) => p.playerId === boost.playerId) ??
                    null)
                  : null;
                const gameCountdown = boostEp?.gameStartTime
                  ? formatCountdown(boostEp.gameStartTime, now)
                  : null;

                return (
                  <Card
                    key={tier}
                    variant="terminal"
                    className={cn(
                      "relative cursor-pointer overflow-hidden transition-all",
                      !boost && isAvailable && "hover:border-primary/40 hover:bg-primary/5",
                      boost && "border-primary/35",
                    )}
                    onClick={() => handleSlotClick(tier)}
                  >
                    <div
                      className={cn(
                        "absolute right-0 top-0 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-content-inverse",
                        color,
                      )}
                    >
                      {label}
                    </div>
                    <CardContent className="p-1.5 sm:p-2">
                      {boost ? (
                        <div className="space-y-1.5 sm:space-y-2">
                          <div className="flex items-center gap-1 mb-1">
                            <Badge
                              variant="outline"
                              className="h-5 px-1.5 font-mono text-[10px] uppercase"
                            >
                              {boost.sport}
                            </Badge>
                          </div>
                          <div className="flex items-start justify-between gap-1 min-w-0">
                            <div className="min-w-0">
                              <div className="font-medium text-xs sm:text-sm truncate">
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
                                <span className="terminal-label text-[10px]">Boosts</span>
                                <span className="font-mono text-chart-4 font-medium">
                                  {boost.shareMultiplier}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="terminal-label text-[10px]">Total</span>
                                <span className="font-mono font-bold text-primary">
                                  {(
                                    parseFloat(boost.shareMultiplier) *
                                    (tier + boost.communityBoostCount)
                                  ).toFixed(2)}
                                </span>
                                {boost.communityBoostCount > 0 && (
                                  <span className="font-mono text-[10px] text-status-warning">
                                    ({tier}+{boost.communityBoostCount}x)
                                  </span>
                                )}
                              </div>
                            </div>
                            {boost.status === "active" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="terminalOutline"
                                    onClick={(e) => e.stopPropagation()}
                                    disabled={removeBoostMutation.isPending}
                                    className="h-6 w-6 shrink-0"
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove boost?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will free up the {label} slot. The share will be returned
                                      to your portfolio.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => removeBoostMutation.mutate(boost.id)}
                                    >
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                          {boost.communityBoostCount > 0 && (
                            <div className="flex items-center gap-1">
                              <Badge className="terminal-status-warning h-5 px-1.5 font-mono text-[10px] uppercase">
                                <Zap className="w-3 h-3 mr-0.5" />+{boost.communityBoostCount}
                              </Badge>
                            </div>
                          )}
                          {/* Status and Live Fantasy Points */}
                          {boost.status === "active" && (
                            <Badge
                              variant="secondary"
                              className="w-full justify-center font-mono text-[10px] uppercase"
                            >
                              <Clock className="w-3 h-3 mr-1" />
                              {gameCountdown ? `Tipoff ${gameCountdown}` : "Waiting"}
                            </Badge>
                          )}
                          {boost.status === "locked" &&
                            boost.liveFantasyPoints !== null &&
                            boost.liveFantasyPoints !== undefined && (
                              <div className="space-y-1.5 sm:space-y-2">
                                <Badge className="terminal-status-warning w-full justify-center font-mono text-[10px] uppercase animate-pulse">
                                  Live
                                </Badge>

                                {/* Enhanced Live Fantasy Points Display */}
                                <div className="flex justify-center">
                                  <LiveFantasyPoints
                                    points={boost.liveFantasyPoints}
                                    multiplier={tier + boost.communityBoostCount}
                                    shareMultiplier={parseFloat(boost.shareMultiplier)}
                                    className="w-full max-w-[180px]"
                                  />
                                </div>

                                {boost.liveGameStats && (
                                  <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground pt-1">
                                    <span>{boost.liveGameStats.points} pts</span>
                                    <span>|</span>
                                    <span>{boost.liveGameStats.rebounds} reb</span>
                                    <span>|</span>
                                    <span>{boost.liveGameStats.assists} ast</span>
                                  </div>
                                )}
                              </div>
                            )}
                          {boost.status === "locked" &&
                            (boost.liveFantasyPoints === null ||
                              boost.liveFantasyPoints === undefined) && (
                              <Badge className="terminal-status-warning w-full justify-center font-mono text-[10px] uppercase">
                                Live
                              </Badge>
                            )}
                          {boost.status === "processed" && (
                            <Badge className="terminal-status-positive w-full justify-center font-mono text-[10px] uppercase">
                              ${boost.payout}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <div className="py-3 text-center">
                          {isAvailable ? (
                            <div className="terminal-subtle">
                              <Zap className="w-4 h-4 mx-auto mb-1 opacity-50" />
                              Tap to add
                            </div>
                          ) : (
                            <span className="terminal-subtle">Unavailable</span>
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
          <Card variant="terminal" className="mb-2 sm:mb-3">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="terminal-heading text-sm flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Community Boosts
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="terminal"
                    onClick={() => setCommunityBoostSelectorOpen(true)}
                    disabled={userPremiumShares === 0}
                    title={
                      userPremiumShares === 0
                        ? "Premium shares required to add community boosts"
                        : undefined
                    }
                    className="h-7 px-2"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                  <div className="hidden items-center gap-1 sm:flex">
                    {COMMUNITY_FILTER_SPORTS.map((sport) => (
                      <Button
                        key={sport}
                        size="sm"
                        variant={communitySportFilter === sport ? "terminal" : "terminalOutline"}
                        onClick={() => setCommunitySportFilter(sport)}
                        className="h-7 px-2"
                      >
                        {sport}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 sm:hidden">
                {COMMUNITY_FILTER_SPORTS.map((sport) => (
                  <Button
                    key={sport}
                    size="sm"
                    variant={communitySportFilter === sport ? "terminal" : "terminalOutline"}
                    onClick={() => setCommunitySportFilter(sport)}
                    className="h-7 px-2"
                  >
                    {sport}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredCommunityBoosts.length === 0 ? (
                <div className="terminal-empty py-6 text-center text-sm text-muted-foreground">
                  No community boosts today
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredCommunityBoosts.map((cb) => (
                    <div key={cb.playerId} className="p-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="terminal-avatar shrink-0 text-status-warning">
                          <span>
                            {cb.player.firstName[0]}
                            {cb.player.lastName[0]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-xs sm:text-sm truncate">
                            <PlayerName
                              playerId={cb.player.id}
                              firstName={cb.player.firstName}
                              lastName={cb.player.lastName}
                              className="text-sm"
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                            <span>{cb.player.team}</span>
                            <span>|</span>
                            <Badge
                              variant="outline"
                              className="h-4 px-1 font-mono text-[10px] uppercase"
                            >
                              {cb.sport}
                            </Badge>
                            <span>|</span>
                            <Badge className="terminal-status-warning h-5 px-1.5 font-mono text-[10px] uppercase">
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
          <Card variant="terminal">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="terminal-heading text-sm flex items-center gap-2">
                  <History className="w-4 h-4" />
                  Payouts
                </CardTitle>
                <div className="flex items-center gap-2">
                  {processedBoostResults.length > 0 && (
                    <Button
                      size="sm"
                      variant="terminalOutline"
                      onClick={openResultsPodium}
                      className="h-7 px-2"
                    >
                      <Trophy className="mr-1 h-3 w-3" />
                      Results
                    </Button>
                  )}
                  {historyData && (
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                      Total: ${historyData.totalEarned}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!historyData?.payouts || historyData.payouts.length === 0 ? (
                <div className="terminal-empty py-8 text-center text-sm text-muted-foreground">
                  No payouts yet
                </div>
              ) : (
                <div className="max-h-[300px] divide-y divide-border overflow-y-auto">
                  {historyData.payouts.map((payout) => (
                    <div key={payout.id} className="p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-xs sm:text-sm truncate">
                          {payout.player && (
                            <PlayerName
                              playerId={payout.player.id}
                              firstName={payout.player.firstName}
                              lastName={payout.player.lastName}
                              className="text-sm"
                            />
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {payout.sharesUsed} x {payout.fantasyPoints} FP x {payout.multiplier}x |{" "}
                          {format(new Date(payout.createdAt), "MMM d")}
                        </div>
                      </div>
                      <span className="font-mono font-bold text-market-positive shrink-0">
                        +${payout.payoutAmount}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Player Selector Sheet */}
          <Sheet
            open={playerSelectorOpen}
            onOpenChange={(open) => {
              setPlayerSelectorOpen(open);
              if (!open) {
                setSearch("");
                setSelectedSlot(null);
              }
            }}
          >
            <SheetContent
              side="bottom"
              className="max-h-[80vh] flex flex-col rounded-t-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <SheetHeader>
                <SheetTitle className="terminal-heading text-base">Select Player</SheetTitle>
                <SheetDescription className="terminal-subtle text-[11px] uppercase">
                  Choose a player for {MULTIPLIER_SLOTS.find((s) => s.tier === selectedSlot)?.label}{" "}
                  slot
                </SheetDescription>
              </SheetHeader>

              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  variant="terminal"
                  placeholder="Search players..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>

              {preselectIneligibleMsg && (
                <div className="mb-2 rounded-compact border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                  {preselectIneligibleMsg}
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {loadingEligible ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Loading...</div>
                ) : eligibleError ? (
                  <div className="py-8 text-center text-destructive text-sm">
                    <div className="font-medium mb-2">Server Error</div>
                    <div className="mb-2 max-h-32 overflow-auto border border-market-negative/20 bg-destructive/10 p-2 font-mono text-xs">
                      {eligibleError.message}
                    </div>
                    <Button
                      size="sm"
                      variant="terminalOutline"
                      onClick={() => refetchEligible()}
                      className="mt-2"
                    >
                      Retry
                    </Button>
                  </div>
                ) : !eligibleData?.eligiblePlayers || eligibleData.eligiblePlayers.length === 0 ? (
                  <div className="terminal-empty py-8 text-center text-sm text-muted-foreground">
                    No players held
                    <br />
                    <Button
                      size="sm"
                      variant="terminalOutline"
                      onClick={() => refetchEligible()}
                      className="mt-2"
                    >
                      Refresh
                    </Button>
                  </div>
                ) : filteredPlayers.length === 0 ? (
                  <div className="terminal-empty py-8 text-center text-sm text-muted-foreground">
                    {search ? `No players match "${search}"` : "No players available for boosting"}
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredPlayers.map((ep) => {
                      const hasStackedShare = parseFloat(ep.multiplier || "0") > 1;
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
                            "flex items-center justify-between gap-2 p-3",
                            ep.gameStatus === "live" && "bg-premium/5",
                            ep.gameStatus === "ended" && "bg-muted/20",
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="terminal-avatar shrink-0">
                              <span className="text-xs font-bold">
                                {ep.player.firstName[0]}
                                {ep.player.lastName[0]}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-xs sm:text-sm truncate">
                                <PlayerName
                                  playerId={ep.player.id}
                                  firstName={ep.player.firstName}
                                  lastName={ep.player.lastName}
                                  className="text-sm"
                                />
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 font-mono text-[10px] uppercase"
                                >
                                  {ep.sport}
                                </Badge>
                                <span>{ep.player.team}</span>
                                <span>|</span>
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {ep.totalShares} shares ({ep.availableShares} avail)
                                </span>
                                {hasStackedShare && (
                                  <>
                                    <span>|</span>
                                    <span className="font-mono text-[11px] text-chart-4">
                                      MULTI {ep.bestShareMultiplier}/share
                                    </span>
                                  </>
                                )}
                                {/* Game status indicator */}
                                {!ep.hasGameToday && (
                                  <>
                                    <span>|</span>
                                    <Badge
                                      variant="secondary"
                                      className="h-4 px-1 font-mono text-[10px] uppercase"
                                    >
                                      No game
                                    </Badge>
                                  </>
                                )}
                                {ep.hasGameToday &&
                                  ep.gameStatus === "upcoming" &&
                                  ep.gameStartTime && (
                                    <>
                                      <span>|</span>
                                      <Badge className="h-4 border border-chart-2/30 bg-chart-2/10 px-1 font-mono text-[10px] uppercase text-chart-2">
                                        {format(new Date(ep.gameStartTime), "h:mm a")}
                                      </Badge>
                                    </>
                                  )}
                                {ep.hasGameToday && ep.gameStatus === "live" && (
                                  <>
                                    <span>|</span>
                                    <Badge className="terminal-status-warning h-4 px-1 font-mono text-[10px] uppercase animate-pulse">
                                      Live
                                    </Badge>
                                  </>
                                )}
                                {ep.hasGameToday && ep.gameStatus === "ended" && (
                                  <>
                                    <span>|</span>
                                    <Badge
                                      variant="secondary"
                                      className="h-4 px-1 font-mono text-[10px] uppercase"
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
                              <Badge className="terminal-status-positive px-1.5 font-mono text-[10px] uppercase">
                                <Zap className="w-3 h-3 mr-0.5" />
                                Boosted
                              </Badge>
                            ) : canBoost ? (
                              <Button
                                size="sm"
                                variant="terminal"
                                onClick={() => handleAssignBoost(ep.playerId, ep.sport)}
                                disabled={assignBoostMutation.isPending}
                                className="h-8"
                              >
                                <Zap className="w-3 h-3 mr-1" />
                                {MULTIPLIER_SLOTS.find((s) => s.tier === selectedSlot)?.label}
                              </Button>
                            ) : ep.hasGameToday && ep.gameStatus === "live" ? (
                              <Badge className="terminal-status-warning px-1.5 font-mono text-[10px] uppercase">
                                Live
                              </Badge>
                            ) : ep.hasGameToday && ep.gameStatus === "ended" ? (
                              <Badge
                                variant="secondary"
                                className="px-1.5 font-mono text-[10px] uppercase"
                              >
                                Ended
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="px-1.5 font-mono text-[10px] uppercase text-muted-foreground"
                              >
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
            </SheetContent>
          </Sheet>

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
            results={processedBoostResults}
            totalPayout={parseFloat(historyData?.totalEarned || "0")}
            onClose={() => setResultsPodiumOpen(false)}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}

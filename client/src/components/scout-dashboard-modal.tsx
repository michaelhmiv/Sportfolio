/**
 * Scout Dashboard Modal
 *
 * Central hub for managing scout assignments.
 * REFACTORED: Hybrid Server/Client Data Handling.
 * Uses server-side pagination for market directory (fast load).
 * Uses client-side sorting for user-specific lists (My Scouts/Shares).
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useScout } from "@/lib/scout-context";
import { useWebSocket } from "@/lib/websocket";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Binoculars,
  TrendingUp,
  Search,
  Plus,
  Minus,
  ArrowUpDown,
  Loader2,
  Info,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { useLocation } from "wouter";
import type { Player } from "@shared/schema";
import { PlayerName } from "@/components/player-name";
import { appendPlayerSearchParam, matchesPlayerSearch } from "@/lib/player-search";

// --- Types ---
interface ScoutAssignment {
  id: string;
  playerId: string;
  scoutCount: number;
  globalScoutCount: number;
  player?: Player | null; // Enriched by backend
}

interface ScoutData {
  assignments: ScoutAssignment[];
  totalScouts: number;
  maxScouts: number;
  remaining: number;
  isPremium: boolean;
  premiumActive?: boolean;
  rewardedScoutBoostActive?: boolean;
  rewardedScoutBoostExpiresAt?: string | null;
}

interface Holding {
  playerId: string;
  quantity: number;
  player: Player; // Enriched by backend
}

interface PlayerWithStats extends Player {
  avgFantasyPointsPerGame?: string;
  globalScoutCount: number;
  gameStatus?: "none" | "upcoming" | "live" | "ended";
  gameStartTime?: string | null;
  isGameLocked?: boolean;
}

interface PlayerWithScoutData extends PlayerWithStats {
  scoutCount: number;
  sharesOwned: number;
  fpts: number;
  price: number;
  change: number;
  volume: number;
  mcap: number;
  yield: number;
}

interface ScoutRosterEntry {
  user: { id: string; username: string | null; avatarUrl: string | null } | null;
  scoutCount: number;
}

type SortField =
  | "name"
  | "team"
  | "price"
  | "shares"
  | "scouts"
  | "fantasyPoints"
  | "change"
  | "volume"
  | "marketCap";
type SortDirection = "asc" | "desc";

// --- Sub-Component: Scout Roster ---
function ScoutRoster({ playerId, globalTotal }: { playerId: string; globalTotal: number }) {
  const { data: roster, isLoading } = useQuery<ScoutRosterEntry[]>({
    queryKey: [`/api/scouts/roster/${playerId}`],
    staleTime: 1000 * 60, // 1 minute
  });

  const { data: dbDebug } = useQuery<any>({ queryKey: ["/api/debug/db-check"] });

  if (isLoading)
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
        Loading scouts...
      </div>
    );
  if (!roster || roster.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        No active scouts found.
        <br />
        <span className="text-[10px] opacity-50">
          ID: {playerId} | Global: {globalTotal}
          <br />
          DB Count (Cade): {dbDebug?.scoutAssignmentsCount ?? "?"}
        </span>
      </div>
    );
  }

  return (
    <div className="p-3">
      <h4 className="text-xs font-semibold mb-2 flex items-center justify-between">
        <span>Top Scouts</span>
        <span className="text-muted-foreground font-normal">{globalTotal} Total</span>
      </h4>
      <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
        {roster.map((entry, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted/50"
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-4 text-right">{idx + 1}.</span>
              <Avatar className="h-5 w-5 border">
                <AvatarFallback className="text-[9px]">
                  {entry.user?.username?.[0] || "?"}
                </AvatarFallback>
              </Avatar>
              <span className="font-medium truncate max-w-[100px]">
                {entry.user?.username || "Unknown User"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold">{entry.scoutCount}</span>
              <span className="text-[10px] text-muted-foreground w-12 text-right">
                {((entry.scoutCount / globalTotal) * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Sub-Component: How It Works Popover ---
function HowItWorks() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-amber-600"
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4 text-xs space-y-3" align="end">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <Binoculars className="h-4 w-4 text-amber-600" />
          How Scouting Works
        </h4>
        <div className="space-y-2 text-muted-foreground">
          <p>
            <strong className="text-foreground">Goal:</strong> Earn free shares of players by
            scouting them.
          </p>
          <p>
            <strong className="text-foreground">Mechanic:</strong> Every player mints{" "}
            <span className="text-green-600 font-bold">60 shares per hour</span>.
          </p>
          <p>
            <strong className="text-foreground">Your Reward:</strong> You split these 60 shares with
            other scouts based on how many scouts you assign.
          </p>
          <div className="bg-muted/50 p-2 rounded border font-mono text-[10px] text-center">
            (Your Scouts / Total Scouts) × 60 = Hourly Shares
          </div>
          <p>
            <span className="text-amber-600 font-medium">Strategy:</span> Scout "hidden gems" with
            few other scouts to get a larger slice of the pie!
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Main Component ---
export function ScoutDashboardModal() {
  const { isScoutDashboardOpen, closeScoutDashboard } = useScout();
  const { toast } = useToast();
  const { subscribe } = useWebSocket();
  const [, navigate] = useLocation();

  // Listen for real-time scout updates
  useEffect(() => {
    const unsubscribe = subscribe("scout_update", (message: any) => {
      if (message.type === "scout_update") {
        // Refresh relevant queries when any user updates scouts
        const { playerId } = message.data;

        // 1. Refresh specific roster
        queryClient.invalidateQueries({ queryKey: [`/api/scouts/roster/${playerId}`] });

        // 2. Refresh global market data (counts)
        // Use predicate to match ALL variants of the query (different filters/sorts)
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0];
            return typeof key === "string" && key.startsWith("/api/players");
          },
        });

        // 3. Refresh user's own scout data (to ensure sync)
        queryClient.invalidateQueries({ queryKey: ["/api/scouts"] });
      }

      if (message.type === "scout_payout") {
        // Refresh portfolio to show new shares
        queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
        toast({
          title: "Shares Distributed",
          description: "You've earned new shares from your scouts!",
        });
      }
    });
    return unsubscribe;
  }, [subscribe]);

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [positionFilter] = useState<string>("ALL");
  const [gameStatusFilter, setGameStatusFilter] = useState<string>("all"); // Filter by game status
  const [sortField, setSortField] = useState<SortField>("volume");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [limit, setLimit] = useState(50); // Server-side paging limit
  const [activeTab, setActiveTab] = useState<string>("market");

  // Expanded rows state (for Scout Roster)
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);

  // Reset pagination when filters change (but preserve sortField on tab change to allow consistent sorting)
  useEffect(() => {
    setLimit(50);
  }, [searchQuery, sportFilter, positionFilter, gameStatusFilter, sortDirection]);

  // 1. Fetch Scout Data
  const { data: scoutData, isLoading: isLoadingScouts } = useQuery<ScoutData>({
    queryKey: ["/api/scouts"],
    enabled: isScoutDashboardOpen,
  });

  // 1b. Fetch Scout Status (Timer)
  const { data: scoutStatus } = useQuery<{
    earnedMinutes: number;
    nextDistribution: string;
    perPlayer?: Record<string, number>;
  }>({
    queryKey: ["/api/scouts/status"],
    enabled: isScoutDashboardOpen,
    refetchInterval: 30000,
  });

  // 1c. Fetch today's games for all sports (for game status)
  const { data: todaysGames } = useQuery<
    Array<{
      gameId: string;
      homeTeam: string;
      awayTeam: string;
      startTime: string;
      status: string;
      sport: string;
    }>
  >({
    queryKey: ["/api/games/today"],
    queryFn: async () => {
      // Fetch games for all supported Ball Don't Lie sports
      const [nbaRes, nflRes, mlbRes] = await Promise.all([
        fetch("/api/games/today?sport=NBA"),
        fetch("/api/games/today?sport=NFL"),
        fetch("/api/games/today?sport=MLB"),
      ]);
      const [nbaGames, nflGames, mlbGames] = await Promise.all([
        nbaRes.json(),
        nflRes.json(),
        mlbRes.json(),
      ]);
      return [...(nbaGames || []), ...(nflGames || []), ...(mlbGames || [])];
    },
    enabled: isScoutDashboardOpen,
    refetchInterval: 60000, // Refresh every minute
  });

  // 2. Fetch User Portfolio
  const { data: portfolioData } = useQuery<{ holdings: Holding[] }>({
    queryKey: ["/api/portfolio"],
    enabled: isScoutDashboardOpen,
  });

  // 3. Fetch Market Directory
  const isClientSort = ["scouts", "shares"].includes(sortField) || activeTab === "scouts";
  const needsFullMarketSet = activeTab === "market" && gameStatusFilter !== "all";

  const playerQueryUrl = useMemo(() => {
    const params = new URLSearchParams();
    // Game status is filtered client-side, so fetch full set to avoid subset-only results.
    params.set("limit", needsFullMarketSet ? "5000" : limit.toString());

    appendPlayerSearchParam(params, searchQuery);
    if (sportFilter !== "all") params.set("sport", sportFilter);
    if (positionFilter !== "ALL") params.set("position", positionFilter);

    // Always pass user's sort preference to API for consistent behavior
    params.set("sortBy", sortField);
    params.set("sortOrder", sortDirection);

    return `/api/players?${params.toString()}`;
  }, [
    searchQuery,
    sportFilter,
    positionFilter,
    sortField,
    sortDirection,
    limit,
    needsFullMarketSet,
  ]);

  const { data: playersData, isLoading: isLoadingPlayers } = useQuery<{
    players: PlayerWithStats[];
    total: number;
  }>({
    queryKey: [playerQueryUrl],
    enabled: isScoutDashboardOpen,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ playerId, count }: { playerId: string; count: number }) => {
      return apiRequest("POST", "/api/scouts/assign", { playerId, count });
    },
    onMutate: async (newAssignment) => {
      await queryClient.cancelQueries({ queryKey: ["/api/scouts"] });
      const previousScoutData = queryClient.getQueryData<ScoutData>(["/api/scouts"]);

      if (previousScoutData) {
        const updatedAssignments = [...previousScoutData.assignments];
        const index = updatedAssignments.findIndex((a) => a.playerId === newAssignment.playerId);
        const delta = newAssignment.count - (index >= 0 ? updatedAssignments[index].scoutCount : 0);

        if (index >= 0) {
          if (newAssignment.count === 0) {
            updatedAssignments.splice(index, 1);
          } else {
            updatedAssignments[index] = {
              ...updatedAssignments[index],
              scoutCount: newAssignment.count,
              globalScoutCount: updatedAssignments[index].globalScoutCount + delta,
            };
          }
        } else if (newAssignment.count > 0) {
          updatedAssignments.push({
            id: "temp-" + Date.now(),
            playerId: newAssignment.playerId,
            scoutCount: newAssignment.count,
            globalScoutCount: newAssignment.count,
            player: null,
          });
        }

        queryClient.setQueryData<ScoutData>(["/api/scouts"], {
          ...previousScoutData,
          assignments: updatedAssignments,
          totalScouts: previousScoutData.totalScouts + delta,
          remaining: previousScoutData.remaining - delta,
        });
      }
      return { previousScoutData };
    },
    onError: (err, newAssignment, context) => {
      if (context?.previousScoutData) {
        queryClient.setQueryData(["/api/scouts"], context.previousScoutData);
      }
      toast({
        title: "Failed to update scouts",
        description: (err as any).message || "Please try again",
        variant: "destructive",
      });
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/players"] });
      if (variables) {
        queryClient.invalidateQueries({ queryKey: [`/api/scouts/roster/${variables.playerId}`] });
      }
    },
  });

  const totalScouts = scoutData?.totalScouts || 0;
  const maxScouts = scoutData?.maxScouts || 5;
  const remaining = scoutData?.remaining || 0;
  const premiumActive = scoutData?.premiumActive ?? scoutData?.isPremium ?? false;
  const rewardedScoutBoostActive = scoutData?.rewardedScoutBoostActive || false;
  const assignments = scoutData?.assignments || [];

  // Helper to compute game status for a player
  const getGameStatusForPlayer = (
    playerTeam: string,
    playerSport: string,
  ): { status: "none" | "upcoming" | "live" | "ended"; startTime: string | null } => {
    if (!todaysGames) return { status: "none", startTime: null };

    const sportCode = (playerSport || "").toUpperCase();
    const game = todaysGames.find(
      (g) =>
        (g.sport || "").toUpperCase() === sportCode &&
        (g.homeTeam === playerTeam || g.awayTeam === playerTeam),
    );

    if (!game) return { status: "none", startTime: null };

    const now = new Date();
    const gameStartTime = new Date(game.startTime);
    const gameDbStatus = game.status;

    // Determine game status
    let gameStatus: "none" | "upcoming" | "live" | "ended" = "none";
    if (gameDbStatus === "completed" || gameDbStatus === "ended") {
      gameStatus = "ended";
    } else if (gameDbStatus === "inprogress") {
      gameStatus = "live";
    } else {
      // scheduled or unknown - check time
      const timeSinceStart = now.getTime() - gameStartTime.getTime();
      const threeHoursInMs = 3 * 60 * 60 * 1000;
      if (timeSinceStart >= threeHoursInMs) {
        gameStatus = "ended"; // Likely ended but sync hasn't caught up
      } else {
        gameStatus = "upcoming";
      }
    }

    return { status: gameStatus, startTime: game.startTime };
  };

  // Compute List for Display with game status
  const displayedPlayers = useMemo(() => {
    const assignmentMap = new Map(assignments.map((a) => [a.playerId, a.scoutCount]));
    const globalScoutMap = new Map(assignments.map((a) => [a.playerId, a.globalScoutCount]));
    const holdingMap = new Map(portfolioData?.holdings.map((h) => [h.playerId, h.quantity]));

    let rawList: (PlayerWithStats & { scoutCount: number; sharesOwned: number })[] = [];

    if (activeTab === "scouts") {
      const scoutedPlayers = assignments
        .filter((a) => a.player)
        .map((a) => ({
          ...a.player!,
          scoutCount: a.scoutCount,
          globalScoutCount: a.globalScoutCount,
          sharesOwned: holdingMap.get(a.playerId) || 0,
          avgFantasyPointsPerGame: (a.player as any).avgFantasyPointsPerGame || "0",
        }));

      rawList = scoutedPlayers.filter((p) => {
        if (sportFilter !== "all" && p.sport !== sportFilter) return false;
        if (positionFilter !== "ALL" && p.position !== positionFilter) return false;
        if (!matchesPlayerSearch(p, searchQuery)) return false;
        return true;
      });

      rawList.sort((a, b) => {
        let valA: any = 0;
        let valB: any = 0;

        if (sortField === "scouts") {
          valA = a.scoutCount;
          valB = b.scoutCount;
        } else if (sortField === "shares") {
          valA = a.sharesOwned;
          valB = b.sharesOwned;
        } else if (sortField === "price") {
          valA = parseFloat(a.currentPrice || "0");
          valB = parseFloat(b.currentPrice || "0");
        } else if (sortField === "marketCap") {
          valA = parseFloat(a.marketCap || "0");
          valB = parseFloat(b.marketCap || "0");
        } else if (sortField === "volume") {
          valA = a.volume24h || 0;
          valB = b.volume24h || 0;
        } else if (sortField === "fantasyPoints") {
          valA = parseFloat(a.avgFantasyPointsPerGame || "0");
          valB = parseFloat(b.avgFantasyPointsPerGame || "0");
        } else if (sortField === "name") {
          valA = a.firstName;
          valB = b.firstName;
        } else {
          valA = a.volume24h || 0;
          valB = b.volume24h || 0;
        }

        if (typeof valA === "string" && typeof valB === "string") {
          return sortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return sortDirection === "asc"
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      });
    } else {
      const isLocalPortfolioView = sortField === "shares";

      if (isLocalPortfolioView) {
        const heldPlayers =
          portfolioData?.holdings
            .filter((h) => h.player)
            .map((h) => ({
              ...h.player,
              scoutCount: assignmentMap.get(h.playerId) || 0,
              globalScoutCount: globalScoutMap.get(h.playerId) || 0,
              sharesOwned: h.quantity,
              avgFantasyPointsPerGame: (h.player as any).avgFantasyPointsPerGame || "0",
            })) || [];

        rawList = heldPlayers.filter((p) => {
          if (sportFilter !== "all" && p.sport !== sportFilter) return false;
          if (positionFilter !== "ALL" && p.position !== positionFilter) return false;
          if (!matchesPlayerSearch(p, searchQuery)) return false;
          return true;
        });

        rawList.sort((a, b) =>
          sortDirection === "asc" ? a.sharesOwned - b.sharesOwned : b.sharesOwned - a.sharesOwned,
        );
      } else {
        if (!playersData?.players) return [];

        rawList = playersData.players.map((p) => ({
          ...p,
          scoutCount: assignmentMap.get(p.id) || 0,
          globalScoutCount: (p as any).globalScoutCount || 0,
          sharesOwned: holdingMap.get(p.id) || 0,
        }));
      }
    }

    // Add game status to each player first
    // Use lastTradePrice for display (actual market price), fallback to currentPrice
    const playersWithGameStatus = rawList.map((p): PlayerWithScoutData => {
      const gameInfo = getGameStatusForPlayer(p.team, p.sport);
      // Prefer lastTradePrice (actual trades) over currentPrice (placeholder/default)
      const displayPrice = (p as any).lastTradePrice || p.currentPrice || "0";
      return {
        ...p,
        fpts: parseFloat(p.avgFantasyPointsPerGame || "0"),
        price: parseFloat(displayPrice),
        change: parseFloat(p.priceChange24h || "0"),
        volume: p.volume24h || 0,
        mcap: parseFloat(p.marketCap || "0"),
        yield: p.globalScoutCount > 0 ? (p.scoutCount / p.globalScoutCount) * 60 : 0,
        gameStatus: gameInfo.status,
        gameStartTime: gameInfo.startTime,
        isGameLocked: gameInfo.status === "live" || gameInfo.status === "ended",
      };
    });

    // Then filter by game status if not "all"
    if (gameStatusFilter !== "all") {
      return playersWithGameStatus.filter((p) => p.gameStatus === gameStatusFilter);
    }

    return playersWithGameStatus;
  }, [
    playersData?.players,
    assignments,
    portfolioData,
    todaysGames,
    sortField,
    sortDirection,
    activeTab,
    searchQuery,
    sportFilter,
    positionFilter,
    gameStatusFilter,
  ]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(["name", "team"].includes(field) ? "asc" : "desc");
    }
  };

  const handleAdjustScout = (playerId: string, currentCount: number, delta: number) => {
    if (delta > 0 && remaining === 0) {
      toast({
        title: "Capacity Reached",
        description: premiumActive
          ? "Max premium scouts used."
          : rewardedScoutBoostActive
            ? "Your rewarded scout boost is fully allocated."
            : "Watch a rewarded ad on Android or redeem Premium for more scouts.",
        variant: "destructive",
      });
      return;
    }
    if (delta < 0 && currentCount === 0) return;
    assignMutation.mutate({ playerId, count: currentCount + delta });
  };

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
  };

  const getDeltaColor = (val: number) =>
    val > 0 ? "text-green-500" : val < 0 ? "text-red-500" : "text-muted-foreground";

  return (
    <Dialog open={isScoutDashboardOpen} onOpenChange={(open) => !open && closeScoutDashboard()}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden h-[85vh] flex flex-col">
        {/* Header */}
        <DialogHeader className="p-4 pb-2 border-b bg-muted/10 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-1.5">
                <Binoculars className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <DialogTitle className="text-lg flex items-center gap-2">
                  Scout Command
                  <HowItWorks />
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Deploy scouts to earn shares.
                </DialogDescription>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => {
                closeScoutDashboard();
                navigate("/agent");
              }}
            >
              <Sparkles className="h-4 w-4" />
              Open Agent
            </Button>
          </div>
          {/* Compact Capacity Bar & Status */}
          <div className="bg-card border rounded-md p-2 shadow-sm space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <span
                  className={cn(
                    "font-bold text-base",
                    remaining === 0 ? "text-amber-600" : "text-foreground",
                  )}
                >
                  {totalScouts}
                </span>
                <span className="text-muted-foreground">/ {maxScouts} Assigned</span>
              </span>
            </div>
            <Progress
              value={(totalScouts / maxScouts) * 100}
              className="h-1.5"
              indicatorClassName={cn("bg-amber-500", remaining === 0 && "animate-pulse")}
            />
          </div>
        </DialogHeader>

        {/* Toolbar */}
        <div className="p-3 border-b flex flex-col gap-3 bg-muted/30 shrink-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-9">
              <TabsTrigger value="market" className="text-xs gap-2">
                <Search className="h-3.5 w-3.5" />
                Global Market
              </TabsTrigger>
              <TabsTrigger value="scouts" className="text-xs gap-2">
                <Binoculars className="h-3.5 w-3.5" />
                My Active Scouts ({assignments.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[140px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search players..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>

            <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="volume">Volume</SelectItem>
                <SelectItem value="marketCap">Mkt Cap</SelectItem>
                <SelectItem value="price">Price</SelectItem>
                <SelectItem value="change">24h Change</SelectItem>
                <SelectItem value="fantasyPoints">Fantasy Pts</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="shares">Owned</SelectItem>
                <SelectItem value="scouts">Scouts</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleSortDirection}
                className="h-8 w-8 shrink-0"
              >
                <ArrowUpDown className={cn("h-4 w-4", sortDirection === "asc" && "rotate-180")} />
              </Button>

              <Select value={sportFilter} onValueChange={setSportFilter}>
                <SelectTrigger className="w-[80px] h-8 text-xs">
                  <SelectValue placeholder="Sport" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="NBA">NBA</SelectItem>
                  <SelectItem value="NFL">NFL</SelectItem>
                  <SelectItem value="MLB">MLB</SelectItem>
                  <SelectItem value="NASCAR">NASCAR</SelectItem>
                </SelectContent>
              </Select>

              <Select value={gameStatusFilter} onValueChange={setGameStatusFilter}>
                <SelectTrigger className="w-[100px] h-8 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Games</SelectItem>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="live">Live Now</SelectItem>
                  <SelectItem value="ended">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-card">
          <div className="w-full">
            <div className="px-4 py-2 bg-muted/20 border-b text-[10px] text-muted-foreground flex justify-between items-center">
              <span>
                {activeTab === "scouts"
                  ? `Showing your ${displayedPlayers.length} active scouts`
                  : sortField === "shares"
                    ? `Showing your ${displayedPlayers.length} holdings`
                    : `Showing top ${displayedPlayers.length} of ${playersData?.total || 0} market players by ${sortField}`}
              </span>
              {activeTab === "market" &&
                sortField !== "shares" &&
                playersData?.total &&
                playersData.total > limit && (
                  <span className="text-amber-600 font-medium animate-pulse">
                    Scroll to load more
                  </span>
                )}
            </div>
            {/* Table Header */}
            <div className="sticky top-0 z-20 bg-muted/80 backdrop-blur-sm border-b font-medium text-xs text-muted-foreground flex items-center px-2 py-2">
              <div className="w-8"></div> {/* Expand Toggle Column */}
              <div
                className="flex-1 pl-2 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("name")}
              >
                Player
              </div>
              {/* Dynamic Sort Column - shows the currently selected sort field */}
              <div
                className={cn(
                  "w-20 sm:w-24 text-right cursor-pointer hover:text-foreground",
                  sortField !== "name" && "text-foreground font-semibold",
                )}
                onClick={() => handleSort(sortField === "name" ? "volume" : sortField)}
              >
                {sortField === "volume"
                  ? "Vol"
                  : sortField === "marketCap"
                    ? "Mkt Cap"
                    : sortField === "price"
                      ? "Price"
                      : sortField === "change"
                        ? "24h %"
                        : sortField === "fantasyPoints"
                          ? "FPTS"
                          : sortField === "shares"
                            ? "Owned"
                            : sortField === "scouts"
                              ? "Scouts"
                              : sortField === "name"
                                ? "Name"
                                : "Value"}
              </div>
              {activeTab === "market" && (
                <div
                  className="w-14 sm:w-16 text-right cursor-pointer hover:text-foreground hidden sm:block"
                  onClick={() => handleSort("change")}
                >
                  24h %
                </div>
              )}
              <div className="w-14 sm:w-16 text-right hidden sm:block">Owned</div>
              <div className="w-14 sm:w-16 text-right hidden sm:block">Earned</div>
              <div className="w-14 sm:w-16 text-center">Status</div>
              <div
                className="w-20 sm:w-28 text-center cursor-pointer hover:text-foreground"
                onClick={() => handleSort("scouts")}
              >
                Scouts
              </div>
            </div>

            {/* Table Body */}
            <div className="divide-y relative">
              {isLoadingPlayers || isLoadingScouts ? (
                <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center">
                  <Loader2 className="h-6 w-6 animate-spin mb-2" />
                  Loading market data...
                </div>
              ) : displayedPlayers.length === 0 ? (
                <div className="py-20 text-center text-muted-foreground flex flex-col items-center gap-3 bg-muted/10 shrink-0 border-b">
                  <div className="rounded-sm border bg-background p-3 shadow-none">
                    <Search className="h-5 w-5 opacity-40" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">No players found</p>
                    <p className="text-[10px] opacity-70 px-4 max-w-[200px] mx-auto">
                      Try adjusting your filters or search query.
                    </p>
                  </div>
                </div>
              ) : (
                displayedPlayers.map((player: PlayerWithScoutData) => (
                  <div
                    key={player.id}
                    className="group flex flex-col transition-colors border-b last:border-0"
                  >
                    <div
                      className={cn(
                        "flex items-center px-2 py-1.5 transition-colors text-sm",
                        // Live/ended games get priority highlighting
                        player.gameStatus === "live" &&
                          "bg-red-50 dark:bg-red-950/20 border-l-2 border-l-red-500",
                        player.gameStatus === "ended" &&
                          "bg-muted/40 dark:bg-muted/20 border-l-2 border-l-muted-foreground",
                        // Scout highlighting (only for upcoming/no-game players)
                        player.gameStatus !== "live" &&
                          player.gameStatus !== "ended" &&
                          player.scoutCount > 0 &&
                          "bg-amber-50/50 dark:bg-amber-950/10 hover:bg-amber-100/50 dark:hover:bg-amber-950/20",
                        // Regular hover for non-scouted players
                        player.gameStatus !== "live" &&
                          player.gameStatus !== "ended" &&
                          player.scoutCount === 0 &&
                          "hover:bg-muted/40",
                      )}
                    >
                      {/* Expand Toggle */}
                      <div className="w-8 flex justify-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setExpandedPlayerId(expandedPlayerId === player.id ? null : player.id)
                          }
                        >
                          {expandedPlayerId === player.id ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                      </div>

                      {/* Player Info */}
                      <div className="flex-1 flex items-center gap-2 min-w-0 pr-2">
                        <div className="min-w-0 flex-1">
                          <PlayerName
                            playerId={player.id}
                            firstName={player.firstName}
                            lastName={player.lastName}
                            className="font-medium truncate leading-tight hover:underline text-sm sm:text-xs"
                          />
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant="secondary"
                              className="text-[9px] px-0.5 h-3.5 min-w-[20px] justify-center rounded-[3px]"
                            >
                              {player.team}
                            </Badge>
                            <span className="font-mono">{player.position}</span>
                          </div>
                        </div>
                      </div>

                      {/* Dynamic Sort Column Value */}
                      <div className="w-20 sm:w-24 text-right font-mono text-xs tabular-nums">
                        {sortField === "volume" &&
                          (player.volume > 0 ? player.volume.toLocaleString() : "-")}
                        {sortField === "marketCap" &&
                          (player.mcap >= 1000000
                            ? `$${(player.mcap / 1000000).toFixed(1)}M`
                            : player.mcap >= 1000
                              ? `$${(player.mcap / 1000).toFixed(0)}K`
                              : `$${player.mcap.toFixed(0)}`)}
                        {sortField === "price" && `$${player.price.toFixed(2)}`}
                        {sortField === "change" && (
                          <span className={getDeltaColor(player.change)}>
                            {player.change > 0 ? "+" : ""}
                            {player.change.toFixed(1)}%
                          </span>
                        )}
                        {sortField === "fantasyPoints" && player.fpts.toFixed(1)}
                        {sortField === "shares" &&
                          (player.sharesOwned > 0 ? player.sharesOwned.toLocaleString() : "-")}
                        {sortField === "scouts" && player.globalScoutCount}
                        {sortField === "name" && player.team}
                      </div>

                      {activeTab === "market" && (
                        /* Change */
                        <div
                          className={cn(
                            "w-14 sm:w-16 text-right font-mono text-xs tabular-nums hidden sm:block",
                            getDeltaColor(player.change),
                          )}
                        >
                          {player.change > 0 ? "+" : ""}
                          {player.change.toFixed(1)}%
                        </div>
                      )}

                      {/* Owned */}
                      <div className="w-16 sm:w-20 text-right font-mono text-xs tabular-nums hidden sm:block">
                        {player.sharesOwned > 0 ? (
                          <span className="text-blue-600 dark:text-blue-400 font-bold">
                            {player.sharesOwned.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30">-</span>
                        )}
                      </div>

                      {/* Earned Minutes */}
                      <div className="w-14 sm:w-16 text-right font-mono text-xs tabular-nums hidden sm:block text-amber-600 font-medium">
                        {scoutStatus?.perPlayer?.[player.id]
                          ? `${scoutStatus.perPlayer[player.id].toFixed(0)}m`
                          : "-"}
                      </div>

                      {/* Game Status */}
                      <div className="w-14 sm:w-16 text-center">
                        {player.gameStatus === "upcoming" && player.gameStartTime && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1 h-5 border-blue-200 text-blue-600 bg-blue-50"
                          >
                            {format(new Date(player.gameStartTime), "h:mm a")}
                          </Badge>
                        )}
                        {player.gameStatus === "upcoming" && !player.gameStartTime && (
                          <Badge variant="outline" className="text-[9px] px-1 h-5">
                            -
                          </Badge>
                        )}
                        {player.gameStatus === "live" && (
                          <Badge
                            variant="destructive"
                            className="text-[9px] px-1 h-5 animate-pulse font-bold"
                          >
                            LIVE
                          </Badge>
                        )}
                        {player.gameStatus === "ended" && (
                          <Badge variant="secondary" className="text-[9px] px-1 h-5">
                            FINAL
                          </Badge>
                        )}
                        {player.gameStatus === "none" && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1 h-5 text-muted-foreground"
                          >
                            --
                          </Badge>
                        )}
                      </div>

                      {/* Scouts Control */}
                      <div className="w-20 sm:w-28 flex items-center justify-center gap-0.5 sm:gap-1 pl-1 sm:pl-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleAdjustScout(player.id, player.scoutCount, -1)}
                          disabled={player.scoutCount === 0 || assignMutation.isPending}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <div
                          className="flex flex-col items-center min-w-[32px] rounded p-0.5 transition-colors cursor-pointer hover:bg-muted/50"
                          onClick={() =>
                            setExpandedPlayerId(expandedPlayerId === player.id ? null : player.id)
                          }
                          title="Click to view all scouts"
                        >
                          <div
                            className={cn(
                              "text-center font-bold text-xs leading-none",
                              player.scoutCount > 0 ? "text-amber-600" : "text-muted-foreground",
                            )}
                          >
                            {player.scoutCount}
                          </div>
                          <div className="text-[9px] text-muted-foreground font-normal leading-none mt-0.5">
                            of {player.globalScoutCount}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleAdjustScout(player.id, player.scoutCount, 1)}
                          disabled={remaining === 0 || assignMutation.isPending}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* EXPANDED DETAILS */}
                    {expandedPlayerId === player.id && (
                      <div className="bg-muted/30 border-t p-2 pl-12 animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <h4 className="text-xs font-semibold flex items-center gap-1.5">
                              <TrendingUp className="h-3 w-3" />
                              Stats
                            </h4>
                            <div className="bg-background border rounded p-2 text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Global Scouts:</span>
                                <span className="font-mono">{player.globalScoutCount}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Your Scouts:</span>
                                <span className="font-mono">
                                  {player.scoutCount} (
                                  {player.globalScoutCount > 0
                                    ? ((player.scoutCount / player.globalScoutCount) * 100).toFixed(
                                        1,
                                      )
                                    : 0}
                                  %)
                                </span>
                              </div>
                              <div className="border-t my-1 pt-1 flex justify-between font-medium items-center">
                                <span>Earned Minutes:</span>
                                <span className="text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 dark:bg-amber-950/30 dark:border-amber-900">
                                  {scoutStatus?.perPlayer?.[player.id] ?? 0} min
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <ScoutRoster
                              playerId={player.id}
                              globalTotal={player.globalScoutCount}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* "Load More" trigger */}
              {!isClientSort && !needsFullMarketSet && (playersData?.total || 0) > limit && (
                <div className="p-2 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground w-full"
                    onClick={() => setLimit((prev) => prev + 50)}
                  >
                    Show More ({Math.max(0, (playersData?.total || 0) - limit)} hidden)
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

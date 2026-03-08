import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Zap,
  X,
  Binoculars,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Shimmer } from "@/components/ui/animations";
import { PlayerModal } from "@/components/player-modal";
import { apiRequest, authenticatedFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { GameInsight, GameInsightDetailResponse } from "@/types/game-insights";

interface GameCommandCenterModalProps {
  gameId: string;
  sport: string;
  date: string;
  initialInsight?: GameInsight | null;
  onClose: () => void;
}

type CommandCenterTab = "pre" | "during" | "post";

type InjuryEntry = GameInsightDetailResponse["injuries"][number];

type LivePlayerStats = {
  playerId?: string;
  name: string;
  position?: string;
  min?: string;
  pts?: number;
  reb?: number;
  ast?: number;
  stl?: number;
  blk?: number;
  fgm?: number;
  fga?: number;
  fg3m?: number;
  fg3a?: number;
  ftm?: number;
  fta?: number;
  pf?: number;
  plusMinus?: number | null;
  turnover?: number;
  fg_pct?: number;
  passingCompletions?: number | null;
  passingAttempts?: number | null;
  passingYards?: number | null;
  passingTDs?: number | null;
  passingInterceptions?: number | null;
  rushingAttempts?: number | null;
  rushingYards?: number | null;
  rushingTDs?: number | null;
  receivingTargets?: number | null;
  receivingYards?: number | null;
  receivingTDs?: number | null;
  receptions?: number | null;
  atBats?: number;
  hits?: number;
  doubles?: number;
  triples?: number;
  homeRuns?: number;
  runs?: number;
  runsBattedIn?: number;
  walks?: number;
  stolenBases?: number;
  strikeoutsBatting?: number;
  inningsPitched?: number;
  pitchingStrikeouts?: number;
  earnedRuns?: number;
  wins?: number;
  saves?: number;
  fantasyPoints?: number;
};

interface LiveStatsResponse {
  gameId: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homePlayers?: LivePlayerStats[];
  awayPlayers?: LivePlayerStats[];
  homeTopPerformers?: Array<{ name: string; pts?: number; reb?: number; ast?: number }>;
  awayTopPerformers?: Array<{ name: string; pts?: number; reb?: number; ast?: number }>;
  userEarnings?: {
    totalEstimatedEarnings: number;
    ownedPlayers: Array<{
      playerId: string;
      name: string;
      team: string;
      quantity: number;
      effectiveShares: number;
      fantasyPoints: number;
      estimatedEarnings: number;
    }>;
  } | null;
  message?: string;
}

interface GameStatsResponse {
  gameId: string;
  homeTeam: {
    players: Array<{
      playerId: string;
      playerName: string;
      fantasyPoints: number;
      points: number;
      rebounds: number;
      assists: number;
    }>;
    totals: Record<string, number> | null;
  };
  awayTeam: {
    players: Array<{
      playerId: string;
      playerName: string;
      fantasyPoints: number;
      points: number;
      rebounds: number;
      assists: number;
    }>;
    totals: Record<string, number> | null;
  };
  topPerformers: {
    topScorer: { playerName: string; points: number };
    topRebounder: { playerName: string; rebounds: number };
    topAssister: { playerName: string; assists: number };
  } | null;
  message?: string;
}

interface ScoutAssignment {
  id: string;
  playerId: string;
  scoutCount: number;
  player?: {
    firstName: string;
    lastName: string;
    team: string;
  } | null;
}

interface ScoutData {
  assignments: ScoutAssignment[];
  totalScouts: number;
  maxScouts: number;
  remaining: number;
  isPremium: boolean;
}

const formatName = (name: string) => {
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : name;
};

const formatCompactName = (name: string) => {
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length <= 1) return parts[0] || name;
  return `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`;
};

const getPlayerIdVariants = (playerId: string, sport?: string) => {
  const rawId = String(playerId || "").trim();
  if (!rawId) return [] as string[];

  const variants = new Set<string>([rawId]);
  const normalizedSport = (sport || "").toUpperCase();

  if (rawId.startsWith("nba_") || rawId.startsWith("nfl_") || rawId.startsWith("mlb_")) {
    variants.add(rawId.slice(4));
  } else {
    if (normalizedSport === "NBA") variants.add(`nba_${rawId}`);
    if (normalizedSport === "NFL") variants.add(`nfl_${rawId}`);
    if (normalizedSport === "MLB") variants.add(`mlb_${rawId}`);
  }

  return Array.from(variants);
};

const normalizePlayerName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const getPlayerNameTeamKey = (name: string, team?: string) => {
  const normalizedTeam = String(team || "")
    .trim()
    .toUpperCase();
  const normalizedName = normalizePlayerName(name || "");
  return `${normalizedTeam}|${normalizedName}`;
};

const getAutoTab = (game?: Pick<GameInsight, "status" | "startTime"> | null): CommandCenterTab => {
  if (!game) return "pre";

  if (game.status === "completed") return "post";
  if (game.status === "inprogress") return "during";
  if (game.status === "postponed") return "pre";

  const now = new Date();
  const startTime = new Date(game.startTime);
  const timeSinceStart = now.getTime() - startTime.getTime();
  const threeHoursMs = 3 * 60 * 60 * 1000;

  if (timeSinceStart > 0 && timeSinceStart < threeHoursMs) {
    return "during";
  }

  if (timeSinceStart >= threeHoursMs) {
    return "post";
  }

  return "pre";
};

const hasMeaningfulLiveStats = (player: LivePlayerStats, sport: string): boolean => {
  const normalizedSport = (sport || "").toUpperCase();

  if (normalizedSport === "MLB") {
    const mlbStats = [
      player.fantasyPoints,
      player.atBats,
      player.hits,
      player.homeRuns,
      player.runs,
      player.runsBattedIn,
      player.walks,
      player.stolenBases,
      player.strikeoutsBatting,
      player.inningsPitched,
      player.pitchingStrikeouts,
      player.earnedRuns,
      player.wins,
      player.saves,
    ];

    return mlbStats.some((value) => (value ?? 0) !== 0);
  }

  if (normalizedSport === "NFL") {
    const nflStats = [
      player.fantasyPoints,
      player.passingAttempts,
      player.passingYards,
      player.passingTDs,
      player.passingInterceptions,
      player.rushingAttempts,
      player.rushingYards,
      player.rushingTDs,
      player.receivingTargets,
      player.receivingYards,
      player.receivingTDs,
      player.receptions,
    ];

    return nflStats.some((value) => (value ?? 0) !== 0);
  }

  const nbaStats = [
    player.fantasyPoints,
    player.pts,
    player.reb,
    player.ast,
    player.stl,
    player.blk,
    player.fgm,
    player.fga,
    player.fg3m,
    player.fg3a,
    player.ftm,
    player.fta,
    player.turnover,
    player.pf,
    player.plusMinus,
  ];

  if (nbaStats.some((value) => (value ?? 0) !== 0)) {
    return true;
  }

  if (!player.min) {
    return false;
  }

  const parsedMinutes = Number.parseInt(player.min.split(":")[0] || "0", 10);
  return Number.isFinite(parsedMinutes) && parsedMinutes > 0;
};

export function GameCommandCenterModal({
  gameId,
  sport,
  date,
  initialInsight,
  onClose,
}: GameCommandCenterModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [showAllInjuries, setShowAllInjuries] = useState(false);
  const [selectedLiveInjury, setSelectedLiveInjury] = useState<InjuryEntry | null>(null);
  const [selectedLivePlayerId, setSelectedLivePlayerId] = useState<string | null>(null);
  const [showBoostSelector, setShowBoostSelector] = useState(false);
  const [selectedTier, setSelectedTier] = useState<2 | 3 | 4 | 5 | null>(null);
  const [swapTargetPlayerId, setSwapTargetPlayerId] = useState<string | null>(null);

  const { data: insight, isLoading } = useQuery<GameInsightDetailResponse>({
    queryKey: ["/api/games", gameId, "insights", sport, date],
    queryFn: async () => {
      const res = await authenticatedFetch(
        `/api/games/${gameId}/insights?sport=${sport}&date=${date}`,
      );
      if (!res.ok) throw new Error("Failed to fetch game insights");
      return res.json();
    },
    enabled: !!gameId,
  });

  const game = insight?.game || initialInsight;
  const activeTab = useMemo(() => getAutoTab(game), [game]);
  const liveSport = (game?.sport || sport || "").toUpperCase();
  const leaders = insight?.leaders || game?.leaders;
  const userContext = insight?.userContext || game?.userContext || null;
  const boostSlotsRemaining = insight?.boostSlotsRemaining ?? null;

  const {
    data: liveStats,
    isLoading: isLoadingLive,
    error: liveStatsError,
    refetch: refetchLive,
  } = useQuery<LiveStatsResponse>({
    queryKey: ["/api/games", gameId, "live-stats"],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/games/${gameId}/live-stats`);
      if (!res.ok) throw new Error("Failed to fetch live stats");
      return res.json();
    },
    enabled: !!gameId && activeTab === "during",
    refetchInterval: activeTab === "during" ? 30000 : false,
  });

  const {
    data: gameStats,
    isLoading: isLoadingStats,
    refetch: refetchStats,
  } = useQuery<GameStatsResponse>({
    queryKey: ["/api/games", gameId, "stats"],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/games/${gameId}/stats`);
      if (!res.ok) throw new Error("Failed to fetch game stats");
      return res.json();
    },
    enabled: !!gameId && activeTab === "post",
  });

  const liveOwnedPlayers = useMemo(() => {
    const players = liveStats?.userEarnings?.ownedPlayers || [];
    return [...players].sort((a, b) => {
      if (b.estimatedEarnings !== a.estimatedEarnings) {
        return b.estimatedEarnings - a.estimatedEarnings;
      }
      if (b.fantasyPoints !== a.fantasyPoints) {
        return b.fantasyPoints - a.fantasyPoints;
      }
      return a.name.localeCompare(b.name);
    });
  }, [liveStats?.userEarnings?.ownedPlayers]);

  const liveEarningsByPlayerId = useMemo(() => {
    const map = new Map<
      string,
      { estimatedEarnings: number; quantity: number; effectiveShares: number }
    >();
    liveOwnedPlayers.forEach((player) => {
      const record = {
        estimatedEarnings: player.estimatedEarnings,
        quantity: player.quantity,
        effectiveShares: player.effectiveShares,
      };

      getPlayerIdVariants(player.playerId, liveSport).forEach((id) => {
        map.set(id, record);
      });
    });
    return map;
  }, [liveOwnedPlayers, liveSport]);

  const liveEarningsByNameTeam = useMemo(() => {
    const map = new Map<
      string,
      { estimatedEarnings: number; quantity: number; effectiveShares: number }
    >();

    liveOwnedPlayers.forEach((player) => {
      const key = getPlayerNameTeamKey(player.name, player.team);
      const existing = map.get(key);
      if (!existing || player.estimatedEarnings > existing.estimatedEarnings) {
        map.set(key, {
          estimatedEarnings: player.estimatedEarnings,
          quantity: player.quantity,
          effectiveShares: player.effectiveShares,
        });
      }
    });

    return map;
  }, [liveOwnedPlayers]);

  const liveOwnedPlayerIdByNameTeam = useMemo(() => {
    const map = new Map<string, string>();

    liveOwnedPlayers.forEach((player) => {
      map.set(getPlayerNameTeamKey(player.name, player.team), player.playerId);
    });

    return map;
  }, [liveOwnedPlayers]);

  const liveHomePlayers = useMemo(
    () =>
      [...(liveStats?.homePlayers || [])].sort(
        (a, b) => (b.fantasyPoints || 0) - (a.fantasyPoints || 0),
      ),
    [liveStats?.homePlayers],
  );

  const liveAwayPlayers = useMemo(
    () =>
      [...(liveStats?.awayPlayers || [])].sort(
        (a, b) => (b.fantasyPoints || 0) - (a.fantasyPoints || 0),
      ),
    [liveStats?.awayPlayers],
  );

  const liveInjuries = useMemo(() => {
    if (!insight?.injuries?.length) return [];
    if (!liveStats) return insight.injuries;
    return insight.injuries.filter(
      (injury) => injury.team === liveStats.homeTeam || injury.team === liveStats.awayTeam,
    );
  }, [insight?.injuries, liveStats]);

  const liveTeamSections = useMemo(() => {
    if (!liveStats) return [] as Array<{ team: string; players: LivePlayerStats[] }>;
    return [
      {
        team: liveStats.awayTeam,
        players: liveAwayPlayers.filter((player) => hasMeaningfulLiveStats(player, liveSport)),
      },
      {
        team: liveStats.homeTeam,
        players: liveHomePlayers.filter((player) => hasMeaningfulLiveStats(player, liveSport)),
      },
    ];
  }, [liveStats, liveAwayPlayers, liveHomePlayers, liveSport]);

  const totalLiveEarnings = liveStats?.userEarnings?.totalEstimatedEarnings || 0;
  const liveStatsErrorMessage =
    liveStatsError instanceof Error ? liveStatsError.message : "Failed to fetch live stats.";

  const { data: scoutData, isLoading: isLoadingScouts } = useQuery<ScoutData>({
    queryKey: ["/api/scouts"],
    enabled: isAuthenticated && activeTab === "pre",
  });

  const topFantasy = useMemo(() => {
    if (!gameStats?.homeTeam?.players?.length && !gameStats?.awayTeam?.players?.length) {
      return [];
    }
    const players = [
      ...(gameStats?.homeTeam?.players || []),
      ...(gameStats?.awayTeam?.players || []),
    ];
    return [...players].sort((a, b) => b.fantasyPoints - a.fantasyPoints).slice(0, 5);
  }, [gameStats]);

  // Split top players by team for Pre-Game tab
  const awayTeamPlayers = useMemo(() => {
    if (!insight?.topPlayers?.fantasy || !game) return [];
    return insight.topPlayers.fantasy.filter((p) => p.team === game.awayTeam).slice(0, 5);
  }, [insight?.topPlayers?.fantasy, game]);

  const homeTeamPlayers = useMemo(() => {
    if (!insight?.topPlayers?.fantasy || !game) return [];
    return insight.topPlayers.fantasy.filter((p) => p.team === game.homeTeam).slice(0, 5);
  }, [insight?.topPlayers?.fantasy, game]);

  const ownedPlayerData = useMemo(() => {
    const map = new Map<
      string,
      { multiplier: number; totalShares: number; availableShares: number }
    >();
    const ownedPlayers = userContext?.ownedPlayers || userContext?.topMultiplierPlayers || [];

    ownedPlayers.forEach((player) => {
      const existing = map.get(player.playerId);
      if (!existing) {
        map.set(player.playerId, {
          multiplier: player.multiplier,
          totalShares: player.totalShares,
          availableShares: player.availableShares,
        });
        return;
      }

      map.set(player.playerId, {
        multiplier: Math.max(existing.multiplier, player.multiplier),
        totalShares: Math.max(existing.totalShares, player.totalShares),
        availableShares: Math.max(existing.availableShares, player.availableShares),
      });
    });

    return map;
  }, [userContext?.ownedPlayers, userContext?.topMultiplierPlayers]);

  const ownedPlayerIds = useMemo(() => new Set(ownedPlayerData.keys()), [ownedPlayerData]);

  const scoutCandidates = useMemo(() => {
    if (!insight?.topPlayers?.fantasy || !game) return [];

    return insight.topPlayers.fantasy
      .filter((player) => player.team === game.homeTeam || player.team === game.awayTeam)
      .sort((a, b) => {
        if (b.avgFantasyPointsPerGame !== a.avgFantasyPointsPerGame) {
          return b.avgFantasyPointsPerGame - a.avgFantasyPointsPerGame;
        }
        return a.name.localeCompare(b.name);
      });
  }, [insight?.topPlayers?.fantasy, game]);

  const scoutAssignmentsByPlayer = useMemo(() => {
    const map = new Map<string, ScoutAssignment>();
    (scoutData?.assignments || []).forEach((assignment) => {
      map.set(assignment.playerId, assignment);
    });
    return map;
  }, [scoutData?.assignments]);

  const swapTargetPlayer = useMemo(
    () => scoutCandidates.find((player) => player.playerId === swapTargetPlayerId) || null,
    [scoutCandidates, swapTargetPlayerId],
  );

  const swapSourceAssignments = useMemo(() => {
    if (!scoutData?.assignments || !swapTargetPlayerId) return [] as ScoutAssignment[];

    return scoutData.assignments.filter(
      (assignment) => assignment.scoutCount > 0 && assignment.playerId !== swapTargetPlayerId,
    );
  }, [scoutData?.assignments, swapTargetPlayerId]);

  // Boost assignment mutation
  const assignBoostMutation = useMutation({
    mutationFn: async ({
      playerId,
      slotTier,
      sharesEntered,
    }: {
      playerId: string;
      slotTier: number;
      sharesEntered: number;
    }) => {
      const res = await apiRequest("POST", "/api/daily-boosts/assign", {
        playerId,
        slotTier,
        sharesEntered,
        sport,
        date,
      });
      return res.json();
    },
    onSuccess: () => {
      // Invalidate both the specific game insights and the dashboard list
      queryClient.invalidateQueries({ queryKey: ["/api/games", gameId, "insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-boosts"] });
      toast({
        title: "Boost Applied!",
        description: "Your player has been boosted for this game.",
      });
      setShowBoostSelector(false);
      setSelectedTier(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to apply boost",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const quickScoutMutation = useMutation({
    mutationFn: async ({ playerId, count }: { playerId: string; count: number }) => {
      const res = await apiRequest("POST", "/api/scouts/assign", { playerId, count });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games", gameId, "insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games/insights"] });
      toast({
        title: "Scout assigned",
        description: "1 scout started for this player.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to assign scout",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const swapScoutMutation = useMutation({
    mutationFn: async ({
      fromPlayerId,
      fromCount,
      toPlayerId,
      toCount,
    }: {
      fromPlayerId: string;
      fromCount: number;
      toPlayerId: string;
      toCount: number;
    }) => {
      await apiRequest("POST", "/api/scouts/assign", {
        playerId: fromPlayerId,
        count: Math.max(fromCount - 1, 0),
      });

      const res = await apiRequest("POST", "/api/scouts/assign", {
        playerId: toPlayerId,
        count: toCount,
      });

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games", gameId, "insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games/insights"] });
      setSwapTargetPlayerId(null);
      toast({
        title: "Scout swapped",
        description: "Moved 1 scout to your selected player.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Swap failed",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleQuickScout = (playerId: string) => {
    if (!isAuthenticated) {
      toast({
        title: "Sign in required",
        description: "Please sign in to assign scouts.",
        variant: "destructive",
      });
      return;
    }

    const currentCount = scoutAssignmentsByPlayer.get(playerId)?.scoutCount || 0;

    if (currentCount > 0) {
      toast({
        title: "Already scouting",
        description: "You already have scouts on this player.",
      });
      return;
    }

    if ((scoutData?.remaining || 0) > 0) {
      quickScoutMutation.mutate({ playerId, count: 1 });
      return;
    }

    setSwapTargetPlayerId(playerId);
  };

  const getPlayerLiveEarnings = (player: LivePlayerStats, team: string) => {
    if (player.playerId) {
      for (const candidateId of getPlayerIdVariants(player.playerId, liveSport)) {
        const match = liveEarningsByPlayerId.get(candidateId);
        if (match) return match.estimatedEarnings;
      }
    }

    const byName = liveEarningsByNameTeam.get(getPlayerNameTeamKey(player.name, team));
    if (byName) return byName.estimatedEarnings;

    return 0;
  };

  const resolveLivePlayerModalId = (player: LivePlayerStats, team: string) => {
    if (player.playerId) {
      for (const candidateId of getPlayerIdVariants(player.playerId, liveSport)) {
        if (ownedPlayerIds.has(candidateId) || liveEarningsByPlayerId.has(candidateId)) {
          return candidateId;
        }
      }

      return player.playerId;
    }

    return liveOwnedPlayerIdByNameTeam.get(getPlayerNameTeamKey(player.name, team)) || null;
  };

  const startTimeLabel = game ? new Date(game.startTime).toLocaleString() : "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>
            {game ? `${game.awayTeam} @ ${game.homeTeam}` : "Game Command Center"}
          </DialogTitle>
          <DialogDescription>
            {activeTab === "pre"
              ? "Pregame setup with leaders, boosts, and key availability."
              : activeTab === "during"
                ? "Live game view with active score and top performers."
                : "Postgame recap with final leaders and fantasy output."}
          </DialogDescription>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {game && <span>{startTimeLabel}</span>}
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {activeTab === "pre" ? "Pregame" : activeTab === "during" ? "Live" : "Final"}
            </Badge>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} className="mt-4">
          <TabsContent value="pre" className="mt-4 space-y-4">
            {isLoading && !game ? (
              <div className="space-y-3">
                <Shimmer height="16px" width="60%" />
                <Shimmer height="120px" width="100%" />
              </div>
            ) : (
              <>
                {/* Compact Leaders Row */}
                <div className="flex items-center justify-between gap-2 rounded-sm border border-border/60 p-2 text-[11px]">
                  <div className="flex-1 text-center">
                    <div className="text-muted-foreground">FP Leader</div>
                    <div className="font-semibold truncate">{leaders?.fantasy?.name || "—"}</div>
                    <div className="text-muted-foreground">
                      {leaders?.fantasy?.avgFantasyPointsPerGame?.toFixed(1) ?? "—"}
                    </div>
                  </div>
                  <div className="w-px h-8 bg-border/60" />
                  <div className="flex-1 text-center">
                    <div className="text-muted-foreground">TSV Leader</div>
                    <div className="font-semibold truncate">{leaders?.shares?.name || "—"}</div>
                    <div className="text-muted-foreground">
                      {leaders?.shares?.totalShares ?? "—"}
                    </div>
                  </div>
                  <div className="w-px h-8 bg-border/60" />
                  <div className="flex-1 text-center">
                    <div className="text-muted-foreground">Scouts Leader</div>
                    <div className="font-semibold truncate">{leaders?.scouts?.name || "—"}</div>
                    <div className="text-muted-foreground">
                      {leaders?.scouts?.scoutCount ?? "—"}
                    </div>
                  </div>
                </div>

                {/* Team Rosters - Top 5 by Season Avg Fantasy Points */}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-sm border border-border/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold">{game?.awayTeam}</div>
                      <Badge variant="outline" className="text-[10px]">
                        Top 5 by FP
                      </Badge>
                    </div>
                    {awayTeamPlayers.length > 0 ? (
                      <div className="space-y-1.5">
                        {awayTeamPlayers.map((player, idx) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between text-xs"
                          >
                            <span
                              className={
                                ownedPlayerIds.has(player.playerId)
                                  ? "text-purple-400 font-medium"
                                  : ""
                              }
                            >
                              {idx + 1}. {formatName(player.name)}
                            </span>
                            <span className="font-mono text-muted-foreground">
                              {player.avgFantasyPointsPerGame.toFixed(1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No player data available</div>
                    )}
                  </div>

                  <div className="rounded-sm border border-border/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold">{game?.homeTeam}</div>
                      <Badge variant="outline" className="text-[10px]">
                        Top 5 by FP
                      </Badge>
                    </div>
                    {homeTeamPlayers.length > 0 ? (
                      <div className="space-y-1.5">
                        {homeTeamPlayers.map((player, idx) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between text-xs"
                          >
                            <span
                              className={
                                ownedPlayerIds.has(player.playerId)
                                  ? "text-purple-400 font-medium"
                                  : ""
                              }
                            >
                              {idx + 1}. {formatName(player.name)}
                            </span>
                            <span className="font-mono text-muted-foreground">
                              {player.avgFantasyPointsPerGame.toFixed(1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No player data available</div>
                    )}
                  </div>
                </div>

                {/* Your Multiplier Leaders - interactive quick-boost view */}
                <div className="rounded-sm border-2 border-purple-500/40 bg-purple-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-purple-500" />
                      <div className="text-sm font-semibold">Your Multiplier Leaders</div>
                      {userContext?.topMultiplierPlayers?.length ? (
                        <Badge variant="secondary" className="text-[10px] border-border/80">
                          {userContext.topMultiplierPlayers.length}
                        </Badge>
                      ) : null}
                    </div>

                    {boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
                      <Button
                        variant={showBoostSelector ? "default" : "outline"}
                        size="sm"
                        className={`h-7 px-3 text-[11px] font-medium border-2 ${
                          showBoostSelector
                            ? "bg-purple-600 border-purple-600 hover:bg-purple-700 hover:border-purple-700"
                            : "border-purple-500 text-purple-700 bg-purple-50 hover:bg-purple-100 hover:text-purple-800 hover:border-purple-600 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-500/60"
                        }`}
                        onClick={() => setShowBoostSelector(!showBoostSelector)}
                      >
                        {showBoostSelector ? (
                          <>
                            <X className="h-3 w-3 mr-1" />
                            Close
                          </>
                        ) : (
                          <>
                            <Zap className="h-3 w-3 mr-1" />
                            Slots: {boostSlotsRemaining}
                          </>
                        )}
                      </Button>
                    )}
                    {boostSlotsRemaining !== null && boostSlotsRemaining === 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-muted-foreground border-border/80 px-2 py-1"
                      >
                        Slots: 0
                      </Badge>
                    )}
                  </div>

                  {!showBoostSelector && userContext?.topMultiplierPlayers?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {userContext.topMultiplierPlayers.slice(0, 4).map((player, idx) => (
                        <Badge
                          key={`${player.playerId}-${idx}`}
                          variant="outline"
                          className="text-[10px] gap-1.5 border-border/80 px-2 py-1"
                        >
                          <span className="text-purple-500 font-medium">
                            {formatName(player.name)}
                          </span>
                          <span className="text-purple-500 font-mono">
                            {player.multiplier.toFixed(1)}x
                          </span>
                        </Badge>
                      ))}
                      {userContext.topMultiplierPlayers.length > 4 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-muted-foreground border-border/80"
                        >
                          +{userContext.topMultiplierPlayers.length - 4}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    !showBoostSelector && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        No eligible holdings for this matchup
                      </div>
                    )
                  )}

                  {showBoostSelector && boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
                    <div className="mt-3 rounded-sm border-2 border-purple-400 bg-background/80 p-3">
                      <div className="mb-2 text-[11px] font-medium text-purple-700 dark:text-purple-400">
                        Select tier & player to boost:
                      </div>

                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground font-medium">Tier:</span>
                        <div className="flex gap-1">
                          {([5, 4, 3, 2] as const).map((tier) => (
                            <Button
                              key={tier}
                              variant={selectedTier === tier ? "default" : "outline"}
                              size="sm"
                              className={`h-7 px-2.5 text-[11px] font-semibold border-2 ${
                                selectedTier === tier
                                  ? "bg-purple-600 border-purple-600 hover:bg-purple-700 hover:border-purple-700"
                                  : "border-border hover:border-purple-400"
                              }`}
                              onClick={() => setSelectedTier(selectedTier === tier ? null : tier)}
                            >
                              {tier}x
                            </Button>
                          ))}
                        </div>
                      </div>

                      {userContext?.topMultiplierPlayers &&
                      userContext.topMultiplierPlayers.length > 0 ? (
                        <div className="space-y-1 max-h-40 overflow-y-auto border border-border/60 rounded-md p-1">
                          {userContext.topMultiplierPlayers.map((player, idx) => (
                            <div
                              key={`${player.playerId}-${idx}`}
                              className="flex items-center justify-between text-xs py-2 px-2 rounded bg-muted/30 hover:bg-purple-500/10 transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-medium truncate">
                                  {formatName(player.name)}
                                </span>
                                <span className="text-muted-foreground text-[10px]">
                                  {player.team}
                                </span>
                                <span className="text-purple-500 font-mono text-[10px]">
                                  {player.multiplier.toFixed(1)}x
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant={selectedTier ? "default" : "ghost"}
                                disabled={!selectedTier || assignBoostMutation.isPending}
                                className={`h-6 px-2 text-[10px] border-2 ${
                                  selectedTier
                                    ? "bg-purple-600 border-purple-600 hover:bg-purple-700 hover:border-purple-700"
                                    : "border-transparent"
                                }`}
                                onClick={() => {
                                  if (selectedTier) {
                                    assignBoostMutation.mutate({
                                      playerId: player.playerId,
                                      slotTier: selectedTier as number,
                                      sharesEntered: player.availableShares,
                                    });
                                  }
                                }}
                              >
                                {assignBoostMutation.isPending ? (
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                ) : (
                                  <>
                                    <Zap className="h-3 w-3 mr-1" />
                                    Boost
                                  </>
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border/60 rounded-md">
                          No eligible players to boost
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Quick Scout - mobile-first command center action */}
                <div className="rounded-sm border-2 border-amber-500/40 bg-amber-500/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Binoculars className="h-4 w-4 text-amber-600" />
                      <div className="text-sm font-semibold">Quick Scout</div>
                    </div>
                    {isAuthenticated && scoutData ? (
                      <Badge variant="outline" className="text-[10px] border-border/80">
                        {scoutData.remaining} open
                      </Badge>
                    ) : null}
                  </div>

                  {!isAuthenticated ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Sign in to assign scouts directly from dashboard.
                    </div>
                  ) : isLoadingScouts ? (
                    <div className="mt-2 space-y-2">
                      <Shimmer height="28px" width="100%" />
                      <Shimmer height="28px" width="100%" />
                    </div>
                  ) : scoutCandidates.length > 0 ? (
                    <>
                      <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                        {scoutCandidates.map((player, idx) => {
                          const assignment = scoutAssignmentsByPlayer.get(player.playerId);
                          const scoutCount = assignment?.scoutCount || 0;
                          const isScouting = scoutCount > 0;
                          const ownedData = ownedPlayerData.get(player.playerId);

                          return (
                            <div
                              key={player.playerId}
                              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                <div
                                  className={`truncate text-xs font-medium ${ownedData ? "text-purple-500" : ""}`}
                                >
                                  {idx + 1}. {formatName(player.name)}
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                  <span>{player.team}</span>
                                  <span>•</span>
                                  <span>{player.avgFantasyPointsPerGame.toFixed(1)} FP</span>
                                  {ownedData ? (
                                    <>
                                      <span>•</span>
                                      <span className="text-purple-500 font-medium">
                                        Own {ownedData.multiplier.toFixed(1)}x
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                              </div>

                              {isScouting ? (
                                <Badge variant="secondary" className="text-[10px] px-2">
                                  Scouting {scoutCount}
                                </Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[10px]"
                                  onClick={() => handleQuickScout(player.playerId)}
                                  disabled={
                                    !isAuthenticated ||
                                    quickScoutMutation.isPending ||
                                    swapScoutMutation.isPending
                                  }
                                >
                                  {quickScoutMutation.isPending || swapScoutMutation.isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : !isAuthenticated ? (
                                    "Sign In"
                                  ) : scoutData?.remaining ? (
                                    "Quick Scout"
                                  ) : (
                                    "Swap In"
                                  )}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {scoutData && scoutData.remaining === 0 && (
                        <div className="mt-2 text-[10px] text-muted-foreground">
                          Scouts are fully allocated. Tap{" "}
                          <span className="font-medium">Swap In</span> to move 1 scout.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">
                      No players available for scouting.
                    </div>
                  )}
                </div>

                {/* Injuries - Compact */}
                <div className="rounded-sm border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      <span className="text-xs text-muted-foreground">Injuries</span>
                      {insight?.injuries?.length ? (
                        <Badge variant="outline" className="text-[10px]">
                          {insight.injuries.length}
                        </Badge>
                      ) : null}
                    </div>
                    {insight?.injuries && insight.injuries.length > 2 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setShowAllInjuries(!showAllInjuries)}
                      >
                        {showAllInjuries ? (
                          <>
                            Less <ChevronUp className="ml-1 h-3 w-3" />
                          </>
                        ) : (
                          <>
                            More <ChevronDown className="ml-1 h-3 w-3" />
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  {insight?.injuries?.length ? (
                    <div className="mt-2 space-y-1.5">
                      {(showAllInjuries ? insight.injuries : insight.injuries.slice(0, 2)).map(
                        (player) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="truncate">
                              {formatName(player.name)}{" "}
                              <span className="text-muted-foreground">({player.team})</span>
                            </span>
                            <Badge
                              variant={player.status === "Out" ? "destructive" : "outline"}
                              className="text-[10px] ml-2 flex-shrink-0"
                            >
                              {player.status}
                            </Badge>
                          </div>
                        ),
                      )}
                      {!showAllInjuries && insight.injuries.length > 2 && (
                        <div className="text-[10px] text-muted-foreground text-center pt-1">
                          +{insight.injuries.length - 2} more
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">No reported injuries.</div>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="during" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Live Box Score</div>
              <Button variant="outline" size="sm" onClick={() => refetchLive()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
            </div>

            {isLoadingLive ? (
              <Shimmer height="160px" width="100%" />
            ) : !liveStats ? (
              <div className="text-sm text-muted-foreground">{liveStatsErrorMessage}</div>
            ) : (
              <>
                <div className="space-y-3 rounded-sm border border-border/60 p-3">
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span>
                      {liveStats.awayTeam} {liveStats.awayScore}
                    </span>
                    <span>@</span>
                    <span>
                      {liveStats.homeTeam} {liveStats.homeScore}
                    </span>
                  </div>

                  {liveStats.message ? (
                    <div className="text-xs text-muted-foreground">{liveStats.message}</div>
                  ) : null}

                  {(liveStats.awayTopPerformers?.length || liveStats.homeTopPerformers?.length) && (
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          {liveStats.awayTeam} Leaders
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {(liveStats.awayTopPerformers || []).slice(0, 3).map((player) => (
                            <Badge key={`${liveStats.awayTeam}-${player.name}`} variant="outline">
                              {formatName(player.name)} · {player.pts ?? 0}p
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          {liveStats.homeTeam} Leaders
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {(liveStats.homeTopPerformers || []).slice(0, 3).map((player) => (
                            <Badge key={`${liveStats.homeTeam}-${player.name}`} variant="outline">
                              {formatName(player.name)} · {player.pts ?? 0}p
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid min-w-0 gap-3 md:grid-cols-2">
                  {liveTeamSections.map((section) => (
                    <div
                      key={section.team}
                      className="min-w-0 rounded-sm border border-border/70 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">{section.team} Box</div>
                        <Badge variant="outline" className="text-[10px]">
                          {section.players.length} active
                        </Badge>
                      </div>

                      {section.players.length > 0 ? (
                        <>
                          <div className="mb-1 text-[10px] text-muted-foreground">
                            Player, FP, and $ stay fixed. Swipe for full box score →
                          </div>
                          <div className="max-w-full overflow-x-auto overscroll-x-contain">
                            {liveSport === "NFL" ? (
                              <table className="w-full min-w-[840px] border-separate border-spacing-0 text-[10px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="sticky left-0 z-30 w-20 border-b border-border/60 bg-background px-1 py-1 text-left font-medium">
                                      Player
                                    </th>
                                    <th className="sticky left-20 z-30 w-12 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      FP
                                    </th>
                                    <th className="sticky left-[8rem] z-30 w-14 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      $
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Pos
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Pass
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Rush
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Rec
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      TD
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      INT
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.players.map((player) => {
                                    const earnings = getPlayerLiveEarnings(player, section.team);
                                    const owned = earnings > 0;
                                    const stickyCellBg = owned ? "bg-purple-500/10" : "bg-card";
                                    const passLine = `${player.passingCompletions ?? 0}/${player.passingAttempts ?? 0}-${player.passingYards ?? 0}`;
                                    const rushLine = `${player.rushingAttempts ?? 0}/${player.rushingYards ?? 0}`;
                                    const recLine = `${player.receptions ?? 0}/${player.receivingTargets ?? 0}-${player.receivingYards ?? 0}`;
                                    const totalTD =
                                      (player.passingTDs ?? 0) +
                                      (player.rushingTDs ?? 0) +
                                      (player.receivingTDs ?? 0);

                                    return (
                                      <tr
                                        key={`${section.team}-${player.playerId || player.name}`}
                                        className={owned ? "bg-purple-500/5" : ""}
                                      >
                                        <td
                                          className={`sticky left-0 z-20 border-b border-border/40 px-1 py-1.5 ${stickyCellBg}`}
                                        >
                                          {player.playerId ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setSelectedLivePlayerId(
                                                  resolveLivePlayerModalId(player, section.team),
                                                )
                                              }
                                              className={`truncate text-left underline-offset-2 hover:underline ${owned ? "font-medium text-purple-500" : ""}`}
                                            >
                                              {formatCompactName(player.name)}
                                            </button>
                                          ) : (
                                            <div
                                              className={`truncate ${owned ? "font-medium text-purple-500" : ""}`}
                                            >
                                              {formatCompactName(player.name)}
                                            </div>
                                          )}
                                        </td>
                                        <td
                                          className={`sticky left-20 z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono ${stickyCellBg}`}
                                        >
                                          {(player.fantasyPoints || 0).toFixed(1)}
                                        </td>
                                        <td
                                          className={`sticky left-[8rem] z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 ${stickyCellBg}`}
                                        >
                                          ${earnings.toFixed(2)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.position || "—"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {passLine}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {rushLine}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {recLine}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {totalTD}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.passingInterceptions ?? 0}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : liveSport === "MLB" ? (
                              <table className="w-full min-w-[1020px] border-separate border-spacing-0 text-[10px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="sticky left-0 z-30 w-20 border-b border-border/60 bg-background px-1 py-1 text-left font-medium">
                                      Player
                                    </th>
                                    <th className="sticky left-20 z-30 w-12 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      FP
                                    </th>
                                    <th className="sticky left-[8rem] z-30 w-14 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      $
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Pos
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      H
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      R
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      RBI
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      HR
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      SB
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      BB
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      K
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      IP
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      P-K
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      ER
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      W
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      SV
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.players.map((player) => {
                                    const earnings = getPlayerLiveEarnings(player, section.team);
                                    const owned = earnings > 0;
                                    const stickyCellBg = owned ? "bg-purple-500/10" : "bg-card";

                                    return (
                                      <tr
                                        key={`${section.team}-${player.playerId || player.name}`}
                                        className={owned ? "bg-purple-500/5" : ""}
                                      >
                                        <td
                                          className={`sticky left-0 z-20 border-b border-border/40 px-1 py-1.5 ${stickyCellBg}`}
                                        >
                                          {player.playerId ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setSelectedLivePlayerId(
                                                  resolveLivePlayerModalId(player, section.team),
                                                )
                                              }
                                              className={`truncate text-left underline-offset-2 hover:underline ${owned ? "font-medium text-purple-500" : ""}`}
                                            >
                                              {formatCompactName(player.name)}
                                            </button>
                                          ) : (
                                            <div
                                              className={`truncate ${owned ? "font-medium text-purple-500" : ""}`}
                                            >
                                              {formatCompactName(player.name)}
                                            </div>
                                          )}
                                        </td>
                                        <td
                                          className={`sticky left-20 z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono ${stickyCellBg}`}
                                        >
                                          {(player.fantasyPoints || 0).toFixed(1)}
                                        </td>
                                        <td
                                          className={`sticky left-[8rem] z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 ${stickyCellBg}`}
                                        >
                                          ${earnings.toFixed(2)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.position || "-"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.hits ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.runs ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.runsBattedIn ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.homeRuns ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.stolenBases ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.walks ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.strikeoutsBatting ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {Number(player.inningsPitched ?? 0).toFixed(1)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.pitchingStrikeouts ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.earnedRuns ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.wins ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.saves ?? 0}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : (
                              <table className="w-full min-w-[940px] border-separate border-spacing-0 text-[10px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="sticky left-0 z-30 w-20 border-b border-border/60 bg-background px-1 py-1 text-left font-medium">
                                      Player
                                    </th>
                                    <th className="sticky left-20 z-30 w-12 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      FP
                                    </th>
                                    <th className="sticky left-[8rem] z-30 w-14 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      $
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Pos
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      MIN
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      PTS
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      REB
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      AST
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      STL
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      BLK
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      TO
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      3PM
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      FG
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      FT
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      +/-
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.players.map((player) => {
                                    const earnings = getPlayerLiveEarnings(player, section.team);
                                    const owned = earnings > 0;
                                    const stickyCellBg = owned ? "bg-purple-500/10" : "bg-card";

                                    return (
                                      <tr
                                        key={`${section.team}-${player.playerId || player.name}`}
                                        className={owned ? "bg-purple-500/5" : ""}
                                      >
                                        <td
                                          className={`sticky left-0 z-20 border-b border-border/40 px-1 py-1.5 ${stickyCellBg}`}
                                        >
                                          {player.playerId ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setSelectedLivePlayerId(
                                                  resolveLivePlayerModalId(player, section.team),
                                                )
                                              }
                                              className={`truncate text-left underline-offset-2 hover:underline ${owned ? "font-medium text-purple-500" : ""}`}
                                            >
                                              {formatCompactName(player.name)}
                                            </button>
                                          ) : (
                                            <div
                                              className={`truncate ${owned ? "font-medium text-purple-500" : ""}`}
                                            >
                                              {formatCompactName(player.name)}
                                            </div>
                                          )}
                                        </td>
                                        <td
                                          className={`sticky left-20 z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono ${stickyCellBg}`}
                                        >
                                          {(player.fantasyPoints || 0).toFixed(1)}
                                        </td>
                                        <td
                                          className={`sticky left-[8rem] z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 ${stickyCellBg}`}
                                        >
                                          ${earnings.toFixed(2)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.position || "—"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.min || "0"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.pts ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.reb ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.ast ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.stl ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.blk ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.turnover ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.fg3m ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.fgm ?? 0}/{player.fga ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.ftm ?? 0}/{player.fta ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.plusMinus ?? 0}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          No player stat lines available yet.
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-sm border border-border/70 p-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    <span className="text-xs text-muted-foreground">Injuries</span>
                    {liveInjuries.length ? (
                      <Badge variant="outline" className="text-[10px]">
                        {liveInjuries.length}
                      </Badge>
                    ) : null}
                  </div>

                  {liveInjuries.length ? (
                    <>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {liveInjuries.map((injury) => (
                          <button
                            key={`live-injury-${injury.playerId}`}
                            type="button"
                            className={`h-8 truncate rounded-md border px-2 text-left text-[10px] transition-colors ${
                              injury.status === "Out"
                                ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                                : "border-border/70 bg-background/70 text-foreground hover:bg-muted"
                            }`}
                            onClick={() => setSelectedLiveInjury(injury)}
                          >
                            {formatName(injury.name)}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        Tap a name for details and player actions.
                      </div>
                    </>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">No reported injuries.</div>
                  )}
                </div>

                <div className="rounded-sm border-2 border-emerald-500/35 bg-emerald-500/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">Live Earnings</div>
                    {isAuthenticated ? (
                      <Badge variant="outline" className="text-[10px] border-border/80">
                        {liveOwnedPlayers.length} owned
                      </Badge>
                    ) : null}
                  </div>

                  {!isAuthenticated ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Sign in to view your live earnings breakdown.
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 flex items-center justify-between rounded-md border border-emerald-500/30 bg-background/70 px-2 py-1.5">
                        <span className="text-xs text-muted-foreground">Total Estimated</span>
                        <span className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                          ${totalLiveEarnings.toFixed(2)}
                        </span>
                      </div>

                      {liveOwnedPlayers.length > 0 ? (
                        <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                          {liveOwnedPlayers.map((player) => (
                            <div
                              key={player.playerId}
                              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-purple-500">
                                  {formatName(player.name)}
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                  <span>{player.team}</span>
                                  <span>•</span>
                                  <span>{player.fantasyPoints.toFixed(1)} FP</span>
                                  <span>•</span>
                                  <span>{player.effectiveShares.toFixed(1)} effective</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                  ${player.estimatedEarnings.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {player.quantity.toFixed(2)} shares
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-muted-foreground">
                          You don’t own players in this matchup yet.
                        </div>
                      )}

                      <div className="mt-2 text-[10px] text-muted-foreground">
                        Estimated earnings = live fantasy points x total effective shares.
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="post" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Post-Game Recap</div>
              <Button variant="outline" size="sm" onClick={() => refetchStats()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
            </div>
            {isLoadingStats ? (
              <Shimmer height="120px" width="100%" />
            ) : gameStats?.message ? (
              <div className="text-sm text-muted-foreground">{gameStats.message}</div>
            ) : gameStats ? (
              <div className="space-y-4">
                {gameStats.topPerformers && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-sm border border-border/60 p-3 text-xs">
                      <div className="text-muted-foreground">Top Scorer</div>
                      <div className="mt-1 font-semibold">
                        {gameStats.topPerformers.topScorer.playerName}
                      </div>
                      <div className="mt-1">{gameStats.topPerformers.topScorer.points} pts</div>
                    </div>
                    <div className="rounded-sm border border-border/60 p-3 text-xs">
                      <div className="text-muted-foreground">Top Rebounder</div>
                      <div className="mt-1 font-semibold">
                        {gameStats.topPerformers.topRebounder.playerName}
                      </div>
                      <div className="mt-1">
                        {gameStats.topPerformers.topRebounder.rebounds} reb
                      </div>
                    </div>
                    <div className="rounded-sm border border-border/60 p-3 text-xs">
                      <div className="text-muted-foreground">Top Assister</div>
                      <div className="mt-1 font-semibold">
                        {gameStats.topPerformers.topAssister.playerName}
                      </div>
                      <div className="mt-1">{gameStats.topPerformers.topAssister.assists} ast</div>
                    </div>
                  </div>
                )}

                <div className="rounded-sm border border-border/60 p-3">
                  <div className="text-xs text-muted-foreground">Fantasy Points Leaders</div>
                  <div className="mt-2 space-y-2 text-xs">
                    {topFantasy.map((player) => (
                      <div key={player.playerId} className="flex items-center justify-between">
                        <span>{formatName(player.playerName)}</span>
                        <span className="font-mono">{player.fantasyPoints.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Final stats are not available yet.
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Dialog
          open={Boolean(selectedLiveInjury)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedLiveInjury(null);
            }
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {selectedLiveInjury ? formatName(selectedLiveInjury.name) : "Injury Details"}
              </DialogTitle>
              <DialogDescription>
                {selectedLiveInjury
                  ? `${selectedLiveInjury.team} • ${selectedLiveInjury.status}`
                  : "View live injury details."}
              </DialogDescription>
            </DialogHeader>

            {selectedLiveInjury ? (
              <div className="space-y-3 text-xs">
                <div className="rounded-md border border-border/70 bg-muted/40 p-2">
                  {selectedLiveInjury.description || "No additional injury description provided."}
                </div>
                {selectedLiveInjury.returnDate ? (
                  <div className="text-muted-foreground">
                    Expected return: {selectedLiveInjury.returnDate}
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!selectedLiveInjury.playerId}
                    onClick={() => {
                      if (!selectedLiveInjury.playerId) return;
                      setSelectedLiveInjury(null);
                      setSelectedLivePlayerId(selectedLiveInjury.playerId);
                    }}
                  >
                    Open Player Modal
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <PlayerModal
          playerId={selectedLivePlayerId}
          open={Boolean(selectedLivePlayerId)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedLivePlayerId(null);
            }
          }}
        />

        <AlertDialog
          open={Boolean(swapTargetPlayerId)}
          onOpenChange={(open) => {
            if (!open) {
              setSwapTargetPlayerId(null);
            }
          }}
        >
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Swap Scout Assignment</AlertDialogTitle>
              <AlertDialogDescription>
                {swapTargetPlayer
                  ? `Choose which active scout to move onto ${formatName(swapTargetPlayer.name)}.`
                  : "Choose which active scout to move onto your selected player."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-2">
              {swapTargetPlayer ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                  <span className="font-medium">Target:</span> {formatName(swapTargetPlayer.name)} •{" "}
                  {swapTargetPlayer.team}
                </div>
              ) : null}

              <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                {swapSourceAssignments.length > 0 ? (
                  swapSourceAssignments.map((assignment) => {
                    const sourceName = assignment.player
                      ? `${assignment.player.firstName} ${assignment.player.lastName}`
                      : assignment.playerId;
                    const targetCurrentCount = swapTargetPlayerId
                      ? scoutAssignmentsByPlayer.get(swapTargetPlayerId)?.scoutCount || 0
                      : 0;

                    return (
                      <div
                        key={assignment.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">
                            {formatName(sourceName)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Active scouts: {assignment.scoutCount}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          disabled={swapScoutMutation.isPending}
                          onClick={() => {
                            if (!swapTargetPlayerId) return;
                            swapScoutMutation.mutate({
                              fromPlayerId: assignment.playerId,
                              fromCount: assignment.scoutCount,
                              toPlayerId: swapTargetPlayerId,
                              toCount: targetCurrentCount + 1,
                            });
                          }}
                        >
                          {swapScoutMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Move 1"
                          )}
                        </Button>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                    No scout assignments available to swap.
                  </div>
                )}
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={swapScoutMutation.isPending}>Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

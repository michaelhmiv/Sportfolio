import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ChevronDown, ChevronUp, AlertTriangle, Zap, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shimmer } from "@/components/ui/animations";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GameInsight, GameInsightDetailResponse } from "@/types/game-insights";

interface GameCommandCenterModalProps {
  gameId: string;
  sport: string;
  date: string;
  initialInsight?: GameInsight | null;
  onClose: () => void;
}

interface LiveStatsResponse {
  gameId: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeTopPerformers?: Array<{ name: string; pts?: number; reb?: number; ast?: number }>;
  awayTopPerformers?: Array<{ name: string; pts?: number; reb?: number; ast?: number }>;
  message?: string;
}

interface GameStatsResponse {
  gameId: string;
  homeTeam: {
    players: Array<{ playerId: string; playerName: string; fantasyPoints: number; points: number; rebounds: number; assists: number }>;
    totals: Record<string, number> | null;
  };
  awayTeam: {
    players: Array<{ playerId: string; playerName: string; fantasyPoints: number; points: number; rebounds: number; assists: number }>;
    totals: Record<string, number> | null;
  };
  topPerformers: {
    topScorer: { playerName: string; points: number };
    topRebounder: { playerName: string; rebounds: number };
    topAssister: { playerName: string; assists: number };
  } | null;
  message?: string;
}

const formatName = (name: string) => {
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : name;
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
  const [activeTab, setActiveTab] = useState("pre");
  const [showAllInjuries, setShowAllInjuries] = useState(false);
  const [showBoostSelector, setShowBoostSelector] = useState(false);
  const [selectedTier, setSelectedTier] = useState<2 | 3 | 4 | 5 | null>(null);

  const { data: insight, isLoading } = useQuery<GameInsightDetailResponse>({
    queryKey: ["/api/games", gameId, "insights", sport, date],
    queryFn: async () => {
      const res = await fetch(`/api/games/${gameId}/insights?sport=${sport}&date=${date}`);
      if (!res.ok) throw new Error("Failed to fetch game insights");
      return res.json();
    },
    enabled: !!gameId,
  });

  const game = insight?.game || initialInsight;
  const leaders = insight?.leaders || game?.leaders;
  const userContext = insight?.userContext || game?.userContext || null;
  const boostSlotsRemaining = insight?.boostSlotsRemaining ?? null;

  const { data: liveStats, isLoading: isLoadingLive, refetch: refetchLive } = useQuery<LiveStatsResponse>({
    queryKey: ["/api/games", gameId, "live-stats"],
    queryFn: async () => {
      const res = await fetch(`/api/games/${gameId}/live-stats`);
      if (!res.ok) throw new Error("Failed to fetch live stats");
      return res.json();
    },
    enabled: activeTab === "during",
    refetchInterval: activeTab === "during" ? 30000 : false,
  });

  const { data: gameStats, isLoading: isLoadingStats, refetch: refetchStats } = useQuery<GameStatsResponse>({
    queryKey: ["/api/games", gameId, "stats"],
    queryFn: async () => {
      const res = await fetch(`/api/games/${gameId}/stats`);
      if (!res.ok) throw new Error("Failed to fetch game stats");
      return res.json();
    },
    enabled: activeTab === "post",
  });

  const topFantasy = useMemo(() => {
    if (!gameStats?.homeTeam?.players?.length && !gameStats?.awayTeam?.players?.length) {
      return [];
    }
    const players = [...(gameStats?.homeTeam?.players || []), ...(gameStats?.awayTeam?.players || [])];
    return [...players].sort((a, b) => b.fantasyPoints - a.fantasyPoints).slice(0, 5);
  }, [gameStats]);

  // Split top players by team for Pre-Game tab
  const awayTeamPlayers = useMemo(() => {
    if (!insight?.topPlayers?.fantasy || !game) return [];
    return insight.topPlayers.fantasy
      .filter(p => p.team === game.awayTeam)
      .slice(0, 5);
  }, [insight?.topPlayers?.fantasy, game]);

  const homeTeamPlayers = useMemo(() => {
    if (!insight?.topPlayers?.fantasy || !game) return [];
    return insight.topPlayers.fantasy
      .filter(p => p.team === game.homeTeam)
      .slice(0, 5);
  }, [insight?.topPlayers?.fantasy, game]);

  // Set of player IDs the user owns for quick lookup
  const ownedPlayerIds = useMemo(() => {
    if (!userContext?.topPowerPlayers) return new Set<string>();
    return new Set(userContext.topPowerPlayers.map(p => p.playerId));
  }, [userContext?.topPowerPlayers]);

  // Boost assignment mutation
  const assignBoostMutation = useMutation({
    mutationFn: async ({ playerId, slotTier, sharesEntered }: { playerId: string; slotTier: number; sharesEntered: number }) => {
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

  const startTimeLabel = game ? new Date(game.startTime).toLocaleString() : "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {game ? `${game.awayTeam} @ ${game.homeTeam}` : "Game Command Center"}
          </DialogTitle>
          {game && (
            <div className="text-xs text-muted-foreground">{startTimeLabel}</div>
          )}
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pre">Pre-Game</TabsTrigger>
            <TabsTrigger value="during">Live</TabsTrigger>
            <TabsTrigger value="post">Post-Game</TabsTrigger>
          </TabsList>

          <TabsContent value="pre" className="mt-4 space-y-4">
            {isLoading && !game ? (
              <div className="space-y-3">
                <Shimmer height="16px" width="60%" />
                <Shimmer height="120px" width="100%" />
              </div>
            ) : (
              <>
                {/* Compact Leaders Row */}
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-2 text-[11px]">
                  <div className="flex-1 text-center">
                    <div className="text-muted-foreground">FP Leader</div>
                    <div className="font-semibold truncate">{leaders?.fantasy?.name || "—"}</div>
                    <div className="text-muted-foreground">{leaders?.fantasy?.avgFantasyPointsPerGame?.toFixed(1) ?? "—"}</div>
                  </div>
                  <div className="w-px h-8 bg-border/60" />
                  <div className="flex-1 text-center">
                    <div className="text-muted-foreground">Shares Leader</div>
                    <div className="font-semibold truncate">{leaders?.shares?.name || "—"}</div>
                    <div className="text-muted-foreground">{leaders?.shares?.totalShares ?? "—"}</div>
                  </div>
                  <div className="w-px h-8 bg-border/60" />
                  <div className="flex-1 text-center">
                    <div className="text-muted-foreground">Scouts Leader</div>
                    <div className="font-semibold truncate">{leaders?.scouts?.name || "—"}</div>
                    <div className="text-muted-foreground">{leaders?.scouts?.scoutCount ?? "—"}</div>
                  </div>
                </div>

                {/* Team Rosters - Top 5 by Season Avg Fantasy Points */}
                <div className="grid gap-3 md:grid-cols-2">
                  {/* Away Team */}
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">{game?.awayTeam}</div>
                      <Badge variant="outline" className="text-[10px]">Top 5 by FP</Badge>
                    </div>
                    {awayTeamPlayers.length > 0 ? (
                      <div className="space-y-1.5">
                        {awayTeamPlayers.map((player, idx) => (
                          <div key={player.playerId} className="flex items-center justify-between text-xs">
                            <span className={ownedPlayerIds.has(player.playerId) ? "text-purple-400 font-medium" : ""}>
                              {idx + 1}. {formatName(player.name)}
                            </span>
                            <span className="font-mono text-muted-foreground">{player.avgFantasyPointsPerGame.toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No player data available</div>
                    )}
                  </div>

                  {/* Home Team */}
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">{game?.homeTeam}</div>
                      <Badge variant="outline" className="text-[10px]">Top 5 by FP</Badge>
                    </div>
                    {homeTeamPlayers.length > 0 ? (
                      <div className="space-y-1.5">
                        {homeTeamPlayers.map((player, idx) => (
                          <div key={player.playerId} className="flex items-center justify-between text-xs">
                            <span className={ownedPlayerIds.has(player.playerId) ? "text-purple-400 font-medium" : ""}>
                              {idx + 1}. {formatName(player.name)}
                            </span>
                            <span className="font-mono text-muted-foreground">{player.avgFantasyPointsPerGame.toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No player data available</div>
                    )}
                  </div>
                </div>

                {/* Your Power Players - Interactive with Quick Boost */}
                <div className="rounded-lg border-2 border-purple-500/40 bg-purple-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-purple-500" />
                      <div className="text-sm font-semibold">Your Power Players</div>
                      {userContext?.topPowerPlayers?.length ? (
                        <Badge variant="secondary" className="text-[10px] border-border/80">
                          {userContext.topPowerPlayers.length}
                        </Badge>
                      ) : null}
                    </div>

                    {/* Slots Button - Very clickable styling */}
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
                          <><X className="h-3 w-3 mr-1" />Close</>
                        ) : (
                          <><Zap className="h-3 w-3 mr-1" />Slots: {boostSlotsRemaining}</>
                        )}
                      </Button>
                    )}
                    {boostSlotsRemaining !== null && boostSlotsRemaining === 0 && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/80 px-2 py-1">
                        Slots: 0
                      </Badge>
                    )}
                  </div>

                  {/* Player badges - shown when collapsed */}
                  {!showBoostSelector && userContext?.topPowerPlayers?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {userContext.topPowerPlayers.slice(0, 4).map((player, idx) => (
                        <Badge key={`${player.playerId}-${idx}`} variant="outline" className="text-[10px] gap-1.5 border-border/80 px-2 py-1">
                          <span className="text-purple-500 font-medium">{formatName(player.name)}</span>
                          <span className="text-purple-500 font-mono">{player.powerLevel.toFixed(1)}p</span>
                        </Badge>
                      ))}
                      {userContext.topPowerPlayers.length > 4 && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/80">
                          +{userContext.topPowerPlayers.length - 4}
                        </Badge>
                      )}
                    </div>
                  ) : !showBoostSelector && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      No eligible holdings for this matchup
                    </div>
                  )}

                  {/* Quick Boost Selector - Expanded panel with clear borders */}
                  {showBoostSelector && boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
                    <div className="mt-3 p-3 rounded-lg border-2 border-purple-400 bg-background/80">
                      <div className="text-[11px] font-medium text-purple-700 dark:text-purple-400 mb-2">
                        Select tier & player to boost:
                      </div>

                      {/* Tier Selection */}
                      <div className="flex items-center gap-2 mb-3">
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

                      {/* Player List with Boost Button - Each row is ONE share */}
                      {userContext?.topPowerPlayers && userContext.topPowerPlayers.length > 0 ? (
                        <div className="space-y-1 max-h-40 overflow-y-auto border border-border/60 rounded-md p-1">
                          {userContext.topPowerPlayers.map((player, idx) => (
                            <div
                              key={`${player.playerId}-${idx}`}
                              className="flex items-center justify-between text-xs py-2 px-2 rounded bg-muted/30 hover:bg-purple-500/10 transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-medium truncate">{formatName(player.name)}</span>
                                <span className="text-muted-foreground text-[10px]">{player.team}</span>
                                <span className="text-purple-500 font-mono text-[10px]">{player.powerLevel.toFixed(1)} power</span>
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
                                  <><Zap className="h-3 w-3 mr-1" />Boost</>
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

                {/* Injuries - Compact */}
                <div className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      <span className="text-xs text-muted-foreground">Injuries</span>
                      {insight?.injuries?.length ? (
                        <Badge variant="outline" className="text-[10px]">{insight.injuries.length}</Badge>
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
                          <>Less <ChevronUp className="ml-1 h-3 w-3" /></>
                        ) : (
                          <>More <ChevronDown className="ml-1 h-3 w-3" /></>
                        )}
                      </Button>
                    )}
                  </div>
                  {insight?.injuries?.length ? (
                    <div className="mt-2 space-y-1.5">
                      {(showAllInjuries ? insight.injuries : insight.injuries.slice(0, 2)).map(player => (
                        <div key={player.playerId} className="flex items-center justify-between text-xs">
                          <span className="truncate">{formatName(player.name)} <span className="text-muted-foreground">({player.team})</span></span>
                          <Badge variant={player.status === 'Out' ? 'destructive' : 'outline'} className="text-[10px] ml-2 flex-shrink-0">
                            {player.status}
                          </Badge>
                        </div>
                      ))}
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
              <div className="text-sm font-semibold">Live Box Snapshot</div>
              <Button variant="outline" size="sm" onClick={() => refetchLive()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
            </div>
            {isLoadingLive ? (
              <Shimmer height="120px" width="100%" />
            ) : liveStats?.message ? (
              <div className="text-sm text-muted-foreground">{liveStats.message}</div>
            ) : liveStats ? (
              <div className="space-y-3 rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>{liveStats.awayTeam} {liveStats.awayScore}</span>
                  <span>@</span>
                  <span>{liveStats.homeTeam} {liveStats.homeScore}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">{liveStats.awayTeam} Leaders</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(liveStats.awayTopPerformers || []).slice(0, 3).map(player => (
                        <Badge key={player.name} variant="outline">
                          {formatName(player.name)} · {player.pts ?? 0}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{liveStats.homeTeam} Leaders</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(liveStats.homeTopPerformers || []).slice(0, 3).map(player => (
                        <Badge key={player.name} variant="outline">
                          {formatName(player.name)} · {player.pts ?? 0}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Live stats are not available yet.</div>
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
                    <div className="rounded-lg border border-border/60 p-3 text-xs">
                      <div className="text-muted-foreground">Top Scorer</div>
                      <div className="mt-1 font-semibold">{gameStats.topPerformers.topScorer.playerName}</div>
                      <div className="mt-1">{gameStats.topPerformers.topScorer.points} pts</div>
                    </div>
                    <div className="rounded-lg border border-border/60 p-3 text-xs">
                      <div className="text-muted-foreground">Top Rebounder</div>
                      <div className="mt-1 font-semibold">{gameStats.topPerformers.topRebounder.playerName}</div>
                      <div className="mt-1">{gameStats.topPerformers.topRebounder.rebounds} reb</div>
                    </div>
                    <div className="rounded-lg border border-border/60 p-3 text-xs">
                      <div className="text-muted-foreground">Top Assister</div>
                      <div className="mt-1 font-semibold">{gameStats.topPerformers.topAssister.playerName}</div>
                      <div className="mt-1">{gameStats.topPerformers.topAssister.assists} ast</div>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-border/60 p-3">
                  <div className="text-xs text-muted-foreground">Fantasy Points Leaders</div>
                  <div className="mt-2 space-y-2 text-xs">
                    {topFantasy.map(player => (
                      <div key={player.playerId} className="flex items-center justify-between">
                        <span>{formatName(player.playerName)}</span>
                        <span className="font-mono">{player.fantasyPoints.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Final stats are not available yet.</div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

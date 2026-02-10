import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shimmer } from "@/components/ui/animations";
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
  const [activeTab, setActiveTab] = useState("pre");

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

  const startTimeLabel = game ? new Date(game.startTime).toLocaleString() : "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
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
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-xs text-muted-foreground">FP Avg Leader</div>
                    <div className="mt-1 text-sm font-semibold">{leaders?.fantasy?.name || "—"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {leaders?.fantasy
                        ? `Avg ${leaders.fantasy.avgFantasyPointsPerGame.toFixed(1)} · Shares ${leaders.fantasy.totalShares} · Scouts ${leaders.fantasy.scoutCount}`
                        : "No leader data"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-xs text-muted-foreground">Shares Leader</div>
                    <div className="mt-1 text-sm font-semibold">{leaders?.shares?.name || "—"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {leaders?.shares
                        ? `Shares ${leaders.shares.totalShares} · Avg ${leaders.shares.avgFantasyPointsPerGame.toFixed(1)} · Scouts ${leaders.shares.scoutCount}`
                        : "No leader data"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-xs text-muted-foreground">Scout Leader</div>
                    <div className="mt-1 text-sm font-semibold">{leaders?.scouts?.name || "—"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {leaders?.scouts
                        ? `Scouts ${leaders.scouts.scoutCount} · Avg ${leaders.scouts.avgFantasyPointsPerGame.toFixed(1)} · Shares ${leaders.scouts.totalShares}`
                        : "No leader data"}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Your Edge</div>
                      <div className="text-sm font-semibold">
                        {userContext?.topPowerPlayers?.length
                          ? `${userContext.topPowerPlayers.length} power-ready players`
                          : "No eligible holdings for this matchup"}
                      </div>
                    </div>
                    {boostSlotsRemaining !== null && (
                      <Badge variant="outline">Boost slots: {boostSlotsRemaining}</Badge>
                    )}
                  </div>
                  {userContext?.topPowerPlayers?.length ? (
                    <div className="mt-3 space-y-2">
                      {userContext.topPowerPlayers.map(player => (
                        <div key={player.playerId} className="flex items-center justify-between text-xs">
                          <span>{formatName(player.name)}</span>
                          <span className="font-mono text-purple-400">{player.powerLevel.toFixed(2)} power</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border/60 p-3">
                  <div className="text-xs text-muted-foreground">Injuries</div>
                  {insight?.injuries?.length ? (
                    <div className="mt-2 space-y-2">
                      {insight.injuries.map(player => (
                        <div key={player.playerId} className="text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{formatName(player.name)} · {player.team}</span>
                            <Badge variant="outline">{player.status}</Badge>
                          </div>
                          {player.description && (
                            <div className="text-muted-foreground">{player.description}</div>
                          )}
                        </div>
                      ))}
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

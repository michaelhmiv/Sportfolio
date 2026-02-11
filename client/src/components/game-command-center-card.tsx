import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GameInsight } from "@/types/game-insights";
import { Activity, Calendar, Trophy, Zap, X, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GameCommandCenterCardProps {
  game: GameInsight;
  effectiveStatus: "scheduled" | "inprogress" | "completed" | "postponed";
  boostSlotsRemaining: number | null;
  isAuthenticated: boolean;
  onOpen: () => void;
}

const statusConfig = {
  scheduled: { label: "Scheduled", icon: Calendar, variant: "outline" as const },
  inprogress: { label: "Live", icon: Activity, variant: "default" as const },
  completed: { label: "Final", icon: Trophy, variant: "secondary" as const },
  postponed: { label: "Postponed", icon: Calendar, variant: "outline" as const },
};

export function GameCommandCenterCard({
  game,
  effectiveStatus,
  boostSlotsRemaining,
  isAuthenticated,
  onOpen,
}: GameCommandCenterCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showBoostSelector, setShowBoostSelector] = useState(false);
  const [selectedTier, setSelectedTier] = useState<2 | 3 | 4 | 5 | null>(null);

  const status = statusConfig[effectiveStatus];
  const StatusIcon = status.icon;
  const startTime = new Date(game.startTime);
  const timeLabel = startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const powerLeader = game.userContext?.topPowerPlayers?.[0];

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
      const date = game.gameDay;
      const res = await apiRequest("POST", "/api/daily-boosts/assign", {
        playerId,
        slotTier,
        sharesEntered,
        sport: game.sport,
        date,
      });
      return res.json();
    },
    onSuccess: () => {
      // Invalidate the specific insights query used by dashboard to refresh slots/leaders
      queryClient.invalidateQueries({ queryKey: ["/api/games/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games", game.gameId, "insights"] });
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

  const LeaderRow = ({
    label,
    leader,
    value,
  }: {
    label: string;
    leader: string;
    value: string | number;
  }) => (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground w-16 flex-shrink-0">{label}</span>
      <span className="truncate flex-1 text-right mr-2">{leader}</span>
      <span className="font-mono font-semibold text-right w-14">{value}</span>
    </div>
  );

  const formatLeader = (leader: GameInsight["leaders"]["fantasy"]) => (leader ? leader.name : "—");

  const formatNumber = (value: number | null | undefined, digits: number = 0) =>
    value === null || value === undefined ? "—" : value.toFixed(digits);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-lg border border-border bg-card p-3 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={status.variant} className="gap-1 text-[10px] uppercase">
            <StatusIcon className="h-3 w-3" />
            {status.label}
          </Badge>
          {effectiveStatus === "scheduled" && (
            <span className="text-xs text-muted-foreground">{timeLabel}</span>
          )}
        </div>
        {effectiveStatus === "inprogress" && (
          <span className="text-xs text-muted-foreground">{timeLabel}</span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-sm font-semibold">{game.awayTeam}</div>
          <div className="text-sm font-semibold">{game.homeTeam}</div>
        </div>
        <div className="text-right font-mono">
          <div className="text-base font-bold">{game.awayScore ?? "-"}</div>
          <div className="text-base font-bold">{game.homeScore ?? "-"}</div>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <LeaderRow
          label="FP Avg"
          leader={formatLeader(game.leaders.fantasy)}
          value={formatNumber(game.leaders.fantasy?.avgFantasyPointsPerGame, 1)}
        />
        <LeaderRow
          label="TSV"
          leader={formatLeader(game.leaders.shares)}
          value={game.leaders.shares ? game.leaders.shares.totalShares : "—"}
        />
        <LeaderRow
          label="Scouts"
          leader={formatLeader(game.leaders.scouts)}
          value={game.leaders.scouts ? game.leaders.scouts.scoutCount : "—"}
        />
      </div>

      {isAuthenticated && game.userContext && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Eligible badge - non clickable */}
            <Badge variant="outline" className="text-[10px] border-border/80">
              Eligible: {game.userContext.eligibleCount}
            </Badge>

            {/* Slots badge - CLICKABLE with distinct styling */}
            {boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowBoostSelector(!showBoostSelector);
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border-2 transition-all ${
                  showBoostSelector
                    ? "bg-purple-600 text-white border-purple-600"
                    : "bg-purple-50 text-purple-700 border-purple-400 hover:bg-purple-100 hover:border-purple-500 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-600/50"
                }`}
              >
                {showBoostSelector ? (
                  <>
                    <X className="h-3 w-3" />
                    Close
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3" />
                    Slots: {boostSlotsRemaining}
                  </>
                )}
              </button>
            )}
            {boostSlotsRemaining !== null && boostSlotsRemaining === 0 && (
              <Badge
                variant="outline"
                className="text-[10px] text-muted-foreground border-border/80"
              >
                Slots: 0
              </Badge>
            )}

            {/* Power badge - non clickable info */}
            {powerLeader && powerLeader.powerLevel > 0 && (
              <Badge
                variant="secondary"
                className="gap-1 text-[10px] text-purple-500 border-border/80"
              >
                <Zap className="h-3 w-3" />
                Power {powerLeader.powerLevel.toFixed(2)}
              </Badge>
            )}
          </div>

          {/* Quick Boost Selector - Inline expandable panel */}
          {showBoostSelector && boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
            <div
              className="mt-3 p-3 rounded-lg border-2 border-purple-400 bg-purple-50/50 dark:bg-purple-950/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[11px] font-medium text-purple-700 dark:text-purple-400 mb-2">
                Select tier & player to boost:
              </div>

              {/* Tier Selection */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] text-muted-foreground">Tier:</span>
                <div className="flex gap-1">
                  {([5, 4, 3, 2] as const).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setSelectedTier(selectedTier === tier ? null : tier)}
                      className={`px-2 py-1 rounded text-[10px] font-medium border-2 transition-all ${
                        selectedTier === tier
                          ? "bg-purple-600 text-white border-purple-600"
                          : "bg-background text-foreground border-border hover:border-purple-400"
                      }`}
                    >
                      {tier}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Player List - Each row represents ONE share with its power level */}
              {game.userContext.topPowerPlayers.length > 0 ? (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {game.userContext.topPowerPlayers.map((player, idx) => (
                    <div
                      key={`${player.playerId}-${idx}`}
                      className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-background/80"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium truncate">{player.name}</span>
                        <span className="text-muted-foreground text-[10px]">{player.team}</span>
                        <span className="text-purple-500 font-mono text-[10px]">
                          {player.powerLevel.toFixed(1)} power
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant={selectedTier ? "default" : "ghost"}
                        disabled={!selectedTier || assignBoostMutation.isPending}
                        className={`h-6 px-2 text-[10px] ${selectedTier ? "bg-purple-600 hover:bg-purple-700" : ""}`}
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
                <div className="text-xs text-muted-foreground text-center py-3 bg-background/50 rounded">
                  No eligible players to boost
                </div>
              )}
            </div>
          )}

          {/* Collapsed power players list (shown when boost selector is closed) */}
          {!showBoostSelector && game.userContext.topPowerPlayers.length > 0 && (
            <div className="mt-2 space-y-1 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Your Power Shares
              </div>
              {game.userContext.topPowerPlayers.slice(0, 3).map((player, idx) => (
                <div
                  key={`${player.playerId}-${idx}`}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{player.name}</span>
                  <span className="font-mono text-purple-400">
                    {player.powerLevel.toFixed(1)} power
                  </span>
                </div>
              ))}
              {game.userContext.topPowerPlayers.length > 3 && (
                <div className="text-[10px] text-muted-foreground text-center">
                  +{game.userContext.topPowerPlayers.length - 3} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

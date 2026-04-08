import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GameInsight } from "@/types/game-insights";
import { Activity, Calendar, Trophy, Zap, X, RefreshCw } from "lucide-react";
import { formatSignedAdaptiveCurrency } from "@/lib/currency";
import { openPlayerModal } from "@/lib/player-modal-events";
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

const listingGridClass =
  "grid grid-cols-[minmax(74px,1.05fr)_minmax(52px,0.8fr)_minmax(52px,0.8fr)_minmax(86px,1fr)_minmax(88px,1fr)] items-start gap-x-2";

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
  const userContext = game.userContext;
  const startTime = new Date(game.startTime);
  const timeLabel = startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateLabel = startTime.toLocaleDateString([], { month: "short", day: "numeric" });
  const powerLeader = userContext?.topMultiplierPlayers?.[0];
  const showBoostPanel = Boolean(
    userContext && (userContext.eligibleCount > 0 || userContext.topMultiplierPlayers.length > 0),
  );

  const ownedTeams = new Set(
    [
      ...(userContext?.ownedPlayers || []).map((player) => player.team?.toUpperCase()),
      ...(userContext?.topMultiplierPlayers || []).map((player) => player.team?.toUpperCase()),
    ].filter(Boolean),
  );

  const progressValue =
    effectiveStatus === "inprogress" || effectiveStatus === "completed"
      ? `${game.awayScore ?? "-"}-${game.homeScore ?? "-"}`
      : "--";

  const progressMeta =
    effectiveStatus === "scheduled"
      ? `Opens ${timeLabel}`
      : effectiveStatus === "postponed"
        ? "Postponed"
        : effectiveStatus === "inprogress"
          ? "Live board"
          : "Final";
  const marketStatusLabel = status.label;
  const marketDetailLabel =
    effectiveStatus === "inprogress"
      ? String(game.liveMarketStatus || "").trim() || `${dateLabel} ${timeLabel}`
      : effectiveStatus === "scheduled"
        ? timeLabel
        : `${dateLabel} ${timeLabel}`;

  const getLiveEarnedDisplay = () => {
    if (!isAuthenticated || !userContext) {
      return { label: "--", toneClass: "text-muted-foreground", meta: "Sign in" };
    }

    const earningsStatus = userContext.earningsStatus || effectiveStatus;
    if (earningsStatus === "scheduled" || earningsStatus === "postponed") {
      return { label: "--", toneClass: "text-muted-foreground", meta: "Pre-market" };
    }

    if (typeof userContext.liveEarned !== "number" || Number.isNaN(userContext.liveEarned)) {
      return { label: "--", toneClass: "text-muted-foreground", meta: "No earn line" };
    }

    const rawValue = userContext.liveEarned;
    return {
      label: formatSignedAdaptiveCurrency(rawValue, { zeroDisplay: "$0.00" }),
      toneClass:
        rawValue > 0
          ? "text-emerald-500"
          : rawValue < 0
            ? "text-rose-500"
            : "text-muted-foreground",
      meta: "Captured",
    };
  };

  const liveEarnedDisplay = getLiveEarnedDisplay();
  const openPlayerFromName = (
    event: React.MouseEvent | React.KeyboardEvent,
    playerId: string | null | undefined,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    openPlayerModal(playerId);
  };

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

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-sm border-2 border-border/90 bg-card p-3 shadow-none transition-all hover:border-border hover:shadow-none"
    >
      <div className="rounded-md border border-border/70 bg-background/40 overflow-hidden">
        <div
          className={`${listingGridClass} border-b border-border/60 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground`}
        >
          <div>Market</div>
          <div>Away</div>
          <div>Home</div>
          <div>Progress</div>
          <div className="text-right">Live Earned</div>
        </div>
        <div className={`${listingGridClass} px-2 py-2`}>
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em]">
              <StatusIcon className="h-3 w-3 text-muted-foreground" />
              <span>{marketStatusLabel}</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {marketDetailLabel}
            </div>
          </div>

          <div
            className={`text-xs sm:text-sm font-semibold truncate ${ownedTeams.has(game.awayTeam?.toUpperCase()) ? "text-primary" : "text-foreground"}`}
          >
            {game.awayTeam}
          </div>

          <div
            className={`text-xs sm:text-sm font-semibold truncate ${ownedTeams.has(game.homeTeam?.toUpperCase()) ? "text-primary" : "text-foreground"}`}
          >
            {game.homeTeam}
          </div>

          <div className="min-w-0">
            <div className="font-mono text-xs sm:text-sm font-semibold truncate">
              {progressValue}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{progressMeta}</div>
          </div>

          <div className="text-right min-w-0">
            <div
              className={`font-mono text-xs sm:text-sm font-semibold truncate ${liveEarnedDisplay.toneClass}`}
            >
              {liveEarnedDisplay.label}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {liveEarnedDisplay.meta}
            </div>
          </div>
        </div>
      </div>

      {isAuthenticated && userContext && showBoostPanel && effectiveStatus === "scheduled" && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Eligible badge - non clickable */}
            <Badge variant="outline" className="text-[10px] border-border/80">
              Eligible: {userContext.eligibleCount}
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

            {/* Multiplier badge - non-clickable info */}
            {powerLeader && powerLeader.multiplier > 0 && (
              <Badge
                variant="secondary"
                className="gap-1 text-[10px] text-purple-500 border-border/80"
              >
                <Zap className="h-3 w-3" />
                Multi {powerLeader.multiplier.toFixed(2)}x
              </Badge>
            )}
          </div>

          {/* Quick Boost Selector - Inline expandable panel */}
          {showBoostSelector && boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
            <div
              className="mt-3 rounded-sm border-2 border-purple-400 bg-purple-50/50 p-3 dark:bg-purple-950/20"
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

              {/* Player list: each row represents one share and its current multiplier. */}
              {userContext.topMultiplierPlayers.length > 0 ? (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {userContext.topMultiplierPlayers.map((player, idx) => (
                    <div
                      key={`${player.playerId}-${idx}`}
                      className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-background/80"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => openPlayerFromName(event, player.playerId)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              openPlayerFromName(event, player.playerId);
                            }
                          }}
                          className="font-medium truncate cursor-pointer underline-offset-2 hover:underline focus-visible:underline"
                        >
                          {player.name}
                        </span>
                        <span className="text-muted-foreground text-[10px]">{player.team}</span>
                        <span className="text-purple-500 font-mono text-[10px]">
                          {player.multiplier.toFixed(1)}x
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

          {/* Collapsed stacked-share list (shown when boost selector is closed) */}
          {!showBoostSelector && userContext.topMultiplierPlayers.length > 0 && (
            <div className="mt-2 space-y-1 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Your Stacked Shares
              </div>
              {userContext.topMultiplierPlayers.slice(0, 3).map((player, idx) => (
                <div
                  key={`${player.playerId}-${idx}`}
                  className="flex items-center justify-between"
                >
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => openPlayerFromName(event, player.playerId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        openPlayerFromName(event, player.playerId);
                      }
                    }}
                    className="truncate cursor-pointer underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {player.name}
                  </span>
                  <span className="font-mono text-purple-400">{player.multiplier.toFixed(1)}x</span>
                </div>
              ))}
              {userContext.topMultiplierPlayers.length > 3 && (
                <div className="text-[10px] text-muted-foreground text-center">
                  +{userContext.topMultiplierPlayers.length - 3} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

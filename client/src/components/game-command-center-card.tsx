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
import { MlbSignalChips } from "@/components/mlb-gameplay-signals";

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

const BOOST_SLOT_TIERS = [10, 7, 5, 3, 2] as const;
type BoostSlotTier = (typeof BOOST_SLOT_TIERS)[number];

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
  const [selectedTier, setSelectedTier] = useState<BoostSlotTier | null>(null);

  const status = statusConfig[effectiveStatus];
  const StatusIcon = status.icon;
  const userContext = game.userContext;
  const boostCandidates = (userContext?.ownedPlayers || []).filter(
    (player) => player.availableShares >= 1 && !player.isBoosted,
  );
  const startTime = new Date(game.startTime);
  const timeLabel = startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateLabel = startTime.toLocaleDateString([], { month: "short", day: "numeric" });
  const showBoostPanel = Boolean(
    userContext && (userContext.eligibleCount > 0 || boostCandidates.length > 0),
  );

  const ownedTeams = new Set(
    (userContext?.ownedPlayers || [])
      .map((player) => player.team?.toUpperCase())
      .filter(Boolean),
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
          ? "text-market-positive"
          : rawValue < 0
            ? "text-market-negative"
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

  const assignBoostMutation = useMutation({
    mutationFn: async ({
      playerId,
      slotTier,
      sharesEntered,
    }: {
      playerId: string;
      slotTier: BoostSlotTier;
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
      queryClient.invalidateQueries({ queryKey: ["/api/games/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games", game.gameId, "insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-boosts"] });
      toast({
        title: "Boost Applied!",
        description: "One Single was assigned to this game's Boost slot.",
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
    <div className="w-full rounded-compact border-2 border-border/90 bg-card p-3 text-left shadow-none transition-all hover:border-border hover:shadow-none">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full overflow-hidden rounded-control border border-border/70 bg-background/40 text-left"
        aria-label={`Open ${game.awayTeam} at ${game.homeTeam} game details`}
      >
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
      </button>

      {game.sport?.toUpperCase() === "MLB" ? (
        <MlbSignalChips signals={game.mlbSignals} limit={3} />
      ) : null}

      {isAuthenticated && userContext && showBoostPanel && effectiveStatus === "scheduled" && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] border-border/80">
              Eligible: {userContext.eligibleCount}
            </Badge>

            {boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowBoostSelector(!showBoostSelector);
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-compact text-[10px] font-medium border-2 transition-all ${
                  showBoostSelector
                    ? "border-boost bg-boost text-boost-foreground"
                    : "border-boost/40 bg-boost/10 text-boost hover:border-boost/60 hover:bg-hover"
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
          </div>

          {showBoostSelector && boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
            <div
              className="mt-3 rounded-panel border-2 border-boost/40 bg-boost/10 p-3"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 text-[11px] font-medium text-boost">
                Select a slot and boost-ready player. Quick Boost burns one Single.
              </div>

              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] text-muted-foreground">Slot:</span>
                <div className="flex flex-wrap gap-1">
                  {BOOST_SLOT_TIERS.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setSelectedTier(selectedTier === tier ? null : tier)}
                      aria-pressed={selectedTier === tier}
                      className={`px-2 py-1 rounded-compact text-[10px] font-medium border-2 transition-all ${
                        selectedTier === tier
                          ? "border-boost bg-boost text-boost-foreground"
                          : "border-border bg-background text-foreground hover:border-boost"
                      }`}
                    >
                      {tier}x
                    </button>
                  ))}
                </div>
              </div>

              {boostCandidates.length > 0 ? (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {boostCandidates.map((player) => (
                    <div
                      key={player.playerId}
                      className="flex items-center justify-between text-xs py-1.5 px-2 rounded-compact bg-background/80"
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
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {player.availableShares} Singles
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant={selectedTier ? "default" : "ghost"}
                        disabled={!selectedTier || assignBoostMutation.isPending}
                        className={`h-6 px-2 text-[10px] ${selectedTier ? "bg-boost text-boost-foreground hover:bg-boost/90" : ""}`}
                        onClick={() => {
                          if (selectedTier) {
                            assignBoostMutation.mutate({
                              playerId: player.playerId,
                              slotTier: selectedTier,
                              sharesEntered: 1,
                            });
                          }
                        }}
                      >
                        {assignBoostMutation.isPending ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Zap className="h-3 w-3 mr-1" />
                            Boost 1
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground text-center py-3 bg-background/50 rounded-compact">
                  No eligible Singles to boost
                </div>
              )}
            </div>
          )}

          {!showBoostSelector && boostCandidates.length > 0 && (
            <div className="mt-2 space-y-1 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Boost-ready holdings
              </div>
              {boostCandidates.slice(0, 3).map((player) => (
                <div
                  key={player.playerId}
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
                  <span className="font-mono text-muted-foreground">
                    {player.availableShares} Singles
                  </span>
                </div>
              ))}
              {boostCandidates.length > 3 && (
                <div className="text-[10px] text-muted-foreground text-center">
                  +{boostCandidates.length - 3} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

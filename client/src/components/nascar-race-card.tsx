/**
 * NASCAR Race Card Component
 *
 * Displays a NASCAR race with driver standings, lap info, and boost controls.
 * Used on the dashboard when NASCAR is selected as the sport.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Calendar, Trophy, Zap, X, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface NascarDriverStanding {
  position: number;
  startingPosition: number;
  playerId: string;
  driverName: string;
  carNumber: string;
  manufacturer: string;
  lapsCompleted: number;
  lapsLed: number;
  fantasyPoints: number;
}

export interface NascarLapInfo {
  currentLap: number;
  totalLaps: number;
  lapsToGo: number;
  flagState: string;
}

export interface NascarRace {
  raceId: string;
  trackName: string;
  series: string;
  raceDate: string;
  status: "scheduled" | "inprogress" | "completed";
  venue: string;
  lapInfo: NascarLapInfo | null;
  liveEarned?: number | null;
  driverStandings: NascarDriverStanding[];
  totalDrivers: number;
}

export interface NascarRaceCardProps {
  race: NascarRace;
  boostSlotsRemaining: number | null;
  isAuthenticated: boolean;
  userHoldings: any[];
  onOpen: () => void;
}

const statusConfig = {
  scheduled: { label: "Scheduled", icon: Calendar, variant: "outline" as const },
  inprogress: { label: "Live", icon: Activity, variant: "default" as const },
  completed: { label: "Final", icon: Trophy, variant: "secondary" as const },
};

const flagColorMap: Record<string, string> = {
  Green: "bg-green-500",
  Yellow: "bg-yellow-500",
  Red: "bg-red-500",
  Checkered: "bg-black",
  White: "bg-white",
};

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const standardCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const listingGridClass =
  "grid grid-cols-[minmax(74px,1fr)_minmax(90px,1fr)_minmax(90px,1fr)_minmax(86px,1fr)_minmax(88px,1fr)] items-start gap-x-2";

export function NascarRaceCard({
  race,
  boostSlotsRemaining,
  isAuthenticated,
  userHoldings,
  onOpen,
}: NascarRaceCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showBoostSelector, setShowBoostSelector] = useState(false);
  const [selectedTier, setSelectedTier] = useState<2 | 3 | 4 | 5 | null>(null);

  const status = statusConfig[race.status] || statusConfig.scheduled;
  const StatusIcon = status.icon;
  const startTime = new Date(race.raceDate);
  const timeLabel = startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  // Get user's drivers for this race's series
  const userDriversForRace = userHoldings.filter((h) => h.team === race.series);
  const eligibleDrivers = userDriversForRace.filter(
    (h) => h.availableShares > 0 || parseFloat(h.multiplier || "0") > 0 || h.isBoosted,
  );

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
      const date = new Date(race.raceDate).toISOString().split("T")[0];
      const res = await apiRequest("POST", "/api/daily-boosts/assign", {
        playerId,
        slotTier,
        sharesEntered,
        sport: "NASCAR",
        date,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/races/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-boosts"] });
      toast({
        title: "Boost Applied!",
        description: "Your driver has been boosted for this race.",
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

  const showBoostPanel = isAuthenticated && eligibleDrivers.length > 0;
  const boostedDrivers = userDriversForRace.filter((h) => h.isBoosted);
  const dateLabel = startTime.toLocaleDateString([], { month: "short", day: "numeric" });
  const leader = race.driverStandings[0] || null;

  const progressValue =
    race.status === "inprogress" && race.lapInfo
      ? `Lap ${race.lapInfo.currentLap}/${race.lapInfo.totalLaps}`
      : race.status === "completed"
        ? "Final"
        : "--";

  const progressMeta =
    race.status === "inprogress" && race.lapInfo
      ? `${race.lapInfo.lapsToGo} to go`
      : race.status === "completed"
        ? `${race.totalDrivers} finished`
        : `Opens ${timeLabel}`;

  const getLiveEarnedDisplay = () => {
    if (!isAuthenticated) {
      return { label: "--", toneClass: "text-muted-foreground", meta: "Sign in" };
    }

    if (race.status === "scheduled") {
      return { label: "--", toneClass: "text-muted-foreground", meta: "Pre-race" };
    }

    const rawValue = typeof race.liveEarned === "number" ? race.liveEarned : 0;
    const formatter =
      Math.abs(rawValue) >= 1000 ? compactCurrencyFormatter : standardCurrencyFormatter;
    const absValue = formatter.format(Math.abs(rawValue));

    if (rawValue > 0) {
      return { label: `+${absValue}`, toneClass: "text-emerald-500", meta: "Captured" };
    }

    if (rawValue < 0) {
      return { label: `-${absValue}`, toneClass: "text-rose-500", meta: "Captured" };
    }

    return { label: "$0.00", toneClass: "text-muted-foreground", meta: "Captured" };
  };

  const liveEarnedDisplay = getLiveEarnedDisplay();

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
          <div className="col-span-2">Race</div>
          <div>Progress</div>
          <div className="text-right">Live Earned</div>
        </div>

        <div className={`${listingGridClass} px-2 py-2`}>
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em]">
              <StatusIcon className="h-3 w-3 text-muted-foreground" />
              <span>{status.label}</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {dateLabel} {timeLabel}
            </div>
          </div>

          <div className="col-span-2 min-w-0">
            <div className="text-xs sm:text-sm font-semibold truncate">{race.trackName}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {race.series} Series
              {leader ? ` | P1 ${leader.driverName} #${leader.carNumber}` : ""}
            </div>
          </div>

          <div className="min-w-0">
            <div className="font-mono text-xs sm:text-sm font-semibold truncate">
              {progressValue}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate flex items-center gap-1">
              {race.status === "inprogress" && race.lapInfo && (
                <span
                  className={`h-1.5 w-1.5 rounded-sm ${flagColorMap[race.lapInfo.flagState] || "bg-gray-500"}`}
                />
              )}
              <span>{progressMeta}</span>
            </div>
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

      {/* Boost Panel */}
      {isAuthenticated && showBoostPanel && race.status === "scheduled" && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] border-border/80">
              Eligible: {eligibleDrivers.length}
            </Badge>

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
                    : "bg-purple-50 text-purple-700 border-purple-400 hover:bg-purple-100 hover:border-purple-500"
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

            {boostedDrivers.length > 0 && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Zap className="h-3 w-3" />
                {boostedDrivers.length} Boosted
              </Badge>
            )}
          </div>

          {/* Boost Selector */}
          {showBoostSelector && boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
            <div
              className="mt-3 rounded-sm border-2 border-purple-400 bg-purple-50 p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[11px] font-medium text-purple-700 mb-2">
                Select tier & driver to boost:
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

              {/* Driver List */}
              {eligibleDrivers.length > 0 ? (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {eligibleDrivers.slice(0, 5).map((driver) => (
                    <div
                      key={driver.playerId}
                      className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-background/80"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium truncate">{driver.name}</span>
                        <span className="text-purple-500 font-mono text-[10px]">
                          {driver.multiplier > 0
                            ? `${driver.multiplier.toFixed(1)}x`
                            : `${driver.availableShares} shares`}
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
                              playerId: driver.playerId,
                              slotTier: selectedTier as number,
                              sharesEntered: driver.availableShares,
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
                <div className="text-xs text-muted-foreground text-center py-3">
                  No eligible drivers to boost
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

export default NascarRaceCard;

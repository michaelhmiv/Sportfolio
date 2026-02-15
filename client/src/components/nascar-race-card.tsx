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
import { Activity, Calendar, Trophy, Zap, X, RefreshCw, Flag } from "lucide-react";
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
    (h) => h.availableShares > 0 || parseFloat(h.powerLevel) > 0 || h.isBoosted
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

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-lg border-2 border-border/90 bg-card p-3 shadow-sm transition-all hover:border-border hover:shadow-md"
    >
      {/* Header: Status and Time */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={status.variant} className="gap-1 text-[10px] uppercase">
            <StatusIcon className="h-3 w-3" />
            {status.label}
          </Badge>
          {race.status === "inprogress" && race.lapInfo && (
            <div className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${flagColorMap[race.lapInfo.flagState] || "bg-gray-500"}`} />
              <span className="text-xs text-muted-foreground">
                Lap {race.lapInfo.currentLap}/{race.lapInfo.totalLaps}
              </span>
            </div>
          )}
          {race.status === "scheduled" && (
            <span className="text-xs text-muted-foreground">{timeLabel}</span>
          )}
        </div>
      </div>

      {/* Race Info */}
      <div className="mt-2">
        <div className="text-lg font-bold">{race.trackName}</div>
        <div className="text-sm text-muted-foreground">{race.series} Series</div>
      </div>

      {/* Driver Count / Lap Info */}
      {race.status === "inprogress" && race.lapInfo && (
        <div className="mt-2 text-xs text-muted-foreground">
          {race.totalDrivers} drivers | {race.lapInfo.lapsToGo} laps to go
        </div>
      )}
      {race.status === "completed" && (
        <div className="mt-2 text-xs text-muted-foreground">
          {race.totalDrivers} drivers finished
        </div>
      )}

      {/* Top 3 Preview (if available) */}
      {race.driverStandings.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Leader</div>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="font-bold text-yellow-500">1</span>
              <span className="font-medium">{race.driverStandings[0]?.driverName || "TBD"}</span>
              <span className="text-muted-foreground text-xs">
                #{race.driverStandings[0]?.carNumber}
              </span>
            </div>
            <span className="font-mono text-purple-400">
              {race.driverStandings[0]?.fantasyPoints.toFixed(1)} FP
            </span>
          </div>
        </div>
      )}

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
              className="mt-3 p-3 rounded-lg border-2 border-purple-400 bg-purple-50"
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
                          {driver.powerLevel > 0 ? `${driver.powerLevel.toFixed(1)} power` : `${driver.availableShares} shares`}
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

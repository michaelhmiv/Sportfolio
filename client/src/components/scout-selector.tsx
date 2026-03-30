/**
 * Scout Selector Component
 *
 * Allows users to assign scouts to a player from within the player modal.
 * Uses a slider to select scout count (0 to available capacity).
 * Scouts earn shares hourly via the Scout-Minute distribution system.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Binoculars, Loader2, Info, Crown, Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ScoutSelectorProps {
  playerId: string;
}

interface ScoutData {
  assignments: Array<{
    id: string;
    playerId: string;
    scoutCount: number;
    globalScoutCount: number;
    player?: { firstName: string; lastName: string };
  }>;
  totalScouts: number;
  maxScouts: number;
  remaining: number;
  isPremium: boolean;
  premiumActive?: boolean;
  rewardedScoutBoostActive?: boolean;
}

export function ScoutSelector({ playerId }: ScoutSelectorProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch user's scout data
  const { data: scoutData, isLoading } = useQuery<ScoutData>({
    queryKey: ["/api/scouts"],
  });

  // Find current assignment for this player
  const currentAssignment = scoutData?.assignments.find((a) => a.playerId === playerId);
  const currentCount = currentAssignment?.scoutCount || 0;

  // Local state for slider
  const [sliderValue, setSliderValue] = useState(currentCount);

  // Sync slider with fetched data
  useEffect(() => {
    setSliderValue(currentCount);
  }, [currentCount]);

  // Calculate statistics
  const remaining = scoutData?.remaining || 0;
  const maxForThisPlayer = currentCount + remaining;

  // Global stats
  const globalCount = currentAssignment?.globalScoutCount || 0;
  const otherScouts = Math.max(0, globalCount - currentCount);

  // Calculate projected earnings based on slider value
  // Formula: (My Scouts / (Other Scouts + My Scouts)) * 60 shares/hr
  const projectedTotal = otherScouts + sliderValue;
  const projectedShare = projectedTotal > 0 ? (sliderValue / projectedTotal) * 60 : 0;

  // Mutation for assigning scouts
  const assignMutation = useMutation({
    mutationFn: async (count: number) => {
      return apiRequest("POST", "/api/scouts/assign", { playerId, count });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] });
      toast({
        title: "Scouts Updated",
        description:
          sliderValue === 0
            ? "Scouts removed from this player"
            : `${sliderValue} scout${sliderValue > 1 ? "s" : ""} assigned`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to assign scouts",
        description: error.message || "Please try again",
        variant: "destructive",
      });
      // Reset slider to previous value
      setSliderValue(currentCount);
    },
  });

  const handleSave = () => {
    if (sliderValue !== currentCount) {
      assignMutation.mutate(sliderValue);
    }
  };

  const hasChanges = sliderValue !== currentCount;

  if (isLoading) {
    return (
      <div className="border rounded-md p-2 bg-accent/5">
        <div className="flex items-center gap-1 mb-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  return (
    <div className="border border-amber-500/20 rounded-sm bg-amber-500/5 p-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Binoculars className="h-3.5 w-3.5 text-amber-600" />
          <span className="text-xs font-semibold">Scout This Player</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[250px]">
                <p className="text-xs">
                  EARNINGS RULE: 60 shares are distributed per hour among all scouts on this player.
                  Your share = (Your Scouts / Total Scouts) * 60.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">
            {scoutData?.totalScouts || 0}/{scoutData?.maxScouts || 5} used
          </span>
          {(scoutData?.premiumActive ?? scoutData?.isPremium) && (
            <Badge
              variant="secondary"
              className="h-4 px-1 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            >
              <Crown className="h-2.5 w-2.5 mr-0.5" />
              PRO
            </Badge>
          )}
          {!(scoutData?.premiumActive ?? scoutData?.isPremium) &&
            scoutData?.rewardedScoutBoostActive && (
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              >
                <Zap className="h-2.5 w-2.5 mr-0.5" />
                BOOST
              </Badge>
            )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Slider
              value={[sliderValue]}
              min={0}
              max={Math.max(maxForThisPlayer, 1)}
              step={1}
              onValueChange={(val) => setSliderValue(val[0])}
              disabled={assignMutation.isPending}
              className="cursor-pointer"
            />
          </div>
          <div className="w-8 text-center">
            <span
              className={`text-sm font-bold ${sliderValue > 0 ? "text-amber-600" : "text-muted-foreground"}`}
            >
              {sliderValue}
            </span>
          </div>
        </div>

        <div className="flex justify-between items-center text-[10px] px-1 py-1.5 bg-background/50 rounded border border-border/50">
          <div className="text-muted-foreground">
            Global Scouts:{" "}
            <span className="font-mono text-foreground">{otherScouts + sliderValue}</span>
          </div>
          <div className="font-medium">
            Est. Earnings:{" "}
            <span className="text-amber-600 font-bold">{projectedShare.toFixed(2)}</span> / hr
          </div>
        </div>

        {hasChanges && (
          <Button
            size="sm"
            className="w-full h-7 text-xs bg-amber-600 hover:bg-amber-700"
            onClick={handleSave}
            disabled={assignMutation.isPending}
          >
            {assignMutation.isPending ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Binoculars className="h-3 w-3 mr-1" />
                {sliderValue === 0
                  ? "Remove Scouts"
                  : `Assign ${sliderValue} Scout${sliderValue > 1 ? "s" : ""}`}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

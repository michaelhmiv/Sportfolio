import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Binoculars, Clock, Coins } from "lucide-react";
import { useScout } from "@/lib/scout-context";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

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
}

interface ScoutStatus {
    earnedMinutes: number;
    nextDistribution: string; // ISO date string
}

interface ScoutWidgetProps {
    className?: string;
    compact?: boolean;
}

export function ScoutWidget({ className, compact = false }: ScoutWidgetProps) {
    const { openScoutDashboard } = useScout();
    const [timeLeft, setTimeLeft] = useState("");

    const { data: scoutData, isLoading } = useQuery<ScoutData>({
        queryKey: ["/api/scouts"],
    });

    const { data: scoutStatus } = useQuery<ScoutStatus>({
        queryKey: ["/api/scouts/status"],
        refetchInterval: 30000, // Sync every 30s
    });

    // Countdown Timer logic
    useEffect(() => {
        if (!scoutStatus?.nextDistribution) return;

        const interval = setInterval(() => {
            const now = new Date();
            const target = new Date(scoutStatus.nextDistribution);
            const diff = target.getTime() - now.getTime();

            if (diff <= 0) {
                setTimeLeft("Distributing...");
            } else {
                const minutes = Math.floor(diff / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [scoutStatus?.nextDistribution]);

    // Calculate estimated shares per hour
    const totalScouts = scoutData?.totalScouts || 0;
    const maxScouts = scoutData?.maxScouts || 5;
    const playerCount = scoutData?.assignments?.length || 0;

    const estimatedSharesPerHour = scoutData?.assignments.reduce((sum, assignment) => {
        const globalCount = assignment.globalScoutCount || 0;
        const effectiveGlobal = Math.max(globalCount, assignment.scoutCount);
        if (effectiveGlobal === 0) return sum;
        const share = (assignment.scoutCount / effectiveGlobal) * 60;
        return sum + share;
    }, 0) || 0;

    const formattedEstimate = estimatedSharesPerHour.toFixed(1);
    const progressPercent = maxScouts > 0 ? (totalScouts / maxScouts) * 100 : 0;
    const earnedMinutes = scoutStatus?.earnedMinutes || 0;

    if (isLoading) {
        return (
            <div className={cn("flex items-center gap-2", className)}>
                <Skeleton className="h-8 w-20" />
            </div>
        );
    }

    // Compact mobile version
    if (compact) {
        return (
            <Button
                variant="ghost"
                size="sm"
                onClick={openScoutDashboard}
                className={cn(
                    "flex items-center gap-1.5 px-2 h-8 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30",
                    className
                )}
                data-testid="button-scout-widget-mobile"
            >
                <Binoculars className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-xs font-semibold text-amber-600">
                    {totalScouts}/{maxScouts}
                </span>
                {timeLeft && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 ml-1 pl-1 border-l border-amber-500/20">
                        <Clock className="w-3 h-3" /> {timeLeft}
                    </span>
                )}
            </Button>
        );
    }

    // Full desktop version
    return (
        <Button
            variant="ghost"
            onClick={openScoutDashboard}
            className={cn(
                "flex flex-col items-start gap-0.5 h-auto py-1.5 px-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20 border border-amber-500/20",
                className
            )}
            data-testid="button-scout-widget"
        >
            <div className="flex items-center gap-1.5 w-full">
                <Binoculars className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-xs font-medium text-muted-foreground">Scouts</span>
                <span className="ml-auto text-xs font-semibold text-foreground">
                    {totalScouts}/{maxScouts}
                </span>
            </div>

            <div className="flex items-center gap-2 w-full mt-1">
                <Progress
                    value={progressPercent}
                    className="h-1.5 flex-1 bg-amber-100 dark:bg-amber-900/30"
                    data-testid="progress-scout-widget"
                />
                {playerCount > 0 && timeLeft ? (
                    <div className="flex flex-col items-end leading-none">
                        <span className="text-[10px] text-amber-600 font-medium" data-testid="text-scout-rate">
                            ~{formattedEstimate}/hr
                        </span>
                        <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> Next: {timeLeft}
                        </span>
                    </div>
                ) : (
                    <span className="text-[10px] text-muted-foreground">
                        {playerCount === 0 ? "No players" : ""}
                    </span>
                )}
            </div>
            {/* Expanded details on hover (optional, but for now simple display of earned minutes if > 0) */}
            {earnedMinutes > 0 && (
                <div className="w-full mt-1 pt-1 border-t border-amber-500/10 flex justify-between items-center text-[10px]">
                    <span className="text-muted-foreground">Est. Earned</span>
                    <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
                        {earnedMinutes} min
                    </span>
                </div>
            )}
        </Button>
    );
}

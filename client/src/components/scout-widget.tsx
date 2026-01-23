import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Binoculars, Clock } from "lucide-react";
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
                "flex items-center gap-2 h-auto py-1.5 px-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20 border border-amber-500/20",
                className
            )}
            data-testid="button-scout-widget"
        >
            <Binoculars className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium">Scouts: {totalScouts}/{maxScouts}</span>
        </Button>
    );
}

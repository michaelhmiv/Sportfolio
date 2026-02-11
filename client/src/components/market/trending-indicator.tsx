import { motion } from "framer-motion";
import { Flame, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TrendingIndicatorProps {
  scoutVelocity: number; // Scouts added per hour
  isTrending?: boolean;
  className?: string;
  showTooltip?: boolean;
}

export function TrendingIndicator({
  scoutVelocity,
  isTrending = false,
  className,
  showTooltip = true,
}: TrendingIndicatorProps) {
  if (!isTrending && scoutVelocity < 5) return null;

  const intensity = scoutVelocity >= 20 ? "high" : scoutVelocity >= 10 ? "medium" : "low";

  const colors = {
    high: "text-red-500 bg-red-500/10 border-red-500/30",
    medium: "text-orange-500 bg-orange-500/10 border-orange-500/30",
    low: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  };

  const icons = {
    high: Flame,
    medium: TrendingUp,
    low: TrendingUp,
  };

  const Icon = icons[intensity];

  const content = (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className={className}
    >
      <Badge
        variant="outline"
        className={cn("flex items-center gap-1 font-medium", colors[intensity])}
      >
        <motion.div
          animate={
            intensity === "high"
              ? {
                  scale: [1, 1.2, 1],
                  rotate: [0, -5, 5, 0],
                }
              : {}
          }
          transition={{
            duration: 1,
            repeat: Infinity,
            repeatDelay: intensity === "high" ? 1 : 2,
          }}
        >
          <Icon className="w-3 h-3" />
        </motion.div>
        <span>Trending</span>
      </Badge>
    </motion.div>
  );

  if (!showTooltip) return content;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{scoutVelocity.toFixed(1)} scouts/hour</p>
          <p className="text-[10px] text-muted-foreground">High scout activity detected</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface ScoutVelocityBadgeProps {
  currentScouts: number;
  previousScouts: number;
  timeWindowHours?: number;
  className?: string;
}

export function ScoutVelocityBadge({
  currentScouts,
  previousScouts,
  timeWindowHours = 1,
  className,
}: ScoutVelocityBadgeProps) {
  const velocity = (currentScouts - previousScouts) / timeWindowHours;
  const isTrending = velocity >= 10;

  if (velocity <= 0) return null;

  return (
    <TrendingIndicator scoutVelocity={velocity} isTrending={isTrending} className={className} />
  );
}

interface ScoutCountBadgeProps {
  count: number;
  showAnimation?: boolean;
  className?: string;
}

export function ScoutCountBadge({ count, showAnimation = true, className }: ScoutCountBadgeProps) {
  if (count === 0) return null;

  return (
    <motion.div
      initial={showAnimation ? { scale: 0, opacity: 0 } : {}}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className={className}
    >
      <Badge
        variant="outline"
        className="flex items-center gap-1 bg-blue-500/10 text-blue-500 border-blue-500/20"
      >
        <Users className="w-3 h-3" />
        <span>
          {count} scout{count !== 1 ? "s" : ""}
        </span>
      </Badge>
    </motion.div>
  );
}

// Hook to fetch and track scout velocity
import { useEffect, useState } from "react";
import { useWebSocket } from "@/lib/websocket";

interface ScoutVelocityData {
  playerId: string;
  velocity: number; // Scouts per hour
  totalScouts: number;
  isTrending: boolean;
}

export function useScoutVelocity(playerId: string) {
  const [data, setData] = useState<ScoutVelocityData | null>(null);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    // Subscribe to scout velocity updates
    const unsubscribe = subscribe("scout_velocity_update", (message) => {
      if (message.playerId === playerId) {
        setData({
          playerId: message.playerId,
          velocity: message.velocity,
          totalScouts: message.totalScouts,
          isTrending: message.velocity >= 10,
        });
      }
    });

    // Fetch initial data
    const fetchInitialData = async () => {
      try {
        const res = await fetch(`/api/scouts/velocity/${playerId}`);
        if (res.ok) {
          const result = await res.json();
          setData({
            playerId,
            velocity: result.velocity,
            totalScouts: result.totalScouts,
            isTrending: result.velocity >= 10,
          });
        }
      } catch (error) {
        console.error("Failed to fetch scout velocity:", error);
      }
    };

    fetchInitialData();

    return () => {
      unsubscribe();
    };
  }, [playerId, subscribe]);

  return data;
}

// Hook to get trending players
export function useTrendingPlayers() {
  const [trendingPlayers, setTrendingPlayers] = useState<string[]>([]);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    // Subscribe to trending updates
    const unsubscribe = subscribe("trending_players_update", (message) => {
      setTrendingPlayers(message.playerIds || []);
    });

    // Fetch initial trending players
    const fetchTrending = async () => {
      try {
        const res = await fetch("/api/scouts/trending");
        if (res.ok) {
          const result = await res.json();
          setTrendingPlayers(result.playerIds || []);
        }
      } catch (error) {
        console.error("Failed to fetch trending players:", error);
      }
    };

    fetchTrending();

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  return trendingPlayers;
}

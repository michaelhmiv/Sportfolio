import { motion } from "framer-motion";
import { Flame, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface BoostCounterBadgeProps {
  count: number;
  showCount?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function BoostCounterBadge({
  count,
  showCount = true,
  size = "sm",
  className,
}: BoostCounterBadgeProps) {
  if (count === 0) return null;

  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0 h-5",
    md: "text-xs px-2 py-0.5 h-6",
    lg: "text-sm px-3 py-1 h-7",
  };

  const iconSizes = {
    sm: "w-2.5 h-2.5",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  };

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className={className}
    >
      <Badge
        variant="outline"
        className={cn(
          "bg-amber-500/10 text-amber-500 border-amber-500/20",
          "flex items-center gap-1 font-medium",
          sizeClasses[size]
        )}
      >
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, -5, 5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            repeatDelay: 3,
          }}
        >
          <Flame className={cn("text-amber-500", iconSizes[size])} />
        </motion.div>
        {showCount && <span>{count}</span>}
      </Badge>
    </motion.div>
  );
}

interface CommunityBoostIndicatorProps {
  count: number;
  className?: string;
}

export function CommunityBoostIndicator({
  count,
  className,
}: CommunityBoostIndicatorProps) {
  if (count === 0) return null;

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full",
        "bg-violet-500/10 border border-violet-500/20",
        "text-violet-500 text-xs font-medium",
        className
      )}
    >
      <Users className="w-3 h-3" />
      <span>+{count} community</span>
    </motion.div>
  );
}

import { useEffect, useState } from "react";
import { useWebSocket } from "@/lib/websocket";

export function useLiveBoostCount(playerId: string, date: string) {
  const [count, setCount] = useState(0);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    // Subscribe to boost count updates
    const unsubscribe = subscribe("boost_count_update", (message) => {
      if (message.playerId === playerId && message.date === date) {
        setCount(message.count);
      }
    });

    // Fetch initial count
    const fetchInitialCount = async () => {
      try {
        const res = await fetch(`/api/boosts/count/${playerId}/${date}`);
        if (res.ok) {
          const data = await res.json();
          setCount(data.count);
        }
      } catch (error) {
        console.error("Failed to fetch boost count:", error);
      }
    };

    fetchInitialCount();

    return () => {
      unsubscribe();
    };
  }, [playerId, date, subscribe]);

  return count;
}

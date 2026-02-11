import { motion } from "framer-motion";
import { AlertTriangle, TrendingUp, TrendingDown, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface BoostThresholdWarningProps {
  currentPoints: number;
  nextThreshold: number;
  estimatedPayout: number;
  className?: string;
}

export function BoostThresholdWarning({
  currentPoints,
  nextThreshold,
  estimatedPayout,
  className,
}: BoostThresholdWarningProps) {
  const pointsNeeded = nextThreshold - currentPoints;
  const isClose = pointsNeeded <= 5 && pointsNeeded > 0;

  if (!isClose) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full",
        "bg-amber-500/10 border border-amber-500/30",
        "text-amber-500 text-sm font-medium",
        className,
      )}
    >
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          rotate: [0, -5, 5, 0],
        }}
        transition={{
          duration: 0.5,
          repeat: Infinity,
          repeatDelay: 2,
        }}
      >
        <Flame className="w-4 h-4" />
      </motion.div>
      <span>{pointsNeeded.toFixed(1)} pts to next tier!</span>
      <span className="text-amber-400/70 text-xs">(+${estimatedPayout.toFixed(2)})</span>
    </motion.div>
  );
}

interface LiveFantasyPointsProps {
  points: number;
  previousPoints?: number;
  multiplier: number;
  powerLevel: number;
  className?: string;
}

export function LiveFantasyPoints({
  points,
  previousPoints,
  multiplier,
  powerLevel,
  className,
}: LiveFantasyPointsProps) {
  const [displayPoints, setDisplayPoints] = useState(points);
  const [isUpdating, setIsUpdating] = useState(false);
  const [trend, setTrend] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (previousPoints !== undefined && previousPoints !== points) {
      const direction = points > previousPoints ? "up" : "down";
      setTrend(direction);
      setIsUpdating(true);
      setDisplayPoints(points);

      const timer = setTimeout(() => {
        setIsUpdating(false);
        setTrend(null);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [points, previousPoints]);

  const estimatedPayout = points * multiplier * powerLevel;

  return (
    <div
      className={cn(
        "inline-flex flex-col items-center p-4 rounded-xl border bg-card",
        isUpdating &&
          trend === "up" &&
          "border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]",
        isUpdating && trend === "down" && "border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">
          Fantasy Points
        </span>
        {trend && (
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              trend === "up" ? "text-emerald-500" : "text-red-500",
            )}
          >
            {trend === "up" ? (
              <>
                <TrendingUp className="w-3 h-3" />
                <span>+{(points - (previousPoints || 0)).toFixed(1)}</span>
              </>
            ) : (
              <>
                <TrendingDown className="w-3 h-3" />
                <span>-{Math.abs((previousPoints || 0) - points).toFixed(1)}</span>
              </>
            )}
          </motion.div>
        )}
      </div>

      <motion.div
        key={displayPoints}
        initial={isUpdating ? { scale: 1.2 } : {}}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className={cn(
          "text-4xl font-bold font-mono",
          trend === "up" && "text-emerald-500",
          trend === "down" && "text-red-500",
        )}
      >
        {displayPoints.toFixed(1)}
      </motion.div>

      <div className="mt-2 text-center">
        <p className="text-xs text-muted-foreground">Est. Payout</p>
        <motion.p
          key={estimatedPayout}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-lg font-bold text-emerald-500 font-mono"
        >
          ${estimatedPayout.toFixed(2)}
        </motion.p>
      </div>

      {/* Pulse ring for updates */}
      {isUpdating && (
        <motion.div
          className={cn(
            "absolute inset-0 rounded-xl border-2",
            trend === "up" ? "border-emerald-500" : "border-red-500",
          )}
          initial={{ opacity: 0.5, scale: 1 }}
          animate={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 1, repeat: 2 }}
        />
      )}
    </div>
  );
}

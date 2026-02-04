import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface LiveRankTickerProps {
  rank: number;
  totalEntries: number;
  previousRank?: number;
  className?: string;
}

export function LiveRankTicker({
  rank,
  totalEntries,
  previousRank,
  className,
}: LiveRankTickerProps) {
  const [displayRank, setDisplayRank] = useState(rank);
  const [isImproving, setIsImproving] = useState<boolean | null>(null);
  const [showPulse, setShowPulse] = useState(false);

  useEffect(() => {
    if (previousRank !== undefined && previousRank !== rank) {
      const improving = rank < previousRank;
      setIsImproving(improving);
      setShowPulse(true);
      setDisplayRank(rank);

      // Reset pulse after animation
      const timer = setTimeout(() => {
        setShowPulse(false);
      }, 2000);

      return () => clearTimeout(timer);
    } else {
      setDisplayRank(rank);
    }
  }, [rank, previousRank]);

  const percentComplete = ((totalEntries - displayRank + 1) / totalEntries) * 100;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 px-4 py-2 rounded-lg bg-card border",
        showPulse && isImproving && "border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]",
        showPulse && !isImproving && isImproving !== null && "border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]",
        className
      )}
    >
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Rank
          </span>
          <AnimatePresence mode="wait">
            {showPulse && (
              <motion.div
                key={isImproving ? "up" : "down"}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className={cn(
                  "flex items-center gap-1 text-xs font-medium",
                  isImproving ? "text-emerald-500" : "text-red-500"
                )}
              >
                {isImproving ? (
                  <>
                    <TrendingUp className="w-3 h-3" />
                    <span>+{previousRank! - rank}</span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-3 h-3" />
                    <span>-{rank - previousRank!}</span>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-baseline gap-1">
          <motion.span
            key={displayRank}
            initial={showPulse ? { scale: 1.2 } : {}}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className={cn(
              "text-2xl font-bold font-mono",
              showPulse && isImproving && "text-emerald-500",
              showPulse && !isImproving && isImproving !== null && "text-red-500"
            )}
          >
            #{displayRank}
          </motion.span>
          <span className="text-sm text-muted-foreground">
            of {totalEntries}
          </span>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="w-16 h-12 relative">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          {/* Background circle */}
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-muted/20"
          />
          {/* Progress circle */}
          <motion.path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className={cn(
              percentComplete >= 50 ? "text-emerald-500" : "text-amber-500",
              showPulse && isImproving && "text-emerald-500",
              showPulse && !isImproving && isImproving !== null && "text-red-500"
            )}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: percentComplete / 100 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </svg>

        {/* Center icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          {percentComplete >= 50 ? (
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          ) : (
            <Minus className="w-4 h-4 text-amber-500" />
          )}
        </div>
      </div>
    </div>
  );
}

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface BubbleWarningProps {
  isActive: boolean;
  rank: number;
  cutLine: number;
  className?: string;
}

export function BubbleWarning({
  isActive,
  rank,
  cutLine,
  className,
}: BubbleWarningProps) {
  if (!isActive) return null;

  const positionsFromCut = cutLine - rank;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full",
        "bg-red-500/10 border border-red-500/30",
        "text-red-500 text-sm font-medium",
        className
      )}
    >
      <motion.div
        animate={{
          scale: [1, 1.1, 1],
          opacity: [1, 0.7, 1],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <AlertTriangle className="w-4 h-4" />
      </motion.div>
      <span>On the bubble!</span>
      <span className="text-red-400/70 text-xs">
        ({positionsFromCut} {positionsFromCut === 1 ? "spot" : "spots"} from cut)
      </span>
    </motion.div>
  );
}

interface RankDisplayProps {
  rank: number;
  totalEntries: number;
  isOnBubble?: boolean;
  className?: string;
}

export function RankDisplay({
  rank,
  totalEntries,
  isOnBubble = false,
  className,
}: RankDisplayProps) {
  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <div
        className={cn(
          "relative px-4 py-2 rounded-lg font-mono font-bold text-lg",
          "bg-card border-2 transition-all duration-300",
          isOnBubble
            ? "border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]"
            : "border-border"
        )}
      >
        <span>#{rank}</span>
        <span className="text-muted-foreground text-sm ml-1">
          / {totalEntries}
        </span>

        {/* Pulsing ring for bubble warning */}
        {isOnBubble && (
          <motion.div
            className="absolute inset-0 rounded-lg border-2 border-red-500"
            animate={{
              scale: [1, 1.05, 1],
              opacity: [0.5, 0, 0.5],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        )}
      </div>
    </div>
  );
}

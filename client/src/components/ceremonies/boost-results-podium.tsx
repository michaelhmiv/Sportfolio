import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Trophy, Zap, TrendingUp, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface BoostResult {
  slotTier: number;
  playerName: string;
  playerTeam: string;
  fantasyPoints: number;
  multiplier: number;
  shareMultiplier: number;
  payout: number;
}

interface BoostResultsPodiumProps {
  isOpen: boolean;
  results: BoostResult[];
  totalPayout: number;
  onClose: () => void;
}

function getTierVisuals(tier: number) {
  switch (tier) {
    case 5:
      return {
        color: "#EF4444",
        bgColor: "bg-red-500/10",
        borderColor: "border-red-500/30",
        textColor: "text-red-500",
        glowColor: "shadow-red-500/30",
        label: "5x",
        icon: Flame,
      };
    case 4:
      return {
        color: "#F97316",
        bgColor: "bg-orange-500/10",
        borderColor: "border-orange-500/30",
        textColor: "text-orange-500",
        glowColor: "shadow-orange-500/30",
        label: "4x",
        icon: Zap,
      };
    case 3:
      return {
        color: "#8B5CF6",
        bgColor: "bg-violet-500/10",
        borderColor: "border-violet-500/30",
        textColor: "text-violet-500",
        glowColor: "shadow-violet-500/30",
        label: "3x",
        icon: TrendingUp,
      };
    case 2:
    default:
      return {
        color: "#3B82F6",
        bgColor: "bg-blue-500/10",
        borderColor: "border-blue-500/30",
        textColor: "text-blue-500",
        glowColor: "shadow-blue-500/30",
        label: "2x",
        icon: TrendingUp,
      };
  }
}

function ResultCard({
  result,
  index,
  delay,
}: {
  result: BoostResult;
  index: number;
  delay: number;
}) {
  const visuals = getTierVisuals(result.slotTier);
  const Icon = visuals.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 25,
        delay,
      }}
      className={cn(
        "flex flex-col items-center rounded-sm border p-4",
        visuals.bgColor,
        visuals.borderColor,
      )}
    >
      {/* Tier badge */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 20, delay: delay + 0.2 }}
        className={cn(
          "mb-3 flex h-12 w-12 items-center justify-center rounded-sm",
          "bg-card border-2",
          visuals.borderColor,
        )}
      >
        <Icon className={cn("w-6 h-6", visuals.textColor)} />
      </motion.div>

      {/* Player info */}
      <div className="text-center mb-3">
        <p className="font-semibold text-sm truncate max-w-[120px]">{result.playerName}</p>
        <p className="text-xs text-muted-foreground">{result.playerTeam}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 w-full text-center">
        <div className="rounded-sm bg-card/50 p-2">
          <p className="text-[10px] text-muted-foreground">FP</p>
          <p className="font-mono font-bold text-sm">{result.fantasyPoints.toFixed(1)}</p>
        </div>
        <div className="rounded-sm bg-card/50 p-2">
          <p className="text-[10px] text-muted-foreground">Mult</p>
          <p className={cn("font-mono font-bold text-sm", visuals.textColor)}>
            {result.multiplier}x
          </p>
        </div>
      </div>

      {/* Payout */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: delay + 0.4 }}
        className="mt-3 text-center"
      >
        <p
          className={cn(
            "text-2xl font-bold font-mono",
            result.payout > 0 ? "text-emerald-500" : "text-muted-foreground",
          )}
        >
          ${result.payout.toFixed(2)}
        </p>
      </motion.div>
    </motion.div>
  );
}

export function BoostResultsPodium({
  isOpen,
  results,
  totalPayout,
  onClose,
}: BoostResultsPodiumProps) {
  const [showTotal, setShowTotal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowTotal(false);
      const timer = setTimeout(() => setShowTotal(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Sort by payout (highest first)
  const sortedResults = [...results].sort((a, b) => b.payout - a.payout);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
        onClick={onClose}
      >
        <div className="w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <div className="mb-4 inline-flex items-center gap-2 rounded-sm border border-emerald-500/20 bg-emerald-500/10 px-4 py-2">
              <Trophy className="w-5 h-5 text-emerald-500" />
              <span className="font-medium text-emerald-500">Boost Results</span>
            </div>
            <h2 className="text-2xl font-bold">Today's Performance</h2>
          </motion.div>

          {/* Results grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {sortedResults.map((result, index) => (
              <ResultCard key={result.slotTier} result={result} index={index} delay={index * 0.1} />
            ))}
          </div>

          {/* Total payout */}
          <AnimatePresence>
            {showTotal && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className={cn(
                  "rounded-sm border p-6 text-center",
                  totalPayout > 0
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : "bg-muted border-border",
                )}
              >
                <p className="text-sm text-muted-foreground mb-2">Total Payout</p>
                <motion.p
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.2 }}
                  className={cn(
                    "text-5xl font-bold font-mono",
                    totalPayout > 0 ? "text-emerald-500" : "text-muted-foreground",
                  )}
                >
                  ${totalPayout.toFixed(2)}
                </motion.p>

                {totalPayout > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="mt-4 flex items-center justify-center gap-2 text-sm text-emerald-400"
                  >
                    <Zap className="w-4 h-4" />
                    <span>Great job! Your boosts paid off.</span>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Close button */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center mt-6"
          >
            <Button onClick={onClose} variant="terminal">
              Continue
            </Button>
          </motion.div>

          {/* Close hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-center text-xs text-muted-foreground mt-4"
          >
            Click anywhere to close
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

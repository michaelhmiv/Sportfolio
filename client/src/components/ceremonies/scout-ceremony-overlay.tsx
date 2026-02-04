import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import { X, Binoculars } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ScoutDistribution {
  playerId: string;
  playerName: string;
  playerTeam: string;
  playerPosition: string;
  sport: string;
  sharesEarned: number;
  scoutMinutes: number;
  globalMinutes: number;
  efficiency: number;
}

interface ScoutCeremonyData {
  distributions: ScoutDistribution[];
  totalShares: number;
  totalPlayers: number;
  highlight: ScoutDistribution;
  hourTimestamp: string;
}

interface ScoutCeremonyOverlayProps {
  isOpen: boolean;
  data: ScoutCeremonyData | null;
  onClose: () => void;
  onComplete?: () => void;
}

// Data particle component
function DataParticle({ 
  delay, 
  duration, 
  color 
}: { 
  delay: number; 
  duration: number; 
  color: string;
}) {
  return (
    <motion.div
      className="absolute w-2 h-2 rounded-sm"
      style={{ backgroundColor: color }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        scale: [0, 1, 1, 0.5],
        y: [0, -20, -40, -60],
        x: [0, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, 0],
      }}
      transition={{
        duration,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    />
  );
}

// Player card component
function ScoutPlayerCard({
  distribution,
  index,
  isHighlight,
}: {
  distribution: ScoutDistribution;
  index: number;
  isHighlight: boolean;
}) {
  const efficiencyColor =
    distribution.efficiency < 20
      ? "#F59E0B" // Amber
      : distribution.efficiency < 50
      ? "#10B981" // Emerald
      : "#8B5CF6"; // Violet

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 25,
        delay: index * 0.05,
      }}
      className={cn(
        "relative p-3 rounded-lg border bg-card",
        isHighlight && "ring-2 ring-emerald-500/50"
      )}
    >
      {/* Efficiency indicator */}
      <div
        className="absolute top-2 right-2 w-2 h-2 rounded-full"
        style={{ backgroundColor: efficiencyColor }}
      />

      {/* Player info */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-xs font-bold">
          {distribution.playerName
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{distribution.playerName}</p>
          <p className="text-xs text-muted-foreground">
            {distribution.playerTeam} • {distribution.sport}
          </p>
        </div>
      </div>

      {/* Shares earned */}
      <motion.div
        className="mt-2 text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 + index * 0.05 }}
      >
        <span className="text-lg font-bold text-emerald-500">
          +{distribution.sharesEarned.toFixed(2)}
        </span>
        <span className="text-xs text-muted-foreground ml-1">shares</span>
      </motion.div>

      {/* Particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(3)].map((_, i) => (
          <DataParticle
            key={i}
            delay={0.5 + index * 0.05 + i * 0.1}
            duration={1.5}
            color={efficiencyColor}
          />
        ))}
      </div>
    </motion.div>
  );
}

// Animated counter component
function AnimatedCounter({ value, duration = 2 }: { value: number; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
      
      // Ease out quart
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = value * easeOutQuart;
      
      setDisplayValue(current);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [value, duration]);

  return (
    <span className="font-mono font-bold">
      {displayValue.toFixed(2)}
    </span>
  );
}

export function ScoutCeremonyOverlay({
  isOpen,
  data,
  onClose,
  onComplete,
}: ScoutCeremonyOverlayProps) {
  const [phase, setPhase] = useState<"intro" | "flow" | "celebration" | "outro">("intro");
  const [showSkip, setShowSkip] = useState(false);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (isOpen && data) {
      startTimeRef.current = Date.now();
      setPhase("intro");
      setShowSkip(false);

      // Show skip button after 1 second
      const skipTimer = setTimeout(() => setShowSkip(true), 1000);

      // Phase transitions
      const flowTimer = setTimeout(() => setPhase("flow"), 500);
      const celebrationTimer = setTimeout(() => setPhase("celebration"), 2500);
      const outroTimer = setTimeout(() => {
        setPhase("outro");
        onComplete?.();
      }, 4000);

      return () => {
        clearTimeout(skipTimer);
        clearTimeout(flowTimer);
        clearTimeout(celebrationTimer);
        clearTimeout(outroTimer);
      };
    }
  }, [isOpen, data, onComplete]);

  const handleSkip = () => {
    const duration = Date.now() - startTimeRef.current;
    // Track analytics here if needed
    console.log(`[ScoutCeremony] Skipped after ${duration}ms`);
    onClose();
  };

  if (!isOpen || !data) return null;

  // Paginate if more than 8 players
  const displayDistributions = data.distributions.slice(0, 8);
  const hasMore = data.distributions.length > 8;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
        onClick={handleSkip}
      >
        {/* Close button */}
        {showSkip && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              handleSkip();
            }}
          >
            <X className="w-5 h-5" />
          </motion.button>
        )}

        <div
          className="w-full max-w-2xl mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-center mb-6"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20">
              <Binoculars className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-medium text-amber-500">
                Scout Data Harvested
              </span>
            </div>
          </motion.div>

          {/* Player grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {displayDistributions.map((dist, index) => (
              <ScoutPlayerCard
                key={dist.playerId}
                distribution={dist}
                index={index}
                isHighlight={dist.playerId === data.highlight?.playerId}
              />
            ))}
            {hasMore && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="p-3 rounded-lg border bg-card/50 flex items-center justify-center"
              >
                <span className="text-sm text-muted-foreground">
                  +{data.distributions.length - 8} more
                </span>
              </motion.div>
            )}
          </div>

          {/* Total counter */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{
              opacity: phase === "celebration" ? 1 : 0.5,
              scale: phase === "celebration" ? 1 : 0.95,
            }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="text-center"
          >
            <div className="inline-flex flex-col items-center p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <span className="text-sm text-muted-foreground mb-1">
                Total Shares Earned
              </span>
              <div className="text-4xl font-bold text-emerald-500">
                <AnimatedCounter value={data.totalShares} duration={2} />
              </div>
              <span className="text-xs text-muted-foreground mt-2">
                from {data.totalPlayers} players
              </span>
            </div>
          </motion.div>

          {/* Skip hint */}
          {showSkip && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-xs text-muted-foreground mt-6"
            >
              Click anywhere to close
            </motion.p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

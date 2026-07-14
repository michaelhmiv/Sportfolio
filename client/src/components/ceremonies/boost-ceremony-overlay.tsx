import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { X, Zap, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BoostCeremonyData {
  playerName: string;
  playerTeam: string;
  slotTier: number;
  shareMultiplier: number; // Multiplier of the share selected for the boost
  totalMultiplier: number;
  sharesBurned: number;
}

interface BoostCeremonyOverlayProps {
  isOpen: boolean;
  data: BoostCeremonyData | null;
  onClose: () => void;
}

// Energy beam component
function EnergyBeam({ color, delay }: { color: string; delay: number }) {
  return (
    <motion.div
      className="absolute h-1 rounded-compact"
      style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: "100%", opacity: [0, 1, 1, 0] }}
      transition={{
        duration: 0.8,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    />
  );
}

// Particle burst component
function ParticleBurst({ color, count = 8 }: { color: string; count?: number }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {[...Array(count)].map((_, i) => {
        const angle = (360 / count) * i;
        const distance = 30 + (i % 5) * 4;
        return (
          <motion.div
            key={i}
            className="absolute h-1.5 w-1.5 rounded-compact"
            style={{ backgroundColor: color }}
            initial={{
              x: 0,
              y: 0,
              opacity: 0,
              scale: 0,
            }}
            animate={{
              x: [0, Math.cos((angle * Math.PI) / 180) * distance],
              y: [0, Math.sin((angle * Math.PI) / 180) * distance],
              opacity: [0, 1, 0],
              scale: [0, 1, 0.5],
            }}
            transition={{
              duration: 0.6,
              delay: 0.3 + i * 0.02,
              ease: "easeOut",
            }}
          />
        );
      })}
    </div>
  );
}

// Get tier color and icon
function getTierVisuals(tier: number) {
  switch (tier) {
    case 5:
      return {
        color: "hsl(var(--tier-mythic))",
        bgColor: "bg-tier-mythic/10",
        borderColor: "border-tier-mythic/30",
        textColor: "text-tier-mythic",
        glowColor: "shadow-tier-mythic/30",
        label: "5x",
        intensity: "high",
      };
    case 4:
      return {
        color: "hsl(var(--tier-legendary))",
        bgColor: "bg-tier-legendary/10",
        borderColor: "border-tier-legendary/30",
        textColor: "text-tier-legendary",
        glowColor: "shadow-tier-legendary/30",
        label: "4x",
        intensity: "high",
      };
    case 3:
      return {
        color: "hsl(var(--tier-elite))",
        bgColor: "bg-tier-elite/10",
        borderColor: "border-tier-elite/30",
        textColor: "text-tier-elite",
        glowColor: "shadow-tier-elite/30",
        label: "3x",
        intensity: "medium",
      };
    case 2:
    default:
      return {
        color: "hsl(var(--tier-boosted))",
        bgColor: "bg-tier-boosted/10",
        borderColor: "border-tier-boosted/30",
        textColor: "text-tier-boosted",
        glowColor: "shadow-tier-boosted/30",
        label: "2x",
        intensity: "low",
      };
  }
}

export function BoostCeremonyOverlay({ isOpen, data, onClose }: BoostCeremonyOverlayProps) {
  const [phase, setPhase] = useState<"intro" | "charge" | "boost" | "complete">("intro");
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (isOpen && data) {
      setPhase("intro");

      const timers = [
        setTimeout(() => setPhase("charge"), prefersReducedMotion ? 0 : 300),
        setTimeout(() => setPhase("boost"), prefersReducedMotion ? 0 : 1000),
        setTimeout(() => setPhase("complete"), prefersReducedMotion ? 0 : 2000),
        setTimeout(() => onClose(), prefersReducedMotion ? 2500 : 3500),
      ];

      return () => timers.forEach(clearTimeout);
    }
  }, [isOpen, data, onClose, prefersReducedMotion]);

  if (!isOpen || !data) return null;

  const visuals = getTierVisuals(data.slotTier);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="boost-ceremony-title"
      >
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: prefersReducedMotion ? 0 : 0.5 }}
          className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-control border border-border/60 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close boost ceremony"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="w-5 h-5" />
        </motion.button>

        <div className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
            className="text-center mb-8"
          >
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-compact px-4 py-2 border",
                visuals.bgColor,
                visuals.borderColor,
              )}
            >
              <Zap className={cn("w-4 h-4", visuals.textColor)} />
              <span
                id="boost-ceremony-title"
                className={cn("text-sm font-medium", visuals.textColor)}
              >
                Boost Applied
              </span>
            </div>
          </motion.div>

          {/* Main content */}
          <div className="relative">
            {/* Share card */}
            <motion.div
              initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                duration: prefersReducedMotion ? 0 : 0.3,
                delay: prefersReducedMotion ? 0 : 0.1,
              }}
              className={cn(
                "relative mb-4 overflow-hidden rounded-compact border bg-card p-4",
                phase === "charge" && "ring-2",
                phase === "charge" && visuals.borderColor,
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-compact bg-primary/10 flex items-center justify-center text-sm font-bold">
                  {data.playerName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{data.playerName}</p>
                  <p className="text-sm text-muted-foreground">{data.playerTeam}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Share Multiplier</p>
                  <p className="font-mono font-bold">{data.shareMultiplier}x</p>
                </div>
              </div>

              {/* Energy effect during charge phase */}
              {phase === "charge" && !prefersReducedMotion && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  animate={{
                    boxShadow: [
                      `inset 0 0 0 0 ${visuals.color}00`,
                      `inset 0 0 30px 10px ${visuals.color}40`,
                      `inset 0 0 0 0 ${visuals.color}00`,
                    ],
                  }}
                  transition={{ duration: 0.6, repeat: 2 }}
                />
              )}
            </motion.div>

            {/* Energy beam */}
            <div className="relative h-8 flex items-center justify-center">
              {phase === "boost" && !prefersReducedMotion && (
                <EnergyBeam color={visuals.color} delay={0} />
              )}
              <motion.div
                animate={phase === "boost" && !prefersReducedMotion ? { scale: [1, 1.2, 1] } : {}}
                transition={{ duration: 0.3 }}
                className={cn(
                  "z-10 flex h-8 w-8 items-center justify-center rounded-compact",
                  visuals.bgColor,
                )}
              >
                <Zap className={cn("w-4 h-4", visuals.textColor)} />
              </motion.div>
            </div>

            {/* Boost slot */}
            <motion.div
              initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.9 }}
              animate={{
                opacity: 1,
                scale: !prefersReducedMotion && phase === "complete" ? [1, 1.05, 1] : 1,
              }}
              transition={{
                duration: prefersReducedMotion ? 0 : 0.3,
                delay: prefersReducedMotion ? 0 : 0.2,
                scale: { duration: 0.4, delay: 0 },
              }}
              className={cn(
                "relative mt-4 overflow-hidden rounded-compact border p-6 text-center",
                visuals.bgColor,
                visuals.borderColor,
                phase === "complete" && cn("ring-1", visuals.borderColor),
              )}
            >
              <motion.div
                animate={
                  !prefersReducedMotion && phase === "complete"
                    ? {
                        scale: [1, 1.2, 1],
                        opacity: [0.5, 1, 0.5],
                      }
                    : {}
                }
                transition={{ duration: 0.6 }}
                className={cn("text-5xl font-bold mb-2", visuals.textColor)}
              >
                {visuals.label}
              </motion.div>
              <p className="text-sm text-muted-foreground">Total Multiplier</p>
              <p className="text-lg font-semibold mt-1">{data.totalMultiplier}x</p>

              {/* Particle burst on complete */}
              {phase === "complete" && !prefersReducedMotion && (
                <ParticleBurst color={visuals.color} count={12} />
              )}
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: phase === "complete" ? 1 : 0 }}
              transition={{ delay: prefersReducedMotion ? 0 : 0.3 }}
              className="mt-6 grid grid-cols-2 gap-4"
            >
              <div className="rounded-compact bg-muted p-3 text-center">
                <TrendingUp className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Share Multiplier</p>
                <p className="font-mono font-semibold">{data.shareMultiplier}x</p>
              </div>
              <div className="rounded-compact bg-muted p-3 text-center">
                <Zap className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Shares Burned</p>
                <p className="font-mono font-semibold">{data.sharesBurned}</p>
              </div>
            </motion.div>
          </div>

          {/* Close hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: prefersReducedMotion ? 0 : 0.5 }}
            className="text-center text-xs text-muted-foreground mt-6"
          >
            Click anywhere to close
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

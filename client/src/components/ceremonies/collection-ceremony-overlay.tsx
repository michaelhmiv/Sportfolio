import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  X,
  Sparkles,
  TrendingUp,
  Target,
  Award,
  Flag,
  Medal,
  Users,
  Crown,
  Layers,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CollectionArt } from "@/components/collection-art";

export interface CollectionCeremonyData {
  title: string;
  artKey: string;
  sport: string;
  family: string;
  kind: "player_slots" | "master";
  rarityTier?: string;
  completionSequence?: number;
}

export interface CollectionCeremonyOverlayProps {
  isOpen: boolean;
  data: CollectionCeremonyData | null;
  onClose: () => void;
}

function getFamilyVisuals(family: string, kind: "player_slots" | "master") {
  if (kind === "master") {
    return {
      icon: "Trophy",
      color: "hsl(var(--premium))",
      bgColor: "bg-premium/10",
      borderColor: "border-premium/30",
      textColor: "text-premium",
      glowColor: "shadow-premium/30",
      label: "Master Collection",
    };
  }
  switch (family) {
    case "season_leaders":
      return {
        icon: "Award",
        color: "hsl(45 100% 55%)",
        bgColor: "bg-yellow-500/10",
        borderColor: "border-yellow-500/30",
        textColor: "text-yellow-400",
        glowColor: "shadow-yellow-500/30",
        label: "Season Leader",
      };
    case "threshold_clubs":
      return {
        icon: "Target",
        color: "hsl(195 100% 50%)",
        bgColor: "bg-cyan-500/10",
        borderColor: "border-cyan-500/30",
        textColor: "text-cyan-400",
        glowColor: "shadow-cyan-500/30",
        label: "Threshold Club",
      };
    case "milestone":
      return {
        icon: "Flag",
        color: "hsl(270 100% 65%)",
        bgColor: "bg-violet-500/10",
        borderColor: "border-violet-500/30",
        textColor: "text-violet-400",
        glowColor: "shadow-violet-500/30",
        label: "Milestone",
      };
    case "official_awards":
      return {
        icon: "Medal",
        color: "hsl(35 100% 55%)",
        bgColor: "bg-amber-500/10",
        borderColor: "border-amber-500/30",
        textColor: "text-amber-400",
        glowColor: "shadow-amber-500/30",
        label: "Official Award",
      };
    case "official_teams":
      return {
        icon: "Users",
        color: "hsl(210 100% 55%)",
        bgColor: "bg-blue-500/10",
        borderColor: "border-blue-500/30",
        textColor: "text-blue-400",
        glowColor: "shadow-blue-500/30",
        label: "Team Collection",
      };
    case "postseason":
      return {
        icon: "Crown",
        color: "hsl(300 100% 60%)",
        bgColor: "bg-fuchsia-500/10",
        borderColor: "border-fuchsia-500/30",
        textColor: "text-fuchsia-400",
        glowColor: "shadow-fuchsia-500/30",
        label: "Postseason",
      };
    default:
      return {
        icon: "Trophy",
        color: "hsl(var(--premium))",
        bgColor: "bg-premium/10",
        borderColor: "border-premium/30",
        textColor: "text-premium",
        glowColor: "shadow-premium/30",
        label: "Collection",
      };
  }
}

function FamilyIcon({
  family,
  kind,
  className,
}: {
  family: string;
  kind: "player_slots" | "master";
  className?: string;
}) {
  const visuals = getFamilyVisuals(family, kind);
  const IconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    Award: () => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="8" r="7" />
        <path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
      </svg>
    ),
    Star: () => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    Target: () => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
    Flag: () => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    ),
    Medal: () => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
        <path d="M8 14v8" />
        <path d="M16 14v8" />
      </svg>
    ),
    Users: () => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    Crown: () => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
    Trophy: () => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M12 2l1.45 2.9A2 2 0 0 1 12 6a2 2 0 0 1-1.45-.1L12 2z" />
        <path d="M2 17c0-1.66 1.34-3 3-3h14c1.66 0 3 1.34 3 3v1H2v-1z" />
        <path d="M8 17v-3" />
        <path d="M16 17v-3" />
      </svg>
    ),
  };
  const Icon = IconMap[visuals.icon] || IconMap.Trophy;
  return <Icon className={cn("w-5 h-5", className)} />;
}

export function CollectionCeremonyOverlay({
  isOpen,
  data,
  onClose,
}: CollectionCeremonyOverlayProps) {
  const [phase, setPhase] = useState<"intro" | "reveal" | "celebrate" | "outro">("intro");
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (isOpen && data) {
      setPhase("intro");
      const timers = [
        setTimeout(() => setPhase("reveal"), prefersReducedMotion ? 0 : 300),
        setTimeout(() => setPhase("celebrate"), prefersReducedMotion ? 0 : 1000),
        setTimeout(() => setPhase("outro"), prefersReducedMotion ? 0 : 3500),
        setTimeout(() => onClose(), prefersReducedMotion ? 4000 : 4500),
      ];
      return () => timers.forEach(clearTimeout);
    }
  }, [isOpen, data, prefersReducedMotion, onClose]);

  if (!isOpen || !data) return null;

  const visuals = getFamilyVisuals(data.family, data.kind);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ceremony-title"
      >
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: prefersReducedMotion ? 0 : 0.5 }}
          className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-control border border-border/60 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close ceremony"
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
              <FamilyIcon family={data.family} kind={data.kind} className={visuals.textColor} />
              <span id="ceremony-title" className={cn("text-sm font-medium", visuals.textColor)}>
                {visuals.label} Complete
              </span>
            </div>
          </motion.div>

          {/* Main content */}
          <div className="relative">
            {/* Collection art */}
            <motion.div
              initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                duration: prefersReducedMotion ? 0 : 0.3,
                delay: prefersReducedMotion ? 0 : 0.1,
              }}
              className="relative mb-4 overflow-hidden rounded-compact border p-4"
              style={{ backgroundColor: visuals.bgColor.replace("bg-", "").replace("/10", "/10") }}
            >
              <CollectionArt
                artKey={data.artKey}
                sport={data.sport}
                isBadge={data.kind === "master"}
                className="w-24 h-24 mx-auto"
              />

              {/* Energy ring during celebrate phase */}
              {phase === "celebrate" && !prefersReducedMotion && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  animate={{
                    boxShadow: [
                      `0 0 0 0 ${visuals.color}00`,
                      `0 0 40px 20px ${visuals.color}30`,
                      `0 0 0 0 ${visuals.color}00`,
                    ],
                  }}
                  transition={{ duration: 1.5, repeat: 1 }}
                />
              )}

              {/* Sparkle particles */}
              {phase === "celebrate" && !prefersReducedMotion && (
                <div className="absolute inset-0 pointer-events-none">
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute w-2 h-2 rounded-full"
                      style={{ backgroundColor: visuals.color }}
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{
                        opacity: [0, 1, 0],
                        scale: [0, 1, 0.5],
                        x: [0, Math.cos((i * 30 * Math.PI) / 180) * 120],
                        y: [0, Math.sin((i * 30 * Math.PI) / 180) * 120],
                      }}
                      transition={{ duration: 1.5, delay: 0.1 * i }}
                    />
                  ))}
                </div>
              )}
            </motion.div>

            {/* Title & Points */}
            <motion.div
              initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: prefersReducedMotion ? 0 : 0.3,
                delay: prefersReducedMotion ? 0 : 0.2,
              }}
              className="text-center"
            >
              <h2 className="font-mono text-xl font-bold uppercase tracking-tight text-content">
                {data.title}
              </h2>
              <div className="mt-2 flex items-center justify-center gap-2">
                {" "}
                {data.rarityTier && (
                  <Badge variant="outline" className={cn("gap-1", visuals.borderColor)}>
                    <Sparkles className="w-3 h-3" />
                    <span className="font-mono font-semibold text-xs">{data.rarityTier}</span>
                  </Badge>
                )}
                {data.completionSequence && (
                  <Badge variant="outline" className="gap-1 border-muted-foreground/30">
                    <span className="font-mono font-semibold text-xs">
                      #{data.completionSequence}
                    </span>
                  </Badge>
                )}
              </div>
            </motion.div>

            {/* Close hint */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: phase === "celebrate" ? 1 : 0 }}
              transition={{ delay: prefersReducedMotion ? 0 : 0.5 }}
              className="text-center text-xs text-muted-foreground mt-6"
            >
              Click anywhere to close
            </motion.p>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

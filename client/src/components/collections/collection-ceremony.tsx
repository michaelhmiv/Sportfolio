import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { X, Trophy, Users, Star, Target, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserCollection } from "@shared/schema";
import confetti from "canvas-confetti";

interface CollectionCeremonyProps {
  isOpen: boolean;
  collection: UserCollection | null;
  onClose: () => void;
}

const collectionTypeIcons: Record<string, typeof Trophy> = {
  team: Users,
  rookie: Star,
  position: Target,
  allstar: Trophy,
};

const collectionTypeLabels: Record<string, string> = {
  team: "Team Squad",
  rookie: "Rookie Hunter",
  position: "Position Master",
  allstar: "All-Star Collector",
};

const collectionTypeColors: Record<
  string,
  { bg: string; border: string; text: string; gradient: string }
> = {
  team: {
    bg: "bg-status-info/10",
    border: "border-status-info/30",
    text: "text-status-info",
    gradient: "from-status-info/20 to-status-info/10",
  },
  rookie: {
    bg: "bg-market-positive/10",
    border: "border-market-positive/30",
    text: "text-market-positive",
    gradient: "from-market-positive/20 to-market-positive/10",
  },
  position: {
    bg: "bg-category-scout/10",
    border: "border-category-scout/30",
    text: "text-category-scout",
    gradient: "from-category-scout/20 to-category-scout/10",
  },
  allstar: {
    bg: "bg-premium/10",
    border: "border-premium/30",
    text: "text-premium",
    gradient: "from-premium/20 to-premium/10",
  },
};

export function CollectionCeremony({ isOpen, collection, onClose }: CollectionCeremonyProps) {
  const [phase, setPhase] = useState<"intro" | "reveal" | "complete">("intro");
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (isOpen && collection) {
      setPhase("intro");

      if (prefersReducedMotion) {
        setPhase("complete");
        const closeTimer = window.setTimeout(onClose, 4000);
        return () => window.clearTimeout(closeTimer);
      }

      // Trigger confetti explosion
      const duration = 3000;
      const end = Date.now() + duration;

      let frameId = 0;
      const frame = () => {
        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: [
            "hsl(var(--market-positive))",
            "hsl(var(--status-info))",
            "hsl(var(--category-scout))",
            "hsl(var(--boost))",
          ],
        });
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: [
            "hsl(var(--market-positive))",
            "hsl(var(--status-info))",
            "hsl(var(--category-scout))",
            "hsl(var(--boost))",
          ],
        });

        if (Date.now() < end) {
          frameId = requestAnimationFrame(frame);
        }
      };

      frame();

      const timers = [
        setTimeout(() => setPhase("reveal"), 500),
        setTimeout(() => setPhase("complete"), 1500),
        setTimeout(() => onClose(), 4000),
      ];

      return () => {
        cancelAnimationFrame(frameId);
        timers.forEach(clearTimeout);
      };
    }
  }, [isOpen, collection, onClose, prefersReducedMotion]);

  const handleSkip = () => {
    onClose();
  };

  if (!isOpen || !collection) return null;

  const Icon = collectionTypeIcons[collection.collectionType] || Trophy;
  const colors = collectionTypeColors[collection.collectionType] || collectionTypeColors.team;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
        onClick={handleSkip}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-ceremony-title"
      >
        {/* Close button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-control border border-border/60 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close collection ceremony"
          onClick={(e) => {
            e.stopPropagation();
            handleSkip();
          }}
        >
          <X className="w-5 h-5" />
        </motion.button>

        <div className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-center mb-8"
          >
            <motion.div
              animate={phase === "complete" ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 0.5, repeat: prefersReducedMotion ? 0 : 2, repeatDelay: 1 }}
              className={cn(
                "inline-flex items-center gap-2 rounded-compact px-4 py-2 border",
                colors.bg,
                colors.border,
              )}
            >
              <Trophy className={cn("w-4 h-4", colors.text)} />
              <span className={cn("text-sm font-medium", colors.text)}>Collection Complete!</span>
            </motion.div>
          </motion.div>

          {/* Badge reveal with 3D flip */}
          <div className="relative perspective-1000">
            <motion.div
              initial={{ rotateY: 90, opacity: 0 }}
              animate={{
                rotateY: phase === "reveal" || phase === "complete" ? 0 : 90,
                opacity: phase === "reveal" || phase === "complete" ? 1 : 0,
              }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 20,
                delay: 0.3,
              }}
              style={{ transformStyle: "preserve-3d" }}
              className={cn(
                "relative overflow-hidden rounded-compact border-2 bg-card p-8 text-center",
                colors.border,
              )}
            >
              {/* Shimmer effect */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                animate={{
                  background: [
                    "linear-gradient(45deg, transparent 30%, hsl(var(--highlight) / 0.1) 50%, transparent 70%)",
                    "linear-gradient(45deg, transparent 70%, hsl(var(--highlight) / 0.1) 90%, transparent 110%)",
                  ],
                }}
                transition={{
                  duration: 2,
                  repeat: prefersReducedMotion ? 0 : 2,
                  ease: "linear",
                }}
                style={{
                  backgroundSize: "200% 200%",
                }}
              />

              {/* Icon */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: phase === "complete" ? 1 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30, delay: 0.5 }}
                className={cn(
                  "mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-compact",
                  colors.bg,
                  colors.border,
                  "border-2",
                )}
              >
                <Icon className={cn("w-10 h-10", colors.text)} />
              </motion.div>

              {/* Title */}
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{
                  opacity: phase === "complete" ? 1 : 0,
                  y: phase === "complete" ? 0 : 10,
                }}
                transition={{ delay: 0.6 }}
                id="collection-ceremony-title"
                className="text-2xl font-bold mb-2"
              >
                {collectionTypeLabels[collection.collectionType] || collection.collectionType}
              </motion.h2>

              {/* Target */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: phase === "complete" ? 1 : 0 }}
                transition={{ delay: 0.7 }}
                className="text-lg text-muted-foreground mb-4"
              >
                {collection.targetId}
              </motion.p>

              {/* Progress */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{
                  opacity: phase === "complete" ? 1 : 0,
                  scale: phase === "complete" ? 1 : 0.9,
                }}
                transition={{ delay: 0.8 }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-compact px-4 py-2",
                  colors.bg,
                )}
              >
                <span className={cn("font-bold", colors.text)}>
                  {collection.progress}/{collection.total}
                </span>
                <span className="text-muted-foreground">Collected</span>
              </motion.div>
            </motion.div>
          </div>

          {/* Share button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: phase === "complete" ? 1 : 0, y: phase === "complete" ? 0 : 20 }}
            transition={{ delay: 1 }}
            className="mt-8 flex justify-center"
          >
            <Button
              variant="terminalOutline"
              className="gap-2"
              onClick={() => {
                // Share functionality
                if (navigator.share) {
                  navigator.share({
                    title: "Collection Complete!",
                    text: `I just completed the ${collectionTypeLabels[collection.collectionType]} collection for ${collection.targetId} on Sportfolio!`,
                    url: window.location.href,
                  });
                } else {
                  // Fallback: copy to clipboard
                  navigator.clipboard.writeText(
                    `I just completed the ${collectionTypeLabels[collection.collectionType]} collection for ${collection.targetId} on Sportfolio!`,
                  );
                }
              }}
            >
              <Share2 className="w-4 h-4" />
              Share Achievement
            </Button>
          </motion.div>

          {/* Skip hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center text-xs text-muted-foreground mt-6"
          >
            Click anywhere to skip
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

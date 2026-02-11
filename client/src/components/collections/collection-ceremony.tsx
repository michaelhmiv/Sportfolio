import { motion, AnimatePresence } from "framer-motion";
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
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-500",
    gradient: "from-blue-500/20 to-blue-600/10",
  },
  rookie: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-500",
    gradient: "from-emerald-500/20 to-emerald-600/10",
  },
  position: {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-500",
    gradient: "from-violet-500/20 to-violet-600/10",
  },
  allstar: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-500",
    gradient: "from-amber-500/20 to-amber-600/10",
  },
};

export function CollectionCeremony({ isOpen, collection, onClose }: CollectionCeremonyProps) {
  const [phase, setPhase] = useState<"intro" | "reveal" | "complete">("intro");

  useEffect(() => {
    if (isOpen && collection) {
      setPhase("intro");

      // Trigger confetti explosion
      const duration = 3000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ["#10B981", "#3B82F6", "#8B5CF6", "#F59E0B"],
        });
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ["#10B981", "#3B82F6", "#8B5CF6", "#F59E0B"],
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };

      frame();

      const timers = [
        setTimeout(() => setPhase("reveal"), 500),
        setTimeout(() => setPhase("complete"), 1500),
        setTimeout(() => onClose(), 4000),
      ];

      return () => timers.forEach(clearTimeout);
    }
  }, [isOpen, collection, onClose]);

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
      >
        {/* Close button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground transition-colors"
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
              transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 1 }}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-full border",
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
                "p-8 rounded-2xl border-2 text-center relative overflow-hidden",
                "bg-gradient-to-br",
                colors.gradient,
                colors.border,
              )}
            >
              {/* Shimmer effect */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                animate={{
                  background: [
                    "linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.1) 50%, transparent 70%)",
                    "linear-gradient(45deg, transparent 70%, rgba(255,255,255,0.1) 90%, transparent 110%)",
                  ],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
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
                  "w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center",
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
                className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full", colors.bg)}
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
              variant="outline"
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

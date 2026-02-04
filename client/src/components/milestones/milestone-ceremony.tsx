import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import { X, Trophy, TrendingUp, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserMilestone } from "@shared/schema";
import confetti from "canvas-confetti";

interface MilestoneCeremonyProps {
  isOpen: boolean;
  milestone: UserMilestone | null;
  userName?: string;
  onClose: () => void;
}

const milestoneConfig: Record<
  string,
  { title: string; icon: typeof Trophy; color: string; bgColor: string; borderColor: string }
> = {
  netWorth: {
    title: "Net Worth Milestone",
    icon: TrendingUp,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
  },
  portfolioValue: {
    title: "Portfolio Value Milestone",
    icon: Trophy,
    color: "text-violet-500",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
  },
  totalTrades: {
    title: "Trading Milestone",
    icon: Trophy,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
};

const milestoneNames: Record<number, string> = {
  1000: "First Thousand",
  10000: "Ten K Club",
  100000: "Six Figures",
  1000000: "Millionaire",
  10000000: "Ten Million",
};

function formatMilestoneValue(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(0)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value}`;
}

export function MilestoneCeremony({ isOpen, milestone, userName, onClose }: MilestoneCeremonyProps) {
  const [phase, setPhase] = useState<"intro" | "count" | "reveal" | "complete">("intro");
  const [displayValue, setDisplayValue] = useState(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (isOpen && milestone) {
      setPhase("intro");
      setDisplayValue(0);
      startTimeRef.current = Date.now();

      // Trigger massive confetti explosion
      const duration = 4000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ["#10B981", "#F59E0B", "#8B5CF6", "#3B82F6"],
          scalar: 1.2,
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ["#10B981", "#F59E0B", "#8B5CF6", "#3B82F6"],
          scalar: 1.2,
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };

      frame();

      const timers = [
        setTimeout(() => setPhase("count"), 500),
        setTimeout(() => setPhase("reveal"), 2000),
        setTimeout(() => setPhase("complete"), 2500),
        setTimeout(() => onClose(), 5000),
      ];

      return () => timers.forEach(clearTimeout);
    }
  }, [isOpen, milestone, onClose]);

  // Animate number counting
  useEffect(() => {
    if (phase === "count" && milestone) {
      const targetValue = parseFloat(milestone.threshold);
      const startValue = 0;
      const duration = 1500;
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out cubic
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = startValue + (targetValue - startValue) * easeOut;

        setDisplayValue(current);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setDisplayValue(targetValue);
        }
      };

      requestAnimationFrame(animate);
    }
  }, [phase, milestone]);

  const handleSkip = () => {
    onClose();
  };

  if (!isOpen || !milestone) return null;

  const config = milestoneConfig[milestone.milestoneType] || milestoneConfig.netWorth;
  const Icon = config.icon;
  const milestoneName = milestoneNames[parseFloat(milestone.threshold)] || "Milestone";

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

        <div
          className="w-full max-w-lg mx-4"
          onClick={(e) => e.stopPropagation()}
        >
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
                config.bgColor,
                config.borderColor
              )}
            >
              <Trophy className={cn("w-4 h-4", config.color)} />
              <span className={cn("text-sm font-medium", config.color)}>Milestone Achieved!</span>
            </motion.div>
          </motion.div>

          {/* Main content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{
              opacity: phase !== "intro" ? 1 : 0,
              scale: phase !== "intro" ? 1 : 0.9,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className={cn(
              "p-8 rounded-2xl border-2 text-center relative overflow-hidden",
              config.bgColor,
              config.borderColor
            )}
          >
            {/* Animated background */}
            <motion.div
              className="absolute inset-0 pointer-events-none opacity-30"
              animate={{
                background: [
                  "radial-gradient(circle at 30% 30%, rgba(16, 185, 129, 0.3), transparent 50%)",
                  "radial-gradient(circle at 70% 70%, rgba(16, 185, 129, 0.3), transparent 50%)",
                  "radial-gradient(circle at 30% 30%, rgba(16, 185, 129, 0.3), transparent 50%)",
                ],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />

            {/* User name */}
            {userName && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: phase === "complete" ? 1 : 0 }}
                transition={{ delay: 0.5 }}
                className="text-lg text-muted-foreground mb-2"
              >
                {userName}
              </motion.p>
            )}

            {/* Milestone name */}
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: phase === "complete" ? 1 : 0, y: phase === "complete" ? 0 : 10 }}
              transition={{ delay: 0.6 }}
              className="text-3xl font-bold mb-4"
            >
              {milestoneName}
            </motion.h2>

            {/* Animated number */}
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{
                scale: phase === "count" || phase === "reveal" || phase === "complete" ? 1 : 0.5,
                opacity: phase !== "intro" ? 1 : 0,
              }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
              className="relative"
            >
              <span className={cn("text-6xl md:text-7xl font-bold", config.color)}>
                {formatMilestoneValue(displayValue)}
              </span>

              {/* Trophy reveal */}
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{
                  scale: phase === "complete" ? 1 : 0,
                  rotate: phase === "complete" ? 0 : -180,
                }}
                transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.3 }}
                className={cn(
                  "absolute -top-4 -right-4 w-16 h-16 rounded-full flex items-center justify-center",
                  config.bgColor,
                  config.borderColor,
                  "border-2"
                )}
              >
                <Icon className={cn("w-8 h-8", config.color)} />
              </motion.div>
            </motion.div>

            {/* Achievement text */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: phase === "complete" ? 1 : 0 }}
              transition={{ delay: 0.8 }}
              className="text-muted-foreground mt-4"
            >
              achieved {config.title.toLowerCase()}
            </motion.p>
          </motion.div>

          {/* Share buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: phase === "complete" ? 1 : 0, y: phase === "complete" ? 0 : 20 }}
            transition={{ delay: 1 }}
            className="mt-8 flex justify-center gap-3"
          >
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({
                    title: "Milestone Achieved!",
                    text: `I just achieved the ${milestoneName} milestone (${formatMilestoneValue(parseFloat(milestone.threshold))}) on Sportfolio!`,
                    url: window.location.href,
                  });
                } else {
                  navigator.clipboard.writeText(
                    `I just achieved the ${milestoneName} milestone (${formatMilestoneValue(parseFloat(milestone.threshold))}) on Sportfolio!`
                  );
                }
              }}
            >
              <Share2 className="w-4 h-4" />
              Share
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

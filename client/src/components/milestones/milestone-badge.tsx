import { motion } from "framer-motion";
import { Trophy, TrendingUp, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserMilestone } from "@shared/schema";

interface MilestoneBadgeProps {
  milestone: UserMilestone;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}

const milestoneIcons: Record<string, typeof Trophy> = {
  netWorth: TrendingUp,
  portfolioValue: Trophy,
  totalTrades: Award,
};

const milestoneColors: Record<string, { bg: string; border: string; text: string }> = {
  netWorth: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-500",
  },
  portfolioValue: {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-500",
  },
  totalTrades: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-500",
  },
};

function formatMilestoneValue(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(0)}M`;
  } else if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}K`;
  }
  return `${value}`;
}

export function MilestoneBadge({ milestone, size = "md", onClick }: MilestoneBadgeProps) {
  const Icon = milestoneIcons[milestone.milestoneType] || Trophy;
  const colors = milestoneColors[milestone.milestoneType] || milestoneColors.netWorth;
  const value = parseFloat(milestone.threshold);

  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  };

  const iconSizes = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  };

  return (
    <motion.div
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cn(
        "relative rounded-sm flex items-center justify-center cursor-pointer",
        "border-2 transition-all duration-200",
        sizeClasses[size],
        colors.bg,
        colors.border,
        onClick && "hover:border-border/80",
      )}
      title={`${milestone.milestoneType}: ${formatMilestoneValue(value)}`}
    >
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
      >
        <Icon className={cn(iconSizes[size], colors.text)} />
      </motion.div>

      {/* Shine effect */}
      <motion.div
        className="absolute inset-0 rounded-sm pointer-events-none"
        animate={{
          background: [
            "linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.2) 50%, transparent 60%)",
            "linear-gradient(135deg, transparent 60%, rgba(255,255,255,0.2) 70%, transparent 80%)",
          ],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          repeatDelay: 3,
          ease: "linear",
        }}
        style={{
          backgroundSize: "200% 200%",
        }}
      />
    </motion.div>
  );
}

interface MilestoneBadgeListProps {
  milestones: UserMilestone[];
  maxDisplay?: number;
  size?: "sm" | "md" | "lg";
}

export function MilestoneBadgeList({
  milestones,
  maxDisplay = 5,
  size = "md",
}: MilestoneBadgeListProps) {
  const sortedMilestones = [...milestones].sort(
    (a, b) => parseFloat(b.threshold) - parseFloat(a.threshold),
  );
  const displayMilestones = sortedMilestones.slice(0, maxDisplay);
  const remainingCount = sortedMilestones.length - maxDisplay;

  return (
    <div className="flex items-center gap-2">
      {displayMilestones.map((milestone, index) => (
        <motion.div
          key={`${milestone.milestoneType}-${milestone.threshold}`}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            type: "spring",
            stiffness: 500,
            damping: 30,
            delay: index * 0.1,
          }}
        >
          <MilestoneBadge milestone={milestone} size={size} />
        </motion.div>
      ))}

      {remainingCount > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={cn(
            "flex items-center justify-center rounded-sm bg-muted font-medium text-muted-foreground",
            size === "sm" && "w-8 h-8 text-xs",
            size === "md" && "w-10 h-10 text-sm",
            size === "lg" && "w-12 h-12 text-base",
          )}
        >
          +{remainingCount}
        </motion.div>
      )}
    </div>
  );
}

import { motion } from "framer-motion";
import { Trophy, Users, Star, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserCollection } from "@shared/schema";

interface CollectionBadgeProps {
  collection: UserCollection;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
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
  { bg: string; border: string; text: string; glow: string }
> = {
  team: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-500",
    glow: "shadow-blue-500/30",
  },
  rookie: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-500",
    glow: "shadow-emerald-500/30",
  },
  position: {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-500",
    glow: "shadow-violet-500/30",
  },
  allstar: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-500",
    glow: "shadow-amber-500/30",
  },
};

export function CollectionBadge({ collection, size = "md", onClick }: CollectionBadgeProps) {
  const Icon = collectionTypeIcons[collection.collectionType] || Trophy;
  const colors = collectionTypeColors[collection.collectionType] || collectionTypeColors.team;
  const progressPercent = Math.min((collection.progress / collection.total) * 100, 100);
  const isCompleted = collection.completed;

  const sizeClasses = {
    sm: "p-2 min-w-[80px]",
    md: "p-3 min-w-[120px]",
    lg: "p-4 min-w-[160px]",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  const textSizes = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm",
  };

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "relative rounded-sm border cursor-pointer overflow-hidden",
        sizeClasses[size],
        colors.bg,
        colors.border,
        isCompleted && "ring-2 ring-offset-2 ring-offset-background",
        isCompleted && colors.border.replace("/30", ""),
        onClick && "transition-colors hover:bg-background/20",
      )}
    >
      {/* Holographic shimmer effect for completed badges */}
      {isCompleted && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          animate={{
            background: [
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)",
              "linear-gradient(90deg, transparent 100%, rgba(255,255,255,0.1) 150%, transparent 200%)",
            ],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "linear",
          }}
          style={{
            backgroundSize: "200% 100%",
          }}
        />
      )}

      <div className="relative z-10 flex flex-col items-center gap-1">
        {/* Icon */}
        <motion.div
          animate={isCompleted ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 0.5, repeat: isCompleted ? Infinity : 0, repeatDelay: 2 }}
          className={cn("rounded-sm p-1.5", colors.bg, colors.text)}
        >
          <Icon className={iconSizes[size]} />
        </motion.div>

        {/* Label */}
        <span className={cn("font-medium text-center line-clamp-1", textSizes[size], colors.text)}>
          {collectionTypeLabels[collection.collectionType] || collection.collectionType}
        </span>

        {/* Target info */}
        <span className={cn("text-muted-foreground line-clamp-1", textSizes[size])}>
          {collection.targetId}
        </span>

        {/* Progress bar for incomplete */}
        {!isCompleted && (
          <div className="w-full mt-1">
            <div className="h-1.5 w-full rounded-sm bg-background/50 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className={cn("h-full rounded-sm", colors.text.replace("text-", "bg-"))}
              />
            </div>
            <p className={cn("text-center mt-0.5 text-muted-foreground", textSizes[size])}>
              {collection.progress}/{collection.total}
            </p>
          </div>
        )}

        {/* Completed badge */}
        {isCompleted && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className={cn(
              "absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-sm",
              colors.text.replace("text-", "bg-"),
              "text-white text-xs font-bold",
            )}
          >
            OK
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

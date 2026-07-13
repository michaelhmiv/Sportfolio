import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CollectionProgressProps {
  progress: number;
  total: number;
  className?: string;
  showPercentage?: boolean;
  size?: "sm" | "md" | "lg";
  color?: "emerald" | "blue" | "violet" | "amber" | "red";
}

const colorClasses: Record<string, { bg: string; fill: string; text: string }> = {
  emerald: {
    bg: "bg-market-positive/20",
    fill: "bg-market-positive",
    text: "text-market-positive",
  },
  blue: { bg: "bg-status-info/20", fill: "bg-status-info", text: "text-status-info" },
  violet: { bg: "bg-category-scout/20", fill: "bg-category-scout", text: "text-category-scout" },
  amber: { bg: "bg-premium/20", fill: "bg-premium", text: "text-premium" },
  red: { bg: "bg-market-negative/20", fill: "bg-market-negative", text: "text-market-negative" },
};

export function CollectionProgress({
  progress,
  total,
  className,
  showPercentage = true,
  size = "md",
  color = "emerald",
}: CollectionProgressProps) {
  const percentage = Math.min((progress / total) * 100, 100);
  const colors = colorClasses[color];

  const heightClasses = {
    sm: "h-1",
    md: "h-2",
    lg: "h-3",
  };

  const textSizes = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm",
  };

  return (
    <div className={cn("w-full", className)}>
      <div className={cn("w-full rounded-compact overflow-hidden", heightClasses[size], colors.bg)}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{
            type: "spring",
            stiffness: 100,
            damping: 20,
            delay: 0.1,
          }}
          className={cn("h-full rounded-compact", colors.fill)}
        />
      </div>

      <div className="flex justify-between items-center mt-1">
        <span className={cn("text-muted-foreground", textSizes[size])}>
          {progress} of {total} collected
        </span>

        {showPercentage && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className={cn("font-medium", textSizes[size], colors.text)}
          >
            {percentage.toFixed(0)}%
          </motion.span>
        )}
      </div>
    </div>
  );
}

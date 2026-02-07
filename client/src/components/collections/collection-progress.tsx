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
  emerald: { bg: "bg-emerald-500/20", fill: "bg-emerald-500", text: "text-emerald-500" },
  blue: { bg: "bg-blue-500/20", fill: "bg-blue-500", text: "text-blue-500" },
  violet: { bg: "bg-violet-500/20", fill: "bg-violet-500", text: "text-violet-500" },
  amber: { bg: "bg-amber-500/20", fill: "bg-amber-500", text: "text-amber-500" },
  red: { bg: "bg-red-500/20", fill: "bg-red-500", text: "text-red-500" },
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
      <div className={cn("w-full rounded-full overflow-hidden", heightClasses[size], colors.bg)}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{
            type: "spring",
            stiffness: 100,
            damping: 20,
            delay: 0.1,
          }}
          className={cn("h-full rounded-full", colors.fill)}
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

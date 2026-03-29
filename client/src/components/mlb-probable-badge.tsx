import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface MlbProbableBadgeProps {
  compact?: boolean;
  className?: string;
  label?: string;
}

export function MlbProbableBadge({ compact = false, className, label }: MlbProbableBadgeProps) {
  return (
    <Badge
      variant="outline"
      aria-label="Probable pitcher"
      title="Probable pitcher"
      className={cn(
        "border-sky-500/30 bg-sky-500/10 font-semibold uppercase tracking-[0.08em] text-sky-200",
        compact ? "h-5 px-1 text-[9px]" : "h-5 px-1.5 text-[10px]",
        className,
      )}
    >
      {label || (compact ? "P" : "Probable")}
    </Badge>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "framer-motion";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fill ratio from 0 to 1 (clamped). */
  value?: number;
  /** When true, fills with an animated gradient sweep (used for live/active state). */
  animated?: boolean;
  /** Tailwind background class for the filled portion (defaults to brand). */
  indicatorClassName?: string;
}

export function Progress({
  value = 0,
  animated = false,
  indicatorClassName,
  className,
  ...props
}: ProgressProps) {
  const prefersReducedMotion = useReducedMotion();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  // Width transitions smoothly when the value changes; reduced-motion users get an instant fill.
  const widthTransition = prefersReducedMotion
    ? undefined
    : "transition-[width] duration-500 ease-out";

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-compact bg-surface-raised",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-compact",
          indicatorClassName ?? "bg-brand",
          widthTransition,
          animated && !prefersReducedMotion && "progress-shimmer",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

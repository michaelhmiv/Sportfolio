import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-xs font-semibold leading-5 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "border-brand/30 bg-brand-subtle text-brand",
        secondary: "border-border-subtle bg-action-secondary text-action-secondary-foreground",
        destructive: "border-destructive/30 bg-destructive-subtle text-destructive",
        outline: "border-border-strong bg-transparent text-content",
        neutral: "border-border-subtle bg-surface-raised text-content-muted",
        status:
          "border-border-subtle bg-surface-raised text-content-muted before:h-1.5 before:w-1.5 before:rounded-circle before:bg-current",
        live: "border-status-live/30 bg-status-live-subtle text-status-live",
        positive: "border-market-positive/30 bg-market-positive-subtle text-market-positive",
        negative: "border-market-negative/30 bg-market-negative-subtle text-market-negative",
        warning: "border-status-warning/30 bg-status-warning-subtle text-status-warning",
        info: "border-status-info/30 bg-surface-raised text-status-info",
        boost: "border-boost/30 bg-boost-subtle text-boost",
        premium: "border-premium/30 bg-premium-subtle text-premium",
        count:
          "min-w-5 justify-center rounded-pill border-border-strong bg-content px-1.5 font-mono text-[11px] tabular-nums text-canvas",
        notification:
          "min-w-5 justify-center border-status-live bg-status-live px-1.5 font-mono text-[11px] tabular-nums text-canvas",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

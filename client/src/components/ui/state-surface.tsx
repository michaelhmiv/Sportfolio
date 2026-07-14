import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import {
  CheckCircle2,
  CircleAlert,
  CloudOff,
  LoaderCircle,
  RefreshCw,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Button } from "./button";

export const stateSurfaceVariants = cva(
  "flex w-full flex-col items-center justify-center border px-5 py-8 text-center",
  {
    variants: {
      kind: {
        loading: "rounded-panel border-border-subtle bg-surface text-content-muted",
        empty: "rounded-panel border-dashed border-border-strong bg-surface text-content-muted",
        error: "rounded-panel border-destructive/35 bg-destructive-subtle text-destructive",
        offline: "rounded-panel border-status-offline/35 bg-surface-raised text-status-offline",
        stale:
          "rounded-panel border-status-warning/35 bg-status-warning-subtle text-status-warning",
        reconnecting: "rounded-panel border-status-info/35 bg-surface-raised text-status-info",
        success:
          "rounded-panel border-market-positive/35 bg-market-positive-subtle text-market-positive",
      },
      compact: {
        true: "flex-row items-start justify-start px-4 py-3 text-left",
        false: "min-h-48",
      },
    },
    defaultVariants: {
      kind: "empty",
      compact: false,
    },
  },
);

type StateSurfaceKind = NonNullable<VariantProps<typeof stateSurfaceVariants>["kind"]>;

type StateIcon = LucideIcon | ComponentType<{ className?: string }>;

const stateIcons: Record<StateSurfaceKind, StateIcon> = {
  loading: LoaderCircle,
  empty: SearchX,
  error: CircleAlert,
  offline: CloudOff,
  stale: TriangleAlert,
  reconnecting: RefreshCw,
  success: CheckCircle2,
};

export interface StateSurfaceProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title">, VariantProps<typeof stateSurfaceVariants> {
  title: ReactNode;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  icon?: StateIcon;
}

export function StateSurface({
  kind = "empty",
  compact = false,
  title,
  description,
  actionLabel,
  onAction,
  icon,
  className,
  ...props
}: StateSurfaceProps) {
  const resolvedKind = kind ?? "empty";
  const Icon = icon ?? stateIcons[resolvedKind];
  const isLoading = resolvedKind === "loading";

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-busy={isLoading || undefined}
      className={cn(stateSurfaceVariants({ kind: resolvedKind, compact }), className)}
      {...props}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-circle border border-current/20 bg-surface p-2",
          compact ? "mb-0 mr-3" : "mb-3",
        )}
      >
        <Icon
          aria-hidden
          className={cn("h-5 w-5", isLoading && "animate-spin motion-reduce:animate-none")}
        />
      </div>
      <div className={cn(compact && "min-w-0 flex-1")}>
        <div className="text-sm font-semibold text-content">{title}</div>
        {description ? (
          <div className="mt-1 max-w-prose text-sm leading-5 text-content-muted">{description}</div>
        ) : null}
        {actionLabel && onAction ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAction}
            className={cn(compact ? "mt-2" : "mt-4")}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

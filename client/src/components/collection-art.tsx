import type { CollectionAssemblyState } from "@shared/collection-api";
import { cn } from "@/lib/utils";
import { resolveCollectionVisualTheme } from "@/components/collections/collection-visual-theme";

export interface CollectionArtProps {
  artKey: string;
  sport?: string;
  family?: string;
  season?: string;
  title?: string;
  kind?: "player_slots" | "master";
  assemblyState?: CollectionAssemblyState;
  award?: { completionSequence: number | null } | null;
  size?: "sm" | "md" | "lg";
  /** @deprecated Achievement art is derived from award/state, never premium entitlement. */
  isBadge?: boolean;
  className?: string;
}

const SIZE_CLASSES = {
  sm: "h-10 w-10 text-[8px]",
  md: "h-14 w-14 text-[9px]",
  lg: "h-24 w-20 text-[10px]",
} as const;

function deriveSportMark(artKey: string, sport?: string): string {
  const source = sport || artKey.split("-")[0] || "??";
  return source.slice(0, 3).toUpperCase();
}

export function CollectionArt({
  artKey,
  sport,
  family = "",
  season,
  title,
  kind = "player_slots",
  assemblyState = "unstarted",
  award,
  size = "md",
  isBadge = false,
  className,
}: CollectionArtProps) {
  const mark = deriveSportMark(artKey, sport);
  const effectiveState = isBadge && assemblyState === "unstarted" ? "active" : assemblyState;
  const theme = resolveCollectionVisualTheme({ family, kind: isBadge ? "master" : kind });
  const earned = award != null || isBadge;

  return (
    <div
      data-testid="collection-art"
      data-silhouette={theme.silhouette}
      data-state={effectiveState}
      className={cn(
        "relative isolate flex shrink-0 flex-col items-center justify-center overflow-hidden border-2 bg-surface text-center font-mono font-bold text-content shadow-low",
        "motion-safe:transition-transform motion-safe:duration-standard group-hover:scale-[1.02]",
        SIZE_CLASSES[size],
        theme.frameClass,
        theme.artClass,
        effectiveState === "unstarted" && "saturate-50 opacity-75",
        effectiveState === "ready" && "border-status-warning shadow-medium",
        earned && "border-brand/60 bg-brand-subtle/20",
        className,
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-x-1 top-1 border-b border-current/20 pb-0.5 tracking-[0.18em]">
        {mark}
      </span>
      {season && (
        <span className="relative z-10 mt-2 text-[0.85em] tabular-nums text-muted-foreground">
          {season}
        </span>
      )}
      <span className="relative z-10 line-clamp-2 max-w-[90%] break-words leading-tight tracking-[0.08em]">
        {title || mark}
      </span>
      {award?.completionSequence != null && (
        <span className="absolute bottom-1 rounded-pill bg-brand px-1 text-[0.75em] text-brand-foreground">
          No. {award.completionSequence}
        </span>
      )}
    </div>
  );
}

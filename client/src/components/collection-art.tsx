import { cn } from "@/lib/utils";

// ── types ────────────────────────────────────────────────────────────────────

export interface CollectionArtProps {
  /** Canonical artKey from the collection identity metadata. */
  artKey: string;
  /** Optional explicit sport override (takes precedence over artKey parsing). */
  sport?: string;
  /** Size variant. */
  size?: "sm" | "md" | "lg";
  /** Whether this art represents a badge/premium collection. */
  isBadge?: boolean;
  className?: string;
}

// ── size config ──────────────────────────────────────────────────────────────

const SIZE_CLASSES: Record<"sm" | "md" | "lg", string> = {
  sm: "h-8 w-8 text-[9px]",
  md: "h-10 w-10 text-[10px]",
  lg: "h-12 w-12 text-xs",
};

// ── art key → sport abbreviation ─────────────────────────────────────────────

function deriveSportMark(artKey: string, explicitSport?: string): string {
  if (explicitSport) {
    return explicitSport.slice(0, 3).toUpperCase();
  }
  // Parse the first segment of the artKey (before any hyphen) as the sport
  const firstSegment = artKey.split("-")[0] || "";
  if (!firstSegment) return "??";
  return firstSegment.slice(0, 3).toUpperCase();
}

// ── component ────────────────────────────────────────────────────────────────

export function CollectionArt({
  artKey,
  sport,
  size = "md",
  isBadge = false,
  className,
}: CollectionArtProps) {
  const mark = deriveSportMark(artKey, sport);

  return (
    <div
      data-testid="collection-art"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-control border font-mono font-bold tracking-[0.08em]",
        SIZE_CLASSES[size],
        isBadge
          ? "border-premium/30 bg-premium-subtle/20 text-premium"
          : "border-border bg-panel text-content",
        className,
      )}
      aria-hidden="true"
    >
      <span>{mark}</span>
    </div>
  );
}

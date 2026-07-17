import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layers, RefreshCw, ChevronRight, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { authenticatedFetch } from "@/lib/queryClient";
import {
  formatCanonicalQuantity,
  basisPointsToProgressValue,
  allocationProgressDisplay,
} from "@/lib/collection-format";
import { extractCollectionApiError, parseCollectionFetchError } from "@/lib/collection-api-error";
import { cn } from "@/lib/utils";
import type { CollectionListEntry } from "@shared/collection-api";

function buildListQueryKey(userId: string) {
  return ["/api/me/collections", userId] as const;
}

async function fetchCollections(): Promise<CollectionListEntry[]> {
  const res = await authenticatedFetch("/api/me/collections");
  if (!res.ok) {
    const apiErr = await extractCollectionApiError(res);
    if (apiErr) throw apiErr;
    throw new Error(`Failed to load collections (${res.status})`);
  }
  const json = await res.json();
  return json.data as CollectionListEntry[];
}

function stateBadge(state: string) {
  switch (state) {
    case "ready":
      return {
        label: "Ready",
        className: "bg-status-live/15 text-status-live border-status-live/30",
      };
    case "active":
      return {
        label: "Active",
        className: "bg-status-live/15 text-status-live border-status-live/30",
      };
    case "in_progress":
      return {
        label: "In Progress",
        className: "bg-amber-500/15 text-amber-500 border-amber-500/30",
      };
    case "inactive":
      return { label: "Inactive", className: "bg-muted text-muted-foreground border-border" };
    default:
      return null;
  }
}

function CollectionSkeleton() {
  return (
    <div className="terminal-shell space-y-3 p-4" aria-hidden="true">
      <div className="h-4 w-20 animate-pulse rounded-sm bg-muted/60" />
      <div className="h-5 w-48 animate-pulse rounded-sm bg-muted/60" />
      <div className="h-3 w-64 animate-pulse rounded-sm bg-muted/40" />
      <div className="h-2 w-full animate-pulse rounded-sm bg-muted/30" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="terminal-shell flex flex-col items-center gap-3 p-8 text-center">
      <Layers className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-muted-foreground">No collections yet</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Collections will appear here as they become available during the season.
        </p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="terminal-shell flex flex-col items-center gap-3 p-8 text-center">
      <div className="rounded-full bg-destructive/10 p-3">
        <RefreshCw className="h-5 w-5 text-destructive" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-destructive">Failed to load collections</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-retry-collections">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

export default function CollectionsPage() {
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id ?? "";
  const {
    data: collections,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CollectionListEntry[]>({
    queryKey: buildListQueryKey(userId),
    queryFn: fetchCollections,
    enabled: isAuthenticated && userId.length > 0,
  });

  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Header */}
        <div className="terminal-shell overflow-hidden p-4 md:p-5">
          <div className="terminal-strip mb-2">Collections</div>
          <h1 className="terminal-heading text-xl">Your Collections</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Track progress toward collection milestones and earn awards.
          </p>
        </div>

        {/* Screen reader loading announcement */}
        {isLoading && (
          <div role="status" aria-live="polite" className="sr-only">
            Loading collections…
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3" data-testid="collections-loading">
            <CollectionSkeleton />
            <CollectionSkeleton />
            <CollectionSkeleton />
          </div>
        ) : isError ? (
          <ErrorState
            message={error instanceof Error ? error.message : "An unexpected error occurred."}
            onRetry={() => refetch()}
          />
        ) : !collections || collections.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3" data-testid="collections-list">
            {collections.map((c) => {
              const pctValue = basisPointsToProgressValue(c.progressBps);
              const pctLabel = allocationProgressDisplay(c.progressBps);
              const badge = stateBadge(c.assemblyState);
              const hasAward = c.award != null;

              return (
                <Link
                  key={c.slug}
                  href={`/collections/${c.slug}`}
                  className={cn(
                    "terminal-shell group block p-4 transition-colors hover:border-brand/40",
                    hasAward && "border-status-live/20",
                  )}
                  data-testid={`collection-card-${c.slug}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="terminal-strip text-[10px]">
                          {c.sport} &middot; {c.season}
                        </span>
                        {c.lifecycleStatus === "final" && (
                          <span className="terminal-strip text-[10px]">Final</span>
                        )}
                        {badge && (
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] px-1.5 py-0", badge.className)}
                          >
                            {badge.label}
                          </Badge>
                        )}
                        {hasAward && (
                          <Award
                            className="h-4 w-4 text-status-live flex-shrink-0"
                            aria-label="Award earned"
                          />
                        )}
                      </div>
                      <h2 className="mt-1.5 truncate font-mono text-sm font-bold uppercase tracking-tight text-content group-hover:text-brand">
                        {c.title}
                      </h2>
                      {c.description && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {c.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight
                      className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground/40 transition-colors group-hover:text-content"
                      aria-hidden="true"
                    />
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {formatCanonicalQuantity(c.allocatedQuantity)} /{" "}
                        {formatCanonicalQuantity(c.requiredQuantity)}{" "}
                        {c.kind === "player_slots" ? "allocated" : "completed"}
                      </span>
                      <span>{pctLabel}</span>
                    </div>
                    <Progress
                      value={pctValue}
                      className={cn("h-1.5", hasAward && "[&>div]:bg-status-live")}
                      aria-label={`${pctLabel} progress`}
                    />
                  </div>

                  {/* Slot info for player_slots */}
                  {c.kind === "player_slots" && (
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>
                        {c.qualifiedSlotCount} / {c.requiredSlotCount} slots
                      </span>
                    </div>
                  )}

                  {c.award && (
                    <div className="mt-2 flex items-center justify-end">
                      <span className="text-[10px] text-status-live font-mono">
                        Completed {new Date(c.award.firstCompletedAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

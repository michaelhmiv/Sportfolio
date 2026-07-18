import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Award, ChevronRight, Layers, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CollectionArt } from "@/components/collection-art";
import { useAuth } from "@/hooks/useAuth";
import { authenticatedFetch } from "@/lib/queryClient";
import {
  formatCanonicalQuantity,
  basisPointsToProgressValue,
  allocationProgressDisplay,
} from "@/lib/collection-format";
import { extractCollectionApiError } from "@/lib/collection-api-error";
import { cn } from "@/lib/utils";
import type { CollectionAssemblyState, CollectionListEntry } from "@shared/collection-api";

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

type CollectionFilter = "all" | "ready" | "in_progress" | "earned";

type CollectionPresentation = {
  label: string;
  filter: CollectionFilter;
  tone: "live" | "amber" | "muted";
};

export const COLLECTION_FILTERS: Array<{ id: CollectionFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "in_progress", label: "In progress" },
  { id: "earned", label: "Earned" },
];

export function getCollectionSummary(collections: CollectionListEntry[]) {
  return collections.reduce(
    (summary, collection) => {
      summary.total += 1;
      if (collection.assemblyState === "ready" && collection.award == null) summary.ready += 1;
      if (collection.assemblyState === "in_progress") summary.inProgress += 1;
      if (collection.award != null) summary.earned += 1;
      return summary;
    },
    { total: 0, ready: 0, inProgress: 0, earned: 0 },
  );
}

function featuredRank(collection: CollectionListEntry) {
  if (collection.assemblyState === "ready" && collection.award == null) return 0;
  if (collection.assemblyState === "in_progress") return 1;
  if (collection.assemblyState === "unstarted") return 2;
  return 3;
}

export function getFeaturedCollection(collections: CollectionListEntry[]) {
  return [...collections]
    .sort((a, b) => featuredRank(a) - featuredRank(b) || b.progressBps - a.progressBps)
    .at(0);
}

export function getCollectionPresentation(collection: CollectionListEntry): CollectionPresentation {
  if (collection.award != null) {
    if (collection.assemblyState === "ready") {
      return { label: "Reactivate", filter: "earned", tone: "live" };
    }
    return { label: "Earned", filter: "earned", tone: "live" };
  }

  switch (collection.assemblyState) {
    case "ready":
      return { label: "Complete", filter: "ready", tone: "live" };
    case "in_progress":
      return { label: "Continue", filter: "in_progress", tone: "amber" };
    case "active":
      return { label: "Active", filter: "in_progress", tone: "live" };
    default:
      return { label: "Start exploring", filter: "all", tone: "muted" };
  }
}

function stateBadge(state: CollectionAssemblyState, hasAward: boolean) {
  if (hasAward) {
    return {
      label: "Earned",
      className: "bg-status-live/15 text-status-live border-status-live/30",
    };
  }

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
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-retry-collections">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

function SummaryHeader({ collections }: { collections: CollectionListEntry[] }) {
  const summary = getCollectionSummary(collections);
  return (
    <div className="terminal-shell overflow-hidden p-4 md:p-5">
      <div className="terminal-strip mb-2">Collections</div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="terminal-heading text-xl">Your collection shelf</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Keep building your sets through the season.
          </p>
        </div>
        <Layers className="mt-1 h-5 w-5 shrink-0 text-brand/70" aria-hidden="true" />
      </div>
      <div className="mt-4 grid grid-cols-3 divide-x divide-border border-t border-border pt-3 text-center">
        <div>
          <p className="font-mono text-base font-bold text-content">{summary.ready}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">ready</p>
        </div>
        <div>
          <p className="font-mono text-base font-bold text-content">{summary.inProgress}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">in progress</p>
        </div>
        <div>
          <p className="font-mono text-base font-bold text-status-live">{summary.earned}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">earned</p>
        </div>
      </div>
    </div>
  );
}

function FeaturedCollection({ collection }: { collection: CollectionListEntry }) {
  const presentation = getCollectionPresentation(collection);
  const hasAward = collection.award != null;
  const pctValue = basisPointsToProgressValue(collection.progressBps);
  const pctLabel = allocationProgressDisplay(collection.progressBps);

  return (
    <Link
      href={`/collections/${collection.slug}`}
      className={cn(
        "terminal-shell group block overflow-hidden border-brand/30 bg-brand/[0.04] p-4 transition-colors hover:border-brand/60 sm:p-5",
        hasAward && "border-status-live/30 bg-status-live/[0.04]",
      )}
      data-testid="featured-collection"
    >
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-brand">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Continue collecting
      </div>
      <div className="mt-3 flex items-start gap-3">
        <CollectionArt
          artKey={collection.artKey}
          sport={collection.sport}
          size="lg"
          isBadge={hasAward}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="terminal-strip text-[10px]">
              {collection.sport} · {collection.season}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "px-1.5 py-0 text-[10px]",
                hasAward
                  ? "border-status-live/30 bg-status-live/15 text-status-live"
                  : presentation.tone === "amber"
                    ? "border-amber-500/30 bg-amber-500/15 text-amber-500"
                    : "border-status-live/30 bg-status-live/15 text-status-live",
              )}
            >
              {presentation.label}
            </Badge>
          </div>
          <h2 className="mt-2 font-mono text-base font-bold uppercase tracking-tight text-content group-hover:text-brand">
            {collection.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {collection.description}
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {formatCanonicalQuantity(collection.allocatedQuantity)} /{" "}
            {formatCanonicalQuantity(collection.requiredQuantity)}{" "}
            {collection.kind === "player_slots" ? "allocated" : "completed"}
          </span>
          <span className="font-mono text-content">{pctLabel}</span>
        </div>
        <Progress
          value={pctValue}
          className={cn("h-2", hasAward && "[&>div]:bg-status-live")}
          aria-label={`${pctLabel} progress`}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[10px]">
        <span className="text-muted-foreground">
          {collection.kind === "player_slots"
            ? `${collection.qualifiedSlotCount} of ${collection.requiredSlotCount} slots qualified`
            : "Milestone collection"}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono font-bold uppercase tracking-wide text-brand">
          {presentation.label}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

function CollectionCard({ collection }: { collection: CollectionListEntry }) {
  const presentation = getCollectionPresentation(collection);
  const badge = stateBadge(collection.assemblyState, collection.award != null);
  const hasAward = collection.award != null;
  const pctValue = basisPointsToProgressValue(collection.progressBps);
  const pctLabel = allocationProgressDisplay(collection.progressBps);

  return (
    <Link
      href={`/collections/${collection.slug}`}
      className={cn(
        "terminal-shell group block p-4 transition-colors hover:border-brand/40",
        hasAward && "border-status-live/20",
        collection.assemblyState === "ready" && !hasAward && "border-status-live/25",
      )}
      data-testid={`collection-card-${collection.slug}`}
    >
      <div className="flex items-start gap-3">
        <CollectionArt
          artKey={collection.artKey}
          sport={collection.sport}
          size="md"
          isBadge={hasAward}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="terminal-strip text-[10px]">
              {collection.sport} · {collection.season}
            </span>
            {collection.lifecycleStatus === "final" && (
              <span className="terminal-strip text-[10px]">Final</span>
            )}
            {badge && (
              <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", badge.className)}>
                {badge.label}
              </Badge>
            )}
          </div>
          <h2 className="mt-1.5 font-mono text-sm font-bold uppercase tracking-tight text-content group-hover:text-brand">
            {collection.title}
          </h2>
          {collection.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {collection.description}
            </p>
          )}
        </div>
        <ChevronRight
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-content"
          aria-hidden="true"
        />
      </div>

      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {formatCanonicalQuantity(collection.allocatedQuantity)} /{" "}
            {formatCanonicalQuantity(collection.requiredQuantity)}{" "}
            {collection.kind === "player_slots" ? "allocated" : "completed"}
          </span>
          <span className="font-mono text-content">{pctLabel}</span>
        </div>
        <Progress
          value={pctValue}
          className={cn("h-1.5", hasAward && "[&>div]:bg-status-live")}
          aria-label={`${pctLabel} progress`}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-[10px]">
        <span className="text-muted-foreground">
          {collection.kind === "player_slots"
            ? `${collection.qualifiedSlotCount} / ${collection.requiredSlotCount} slots`
            : "Milestone collection"}
        </span>
        <span
          className={cn(
            "font-mono font-bold uppercase tracking-wide",
            presentation.tone === "live" && "text-status-live",
            presentation.tone === "amber" && "text-amber-500",
            presentation.tone === "muted" && "text-muted-foreground",
          )}
        >
          {presentation.label}
        </span>
      </div>

      {collection.award && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-status-live/15 pt-2 text-[10px] font-mono text-status-live">
          <Award className="h-3.5 w-3.5" aria-hidden="true" />
          Earned {new Date(collection.award.firstCompletedAt).toLocaleDateString()}
        </div>
      )}
    </Link>
  );
}

function FilterBar({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: CollectionFilter;
  onFilterChange: (filter: CollectionFilter) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter collections">
      {COLLECTION_FILTERS.map((filter) => {
        const isActive = filter.id === activeFilter;
        return (
          <button
            key={filter.id}
            type="button"
            className={cn(
              "min-h-9 shrink-0 rounded-control border px-3 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors",
              isActive
                ? "border-brand/50 bg-brand/10 text-brand"
                : "border-border bg-panel text-muted-foreground hover:border-brand/30 hover:text-content",
            )}
            aria-pressed={isActive}
            onClick={() => onFilterChange(filter.id)}
            data-testid={`collection-filter-${filter.id}`}
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}

export default function CollectionsPage() {
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id ?? "";
  const [activeFilter, setActiveFilter] = useState<CollectionFilter>("all");
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

  const featuredCollection = collections ? getFeaturedCollection(collections) : undefined;
  const visibleCollections = useMemo(() => {
    if (!collections) return [];
    if (activeFilter === "all") {
      return featuredCollection
        ? collections.filter((collection) => collection.slug !== featuredCollection.slug)
        : collections;
    }
    return collections.filter(
      (collection) => getCollectionPresentation(collection).filter === activeFilter,
    );
  }, [activeFilter, collections, featuredCollection]);

  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {collections && collections.length > 0 && <SummaryHeader collections={collections} />}

        {isLoading && (
          <div role="status" aria-live="polite" className="sr-only">
            Loading collections…
          </div>
        )}

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
          <>
            {activeFilter === "all" && featuredCollection && (
              <FeaturedCollection collection={featuredCollection} />
            )}
            <FilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} />
            {visibleCollections.length > 0 ? (
              <div className="space-y-3" data-testid="collections-list">
                {visibleCollections.map((collection) => (
                  <CollectionCard key={collection.slug} collection={collection} />
                ))}
              </div>
            ) : (
              <div
                className="terminal-shell p-6 text-center"
                data-testid="collections-filter-empty"
              >
                <p className="text-sm font-medium text-muted-foreground">Nothing here yet</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Keep building your collections and this shelf will fill in.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

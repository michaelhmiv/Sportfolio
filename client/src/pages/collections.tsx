import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Award, ChevronRight, Layers, RefreshCw, Sparkles, Trophy } from "lucide-react";
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
  if (hasAward)
    return {
      label: "Earned",
      className: "border-status-live/30 bg-status-live/15 text-status-live",
    };
  switch (state) {
    case "ready":
      return {
        label: "Ready",
        className: "border-status-live/30 bg-status-live/15 text-status-live",
      };
    case "active":
      return {
        label: "Active",
        className: "border-status-live/30 bg-status-live/15 text-status-live",
      };
    case "in_progress":
      return {
        label: "In progress",
        className: "border-amber-500/30 bg-amber-500/15 text-amber-500",
      };
    case "inactive":
      return { label: "Inactive", className: "border-border bg-muted text-muted-foreground" };
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
      <button
        type="button"
        className="min-h-9 rounded-control border border-border px-3 text-xs font-medium text-content hover:border-brand/50"
        onClick={onRetry}
        data-testid="button-retry-collections"
      >
        Retry
      </button>
    </div>
  );
}

function PageHeader({ collections }: { collections: CollectionListEntry[] }) {
  const summary = getCollectionSummary(collections);
  return (
    <header className="flex items-end justify-between gap-4 border-b border-border/70 pb-4">
      <div>
        <p className="terminal-strip mb-2 inline-block text-[10px]">Collections</p>
        <h1 className="terminal-heading text-2xl">Build your shelf</h1>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Chase the next set, finish what you started, and keep your best runs.
        </p>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <p className="font-mono text-2xl font-bold text-content">{summary.total}</p>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">sets</p>
      </div>
    </header>
  );
}

function FeaturedCollection({ collection }: { collection: CollectionListEntry }) {
  const presentation = getCollectionPresentation(collection);
  const hasAward = collection.award != null;
  const pctLabel = allocationProgressDisplay(collection.progressBps);
  const eyebrow = hasAward
    ? "Your latest trophy"
    : collection.assemblyState === "ready"
      ? "Ready to complete"
      : collection.assemblyState === "in_progress"
        ? "Continue collecting"
        : "Start a new set";

  return (
    <Link
      href={`/collections/${collection.slug}`}
      className={cn(
        "group relative block overflow-hidden rounded-panel border border-brand/30 bg-gradient-to-br from-brand/[0.14] via-panel to-panel p-4 transition-colors hover:border-brand/70 sm:p-6",
        hasAward && "border-status-live/30 from-status-live/[0.12]",
      )}
      data-testid="featured-collection"
    >
      <div
        className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-brand/[0.08] blur-2xl"
        aria-hidden="true"
      />
      <div className="relative flex items-start gap-4 sm:gap-5">
        <CollectionArt
          artKey={collection.artKey}
          sport={collection.sport}
          size="lg"
          isBadge={hasAward}
          className="h-16 w-16 rounded-panel text-base sm:h-20 sm:w-20 sm:text-lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand">
              {eyebrow}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "px-1.5 py-0 text-[10px]",
                stateBadge(collection.assemblyState, hasAward)?.className,
              )}
            >
              {presentation.label}
            </Badge>
          </div>
          <h2 className="mt-2 text-lg font-bold tracking-tight text-content group-hover:text-brand sm:text-xl">
            {collection.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {collection.description}
          </p>
        </div>
      </div>
      <div className="relative mt-5 space-y-2">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {collection.kind === "player_slots"
              ? `${collection.qualifiedSlotCount} of ${collection.requiredSlotCount} slots qualified`
              : "Milestone collection"}
          </span>
          <span className="font-mono font-bold text-content">{pctLabel}</span>
        </div>
        <Progress
          value={basisPointsToProgressValue(collection.progressBps)}
          className={cn("h-2", hasAward && "[&>div]:bg-status-live")}
          aria-label={`${pctLabel} progress`}
        />
      </div>
      <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <span className="text-[10px] text-muted-foreground">
          {formatCanonicalQuantity(collection.allocatedQuantity)} /{" "}
          {formatCanonicalQuantity(collection.requiredQuantity)} allocated
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-brand">
          Open set <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

function CollectionCard({ collection }: { collection: CollectionListEntry }) {
  const presentation = getCollectionPresentation(collection);
  const badge = stateBadge(collection.assemblyState, collection.award != null);
  const hasAward = collection.award != null;
  const pctLabel = allocationProgressDisplay(collection.progressBps);

  return (
    <Link
      href={`/collections/${collection.slug}`}
      className={cn(
        "group flex min-h-[148px] flex-col rounded-panel border border-border/80 bg-panel/60 p-3 transition-colors hover:border-brand/50 hover:bg-panel sm:p-4",
        hasAward && "border-status-live/20 bg-status-live/[0.025]",
        collection.assemblyState === "ready" && !hasAward && "border-status-live/30",
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
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {collection.sport} · {collection.season}
            </span>
            {badge && (
              <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", badge.className)}>
                {badge.label}
              </Badge>
            )}
          </div>
          <h2 className="mt-1.5 line-clamp-2 text-sm font-bold leading-tight text-content group-hover:text-brand">
            {collection.title}
          </h2>
        </div>
        <ChevronRight
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-brand"
          aria-hidden="true"
        />
      </div>
      <div className="mt-auto space-y-2 pt-4">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {collection.kind === "player_slots"
              ? `${collection.qualifiedSlotCount} / ${collection.requiredSlotCount} slots`
              : "Milestone"}
          </span>
          <span className="font-mono font-bold text-content">{pctLabel}</span>
        </div>
        <Progress
          value={basisPointsToProgressValue(collection.progressBps)}
          className={cn("h-1.5", hasAward && "[&>div]:bg-status-live")}
          aria-label={`${pctLabel} progress`}
        />
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="truncate text-muted-foreground">{collection.description}</span>
          <span
            className={cn(
              "shrink-0 font-mono font-bold uppercase",
              presentation.tone === "live" && "text-status-live",
              presentation.tone === "amber" && "text-amber-500",
              presentation.tone === "muted" && "text-muted-foreground",
            )}
          >
            {presentation.label}
          </span>
        </div>
      </div>
    </Link>
  );
}

function Shelf({
  title,
  icon,
  collections,
}: {
  title: string;
  icon: ReactNode;
  collections: CollectionListEntry[];
}) {
  if (collections.length === 0) return null;
  return (
    <section aria-labelledby={`shelf-${title.replaceAll(" ", "-").toLowerCase()}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2
          id={`shelf-${title.replaceAll(" ", "-").toLowerCase()}`}
          className="text-xs font-bold uppercase tracking-[0.14em] text-content"
        >
          {title}
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">{collections.length}</span>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {collections.map((collection) => (
          <CollectionCard key={collection.slug} collection={collection} />
        ))}
      </div>
    </section>
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
    <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filter collections">
      {COLLECTION_FILTERS.map((filter) => {
        const isActive = filter.id === activeFilter;
        return (
          <button
            key={filter.id}
            type="button"
            className={cn(
              "min-h-8 shrink-0 rounded-control px-2.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors",
              isActive
                ? "bg-content text-canvas"
                : "border border-border/70 text-muted-foreground hover:border-brand/40 hover:text-content",
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
    if (activeFilter === "all")
      return featuredCollection
        ? collections.filter((item) => item.slug !== featuredCollection.slug)
        : collections;
    return collections.filter((item) => getCollectionPresentation(item).filter === activeFilter);
  }, [activeFilter, collections, featuredCollection]);

  const ready = visibleCollections.filter(
    (item) => item.assemblyState === "ready" && item.award == null,
  );
  const inProgress = visibleCollections.filter(
    (item) => item.assemblyState === "in_progress" || item.assemblyState === "active",
  );
  const earned = visibleCollections.filter((item) => item.award != null);
  const other = visibleCollections.filter(
    (item) => !ready.includes(item) && !inProgress.includes(item) && !earned.includes(item),
  );

  return (
    <div className="terminal-page p-3 sm:p-5">
      <div className="mx-auto max-w-4xl space-y-5">
        {collections && collections.length > 0 && <PageHeader collections={collections} />}
        {isLoading && (
          <div role="status" aria-live="polite" className="sr-only">
            Loading collections…
          </div>
        )}
        {isLoading ? (
          <div className="space-y-3" data-testid="collections-loading">
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
              <div className="space-y-6" data-testid="collections-list">
                <Shelf
                  title="Ready to finish"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  collections={ready}
                />
                <Shelf
                  title="In progress"
                  icon={<Layers className="h-3.5 w-3.5" />}
                  collections={inProgress}
                />
                <Shelf
                  title="Earned shelf"
                  icon={<Trophy className="h-3.5 w-3.5" />}
                  collections={earned}
                />
                <Shelf
                  title="Explore"
                  icon={<ChevronRight className="h-3.5 w-3.5" />}
                  collections={other}
                />
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

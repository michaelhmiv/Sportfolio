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
import { normalizeCollectionFamily } from "@/components/collections/collection-visual-theme";

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
  const summary = collections.reduce(
    (summary, collection) => {
      summary.total += 1;
      if (collection.assemblyState === "ready" && collection.award == null) summary.ready += 1;
      if (collection.assemblyState === "in_progress") summary.inProgress += 1;
      if (collection.award != null) summary.earned += 1;
      return summary;
    },
    { total: 0, ready: 0, inProgress: 0, earned: 0 },
  );
  return { ...summary, closest: getFeaturedCollection(collections)?.slug ?? null };
}

export function groupCollectionsByFamily(collections: CollectionListEntry[]) {
  const groups = new Map<
    string,
    { id: string; label: string; collections: CollectionListEntry[] }
  >();
  for (const collection of collections) {
    if (collection.kind === "master") continue;
    const id = normalizeCollectionFamily(collection.family) || "other";
    const group = groups.get(id) ?? { id, label: collection.family || "Other", collections: [] };
    group.collections.push(collection);
    groups.set(id, group);
  }
  return [...groups.values()];
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

export function getFilteredCollectionView(
  collections: CollectionListEntry[],
  activeFilter: CollectionFilter,
  sportFilter: string,
  seasonFilter: string,
  familyFilter: string,
) {
  const facetMatches = collections.filter(
    (item) =>
      (sportFilter === "All" || item.sport === sportFilter) &&
      (seasonFilter === "All" || item.season === seasonFilter) &&
      (familyFilter === "All" || item.family === familyFilter),
  );
  const featuredCollection =
    activeFilter === "all" ? getFeaturedCollection(facetMatches) : undefined;
  const visibleCollections =
    activeFilter === "all"
      ? facetMatches.filter((item) => item.slug !== featuredCollection?.slug)
      : facetMatches.filter((item) => getCollectionPresentation(item).filter === activeFilter);
  return { featuredCollection, visibleCollections };
}

export function getCollectionPresentation(collection: CollectionListEntry): CollectionPresentation {
  if (collection.award != null) {
    if (collection.assemblyState === "ready") {
      return { label: "Reactivate", filter: "earned", tone: "live" };
    }
    if (collection.assemblyState === "active") {
      return { label: "Active", filter: "earned", tone: "live" };
    }
    return { label: "Earned · Inactive", filter: "earned", tone: "muted" };
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
  if (hasAward && state === "active")
    return {
      label: "Active",
      className: "border-status-live/30 bg-status-live/15 text-status-live",
    };
  if (hasAward && state === "ready")
    return {
      label: "Earned · Ready",
      className: "border-status-live/30 bg-status-live/15 text-status-live",
    };
  if (hasAward)
    return {
      label: "Earned · Inactive",
      className: "border-border-strong bg-surface-raised text-content-muted",
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
        className: "border-status-warning/30 bg-status-warning/15 text-status-warning",
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
      <div className="sr-only">Closest {summary.closest ?? "none"}</div>
      <div className="hidden shrink-0 text-right sm:block">
        <p className="font-mono text-2xl font-bold text-content">{summary.total}</p>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">sets</p>
      </div>
    </header>
  );
}

export function SummaryRail({ collections }: { collections: CollectionListEntry[] }) {
  const summary = getCollectionSummary(collections);
  const closest = collections.find((collection) => collection.slug === summary.closest);
  return (
    <dl
      className="grid grid-cols-[repeat(3,minmax(0,1fr))] overflow-hidden rounded-panel border border-border-strong bg-surface shadow-low"
      data-testid="collection-summary-rail"
    >
      {[
        ["In progress", summary.inProgress],
        ["Ready", summary.ready],
        ["Completed", summary.earned],
      ].map(([label, value]) => (
        <div key={label} className="border-r border-border-subtle px-3 py-2 last:border-r-0">
          <dt className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">
            {label}
          </dt>
          <dd className="font-mono text-lg font-black tabular-nums text-content">{value}</dd>
        </div>
      ))}
      <div className="col-span-3 flex items-center justify-between border-t border-border-subtle px-3 py-2">
        <dt className="text-[9px] uppercase tracking-wider text-muted-foreground">Closest</dt>
        <dd className="truncate text-xs font-semibold text-content">{closest?.title ?? "—"}</dd>
      </div>
    </dl>
  );
}

export function FeaturedCollection({ collection }: { collection: CollectionListEntry }) {
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
          family={collection.family}
          season={collection.season}
          title={collection.title}
          kind={collection.kind}
          assemblyState={collection.assemblyState}
          award={collection.award}
          size="lg"
          className="h-28 w-24 sm:h-32 sm:w-28"
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

export function CollectionCard({ collection }: { collection: CollectionListEntry }) {
  const presentation = getCollectionPresentation(collection);
  const badge = stateBadge(collection.assemblyState, collection.award != null);
  const hasAward = collection.award != null;
  const isMaster = collection.kind === "master";
  const pctLabel = allocationProgressDisplay(collection.progressBps);

  return (
    <Link
      href={`/collections/${collection.slug}`}
      className={cn(
        "group flex min-h-[190px] w-[78vw] max-w-[20rem] shrink-0 snap-start flex-col rounded-panel border border-border/80 bg-panel/60 p-3 transition-colors hover:border-brand/50 hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:w-[19rem] sm:p-4",
        hasAward &&
          "border-status-live/25 bg-status-live/[0.035] ring-1 ring-inset ring-status-live/10",
        isMaster &&
          "min-h-[220px] w-[82vw] border-brand/35 bg-brand-subtle/[0.08] shadow-medium sm:w-[22rem]",
        collection.assemblyState === "ready" && !hasAward && "border-status-live/30",
      )}
      data-testid={`collection-card-${collection.slug}`}
    >
      <div className="flex items-start gap-3">
        <CollectionArt
          artKey={collection.artKey}
          sport={collection.sport}
          family={collection.family}
          season={collection.season}
          title={collection.title}
          kind={collection.kind}
          assemblyState={collection.assemblyState}
          award={collection.award}
          size={isMaster ? "lg" : "md"}
          className={isMaster ? "h-20 w-20" : undefined}
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
              presentation.tone === "amber" && "text-status-warning",
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

export function Shelf({
  title,
  icon,
  collections,
  testId,
}: {
  title: string;
  icon: ReactNode;
  collections: CollectionListEntry[];
  testId?: string;
}) {
  if (collections.length === 0) return null;
  return (
    <section
      aria-labelledby={`shelf-${title.replaceAll(" ", "-").toLowerCase()}`}
      data-testid={testId}
    >
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
      <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
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

function FacetFilter({
  label,
  values,
  active,
  onChange,
}: {
  label: string;
  values: string[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-2 overflow-x-auto"
      role="group"
      aria-label={`${label} filter`}
    >
      <span className="w-12 shrink-0 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {["All", ...values].map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={active === value}
          className={cn(
            "min-h-11 shrink-0 rounded-pill border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
            active === value
              ? "border-selected-border bg-selected text-selected-foreground"
              : "border-border-subtle bg-surface text-muted-foreground",
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

export default function CollectionsPage() {
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id ?? "";
  const [activeFilter, setActiveFilter] = useState<CollectionFilter>("all");
  const [sportFilter, setSportFilter] = useState("All");
  const [seasonFilter, setSeasonFilter] = useState("All");
  const [familyFilter, setFamilyFilter] = useState("All");
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

  const { featuredCollection, visibleCollections } = useMemo(
    () =>
      getFilteredCollectionView(
        collections ?? [],
        activeFilter,
        sportFilter,
        seasonFilter,
        familyFilter,
      ),
    [activeFilter, collections, familyFilter, seasonFilter, sportFilter],
  );

  const ready = visibleCollections.filter(
    (item) => item.assemblyState === "ready" && item.award == null,
  );
  const earned = visibleCollections.filter((item) => item.award != null);
  const masters = visibleCollections.filter((item) => item.kind === "master" && item.award == null);
  const familyGroups = groupCollectionsByFamily(
    visibleCollections.filter(
      (item) => item.award == null && item.kind !== "master" && !ready.includes(item),
    ),
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
            <SummaryRail collections={collections} />
            <div className="space-y-2" data-testid="collection-filters">
              <FilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} />
              <FacetFilter
                label="Sport"
                values={[...new Set(collections.map((item) => item.sport))]}
                active={sportFilter}
                onChange={setSportFilter}
              />
              <FacetFilter
                label="Season"
                values={[...new Set(collections.map((item) => item.season))]}
                active={seasonFilter}
                onChange={setSeasonFilter}
              />
              <FacetFilter
                label="Family"
                values={[...new Set(collections.map((item) => item.family))]}
                active={familyFilter}
                onChange={setFamilyFilter}
              />
            </div>
            {activeFilter === "all" && featuredCollection && (
              <FeaturedCollection collection={featuredCollection} />
            )}
            {visibleCollections.length > 0 ? (
              <div className="space-y-8" data-testid="collections-list">
                <Shelf
                  title="Ready to complete"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  collections={ready}
                  testId="ready-to-complete"
                />
                {familyGroups.map((group) => (
                  <Shelf
                    key={group.id}
                    title={group.label}
                    icon={<Layers className="h-3.5 w-3.5" />}
                    collections={group.collections}
                    testId={`family-shelf-${group.id}`}
                  />
                ))}
                <div data-testid="master-prestige">
                  <Shelf
                    title="Master Collections"
                    icon={<Award className="h-3.5 w-3.5" />}
                    collections={masters}
                  />
                </div>
                <div data-testid="trophy-case">
                  <Shelf
                    title="Trophy Case"
                    icon={<Trophy className="h-3.5 w-3.5" />}
                    collections={earned}
                  />
                </div>
              </div>
            ) : !featuredCollection ? (
              <div
                className="terminal-shell p-6 text-center"
                data-testid="collections-filter-empty"
              >
                <p className="text-sm font-medium text-muted-foreground">Nothing here yet</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Keep building your collections and this shelf will fill in.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

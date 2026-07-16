import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Award, Lock, Trophy, ArrowRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { CollectionListEntry } from "@shared/collection-api";

async function fetchCollections(): Promise<CollectionListEntry[]> {
  const res = await fetch("/api/me/collections");
  if (!res.ok) throw new Error("Failed to load collections");
  const json = (await res.json()) as { data: CollectionListEntry[] };
  return json.data as CollectionListEntry[];
}

const familyDot: Record<string, string> = {
  scout: "bg-status-info",
  boost: "bg-boost",
  seasonal: "bg-status-live",
  community: "bg-category-community",
};

type FilterValue = "all" | "active" | "in_progress" | "completed";
type SortValue = "progress" | "recent";

const filterTabs: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

const sortOptions: { value: SortValue; label: string }[] = [
  { value: "progress", label: "Most progress" },
  { value: "recent", label: "Recently completed" },
];

function isComplete(entry: CollectionListEntry): boolean {
  return entry.award != null;
}

function matchesFilter(entry: CollectionListEntry, filter: FilterValue): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return isComplete(entry);
  if (filter === "active") return entry.assemblyState === "active";
  if (filter === "in_progress") return entry.assemblyState === "in_progress";
  return true;
}

function CollectionCard({ entry, index }: { entry: CollectionListEntry; index: number }) {
  const pct = Math.round(Number(entry.progressBps) / 100);
  const isComplete = entry.award != null;
  const remaining = Number(entry.requiredSlotCount) - Number(entry.qualifiedSlotCount);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
      className={cn(
        "terminal-shell group flex w-full flex-col gap-3 p-3 transition-colors sm:p-4",
        "hover:border-brand/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                familyDot[entry.family] ?? "bg-muted-foreground",
              )}
              aria-hidden
            />
            <h2 className="terminal-heading truncate !text-base !font-semibold sm:!text-lg">
              {entry.title}
            </h2>
          </div>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
            {entry.family} · {entry.slug}
          </p>
        </div>
        {entry.assemblyState === "active" && (
          <span className="flex shrink-0 items-center gap-1 rounded-pill border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
            <Lock className="h-3 w-3" /> Active
          </span>
        )}
        {isComplete && (
          <span className="flex shrink-0 items-center gap-1 rounded-pill border border-market-positive/30 bg-market-positive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-market-positive">
            <Trophy className="h-3 w-3" /> Complete
          </span>
        )}
      </div>

      <div>
        <Progress
          value={Number(entry.progressBps) / 10000}
          animated={entry.assemblyState === "active"}
        />
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span className="font-mono text-content-strong">{pct}%</span>
          <span className="text-muted-foreground">
            {entry.qualifiedSlotCount}/{entry.requiredSlotCount} slots
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {!isComplete && remaining > 0 ? (
          <span className="text-xs font-medium text-muted-foreground">
            {remaining} more {remaining === 1 ? "slot" : "slots"} to ready
          </span>
        ) : !isComplete ? (
          <span className="text-xs font-medium text-brand">Ready to complete</span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium text-premium">
            <Award className="h-3.5 w-3.5" />
            {entry.award?.awardId ?? "Award"}
          </span>
        )}
        <span className="flex items-center gap-1 text-xs font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">
          Open <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </motion.div>
  );
}

export default function CollectionsPage() {
  const [filter, setFilter] = useState<FilterValue>("all");
  const [sort, setSort] = useState<SortValue>("progress");

  const {
    data: collections = [],
    isLoading,
    isError,
  } = useQuery<CollectionListEntry[]>({
    queryKey: ["/api/me/collections"],
    queryFn: fetchCollections,
  });

  const visible = useMemo(() => {
    const filtered = collections.filter((c) => matchesFilter(c, filter));
    const sorted = [...filtered];
    if (sort === "progress") {
      sorted.sort((a, b) => Number(b.progressBps) - Number(a.progressBps));
    } else {
      sorted.sort((a, b) => {
        const aDone = isComplete(a) ? 1 : 0;
        const bDone = isComplete(b) ? 1 : 0;
        if (aDone !== bDone) return bDone - aDone;
        return Number(b.progressBps) - Number(a.progressBps);
      });
    }
    return sorted;
  }, [collections, filter, sort]);

  const groups = useMemo(() => {
    const byFamily = new Map<string, CollectionListEntry[]>();
    for (const entry of visible) {
      const list = byFamily.get(entry.family) ?? [];
      list.push(entry);
      byFamily.set(entry.family, list);
    }
    return [...byFamily.entries()];
  }, [visible]);

  const completedCount = collections.filter((c) => c.award != null).length;

  return (
    <div className="pb-24">
      {/* Sticky compact header */}
      <div className="sticky top-0 z-20 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h1 className="terminal-heading !text-lg !font-bold sm:!text-xl">Collections</h1>
            <span className="text-xs text-muted-foreground">
              {completedCount}/{collections.length} completed
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="collections-sort">
              Sort collections
            </label>
            <select
              id="collections-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortValue)}
              className="rounded-control border border-border/60 bg-surface px-2 py-1.5 text-xs text-content-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mx-auto mt-3 flex max-w-5xl gap-1 overflow-x-auto">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              className={cn(
                "shrink-0 rounded-pill px-3 py-1 text-xs font-medium transition-colors",
                filter === tab.value
                  ? "bg-brand/15 text-brand"
                  : "text-muted-foreground hover:text-content-strong",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="terminal-shell h-36 animate-pulse p-4" />
            ))}
          </div>
        ) : isError ? (
          <div className="terminal-shell p-6 text-center text-sm text-muted-foreground">
            Couldn&apos;t load your collections. Try again in a moment.
          </div>
        ) : visible.length === 0 ? (
          <div className="terminal-shell p-8 text-center text-sm text-muted-foreground">
            No collections match this filter.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map(([family, entries]) => (
              <section key={family} className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      familyDot[family] ?? "bg-muted-foreground",
                    )}
                  />
                  {family}
                  <span className="text-muted-foreground/60">· {entries.length}</span>
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {entries.map((entry, index) => (
                    <Link key={entry.slug} href={`/collections/${entry.slug}`} className="block">
                      <CollectionCard entry={entry} index={index} />
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

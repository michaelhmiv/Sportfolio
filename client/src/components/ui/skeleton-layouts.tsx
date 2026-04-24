/**
 * Page-level skeleton layouts that mirror the real page structures.
 * Used as fallbacks during lazy-load and data-fetch states.
 */

import { cn } from "@/lib/utils";

/** Generic animated shimmer base */
function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-sm bg-muted/60", className)} aria-hidden="true" />
  );
}

/** Skeleton for the Dashboard page */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-label="Loading dashboard…" role="status">
      {/* Market ticker */}
      <SkeletonBox className="h-8 w-full rounded-sm" />
      {/* Net worth banner */}
      <SkeletonBox className="h-24 w-full rounded-sm" />
      {/* Showcase cards row */}
      <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-sm border border-border p-3">
            <div className="flex items-center gap-2">
              <SkeletonBox className="h-8 w-8 rounded-sm" />
              <div className="flex flex-col gap-1 flex-1">
                <SkeletonBox className="h-3 w-24" />
                <SkeletonBox className="h-3 w-16" />
              </div>
              <SkeletonBox className="h-6 w-14" />
            </div>
            <SkeletonBox className="h-2 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for the Player Pools / Marketplace page */
export function PlayerPoolsSkeleton() {
  return (
    <div className="flex flex-col gap-0" aria-label="Loading player pools…" role="status">
      {/* Filter bar */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <SkeletonBox className="h-8 w-32" />
        <SkeletonBox className="h-8 w-24" />
        <SkeletonBox className="h-8 flex-1" />
      </div>
      {/* Table rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5 border-b border-border">
          <SkeletonBox className="h-8 w-8 rounded-sm shrink-0" />
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <SkeletonBox className="h-3 w-28" />
            <SkeletonBox className="h-3 w-16" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <SkeletonBox className="h-3 w-12" />
            <SkeletonBox className="h-3 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for the Portfolio page */
export function PortfolioSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-label="Loading portfolio…" role="status">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <SkeletonBox className="h-20 rounded-sm" />
        <SkeletonBox className="h-20 rounded-sm" />
      </div>
      {/* Holdings rows */}
      <div className="flex flex-col gap-0 border border-border rounded-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-3 py-2 bg-muted/40">
          <SkeletonBox className="h-3 w-20" />
          <div className="flex-1" />
          <SkeletonBox className="h-3 w-12" />
          <SkeletonBox className="h-3 w-12" />
          <SkeletonBox className="h-3 w-12" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 border-t border-border">
            <SkeletonBox className="h-7 w-7 rounded-sm shrink-0" />
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <SkeletonBox className="h-3 w-24" />
              <SkeletonBox className="h-3 w-14" />
            </div>
            <SkeletonBox className="h-3 w-10" />
            <SkeletonBox className="h-3 w-10" />
            <SkeletonBox className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Generic page loading skeleton (used for other lazy-loaded routes) */
export function GenericPageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" aria-label="Loading…" role="status">
      <SkeletonBox className="h-8 w-48" />
      <SkeletonBox className="h-4 w-full" />
      <SkeletonBox className="h-4 w-5/6" />
      <SkeletonBox className="h-4 w-4/6" />
      <div className="grid grid-cols-1 gap-3 mt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBox key={i} className="h-16 w-full rounded-sm" />
        ))}
      </div>
    </div>
  );
}

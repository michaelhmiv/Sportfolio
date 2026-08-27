import { useInfiniteQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Clock3,
  Crown,
  Droplets,
  Loader2,
  Search,
  ShoppingCart,
  Sparkles,
  Trophy,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

import {
  buildPortfolioActivityCategoryCounts,
  buildPortfolioActivityFeedQueryParams,
  buildPortfolioActivitySummary,
  filterPortfolioActivities,
  type PortfolioActivityCategoryFilter,
  type PortfolioActivityFocusFilter,
} from "@/components/portfolio-activity-tab.helpers";
import { EmptyState } from "@/components/ui/empty-state";
import { Shimmer } from "@/components/ui/animations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authenticatedFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  type UserActivityCategory,
  type UserActivityFeedResponse,
  type UserActivityItem,
} from "@shared/activity-feed";

const CATEGORY_OPTIONS: Array<{ value: PortfolioActivityCategoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "market", label: "Market" },
  { value: "boosts", label: "Boosts" },
  { value: "payouts", label: "Payouts" },
  { value: "liquidity", label: "Liquidity" },
  { value: "scout", label: "Scout" },
  { value: "community", label: "Community" },
  { value: "premium", label: "Premium" },
];

const FOCUS_OPTIONS: Array<{ value: PortfolioActivityFocusFilter; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "cash", label: "Cash only" },
  { value: "gameplay", label: "Gameplay" },
];

const CATEGORY_LABELS: Record<UserActivityCategory, string> = {
  market: "Market",
  scout: "Scout",
  boosts: "Boosts",
  community: "Community",
  liquidity: "Liquidity",
  premium: "Premium",
  payouts: "Payouts",
};

function getCategoryIcon(category: UserActivityCategory) {
  switch (category) {
    case "market":
      return ShoppingCart;
    case "boosts":
      return Trophy;
    case "liquidity":
      return Droplets;
    case "community":
      return Sparkles;
    case "premium":
      return Crown;
    case "payouts":
      return Wallet;
    case "scout":
    default:
      return Clock3;
  }
}

function getCategoryTone(category: UserActivityCategory) {
  switch (category) {
    case "market":
      return "border-category-market/20 bg-category-market/10 text-category-market";
    case "boosts":
      return "border-category-boost/20 bg-category-boost/10 text-category-boost";
    case "liquidity":
      return "border-category-liquidity/20 bg-category-liquidity/10 text-category-liquidity";
    case "community":
      return "border-category-community/20 bg-category-community/10 text-category-community";
    case "premium":
      return "text-premium border-premium/20 bg-premium/10";
    case "payouts":
      return "border-category-payout/20 bg-category-payout/10 text-category-payout";
    case "scout":
    default:
      return "border-category-scout/20 bg-category-scout/10 text-category-scout";
  }
}

function getStatusLabel(status?: string) {
  switch ((status || "").toLowerCase()) {
    case "active":
      return "Active";
    case "locked":
      return "Locked";
    case "processed":
      return "Processed";
    case "cancelled":
      return "Cancelled";
    default:
      return status || null;
  }
}

function formatSignedCurrency(delta?: string) {
  const value = Number(delta || 0);
  if (!Number.isFinite(value) || value === 0) {
    return null;
  }

  return `${value > 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function formatSignedShares(delta?: number) {
  if (!delta || !Number.isFinite(delta)) {
    return null;
  }

  const absoluteValue = Math.abs(delta);
  const formatted = absoluteValue.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(absoluteValue) ? 0 : 2,
    maximumFractionDigits: 2,
  });

  return `${delta > 0 ? "+" : "-"}${formatted} sh`;
}

async function fetchActivityPage(offset: number) {
  const params = buildPortfolioActivityFeedQueryParams(offset);

  const response = await authenticatedFetch(`/api/activity?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to fetch activity");
  }

  return (await response.json()) as UserActivityFeedResponse;
}

function ActivityRow({ activity }: { activity: UserActivityItem }) {
  const Icon = getCategoryIcon(activity.category);
  const signedCash = formatSignedCurrency(activity.cashDelta);
  const signedShares = formatSignedShares(activity.shareDelta);
  const statusLabel = getStatusLabel(activity.status);
  const detail = String(activity.context?.summary || activity.description);
  const targetHref = activity.entity?.href;

  return (
    <div className="px-3 py-2.5 sm:px-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control border",
            getCategoryTone(activity.category),
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {targetHref ? (
                  <Link
                    href={targetHref}
                    className="truncate text-sm font-medium hover:text-primary"
                  >
                    {activity.title}
                  </Link>
                ) : (
                  <div className="truncate text-sm font-medium">{activity.title}</div>
                )}
                {statusLabel && (
                  <Badge variant="outline" className="h-5 border-border/70 px-1.5 text-[10px]">
                    {statusLabel}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {activity.entity?.label || CATEGORY_LABELS[activity.category]}
                {activity.entity?.secondaryLabel ? ` | ${activity.entity.secondaryLabel}` : ""}
              </div>
            </div>

            <div className="flex-shrink-0 text-right">
              {signedCash ? (
                <div
                  className={cn(
                    "font-mono text-xs font-semibold",
                    Number(activity.cashDelta || 0) > 0
                      ? "text-market-positive"
                      : "text-market-negative",
                  )}
                >
                  {signedCash}
                </div>
              ) : signedShares ? (
                <div
                  className={cn(
                    "font-mono text-xs font-semibold",
                    (activity.shareDelta || 0) > 0
                      ? "text-market-positive"
                      : "text-market-negative",
                  )}
                >
                  {signedShares}
                </div>
              ) : null}
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
              </div>
            </div>
          </div>

          <div className="mt-1 text-xs leading-4 text-muted-foreground">{detail}</div>

          <div className="mt-1 flex items-center justify-between gap-3 text-[11px]">
            <div className="min-w-0 truncate text-muted-foreground">
              {CATEGORY_LABELS[activity.category]}
              {activity.balanceAfter ? ` | Bal $${activity.balanceAfter}` : ""}
            </div>
            {targetHref && (
              <Link href={targetHref} className="flex-shrink-0 text-primary hover:underline">
                Open
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PortfolioActivityTab() {
  const [category, setCategory] = useState<PortfolioActivityCategoryFilter>("all");
  const [focus, setFocus] = useState<PortfolioActivityFocusFilter>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["/api/activity", "portfolio-ledger"],
      initialPageParam: 0,
      queryFn: ({ pageParam }) => fetchActivityPage(pageParam),
      getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    });

  const pages = data?.pages || [];
  const activities = pages.flatMap((page) => page.activities);
  const summary = buildPortfolioActivitySummary(activities);
  const categoryCounts = buildPortfolioActivityCategoryCounts(activities);

  const filteredActivities = useMemo(
    () =>
      filterPortfolioActivities(activities, {
        category,
        focus,
        search,
      }),
    [activities, category, focus, search],
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          {[1, 2, 3, 4, 5, 6].map((index) => (
            <div key={index} className="flex items-center gap-3 rounded-control border p-3">
              <Shimmer width="32px" height="32px" className="rounded-control flex-shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Shimmer height="12px" width="45%" />
                <Shimmer height="11px" width="80%" />
                <Shimmer height="11px" width="55%" />
              </div>
              <Shimmer height="12px" width="54px" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="mb-2 text-sm text-destructive">Failed to load activity.</div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium uppercase tracking-wide">
            Activity Ledger
          </CardTitle>
          <div className="text-[11px] text-muted-foreground">{summary.total} events</div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Total", value: summary.total },
            { label: "Cash", value: summary.cashCount },
            { label: "Gameplay", value: summary.gameplayCount },
          ].map((item) => (
            <div key={item.label} className="rounded-control border bg-muted/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.label}
              </div>
              <div className="font-mono text-sm font-semibold">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search players or actions"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <Select
            value={focus}
            onValueChange={(value) => setFocus(value as PortfolioActivityFocusFilter)}
          >
            <SelectTrigger className="h-9 w-[126px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FOCUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {CATEGORY_OPTIONS.map((option) => {
            const count =
              option.value === "all"
                ? summary.total
                : (categoryCounts[option.value as UserActivityCategory] ?? 0);

            return (
              <Button
                key={option.value}
                size="sm"
                variant={category === option.value ? "default" : "outline"}
                className="h-8 flex-shrink-0 px-3 text-xs"
                onClick={() => setCategory(option.value)}
              >
                {option.label}
                <span className="ml-1 font-mono text-[10px] opacity-75">{count}</span>
              </Button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {filteredActivities.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No activity matches"
            description="Try a different category, focus, or search term."
            size="sm"
            className="py-8"
          />
        ) : (
          <div className="divide-y overflow-hidden rounded-control border">
            {filteredActivities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        )}

        {hasNextPage && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading more
              </>
            ) : (
              "Load more"
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

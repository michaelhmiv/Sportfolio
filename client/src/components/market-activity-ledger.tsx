import { useInfiniteQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  ArrowUpDown,
  Flame,
  Loader2,
  Radio,
  Search,
  ShieldAlert,
  Sparkles,
  Waves,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

import { EmptyState } from "@/components/ui/empty-state";
import { Shimmer } from "@/components/ui/animations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PlayerName } from "@/components/player-name";
import { authenticatedFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  MARKET_ACTIVITY_SIGNAL_TAGS,
  type MarketActivityFeedItem,
  type MarketActivityFeedResponse,
  type MarketActivityGameStateFilter,
  type MarketActivityHighlight,
  type MarketActivitySideFilter,
  type MarketActivitySignalTag,
  type MarketActivitySort,
} from "@shared/market-activity";

// Keep one fetch large enough for dense scanning while staying light on mobile.
const PAGE_SIZE = 40;
const HIGHLIGHT_ITEM_LIMIT = 4;

const SIGNAL_LABELS: Record<MarketActivitySignalTag, string> = {
  whale: "Whales",
  momentum: "Momentum",
  value: "Value",
  scout: "Scouts",
  boost: "Boosts",
  top_pool: "Top Pools",
  thin_pool: "Thin Pools",
  live: "Live",
};

const SIDE_OPTIONS: Array<{ value: MarketActivitySideFilter; label: string }> = [
  { value: "all", label: "All flow" },
  { value: "buy", label: "Pool buys" },
  { value: "sell", label: "Pool sells" },
  { value: "peer", label: "Peer prints" },
];

const GAME_STATE_OPTIONS: Array<{ value: MarketActivityGameStateFilter; label: string }> = [
  { value: "all", label: "Any slate" },
  { value: "live", label: "Live" },
  { value: "upcoming", label: "Upcoming" },
  { value: "ended", label: "Final" },
  { value: "none", label: "Off slate" },
];

const SORT_OPTIONS: Array<{ value: MarketActivitySort; label: string }> = [
  { value: "recent", label: "Recent" },
  { value: "notional", label: "Largest prints" },
  { value: "priceImpact", label: "Spot drift" },
  { value: "activity", label: "Activity score" },
];

function formatCompactMoney(value: number) {
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    minimumFractionDigits: value >= 1000 ? 0 : 2,
  })}`;
}

function formatCompactSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function buildMarketActivityQueryParams(params: {
  offset: number;
  sport?: string;
  search: string;
  side: MarketActivitySideFilter;
  signal: MarketActivitySignalTag | "all";
  gameState: MarketActivityGameStateFilter;
  whalesOnly: boolean;
  sort: MarketActivitySort;
}) {
  const searchParams = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(params.offset),
    sort: params.sort,
  });

  if (params.sport && params.sport !== "ALL") {
    searchParams.set("sport", params.sport);
  }
  if (params.search.trim()) {
    searchParams.set("search", params.search.trim());
  }
  if (params.side !== "all") {
    searchParams.set("side", params.side);
  }
  if (params.signal !== "all") {
    searchParams.set("signal", params.signal);
  }
  if (params.gameState !== "all") {
    searchParams.set("gameState", params.gameState);
  }
  if (params.whalesOnly) {
    searchParams.set("whalesOnly", "true");
  }

  return searchParams;
}

async function fetchMarketActivityPage(params: {
  offset: number;
  sport?: string;
  search: string;
  side: MarketActivitySideFilter;
  signal: MarketActivitySignalTag | "all";
  gameState: MarketActivityGameStateFilter;
  whalesOnly: boolean;
  sort: MarketActivitySort;
}) {
  const query = buildMarketActivityQueryParams(params);
  const response = await authenticatedFetch(`/api/market/activity?${query.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to fetch market activity");
  }
  return (await response.json()) as MarketActivityFeedResponse;
}

function getSignalTone(signal: MarketActivitySignalTag | null) {
  switch (signal) {
    case "whale":
      return "border-category-whale/30 bg-category-whale/10 text-category-whale";
    case "momentum":
      return "border-category-momentum/30 bg-category-momentum/10 text-category-momentum";
    case "value":
      return "border-category-value/30 bg-category-value/10 text-category-value";
    case "scout":
      return "border-category-scout/30 bg-category-scout/10 text-category-scout";
    case "boost":
      return "border-category-boost/30 bg-category-boost/10 text-category-boost";
    case "top_pool":
      return "border-category-pool/30 bg-category-pool/10 text-category-pool";
    case "thin_pool":
      return "border-category-thin-pool/30 bg-category-thin-pool/10 text-category-thin-pool";
    case "live":
      return "border-status-live/30 bg-status-live/10 text-status-live";
    default:
      return "border-border/70 bg-muted/20 text-muted-foreground";
  }
}

function HighlightStrip({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: typeof Activity;
  items: MarketActivityHighlight[];
}) {
  return (
    <div className="min-w-[250px] flex-1 rounded-control border bg-muted/10">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </div>
      </div>
      <div className="divide-y">
        {items.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">No signals right now.</div>
        ) : (
          items.slice(0, HIGHLIGHT_ITEM_LIMIT).map((item) => (
            <Link
              key={`${title}-${item.playerId}`}
              href={item.href}
              className="block px-3 py-2 transition-colors hover:bg-muted/20"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{item.playerName}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {item.team} | {item.note}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs">{item.metricValue}</div>
                  <div
                    className={cn(
                      "text-[11px]",
                      item.priceChange24h >= 0 ? "text-market-positive" : "text-market-negative",
                    )}
                  >
                    {formatCompactSignedPercent(item.priceChange24h)}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function ActivityRow({ activity }: { activity: MarketActivityFeedItem }) {
  return (
    <div className="px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={activity.href} className="truncate text-sm font-medium hover:text-primary">
              <PlayerName
                playerId={activity.playerId}
                firstName={activity.playerFirstName}
                lastName={activity.playerLastName}
                className="text-sm"
              />
            </Link>
            <Badge variant="outline" className="h-5 border-border/70 px-1.5 text-[10px] uppercase">
              {activity.side}
            </Badge>
            {activity.primarySignal ? (
              <Badge
                variant="outline"
                className={cn(
                  "h-5 px-1.5 text-[10px] uppercase",
                  getSignalTone(activity.primarySignal),
                )}
              >
                {SIGNAL_LABELS[activity.primarySignal]}
              </Badge>
            ) : null}
            {activity.isWhale ? (
              <Badge
                variant="outline"
                className="h-5 border-category-whale/30 bg-category-whale/10 px-1.5 text-[10px] uppercase text-category-whale"
              >
                Whale
              </Badge>
            ) : null}
          </div>

          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            {activity.playerTeam} | {activity.playerSport} | {activity.gameState}
            {activity.gameStartTime
              ? ` | ${formatDistanceToNow(new Date(activity.gameStartTime), { addSuffix: true })}`
              : ""}
          </div>

          <div className="mt-1 text-xs leading-4 text-muted-foreground">{activity.note}</div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {activity.signalTags.slice(0, 4).map((tag) => (
              <Badge
                key={`${activity.id}-${tag}`}
                variant="outline"
                className={cn("h-5 px-1.5 text-[10px]", getSignalTone(tag))}
              >
                {SIGNAL_LABELS[tag]}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right sm:min-w-[220px] sm:grid-cols-1">
          <div>
            <div className="font-mono text-xs font-semibold">
              {formatCompactMoney(activity.notional)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {activity.quantity.toLocaleString()} sh @ ${activity.price.toFixed(2)}
            </div>
          </div>
          <div>
            <div
              className={cn(
                "font-mono text-xs font-semibold",
                activity.spotMovePct >= 0 ? "text-market-positive" : "text-market-negative",
              )}
            >
              {formatCompactSignedPercent(activity.spotMovePct)}
            </div>
            <div className="text-[11px] text-muted-foreground">spot vs print</div>
          </div>
          <div>
            <div
              className={cn(
                "font-mono text-xs font-semibold",
                activity.priceChange24h >= 0 ? "text-market-positive" : "text-market-negative",
              )}
            >
              {formatCompactSignedPercent(activity.priceChange24h)}
            </div>
            <div className="text-[11px] text-muted-foreground">24h move</div>
          </div>
          <div>
            <div className="font-mono text-xs font-semibold">
              ${activity.currentPrice.toFixed(2)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketActivityLedger({ sport }: { sport?: string }) {
  const [search, setSearch] = useState("");
  const [side, setSide] = useState<MarketActivitySideFilter>("all");
  const [signal, setSignal] = useState<MarketActivitySignalTag | "all">("all");
  const [gameState, setGameState] = useState<MarketActivityGameStateFilter>("all");
  const [sort, setSort] = useState<MarketActivitySort>("recent");
  const [whalesOnly, setWhalesOnly] = useState(false);

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: [
        "/api/market/activity",
        sport || "ALL",
        search,
        side,
        signal,
        gameState,
        sort,
        whalesOnly,
      ],
      initialPageParam: 0,
      queryFn: ({ pageParam }) =>
        fetchMarketActivityPage({
          offset: pageParam,
          sport,
          search,
          side,
          signal,
          gameState,
          whalesOnly,
          sort,
        }),
      getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    });

  const pages = data?.pages || [];
  const firstPage = pages[0];
  const activities = useMemo(() => pages.flatMap((page) => page.activities), [pages]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          {[1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="rounded-control border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Shimmer height="12px" width="40%" />
                  <Shimmer height="11px" width="70%" />
                  <Shimmer height="11px" width="85%" />
                </div>
                <div className="w-24 space-y-2">
                  <Shimmer height="12px" width="100%" />
                  <Shimmer height="11px" width="80%" />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError || !firstPage) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="mb-2 text-sm text-destructive">Failed to load market activity.</div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="terminal" className="overflow-hidden">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-sm font-medium uppercase tracking-wide">
              Market Activity Ledger
            </CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              Site-wide pool flow, trend tags, and signal context in one feed.
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {firstPage.summary.total} filtered events
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {[
            { label: "Events", value: firstPage.summary.total },
            { label: "Notional", value: formatCompactMoney(firstPage.summary.totalNotional) },
            { label: "Whales", value: firstPage.summary.whaleCount },
            { label: "Live", value: firstPage.summary.liveCount },
            { label: "Pools", value: firstPage.summary.activePoolCount },
          ].map((item) => (
            <div key={item.label} className="rounded-control border bg-muted/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.label}
              </div>
              <div className="font-mono text-sm font-semibold">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          <HighlightStrip
            title="Most Active Now"
            icon={Activity}
            items={firstPage.highlights.mostActiveNow}
          />
          <HighlightStrip
            title="Biggest Prints"
            icon={ShieldAlert}
            items={firstPage.highlights.biggestPrints}
          />
          <HighlightStrip
            title="Momentum"
            icon={Flame}
            items={firstPage.highlights.momentumNames}
          />
          <HighlightStrip
            title="Thin Pool Pressure"
            icon={Waves}
            items={firstPage.highlights.thinPoolPressure}
          />
          <HighlightStrip
            title="Scout / Boost"
            icon={Sparkles}
            items={firstPage.highlights.scoutBoostNames}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_150px_150px_150px]">
          <div className="relative sm:col-span-2 xl:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search players, teams, users, or tags"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <select
            value={side}
            onChange={(event) => setSide(event.target.value as MarketActivitySideFilter)}
            className="h-9 rounded-control border border-input bg-background px-3 text-xs"
          >
            {SIDE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={gameState}
            onChange={(event) => setGameState(event.target.value as MarketActivityGameStateFilter)}
            className="h-9 rounded-control border border-input bg-background px-3 text-xs"
          >
            {GAME_STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as MarketActivitySort)}
            className="h-9 rounded-control border border-input bg-background px-3 text-xs"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={signal === "all" ? "default" : "outline"}
            className="h-8 px-3 text-xs"
            onClick={() => setSignal("all")}
          >
            All
            <span className="ml-1 font-mono text-[10px] opacity-75">{firstPage.summary.total}</span>
          </Button>
          {MARKET_ACTIVITY_SIGNAL_TAGS.map((tag) => (
            <Button
              key={tag}
              size="sm"
              variant={signal === tag ? "default" : "outline"}
              className="h-8 px-3 text-xs"
              onClick={() => setSignal(tag)}
            >
              {SIGNAL_LABELS[tag]}
              <span className="ml-1 font-mono text-[10px] opacity-75">
                {firstPage.signalCounts[tag] ?? 0}
              </span>
            </Button>
          ))}
          <Button
            size="sm"
            variant={whalesOnly ? "default" : "outline"}
            className="h-8 px-3 text-xs"
            onClick={() => setWhalesOnly((current) => !current)}
          >
            <Radio className="mr-1 h-3 w-3" />
            Whale only
          </Button>
          <Badge variant="outline" className="h-8 px-3 text-xs">
            <ArrowUpDown className="mr-1 h-3 w-3" />
            {SORT_OPTIONS.find((option) => option.value === sort)?.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {activities.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No market prints match"
            description="Try a different search, flow, or signal filter."
            size="sm"
            className="py-8"
          />
        ) : (
          <div className="divide-y overflow-hidden rounded-control border">
            {activities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        )}

        {hasNextPage ? (
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
              "Load more activity"
            )}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

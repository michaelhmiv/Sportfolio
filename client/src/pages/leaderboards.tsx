import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  DollarSign,
  PieChart,
  RefreshCw,
  ShoppingCart,
  Trophy,
  Wallet,
} from "lucide-react";
import type { PublicUserIdentity } from "@shared/public-user-identity";
import { UserIdentity } from "@/components/user-identity";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

import { useAuth } from "@/hooks/useAuth";
import { usePublicIdentities } from "@/hooks/usePublicIdentities";
import { formatAdaptiveCurrency } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWebSocket } from "@/lib/websocket";
import { cn } from "@/lib/utils";

type LeaderboardCategory =
  | "netWorth"
  | "cashBalance"
  | "portfolioValue"
  | "tradingVolume24h"
  | "marketOrders";

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  profileImageUrl: string | null;
  value: number;
  rankChange: number | null;
}

interface LeaderboardResponse {
  category: LeaderboardCategory;
  categoryLabel: string;
  description: string;
  unit: "currency" | "count";
  updatedAt: string;
  totalEntries: number;
  leaderboard: LeaderboardEntry[];
  currentUser: LeaderboardEntry | null;
  currentUserWindow: LeaderboardEntry[];
}

const CATEGORY_TABS: Array<{
  value: LeaderboardCategory;
  label: string;
  shortLabel: string;
  icon: typeof DollarSign;
}> = [
  { value: "netWorth", label: "Net Worth", shortLabel: "Worth", icon: DollarSign },
  { value: "portfolioValue", label: "Portfolio", shortLabel: "Portfolio", icon: PieChart },
  { value: "tradingVolume24h", label: "24h Volume", shortLabel: "24h Vol", icon: Activity },
  { value: "cashBalance", label: "Cash", shortLabel: "Cash", icon: Wallet },
  { value: "marketOrders", label: "Orders", shortLabel: "Orders", icon: ShoppingCart },
];

const LEGACY_CATEGORY_ALIASES: Record<string, LeaderboardCategory> = {
  sharesMined: "tradingVolume24h",
  tradingVolume: "tradingVolume24h",
  volume: "tradingVolume24h",
};

function normalizeHashCategory(rawHash: string): LeaderboardCategory {
  if (!rawHash) return "netWorth";
  if (CATEGORY_TABS.some((tab) => tab.value === rawHash)) return rawHash as LeaderboardCategory;
  return LEGACY_CATEGORY_ALIASES[rawHash] || "netWorth";
}

function formatLeaderboardValue(category: LeaderboardCategory, value: number) {
  if (category === "marketOrders") return `${Math.round(value).toLocaleString()} orders`;
  return formatAdaptiveCurrency(value);
}

function RankChangeBadge({ change }: { change: number | null }) {
  if (change === null) {
    return (
      <span className="text-xs text-muted-foreground" aria-label="Movement history unavailable">
        —
      </span>
    );
  }
  if (change === 0) return <span className="text-xs text-muted-foreground">Flat</span>;

  const isPositive = change > 0;
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        isPositive ? "text-positive" : "text-destructive",
      )}
      aria-label={`${isPositive ? "Up" : "Down"} ${Math.abs(change)} ranks`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {isPositive ? "+" : ""}
      {change}
    </span>
  );
}

function fallbackIdentity(entry: LeaderboardEntry): PublicUserIdentity {
  return {
    userId: entry.userId,
    username: entry.username,
    avatarUrl: entry.profileImageUrl,
    premiumActive: false,
    activeBadge: null,
  };
}

export default function Leaderboards() {
  const { user } = useAuth();
  const { subscribe } = useWebSocket();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [category, setCategory] = useState<LeaderboardCategory>(() =>
    normalizeHashCategory(
      typeof window !== "undefined" ? window.location.hash.replace("#", "") : "",
    ),
  );
  const [boardMode, setBoardMode] = useState<"top" | "aroundMe">("top");

  useEffect(() => {
    const syncCategoryFromHash = () => {
      const normalized = normalizeHashCategory(window.location.hash.replace("#", ""));
      setCategory(normalized);
      if (window.location.hash !== `#${normalized}`) {
        window.history.replaceState(null, "", `#${normalized}`);
      }
    };
    syncCategoryFromHash();
    window.addEventListener("hashchange", syncCategoryFromHash);
    return () => window.removeEventListener("hashchange", syncCategoryFromHash);
  }, []);

  useEffect(() => {
    const invalidate = (target: LeaderboardCategory) =>
      queryClient.invalidateQueries({ queryKey: [`/api/leaderboards?category=${target}`] });
    const unsubTrade = subscribe("trade", () => {
      for (const target of CATEGORY_TABS) invalidate(target.value);
    });
    const unsubPortfolio = subscribe("portfolio", () => {
      invalidate("netWorth");
      invalidate("cashBalance");
      invalidate("portfolioValue");
    });
    return () => {
      unsubTrade();
      unsubPortfolio();
    };
  }, [subscribe]);

  const { data, isLoading, refetch, isFetching } = useQuery<LeaderboardResponse>({
    queryKey: [`/api/leaderboards?category=${category}`, user?.id ?? "anonymous"],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/leaderboards?category=${category}`);
      return response.json() as Promise<LeaderboardResponse>;
    },
  });
  const identityUserIds = useMemo(
    () =>
      Array.from(
        new Set(
          [...(data?.leaderboard ?? []), ...(data?.currentUserWindow ?? [])].map(
            (entry) => entry.userId,
          ),
        ),
      ),
    [data],
  );
  const identityMap = usePublicIdentities(identityUserIds);

  useEffect(() => {
    if (!data?.currentUserWindow?.length && boardMode === "aroundMe") setBoardMode("top");
  }, [boardMode, data?.currentUserWindow]);

  const displayedEntries = useMemo(() => {
    if (!data) return [];
    if (boardMode === "aroundMe" && data.currentUserWindow.length > 0) {
      return data.currentUserWindow;
    }
    return data.leaderboard;
  }, [boardMode, data]);

  const handleTabChange = (value: string) => {
    const nextCategory = value as LeaderboardCategory;
    setCategory(nextCategory);
    setBoardMode("top");
    window.location.hash = nextCategory;
  };

  const showAroundMe = () => {
    setBoardMode("aroundMe");
    boardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-4xl space-y-3">
        <header className="flex items-end justify-between gap-3 border-b border-border/70 pb-3">
          <div className="min-w-0">
            <h1 className="terminal-heading text-xl sm:text-2xl">Leaderboards</h1>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {data?.updatedAt
                ? `${data.categoryLabel} · refreshed ${formatDistanceToNow(new Date(data.updatedAt), { addSuffix: true })}`
                : "Public market rankings"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh leaderboard"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </header>

        <div
          role="group"
          aria-label="Leaderboard metric"
          className="flex w-full justify-start gap-1 overflow-x-auto [scrollbar-width:none]"
        >
          {CATEGORY_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <Button
                key={tab.value}
                type="button"
                variant={category === tab.value ? "terminal" : "terminalOutline"}
                className="min-h-11 shrink-0 px-3"
                aria-pressed={category === tab.value}
                onClick={() => handleTabChange(tab.value)}
              >
                <Icon className="mr-1 h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </Button>
            );
          })}
        </div>

        {user && data?.currentUser && (
          <Card variant="terminal" data-testid="current-user-rank">
            <CardContent className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="terminal-label">Your position</div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="font-mono text-xl font-black">#{data.currentUser.rank}</span>
                  <span className="truncate font-mono text-sm font-bold">
                    {formatLeaderboardValue(category, data.currentUser.value)}
                  </span>
                  <RankChangeBadge change={data.currentUser.rankChange} />
                </div>
              </div>
              <Button
                size="sm"
                variant={boardMode === "aroundMe" ? "terminal" : "terminalOutline"}
                onClick={showAroundMe}
                disabled={!data.currentUserWindow.length}
              >
                Around me
              </Button>
            </CardContent>
          </Card>
        )}

        <Card ref={boardRef} variant="terminal">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <div className="min-w-0">
                <h2 className="text-xs font-bold uppercase tracking-[0.14em]">
                  {boardMode === "aroundMe" ? "Around you" : data?.categoryLabel || "Rankings"}
                </h2>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {data?.description || "Public market rankings."}
                </p>
              </div>
              {boardMode === "aroundMe" && (
                <Button size="sm" variant="ghost" onClick={() => setBoardMode("top")}>
                  Top board
                </Button>
              )}
            </div>

            {isLoading && !data ? (
              <div className="py-10 text-center text-sm text-muted-foreground" role="status">
                Loading leaderboard…
              </div>
            ) : !displayedEntries.length ? (
              <EmptyState
                icon="users"
                title="No rankings yet"
                description="This board will appear once eligible accounts have activity."
                size="md"
                variant="terminal"
                className="py-10"
              />
            ) : (
              <ol data-testid="leaderboard-list" aria-label={`${data?.categoryLabel} leaderboard`}>
                {displayedEntries.map((entry) => {
                  const isCurrentUser = user?.id === entry.userId;
                  const identity = identityMap[entry.userId] ?? fallbackIdentity(entry);
                  return (
                    <li
                      key={entry.userId}
                      data-testid={`leaderboard-row-${entry.userId}`}
                      data-rank={entry.rank}
                      className={cn(
                        "flex min-h-16 items-center gap-2 border-b border-border/70 px-3 py-2 last:border-b-0",
                        entry.rank <= 3 && boardMode === "top" && "bg-brand-subtle/[0.05]",
                        isCurrentUser && "bg-primary/5",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <UserIdentity variant="ranked" identity={identity} rank={entry.rank} />
                          {entry.rank === 1 && (
                            <Trophy
                              className="h-4 w-4 shrink-0 text-premium"
                              aria-label="Top ranked"
                            />
                          )}
                          {isCurrentUser && (
                            <span className="text-[10px] font-bold uppercase text-brand">You</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-sm font-black sm:text-base">
                          {formatLeaderboardValue(category, entry.value)}
                        </div>
                        <RankChangeBadge change={entry.rankChange} />
                      </div>
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          href={`/user/${entry.userId}`}
                          aria-label={`Open @${entry.username} profile`}
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </Button>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

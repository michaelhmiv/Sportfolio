import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  DollarSign,
  PieChart,
  RefreshCw,
  ShoppingCart,
  Trophy,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocket } from "@/lib/websocket";
import { queryClient } from "@/lib/queryClient";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  { value: "portfolioValue", label: "Portfolio", shortLabel: "Port", icon: PieChart },
  { value: "cashBalance", label: "Cash", shortLabel: "Cash", icon: Wallet },
  { value: "tradingVolume24h", label: "24h Volume", shortLabel: "24h Vol", icon: Activity },
  { value: "marketOrders", label: "Orders", shortLabel: "Orders", icon: ShoppingCart },
];

const LEGACY_CATEGORY_ALIASES: Record<string, LeaderboardCategory> = {
  sharesMined: "tradingVolume24h",
  tradingVolume: "tradingVolume24h",
  volume: "tradingVolume24h",
};

function normalizeHashCategory(rawHash: string): LeaderboardCategory {
  if (!rawHash) {
    return "netWorth";
  }

  if (CATEGORY_TABS.some((tab) => tab.value === rawHash)) {
    return rawHash as LeaderboardCategory;
  }

  return LEGACY_CATEGORY_ALIASES[rawHash] || "netWorth";
}

function formatLeaderboardValue(category: LeaderboardCategory, value: number) {
  if (category === "marketOrders") {
    return `${Math.round(value).toLocaleString()} orders`;
  }

  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function RankChangeBadge({ change }: { change: number | null }) {
  if (change === null || change === 0) {
    return <span className="text-xs text-muted-foreground">Flat</span>;
  }

  const isPositive = change > 0;
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${isPositive ? "text-positive" : "text-destructive"}`}
    >
      <Icon className="h-3 w-3" />
      {isPositive ? "+" : ""}
      {change}
    </span>
  );
}

export default function Leaderboards() {
  const { user } = useAuth();
  const { subscribe, connectionState, isConnected } = useWebSocket();
  const boardRef = useRef<HTMLDivElement | null>(null);

  const getInitialCategory = () =>
    normalizeHashCategory(
      typeof window !== "undefined" ? window.location.hash.replace("#", "") : "",
    );

  const [category, setCategory] = useState<LeaderboardCategory>(getInitialCategory);
  const [boardMode, setBoardMode] = useState<"top" | "aroundMe">("top");

  useEffect(() => {
    const syncCategoryFromHash = () => {
      const normalized = getInitialCategory();
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
      invalidate("tradingVolume24h");
      invalidate("netWorth");
      invalidate("cashBalance");
      invalidate("portfolioValue");
      invalidate("marketOrders");
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
    queryKey: [`/api/leaderboards?category=${category}`],
  });

  useEffect(() => {
    if (!data?.currentUserWindow?.length && boardMode === "aroundMe") {
      setBoardMode("top");
    }
  }, [boardMode, data?.currentUserWindow]);

  const displayedEntries = useMemo(() => {
    if (!data) {
      return [];
    }

    if (boardMode === "aroundMe" && data.currentUserWindow.length > 0) {
      return data.currentUserWindow;
    }

    return data.leaderboard;
  }, [boardMode, data]);

  const featuredEntries = data?.leaderboard.slice(0, 3) || [];

  const handleTabChange = (value: string) => {
    const nextCategory = value as LeaderboardCategory;
    setCategory(nextCategory);
    window.location.hash = nextCategory;
  };

  const jumpToCurrentUser = () => {
    setBoardMode("aroundMe");
    boardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const liveLabel =
    connectionState === "connected"
      ? "Live"
      : connectionState === "connecting"
        ? "Connecting"
        : connectionState === "error"
          ? "Connection issue"
          : "Reconnecting";

  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="terminal-shell p-4 sm:p-5">
          <div className="terminal-strip mb-3">Live Market Rankings</div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="terminal-heading text-xl sm:text-2xl">Leaderboards</h1>
              <p className="terminal-subtle mt-2 max-w-2xl">
                Track live rank movement, jump straight to your window, and inspect public trader
                status pages from the board.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isConnected ? "default" : "outline"} className="gap-1">
                <span
                  className={`h-2 w-2 rounded-full ${isConnected ? "bg-current" : "bg-muted-foreground"}`}
                />
                {liveLabel}
              </Badge>
              {data?.updatedAt && (
                <Badge variant="outline">
                  Updated {formatDistanceToNow(new Date(data.updatedAt), { addSuffix: true })}
                </Badge>
              )}
              <Button
                variant="terminalOutline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        <Tabs value={category} onValueChange={handleTabChange} className="space-y-4">
          <TabsList variant="terminal" className="grid w-full grid-cols-5">
            {CATEGORY_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.value} value={tab.value} variant="terminal">
                  <Icon className="mr-1 h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden text-xs">{tab.shortLabel}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {CATEGORY_TABS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  <Card variant="terminal">
                    <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
                      <div>
                        <div className="terminal-label">Board</div>
                        <div className="mt-2 text-lg font-semibold">
                          {data?.categoryLabel || tab.label}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {data?.description || "Live public market rankings."}
                        </p>
                      </div>
                      <div>
                        <div className="terminal-label">Competitors</div>
                        <div className="mt-2 font-mono text-2xl font-bold">
                          {data?.totalEntries?.toLocaleString() || "0"}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Public accounts currently on this board.
                        </p>
                      </div>
                      <div>
                        <div className="terminal-label">View</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant={boardMode === "top" ? "terminal" : "terminalOutline"}
                            onClick={() => setBoardMode("top")}
                          >
                            Top board
                          </Button>
                          <Button
                            size="sm"
                            variant={boardMode === "aroundMe" ? "terminal" : "terminalOutline"}
                            onClick={() => setBoardMode("aroundMe")}
                            disabled={!data?.currentUserWindow?.length}
                          >
                            Around me
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-3 md:grid-cols-3">
                    {featuredEntries.map((entry) => (
                      <Link key={entry.userId} href={`/user/${entry.userId}`}>
                        <Card variant="terminal" className="hover-elevate cursor-pointer">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10">
                                  <AvatarImage src={entry.profileImageUrl || undefined} />
                                  <AvatarFallback>
                                    {entry.username.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm text-muted-foreground">
                                      #{entry.rank}
                                    </span>
                                    {entry.rank === 1 && (
                                      <Trophy className="h-4 w-4 text-yellow-500" />
                                    )}
                                  </div>
                                  <div className="font-semibold">@{entry.username}</div>
                                </div>
                              </div>
                              <RankChangeBadge change={entry.rankChange} />
                            </div>
                            <div className="mt-4 font-mono text-2xl font-bold">
                              {formatLeaderboardValue(tab.value, entry.value)}
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>

                  <Card ref={boardRef} variant="terminal">
                    <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle className="text-sm uppercase tracking-wide">
                          {boardMode === "aroundMe" ? "Your Rank Window" : "Full Board"}
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {boardMode === "aroundMe"
                            ? "A focused slice around your current position."
                            : "Click any trader to open their public market status page."}
                        </p>
                      </div>
                      {user && data?.currentUser && boardMode === "aroundMe" && (
                        <Button
                          size="sm"
                          variant="terminalOutline"
                          onClick={() => setBoardMode("top")}
                        >
                          Back to top board
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="p-0">
                      {isLoading && !data ? (
                        <div className="py-10 text-center text-muted-foreground">
                          Loading leaderboard...
                        </div>
                      ) : !displayedEntries.length ? (
                        <EmptyState
                          icon="users"
                          title="No rankings yet"
                          description="Once public accounts have activity on this metric, they will appear here."
                          size="md"
                          variant="terminal"
                          className="py-10"
                        />
                      ) : (
                        <>
                          <div className="hidden overflow-x-auto sm:block">
                            <table className="w-full">
                              <thead className="border-b bg-muted/40">
                                <tr>
                                  <th className="p-3 text-left text-xs uppercase tracking-wide text-muted-foreground">
                                    Rank
                                  </th>
                                  <th className="p-3 text-left text-xs uppercase tracking-wide text-muted-foreground">
                                    Trader
                                  </th>
                                  <th className="p-3 text-right text-xs uppercase tracking-wide text-muted-foreground">
                                    Movement
                                  </th>
                                  <th className="p-3 text-right text-xs uppercase tracking-wide text-muted-foreground">
                                    Value
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {displayedEntries.map((entry) => {
                                  const isCurrentUser = user?.id === entry.userId;
                                  return (
                                    <tr
                                      key={entry.userId}
                                      className={`border-b ${isCurrentUser ? "bg-primary/5" : "hover:bg-muted/20"}`}
                                    >
                                      <td className="p-3 font-mono text-sm font-bold">
                                        #{entry.rank}
                                      </td>
                                      <td className="p-3">
                                        <Link href={`/user/${entry.userId}`}>
                                          <div className="flex cursor-pointer items-center gap-3 hover:text-primary">
                                            <Avatar className="h-8 w-8">
                                              <AvatarImage
                                                src={entry.profileImageUrl || undefined}
                                              />
                                              <AvatarFallback>
                                                {entry.username.slice(0, 2).toUpperCase()}
                                              </AvatarFallback>
                                            </Avatar>
                                            <div>
                                              <div className="font-semibold">
                                                {isCurrentUser
                                                  ? `@${entry.username} (You)`
                                                  : `@${entry.username}`}
                                              </div>
                                              <div className="text-xs text-muted-foreground">
                                                Open public status page
                                              </div>
                                            </div>
                                          </div>
                                        </Link>
                                      </td>
                                      <td className="p-3 text-right">
                                        <RankChangeBadge change={entry.rankChange} />
                                      </td>
                                      <td className="p-3 text-right font-mono font-bold">
                                        {formatLeaderboardValue(tab.value, entry.value)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          <div className="space-y-3 sm:hidden">
                            {displayedEntries.map((entry) => {
                              const isCurrentUser = user?.id === entry.userId;
                              return (
                                <Link key={entry.userId} href={`/user/${entry.userId}`}>
                                  <div
                                    className={`border-b p-3 last:border-b-0 ${isCurrentUser ? "bg-primary/5" : ""}`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex items-center gap-3">
                                        <Avatar className="h-9 w-9">
                                          <AvatarImage src={entry.profileImageUrl || undefined} />
                                          <AvatarFallback>
                                            {entry.username.slice(0, 2).toUpperCase()}
                                          </AvatarFallback>
                                        </Avatar>
                                        <div>
                                          <div className="font-mono text-xs text-muted-foreground">
                                            #{entry.rank}
                                          </div>
                                          <div className="font-semibold">
                                            {isCurrentUser
                                              ? `@${entry.username} (You)`
                                              : `@${entry.username}`}
                                          </div>
                                        </div>
                                      </div>
                                      <RankChangeBadge change={entry.rankChange} />
                                    </div>
                                    <div className="mt-3 font-mono text-lg font-bold">
                                      {formatLeaderboardValue(tab.value, entry.value)}
                                    </div>
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card variant="terminal">
                    <CardHeader>
                      <CardTitle className="text-sm uppercase tracking-wide">
                        Your Position
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {!user ? (
                        <p className="text-sm text-muted-foreground">
                          Sign in to pin your own rank window and jump straight to your live spot on
                          each board.
                        </p>
                      ) : !data?.currentUser ? (
                        <p className="text-sm text-muted-foreground">
                          Your account is not yet ranked on this metric. Once activity lands, this
                          panel will pin your live position.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <div className="terminal-label">Current Rank</div>
                            <div className="mt-2 font-mono text-3xl font-bold">
                              #{data.currentUser.rank}
                            </div>
                          </div>
                          <div>
                            <div className="terminal-label">Current Value</div>
                            <div className="mt-2 font-mono text-xl font-bold">
                              {formatLeaderboardValue(tab.value, data.currentUser.value)}
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Rank movement</span>
                            <RankChangeBadge change={data.currentUser.rankChange} />
                          </div>
                          <Button variant="terminal" className="w-full" onClick={jumpToCurrentUser}>
                            Jump to my spot
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card variant="terminal">
                    <CardHeader>
                      <CardTitle className="text-sm uppercase tracking-wide">
                        How To Read It
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                      <p>
                        {data?.description || "Each board is a different lens on trader behavior."}
                      </p>
                      <p>
                        Rank movement is shown where reliable snapshot history exists. Public rows
                        are clickable so you can inspect holdings, trends, and recent market
                        activity behind the rank.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

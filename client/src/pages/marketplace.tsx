import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useSport } from "@/lib/sport-context";
import { formatAdaptiveCurrency, formatCompactCurrency } from "@/lib/currency";
import { useAppState } from "@/hooks/use-app-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp,
  TrendingDown,
  Search,
  Filter,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  X,
  Activity,
  ShoppingCart,
  Droplets,
  Radio,
  Flame,
  Users,
} from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { AnimatedPrice } from "@/components/ui/animated-price";
import { useWebSocket } from "@/lib/websocket";
import { authenticatedFetch, queryClient } from "@/lib/queryClient";
import type { Player } from "@shared/schema";
import { PlayerName } from "@/components/player-name";
import { SportSelector } from "@/components/sport-selector";
import { MarketActivityLedger } from "@/components/market-activity-ledger";
import { MarketActivityWidget } from "@/components/market-activity-widget";
import { MlbProbableBadge } from "@/components/mlb-probable-badge";
import { MarketplaceScanners } from "@/components/marketplace-scanners";
import { MarketMobilePoolsBoard } from "@/components/market-mobile-pools-board";
import {
  MarketMobilePlayerSheet,
  type MarketSheetAction,
} from "@/components/market-mobile-player-sheet";
import { cn } from "@/lib/utils";
import { BackgroundPattern, CardAccent } from "@/components/ui/decorative-elements";
import { PlayerModal } from "@/components/player-modal";
import { appendPlayerSearchParam } from "@/lib/player-search";

type PlayerWithPool = Player & {
  poolInitialized?: boolean;
  poolLiquidity?: number | null;
  poolTvl?: number | null;
  poolShares?: number | null;
  poolTotalTrades?: number | null;
  buyPressure?: number | null;
  valueIndex?: number | null;
  avgFantasyPointsPerGame?: string | number | null;
  hasGameToday?: boolean;
  gameStatus?: "none" | "upcoming" | "live" | "ended";
  gameStartTime?: string | null;
  communityBoostCount?: number | null;
  isProbableStarter?: boolean;
  probablePitcherGameId?: string | null;
  mlbMatchupChip?: string | null;
  mlbPregameSummary?: string | null;
};

type MobileQuickContext = {
  availableShares?: number;
  isBoostEligible?: boolean;
  scoutCount?: number;
  isWatchlisted?: boolean;
};

type SortField =
  | "price"
  | "volume"
  | "change"
  | "tvl"
  | "marketCap"
  | "sentiment"
  | "undervalued"
  | "fantasyPoints"
  | "name"
  | "team";
type SortOrder = "asc" | "desc";

const getDefaultSortOrder = (field: SortField): SortOrder =>
  ["name", "team"].includes(field) ? "asc" : "desc";

const normalizeSortField = (value: string | null): SortField | null => {
  if (!value) return null;
  if (value === "liquidity" || value === "poolSize") return "tvl";
  if (
    [
      "price",
      "volume",
      "change",
      "tvl",
      "marketCap",
      "sentiment",
      "undervalued",
      "fantasyPoints",
      "name",
      "team",
    ].includes(value)
  ) {
    return value as SortField;
  }
  return null;
};

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const parseMetricNumber = (value: string | number | null | undefined) => {
  const parsed = typeof value === "number" ? value : parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
};

const getMobileSortMetric = (player: PlayerWithPool, sortField: SortField) => {
  switch (sortField) {
    case "price": {
      const price = parseMetricNumber(player.currentPrice);
      return { text: `Price $${price.toFixed(2)}`, className: "font-mono" };
    }
    case "volume":
      return {
        text: `Vol ${integerFormatter.format(player.volume24h ?? 0)}`,
        className: "font-mono",
      };
    case "change": {
      const change = parseMetricNumber(player.priceChange24h);
      return {
        text: `24h ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`,
        className: cn("font-mono", change >= 0 ? "text-positive" : "text-negative"),
      };
    }
    case "tvl": {
      const tvl = parseMetricNumber(player.poolTvl);
      return { text: `TVL ${formatCompactCurrency(tvl)}`, className: "font-mono" };
    }
    case "marketCap": {
      const marketCap = parseMetricNumber(player.marketCap);
      return {
        text: `Cap ${formatCompactCurrency(marketCap)}`,
        className: "font-mono",
      };
    }
    case "sentiment": {
      const buyPressure = parseMetricNumber(player.buyPressure);
      return { text: `Sent ${buyPressure.toFixed(1)}%`, className: "font-mono" };
    }
    case "undervalued": {
      const valueIndex = parseMetricNumber(player.valueIndex);
      return { text: `Value ${valueIndex.toFixed(1)}`, className: "font-mono" };
    }
    case "fantasyPoints": {
      const fantasyPoints = parseMetricNumber(player.avgFantasyPointsPerGame);
      return { text: `FP ${fantasyPoints.toFixed(1)}`, className: "font-mono" };
    }
    case "name":
      return { text: `${player.lastName}, ${player.firstName}`, className: "" };
    case "team":
      return { text: player.team || "-", className: "" };
    default:
      return { text: "-", className: "" };
  }
};

export default function PlayerPools() {
  const { sport, setSport } = useSport();
  const { shouldPoll, isMobile } = useAppState();
  const searchString = useSearch();
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "players");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const initialSortField = normalizeSortField(searchParams.get("sortBy")) || "volume";
  const initialSortOrderParam = searchParams.get("sortOrder") as SortOrder | null;
  const [sortField, setSortField] = useState<SortField>(initialSortField);
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    initialSortOrderParam && ["asc", "desc"].includes(initialSortOrderParam)
      ? initialSortOrderParam
      : getDefaultSortOrder(initialSortField),
  );
  const [filterWatchlistId, setFilterWatchlistId] = useState<string>("none");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [playerModalOpen, setPlayerModalOpen] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [selectedMobilePlayer, setSelectedMobilePlayer] = useState<PlayerWithPool | null>(null);
  const [selectedMobileAction, setSelectedMobileAction] = useState<MarketSheetAction>("default");
  const [selectedMobileQuickContext, setSelectedMobileQuickContext] =
    useState<MobileQuickContext>();
  const ITEMS_PER_PAGE = 50;
  const { subscribe } = useWebSocket();
  const offset = (page - 1) * ITEMS_PER_PAGE;
  const playersPollingInterval = shouldPoll
    ? isMobile
      ? 60000
      : activeTab === "players"
        ? 60000
        : false
    : false;

  // Sync active tab and sort with URL query parameters
  useEffect(() => {
    const tab = searchParams.get("tab");
    const nextTab = tab === "activity" ? "activity" : "players";
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));

    const sortByParam = normalizeSortField(searchParams.get("sortBy"));
    const nextSortField = sortByParam || "volume";
    setSortField((prev) => (prev === nextSortField ? prev : nextSortField));

    const sortOrderParam = searchParams.get("sortOrder") as SortOrder;
    const nextSortOrder =
      sortOrderParam && ["asc", "desc"].includes(sortOrderParam)
        ? sortOrderParam
        : getDefaultSortOrder(nextSortField);
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
  }, [searchString]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset to first page when non-search filters change
  useEffect(() => {
    setPage(1);
  }, [teamFilter, positionFilter, filterWatchlistId, sport]);

  // WebSocket subscriptions for real-time updates
  useEffect(() => {
    const unsubTrade = subscribe("trade", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/players"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/mobile-overview"] });
    });
    const unsubMarketActivity = subscribe("marketActivity", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/market/mobile-overview"] });
    });

    return () => {
      unsubTrade();
      unsubMarketActivity();
    };
  }, [subscribe]);

  // Fetch players with AMM pool data
  const { data: playersData, isLoading } = useQuery<{ players: PlayerWithPool[]; total: number }>({
    queryKey: [
      "/api/players",
      {
        sport,
        search: debouncedSearch,
        team: teamFilter,
        position: positionFilter,
        sortBy: sortField,
        sortOrder,
        page,
        offset,
        limit: ITEMS_PER_PAGE,
        watchlistId: filterWatchlistId !== "none" ? filterWatchlistId : undefined,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sport && sport !== "ALL") params.append("sport", sport);
      appendPlayerSearchParam(params, debouncedSearch);
      if (teamFilter !== "all") params.append("team", teamFilter);
      if (positionFilter !== "all") params.append("position", positionFilter);
      if (sortField) params.append("sortBy", sortField);
      if (sortOrder) params.append("sortOrder", sortOrder);
      params.append("offset", offset.toString());
      params.append("limit", ITEMS_PER_PAGE.toString());
      if (filterWatchlistId !== "none") {
        params.append("isWatchlist", "true");
        if (filterWatchlistId !== "all") {
          params.append("watchlistId", filterWatchlistId);
        }
      }

      const res = await authenticatedFetch(`/api/players?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch players");
      return res.json();
    },
    refetchInterval: playersPollingInterval,
    refetchIntervalInBackground: false,
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
  });

  // Fetch watchlists for filter
  const { data: watchlists } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/watchlists"],
    queryFn: async () => {
      const res = await authenticatedFetch("/api/watchlists");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
    placeholderData: (previousData) => previousData,
  });

  // Extract unique teams and positions for filters
  const { teams, positions } = useMemo(() => {
    const allTeams = new Set<string>();
    const allPositions = new Set<string>();
    playersData?.players.forEach((player) => {
      if (player.team) allTeams.add(player.team);
      if (player.position) allPositions.add(player.position);
    });
    return {
      teams: Array.from(allTeams).sort(),
      positions: Array.from(allPositions).sort(),
    };
  }, [playersData?.players]);

  const players = playersData?.players || [];
  const totalPlayers = playersData?.total || 0;
  const totalPages = Math.ceil(totalPlayers / ITEMS_PER_PAGE);

  // Batch sparkline fetch for all visible players
  const playerIdKey = players.map((p) => p.id).join(",");
  const { data: sparklines = {} } = useQuery<Record<string, number[]>>({
    queryKey: ["/api/players/sparklines", playerIdKey],
    queryFn: async () => {
      if (!playerIdKey) return {};
      const res = await authenticatedFetch(`/api/players/sparklines?ids=${playerIdKey}&days=7`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: players.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!selectedMobilePlayer) {
      return;
    }

    const latestPlayer = players.find((player) => player.id === selectedMobilePlayer.id);
    if (latestPlayer && latestPlayer !== selectedMobilePlayer) {
      setSelectedMobilePlayer(latestPlayer);
    }
  }, [players, selectedMobilePlayer]);

  // Toggle sort order or change sort field
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder(["name", "team"].includes(field) ? "asc" : "desc");
    }
    setPage(1);
  };

  const setSortFieldFromSelector = (field: SortField) => {
    setSortField(field);
    setSortOrder(["name", "team"].includes(field) ? "asc" : "desc");
    setPage(1);
  };

  const clearAllFilters = () => {
    setTeamFilter("all");
    setPositionFilter("all");
    setFilterWatchlistId("none");
    setSearch("");
  };

  const openMobileSheet = (
    player: PlayerWithPool,
    action: MarketSheetAction,
    quickContext?: MobileQuickContext,
  ) => {
    if ((action === "buy" || action === "sell") && player.poolInitialized === false) {
      setLocation(`/player/${player.id}?panel=lp`);
      return;
    }
    setSelectedMobilePlayer(player);
    setSelectedMobileAction(action);
    setSelectedMobileQuickContext(quickContext);
    setMobileSheetOpen(true);
  };

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== "players") params.set("tab", activeTab);
    if (sortField !== "volume") params.set("sortBy", sortField);

    const defaultOrderForField = getDefaultSortOrder(sortField);
    if (sortOrder !== defaultOrderForField) params.set("sortOrder", sortOrder);

    const newSearch = params.toString();
    const currentPath = window.location.pathname;
    const targetUrl = newSearch ? `${currentPath}?${newSearch}` : currentPath;
    const currentUrl = `${currentPath}${window.location.search || ""}`;
    if (targetUrl !== currentUrl) {
      setLocation(targetUrl, { replace: true });
    }
  }, [activeTab, sortField, sortOrder, setLocation]);

  const hasActiveFilters = Boolean(
    teamFilter !== "all" || positionFilter !== "all" || filterWatchlistId !== "none" || search,
  );

  // Render sort icon for column header
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    }
    return sortOrder === "asc" ? (
      <TrendingUp className="w-3 h-3 ml-1" />
    ) : (
      <TrendingDown className="w-3 h-3 ml-1" />
    );
  };

  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header with Background Pattern */}
        <div className="terminal-shell relative hidden overflow-hidden p-4 md:block md:p-6">
          <BackgroundPattern variant="circuit" color="primary" opacity={0.04} />
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="terminal-strip mb-3">Market Directory</div>
              <h1 className="terminal-heading text-xl sm:text-2xl">Player Pools</h1>
              <p className="text-sm text-muted-foreground">Instant buy/sell on initialized pools</p>
            </div>
            <div className="flex items-center gap-2">
              <SportSelector />
            </div>
          </div>
        </div>

        <div className="space-y-3 md:hidden">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={activeTab === "players" ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setActiveTab("players")}
            >
              <Activity className="h-4 w-4" />
              Players
            </Button>
            <Button
              variant={activeTab === "activity" ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setActiveTab("activity")}
            >
              <TrendingUp className="h-4 w-4" />
              Activity
            </Button>
          </div>

          {activeTab === "activity" ? (
            <MarketActivityLedger sport={sport} />
          ) : (
            <MarketMobilePoolsBoard
              sport={sport}
              players={players}
              isLoading={isLoading}
              search={search}
              onSearchChange={setSearch}
              teamFilter={teamFilter}
              onTeamFilterChange={setTeamFilter}
              positionFilter={positionFilter}
              onPositionFilterChange={setPositionFilter}
              sortField={sortField}
              onSortFieldChange={setSortFieldFromSelector}
              sortOrder={sortOrder}
              onSortOrderChange={(value) => {
                setSortOrder(value);
                setPage(1);
              }}
              filterWatchlistId={filterWatchlistId}
              onWatchlistFilterChange={setFilterWatchlistId}
              watchlists={watchlists}
              teams={teams}
              positions={positions}
              hasActiveFilters={hasActiveFilters}
              showFilters={showFilters}
              onShowFiltersChange={setShowFilters}
              onClearFilters={clearAllFilters}
              totalPlayers={totalPlayers}
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              onOpenPlayer={openMobileSheet}
            />
          )}
        </div>

        <div className="hidden md:flex gap-4 items-start">
          {/* Main content: tabs with player list and (on md/lg) activity tab */}
          <div className="flex-1 min-w-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <div className="flex items-center gap-2">
                <TabsList
                  variant="terminal"
                  className="grid flex-1 grid-cols-2 sm:w-auto sm:inline-flex sm:flex-none xl:grid-cols-1 xl:flex"
                >
                  <TabsTrigger variant="terminal" value="players" className="gap-2">
                    <Activity className="w-4 h-4" />
                    Players
                  </TabsTrigger>
                  <TabsTrigger variant="terminal" value="activity" className="gap-2 xl:hidden">
                    <TrendingUp className="w-4 h-4" />
                    Activity
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="players" className="space-y-4">
                {/* Scanners */}
                <MarketplaceScanners />

                {/* Search and Filters */}
                <Card variant="terminal" className="relative overflow-hidden">
                  <CardAccent variant="left" color="primary" intensity="low" />
                  <CardContent className="p-3 space-y-3 relative z-10">
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        variant="terminal"
                        placeholder="Search players..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                      />
                      {search && (
                        <Button
                          variant="terminalOutline"
                          size="sm"
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                          onClick={() => setSearch("")}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>

                    {/* Filter + Sort Controls */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Button
                        variant="terminalOutline"
                        size="sm"
                        onClick={() => setShowFilters(!showFilters)}
                        className="gap-2"
                      >
                        <Filter className="w-4 h-4" />
                        Filters
                        {hasActiveFilters && (
                          <Badge
                            variant="secondary"
                            className="ml-1 font-mono text-[10px] uppercase"
                          >
                            Active
                          </Badge>
                        )}
                      </Button>

                      <div className="flex items-center gap-2">
                        <select
                          value={sortField}
                          onChange={(e) => setSortFieldFromSelector(e.target.value as SortField)}
                          className="h-9 rounded-compact border border-border bg-[hsl(var(--card)/0.85)] px-3 font-mono text-sm"
                        >
                          <option value="volume">Volume</option>
                          <option value="marketCap">Mkt Cap</option>
                          <option value="price">Price</option>
                          <option value="change">24h Change</option>
                          <option value="tvl">TVL</option>
                          <option value="sentiment">Sentiment</option>
                          <option value="undervalued">Undervalued</option>
                          <option value="fantasyPoints">Fantasy Pts</option>
                          <option value="name">Name</option>
                          <option value="team">Team</option>
                        </select>

                        <Button
                          variant="terminalOutline"
                          size="sm"
                          onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                          className="gap-2"
                        >
                          <ArrowUpDown className="w-4 h-4" />
                          {sortOrder === "asc" ? "Asc" : "Desc"}
                        </Button>
                      </div>
                    </div>

                    {/* Expanded Filters */}
                    {showFilters && (
                      <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-3">
                        <div className="space-y-1">
                          <label className="terminal-label">Team</label>
                          <select
                            value={teamFilter}
                            onChange={(e) => setTeamFilter(e.target.value)}
                            className="h-9 w-full rounded-compact border border-border bg-[hsl(var(--card)/0.85)] px-3 font-mono text-sm"
                          >
                            <option value="all">All Teams</option>
                            {teams.map((team) => (
                              <option key={team} value={team}>
                                {team}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="terminal-label">Position</label>
                          <select
                            value={positionFilter}
                            onChange={(e) => setPositionFilter(e.target.value)}
                            className="h-9 w-full rounded-compact border border-border bg-[hsl(var(--card)/0.85)] px-3 font-mono text-sm"
                          >
                            <option value="all">All Positions</option>
                            {positions.map((pos) => (
                              <option key={pos} value={pos}>
                                {pos}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="terminal-label">Watchlist</label>
                          <select
                            value={filterWatchlistId}
                            onChange={(e) => setFilterWatchlistId(e.target.value)}
                            className="h-9 w-full rounded-compact border border-border bg-[hsl(var(--card)/0.85)] px-3 font-mono text-sm"
                          >
                            <option value="none">All Players</option>
                            <option value="all">My Watchlists</option>
                            {watchlists?.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {hasActiveFilters && (
                          <div className="sm:col-span-3 flex justify-end">
                            <Button variant="terminalOutline" size="sm" onClick={clearAllFilters}>
                              Clear all filters
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Players Table */}
                <Card variant="terminal" className="relative overflow-hidden">
                  <CardAccent variant="top" color="primary" intensity="low" />
                  <CardContent className="p-0 relative z-10">
                    {isLoading ? (
                      <div className="terminal-empty p-8 text-center text-muted-foreground">
                        Loading players...
                      </div>
                    ) : players.length === 0 ? (
                      <div className="terminal-empty p-8 text-center">
                        <p className="text-muted-foreground">No players found</p>
                        {hasActiveFilters ? (
                          <Button
                            variant="terminalOutline"
                            size="sm"
                            className="mt-2"
                            onClick={clearAllFilters}
                          >
                            Clear filters
                          </Button>
                        ) : (
                          <Button
                            variant="terminalOutline"
                            size="sm"
                            className="mt-2"
                            onClick={() => setSport("ALL")}
                          >
                            Show all sports
                          </Button>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Desktop Table */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full">
                            <thead className="border-b border-border bg-muted/30">
                              <tr>
                                <th className="text-left p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Player
                                </th>
                                <th
                                  className="text-right p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:bg-muted/80"
                                  onClick={() => toggleSort("price")}
                                >
                                  <div className="flex items-center justify-end">
                                    Price
                                    <SortIcon field="price" />
                                  </div>
                                </th>
                                <th className="text-right p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden lg:table-cell">
                                  7d
                                </th>
                                <th
                                  className="text-right p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:bg-muted/80"
                                  onClick={() => toggleSort("volume")}
                                >
                                  <div className="flex items-center justify-end">
                                    Volume
                                    <SortIcon field="volume" />
                                  </div>
                                </th>
                                <th
                                  className="text-right p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:bg-muted/80"
                                  onClick={() => toggleSort("change")}
                                >
                                  <div className="flex items-center justify-end">
                                    24h Change
                                    <SortIcon field="change" />
                                  </div>
                                </th>
                                <th
                                  className="text-right p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:bg-muted/80 hidden lg:table-cell"
                                  onClick={() => toggleSort("tvl")}
                                >
                                  <div className="flex items-center justify-end">
                                    TVL
                                    <SortIcon field="tvl" />
                                  </div>
                                </th>
                                <th className="text-center p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Action
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {players.map((player) => {
                                const change24h = parseFloat(player.priceChange24h || "0");
                                const isLive = player.gameStatus === "live";
                                const hasBuyPressure = (player.buyPressure ?? 0) >= 60;
                                const hasCommunityBoost = (player.communityBoostCount ?? 0) > 0;
                                const rowBorderClass =
                                  change24h > 0
                                    ? "border-l-2 border-l-emerald-500/50"
                                    : change24h < 0
                                      ? "border-l-2 border-l-red-500/40"
                                      : "";
                                return (
                                  <tr
                                    key={player.id}
                                    className={cn(
                                      "border-b border-border hover:bg-muted/20 transition-colors",
                                      rowBorderClass,
                                      isLive && "bg-market-positive/[0.03]",
                                    )}
                                  >
                                    <td className="p-3">
                                      <button
                                        type="button"
                                        className="flex items-center gap-2 cursor-pointer text-left"
                                        onClick={() => {
                                          setSelectedPlayerId(player.id);
                                          setPlayerModalOpen(true);
                                        }}
                                      >
                                        <div className="terminal-avatar flex-shrink-0">
                                          <span className="text-xs font-bold">
                                            {player.firstName[0]}
                                            {player.lastName[0]}
                                          </span>
                                        </div>
                                        <div>
                                          <div className="font-medium text-sm">
                                            <PlayerName
                                              playerId={player.id}
                                              firstName={player.firstName}
                                              lastName={player.lastName}
                                            />
                                          </div>
                                          <div className="font-mono text-[11px] text-muted-foreground">
                                            {player.team} • {player.position}
                                          </div>
                                          {/* Market signal chips */}
                                          {isLive ||
                                          hasBuyPressure ||
                                          hasCommunityBoost ||
                                          player.isProbableStarter ||
                                          player.mlbMatchupChip ? (
                                            <div className="mt-1 flex flex-wrap gap-1">
                                              {isLive && (
                                                <span className="inline-flex items-center gap-0.5 rounded-compact border border-market-positive/40 bg-market-positive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-market-positive">
                                                  <Radio className="w-2.5 h-2.5" />
                                                  Live
                                                </span>
                                              )}
                                              {hasBuyPressure && (
                                                <span className="inline-flex items-center gap-0.5 rounded-compact border border-boost/30 bg-boost/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-boost">
                                                  <Flame className="w-2.5 h-2.5" />
                                                  Buy
                                                </span>
                                              )}
                                              {hasCommunityBoost && (
                                                <span className="inline-flex items-center gap-0.5 rounded-compact border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-warning">
                                                  <Users className="w-2.5 h-2.5" />
                                                  {player.communityBoostCount}x
                                                </span>
                                              )}
                                              {player.isProbableStarter ? (
                                                <MlbProbableBadge compact />
                                              ) : null}
                                              {player.mlbMatchupChip ? (
                                                <Badge
                                                  variant="outline"
                                                  className="h-5 border-border/70 bg-background/30 px-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
                                                >
                                                  {player.mlbMatchupChip}
                                                </Badge>
                                              ) : null}
                                            </div>
                                          ) : null}
                                        </div>
                                      </button>
                                    </td>
                                    <td className="p-3 text-right">
                                      <AnimatedPrice
                                        value={parseFloat(player.currentPrice?.toString() || "0")}
                                        size="sm"
                                        className="font-mono font-medium justify-end"
                                      />
                                    </td>
                                    <td className="p-3 text-right hidden lg:table-cell">
                                      <Sparkline
                                        points={sparklines[player.id] ?? []}
                                        positive={change24h >= 0}
                                        width={48}
                                        height={22}
                                      />
                                    </td>
                                    <td className="p-3 text-right text-sm text-muted-foreground">
                                      {player.volume24h?.toLocaleString() || 0}
                                    </td>
                                    <td className="p-3 text-right">
                                      <div
                                        className={cn(
                                          "font-mono text-sm",
                                          change24h >= 0 ? "text-positive" : "text-negative",
                                        )}
                                      >
                                        {change24h >= 0 ? "+" : ""}
                                        {change24h.toFixed(2)}%
                                      </div>
                                    </td>
                                    <td className="p-3 text-right text-sm text-muted-foreground hidden lg:table-cell">
                                      {player.poolTvl == null
                                        ? "N/A"
                                        : formatAdaptiveCurrency(player.poolTvl)}
                                    </td>
                                    <td className="p-3 text-center">
                                      {player.poolInitialized === false ? (
                                        <Button
                                          size="sm"
                                          variant="terminalOutline"
                                          className="h-8 px-3"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setLocation(`/player/${player.id}?panel=lp`);
                                          }}
                                        >
                                          <Droplets className="w-3 h-3 mr-1" />
                                          Init Pool
                                        </Button>
                                      ) : (
                                        <Button
                                          size="sm"
                                          variant="terminal"
                                          className="h-8 px-3"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const pid = String(player.id || "").trim();
                                            setSelectedPlayerId(pid);
                                            setPlayerModalOpen(true);
                                          }}
                                        >
                                          <ShoppingCart className="w-3 h-3 mr-1" />
                                          Trade
                                        </Button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile Cards */}
                        <div className="hidden">
                          {players.map((player) => {
                            const mobileSortMetric = getMobileSortMetric(player, sortField);

                            return (
                              <div
                                key={player.id}
                                className="flex items-center justify-between p-3 hover:bg-muted/20"
                              >
                                <button
                                  type="button"
                                  className="flex-1"
                                  onClick={() => {
                                    setSelectedPlayerId(player.id);
                                    setPlayerModalOpen(true);
                                  }}
                                >
                                  <div className="flex items-center gap-2 cursor-pointer text-left">
                                    <div className="terminal-avatar flex-shrink-0">
                                      <span className="text-xs font-bold">
                                        {player.firstName[0]}
                                        {player.lastName[0]}
                                      </span>
                                    </div>
                                    <div>
                                      <div className="font-medium text-sm">
                                        <PlayerName
                                          playerId={player.id}
                                          firstName={player.firstName}
                                          lastName={player.lastName}
                                        />
                                      </div>
                                      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                                        <span>{player.team}</span>
                                        <span>•</span>
                                        <span className="font-mono">
                                          ${player.currentPrice || "0.00"}
                                        </span>
                                        <span>•</span>
                                        <span className={mobileSortMetric.className || ""}>
                                          {mobileSortMetric.text}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </button>
                                <div className="flex items-center ml-2">
                                  {player.poolInitialized === false ? (
                                    <Button
                                      size="sm"
                                      variant="terminalOutline"
                                      className="h-7 px-3 text-xs"
                                      onClick={() => {
                                        setLocation(`/player/${player.id}?panel=lp`);
                                      }}
                                    >
                                      Init Pool
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="terminal"
                                      className="h-7 px-3 text-xs"
                                      onClick={() => {
                                        const pid = String(player.id || "").trim();
                                        setSelectedPlayerId(pid);
                                        setPlayerModalOpen(true);
                                      }}
                                    >
                                      Trade
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-between border-t border-border p-3">
                            <div className="font-mono text-[11px] text-muted-foreground">
                              Page {page} of {totalPages}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="terminalOutline"
                                size="sm"
                                onClick={() => setPage(page - 1)}
                                disabled={page <= 1}
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="terminalOutline"
                                size="sm"
                                onClick={() => setPage(page + 1)}
                                disabled={page >= totalPages}
                              >
                                <ChevronRight className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="activity" className="xl:hidden">
                <MarketActivityLedger sport={sport} />
              </TabsContent>
            </Tabs>
          </div>

          {/* Persistent Market Feed sidebar — always visible on xl+ screens */}
          <div className="hidden xl:flex flex-col w-72 flex-shrink-0 sticky top-4 gap-4">
            <MarketActivityWidget sport={sport} title="Market Feed" limit={15} className="h-full" />
          </div>
        </div>

        <PlayerModal
          playerId={selectedPlayerId}
          open={playerModalOpen}
          onOpenChange={(open) => {
            setPlayerModalOpen(open);
            if (!open) setSelectedPlayerId(null);
          }}
        />
        <MarketMobilePlayerSheet
          open={mobileSheetOpen}
          onOpenChange={(open) => {
            setMobileSheetOpen(open);
            if (!open) {
              setSelectedMobileAction("default");
              setSelectedMobileQuickContext(undefined);
              setSelectedMobilePlayer(null);
            }
          }}
          player={selectedMobilePlayer}
          action={selectedMobileAction}
          quickContext={selectedMobileQuickContext}
        />
      </div>
    </div>
  );
}

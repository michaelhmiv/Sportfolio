import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useSport, useSportConfig } from "@/lib/sport-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/lib/websocket";
import { queryClient } from "@/lib/queryClient";
import type { Player } from "@shared/schema";
import { PlayerName } from "@/components/player-name";
import { SportSelector } from "@/components/sport-selector";
import { MarketActivityWidget } from "@/components/market-activity-widget";
import { MarketplaceScanners } from "@/components/marketplace-scanners";
import { cn } from "@/lib/utils";
import { BackgroundPattern, CardAccent } from "@/components/ui/decorative-elements";
import { PlayerModal } from "@/components/player-modal";

type PlayerWithPool = Player & {
  poolLiquidity?: number;
  poolTvl?: number;
  poolShares?: number;
  poolTotalTrades?: number;
  buyPressure?: number;
  valueIndex?: number;
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

export default function PlayerPools() {
  const { user } = useAuth();
  const isPremiumUser = user?.isPremium || false;
  const { sport } = useSport();
  const sportConfig = useSportConfig();
  const { toast } = useToast();
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
  const ITEMS_PER_PAGE = 50;
  const { subscribe } = useWebSocket();
  const offset = (page - 1) * ITEMS_PER_PAGE;

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
    const unsubTrade = subscribe("trade", (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/players"] });
    });

    return () => {
      unsubTrade();
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
      if (debouncedSearch) params.append("search", debouncedSearch);
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

      const res = await fetch(`/api/players?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch players");
      return res.json();
    },
  });

  // Fetch watchlists for filter
  const { data: watchlists } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/watchlists"],
    queryFn: async () => {
      const res = await fetch("/api/watchlists", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
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

  const hasActiveFilters =
    teamFilter !== "all" || positionFilter !== "all" || filterWatchlistId !== "none" || search;

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
    <div className="min-h-screen bg-background p-3 sm:p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header with Background Pattern */}
        <div className="relative overflow-hidden rounded-xl bg-card border p-4 sm:p-6">
          <BackgroundPattern variant="circuit" color="primary" opacity={0.04} />
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Player Pools</h1>
              <p className="text-sm text-muted-foreground">Instant buy/sell</p>
            </div>
            <div className="flex items-center gap-2">
              <SportSelector />
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full sm:w-auto grid-cols-2 sm:inline-flex">
            <TabsTrigger value="players" className="gap-2">
              <Activity className="w-4 h-4" />
              Players
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-2">
              <TrendingUp className="w-4 h-4" />
              Activity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="players" className="space-y-4">
            {/* Scanners */}
            <MarketplaceScanners />

            {/* Search and Filters */}
            <Card className="relative overflow-hidden">
              <CardAccent variant="left" color="primary" intensity="low" />
              <CardContent className="p-3 space-y-3 relative z-10">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search players..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                  {search && (
                    <Button
                      variant="ghost"
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
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilters(!showFilters)}
                    className="gap-2"
                  >
                    <Filter className="w-4 h-4" />
                    Filters
                    {hasActiveFilters && (
                      <Badge variant="secondary" className="ml-1">
                        Active
                      </Badge>
                    )}
                  </Button>

                  <div className="flex items-center gap-2">
                    <select
                      value={sortField}
                      onChange={(e) => setSortFieldFromSelector(e.target.value as SortField)}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
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
                      variant="outline"
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Team</label>
                      <select
                        value={teamFilter}
                        onChange={(e) => setTeamFilter(e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
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
                      <label className="text-xs font-medium">Position</label>
                      <select
                        value={positionFilter}
                        onChange={(e) => setPositionFilter(e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
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
                      <label className="text-xs font-medium">Watchlist</label>
                      <select
                        value={filterWatchlistId}
                        onChange={(e) => setFilterWatchlistId(e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setTeamFilter("all");
                            setPositionFilter("all");
                            setFilterWatchlistId("none");
                            setSearch("");
                          }}
                        >
                          Clear all filters
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Players Table */}
            <Card className="relative overflow-hidden">
              <CardAccent variant="top" color="primary" intensity="low" />
              <CardContent className="p-0 relative z-10">
                {isLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading players...</div>
                ) : players.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-muted-foreground">No players found</p>
                    {hasActiveFilters && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => {
                          setTeamFilter("all");
                          setPositionFilter("all");
                          setFilterWatchlistId("none");
                          setSearch("");
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full">
                        <thead className="border-b bg-muted/50">
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
                          {players.map((player) => (
                            <tr key={player.id} className="border-b hover:bg-muted/30">
                              <td className="p-3">
                                <button
                                  type="button"
                                  className="flex items-center gap-2 cursor-pointer text-left"
                                  onClick={() => {
                                    setSelectedPlayerId(player.id);
                                    setPlayerModalOpen(true);
                                  }}
                                >
                                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
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
                                    <div className="text-xs text-muted-foreground">
                                      {player.team} • {player.position}
                                    </div>
                                  </div>
                                </button>
                              </td>
                              <td className="p-3 text-right">
                                <div className="font-mono font-medium">
                                  ${player.currentPrice || "0.00"}
                                </div>
                              </td>
                              <td className="p-3 text-right text-sm text-muted-foreground">
                                {player.volume24h?.toLocaleString() || 0}
                              </td>
                              <td className="p-3 text-right">
                                <div
                                  className={cn(
                                    "font-mono text-sm",
                                    parseFloat(player.priceChange24h || "0") >= 0
                                      ? "text-positive"
                                      : "text-negative",
                                  )}
                                >
                                  {parseFloat(player.priceChange24h || "0") >= 0 ? "+" : ""}
                                  {parseFloat(player.priceChange24h || "0").toFixed(2)}%
                                </div>
                              </td>
                              <td className="p-3 text-right text-sm text-muted-foreground hidden lg:table-cell">
                                ${player.poolTvl?.toLocaleString() || "N/A"}
                              </td>
                              <td className="p-3 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="default"
                                    className="h-8 px-3"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLocation(`/player/${player.id}?tab=buy`);
                                    }}
                                  >
                                    <ShoppingCart className="w-3 h-3 mr-1" />
                                    Buy
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-3"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLocation(`/player/${player.id}?tab=sell`);
                                    }}
                                  >
                                    Sell
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden divide-y">
                      {players.map((player) => (
                        <div
                          key={player.id}
                          className="p-3 flex items-center justify-between hover:bg-muted/30"
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
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
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
                                <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                                  <span>{player.team}</span>
                                  <span>•</span>
                                  <span className="font-mono">
                                    ${player.currentPrice || "0.00"}
                                  </span>
                                  <span>•</span>
                                  <span
                                    className={cn(
                                      "font-mono",
                                      parseFloat(player.priceChange24h || "0") >= 0
                                        ? "text-positive"
                                        : "text-negative",
                                    )}
                                  >
                                    {parseFloat(player.priceChange24h || "0") >= 0 ? "+" : ""}
                                    {parseFloat(player.priceChange24h || "0").toFixed(2)}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                          <div className="flex items-center ml-2">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 px-3 text-xs"
                              onClick={() => {
                                const pid = String(player.id || "").trim();
                                setSelectedPlayerId(pid);
                                setPlayerModalOpen(true);
                              }}
                            >
                              Trade
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="p-3 border-t flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">
                          Page {page} of {totalPages}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(page - 1)}
                            disabled={page <= 1}
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
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

          <TabsContent value="activity">
            <MarketActivityWidget />
          </TabsContent>
        </Tabs>

        <PlayerModal
          playerId={selectedPlayerId}
          open={playerModalOpen}
          onOpenChange={(open) => {
            setPlayerModalOpen(open);
            if (!open) setSelectedPlayerId(null);
          }}
        />
      </div>
    </div>
  );
}

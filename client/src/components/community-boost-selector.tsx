/**
 * Community Boost Selector Component
 *
 * Allows users to create community boosts for any player with a game today.
 * Uses the same player list and patterns as the scout dashboard.
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, Loader2, Search, Zap, Users, ChevronUp, ChevronDown, Plus, Minus, ArrowUpDown } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerName } from "@/components/player-name";

interface CommunityBoostSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate?: Date;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  team: string;
  sport: string;
  position?: string;
  currentPrice?: string;
  lastTradePrice?: string | null;
  volume24h?: number;
  marketCap?: string;
  priceChange24h?: string;
  avgFantasyPointsPerGame?: string;
}

interface GameInfo {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
  sport: string;
}

interface PlayerWithGame extends Player {
  gameInfo?: GameInfo;
  gameStatus: 'upcoming' | 'live' | 'ended' | 'none';
  opponent: string | null;
  gameStartTime: string | null;
  boostCount: number;
  // Computed properties for sorting
  price: number;
  volume: number;
  mcap: number;
}

type SortField = 'name' | 'team' | 'sport' | 'price' | 'volume' | 'marketCap' | 'boosts';
type SortDirection = 'asc' | 'desc';

export function CommunityBoostSelector({ open, onOpenChange, selectedDate }: CommunityBoostSelectorProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // State
  const [search, setSearch] = useState("");
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [limit, setLimit] = useState(50);
  const [gameStatusFilter, setGameStatusFilter] = useState<string>("all"); // Filter by game status
  const [buyQuantity, setBuyQuantity] = useState(1);

  // Determine if we should use pagination
  // Pagination only for the default browse mode.
  // Any custom sort/filter/search should fetch full set so client-side sort/filter is complete.
  const usePagination = useMemo(() => {
    return (
      sportFilter === 'all' &&
      gameStatusFilter === 'all' &&
      search.length === 0 &&
      sortField === 'volume' &&
      sortDirection === 'desc'
    );
  }, [sportFilter, gameStatusFilter, search, sortField, sortDirection]);

  // Reset pagination when filters change
  useEffect(() => {
    setLimit(50);
  }, [search, sportFilter, gameStatusFilter, sortField, sortDirection]);

  // Fetch today's games for all sports
  const { data: todaysGames } = useQuery<GameInfo[]>({
    queryKey: ["/api/games/today"],
    queryFn: async () => {
      const [nbaRes, nflRes] = await Promise.all([
        fetch("/api/games/today?sport=NBA"),
        fetch("/api/games/today?sport=NFL"),
      ]);
      const [nbaGames, nflGames] = await Promise.all([nbaRes.json(), nflRes.json()]);
      return [...(nbaGames || []), ...(nflGames || [])];
    },
    enabled: open,
    refetchInterval: 60000,
  });

  // Build game map
  const playerGameMap = useMemo(() => {
    const map = new Map<string, GameInfo>();
    if (!todaysGames) return map;
    for (const game of todaysGames) {
      map.set(game.homeTeam, game);
      map.set(game.awayTeam, game);
    }
    return map;
  }, [todaysGames]);

  // Fetch players from market directory
  // When filters are active, fetch all (high limit). When no filters, use pagination.
  const playerQueryUrl = useMemo(() => {
    const params = new URLSearchParams();
    // When custom sorting/filtering is active, fetch full set for accurate results.
    params.set('limit', usePagination ? limit.toString() : '5000');
    if (search.length > 0) params.set('search', search);
    if (sportFilter !== 'all') params.set('sport', sportFilter);
    params.set('sortBy', 'volume');
    params.set('sortOrder', 'desc');
    return `/api/players?${params.toString()}`;
  }, [search, sportFilter, limit, usePagination]);

  const { data: playersData, isLoading: isLoadingPlayers } = useQuery<{ players: Player[], total: number }>({
    queryKey: [playerQueryUrl],
    enabled: open,
  });

  // Fetch user's community shares
  const { data: holdingsData } = useQuery<{ holdings: Array<{ assetType: string; assetId: string; quantity: number }> }>({
    queryKey: ["/api/portfolio"],
    enabled: open,
  });

  const selectedDateStr = format(selectedDate || new Date(), 'yyyy-MM-dd');
  const communityBoostsUrl = `/api/community-boosts/all?date=${selectedDateStr}`;

  // Fetch community boosts for today to show counts
  const { data: communityBoostsData } = useQuery<{ communityBoosts: Array<{ playerId: string }> }>({
    queryKey: [communityBoostsUrl],
    enabled: open,
  });

  const userCommunityShares = holdingsData?.holdings.find(h => h.assetType === "community")?.quantity || 0;

  // Build boost count map
  const boostCountMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!communityBoostsData?.communityBoosts) return map;
    for (const boost of communityBoostsData.communityBoosts) {
      const current = map.get(boost.playerId) || 0;
      map.set(boost.playerId, current + 1);
    }
    return map;
  }, [communityBoostsData]);

  // Build game status for each player
  const playersWithGames: PlayerWithGame[] = useMemo(() => {
    if (!playersData?.players) return [];

    const now = new Date();

    return playersData.players
      .filter(player => playerGameMap.has(player.team))
      .map(player => {
        const game = playerGameMap.get(player.team);
        const gameStartTime = game?.startTime ? new Date(game.startTime) : null;

        // Determine opponent
        let opponent: string | null = null;
        if (game) {
          opponent = game.homeTeam === player.team ? game.awayTeam : game.homeTeam;
        }

        // Determine game status
        let gameStatus: 'upcoming' | 'live' | 'ended' | 'none' = 'none';
        if (game) {
          if (game.status === 'completed' || game.status === 'ended') {
            gameStatus = 'ended';
          } else if (game.status === 'inprogress') {
            gameStatus = 'live';
          } else if (gameStartTime && gameStartTime > now) {
            gameStatus = 'upcoming';
          }
        }

        return {
          ...player,
          gameInfo: game,
          gameStatus,
          opponent,
          gameStartTime: game?.startTime || null,
          boostCount: boostCountMap.get(player.id) || 0,
          price: parseFloat((player as any).lastTradePrice || player.currentPrice || '0'),
          change: parseFloat(player.priceChange24h || '0'),
          volume: player.volume24h || 0,
          mcap: parseFloat(player.marketCap || '0'),
          fpts: parseFloat(player.avgFantasyPointsPerGame || '0'),
        };
      });
  }, [playersData?.players, playerGameMap, boostCountMap]);

  // Filter by game status
  const filteredPlayers = useMemo(() => {
    let result = playersWithGames;

    if (gameStatusFilter !== 'all') {
      result = result.filter(p => p.gameStatus === gameStatusFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;
      let comparison = 0;

      switch (sortField) {
        case 'name':
          valA = `${a.firstName} ${a.lastName}`;
          valB = `${b.firstName} ${b.lastName}`;
          comparison = valA.localeCompare(valB);
          break;
        case 'team':
          valA = a.team;
          valB = b.team;
          comparison = valA.localeCompare(valB);
          break;
        case 'sport':
          valA = a.sport;
          valB = b.sport;
          comparison = valA.localeCompare(valB);
          break;
        case 'price':
          valA = a.price;
          valB = b.price;
          comparison = valA - valB;
          break;
        case 'volume':
          valA = a.volume;
          valB = b.volume;
          comparison = valA - valB;
          break;
        case 'marketCap':
          valA = a.mcap;
          valB = b.mcap;
          comparison = valA - valB;
          break;
        case 'boosts':
          valA = a.boostCount;
          valB = b.boostCount;
          comparison = valA - valB;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [playersWithGames, sortField, sortDirection, gameStatusFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(['name', 'team', 'sport'].includes(field) ? 'asc' : 'desc');
    }
  };

  const getDeltaColor = (val: number) => val > 0 ? "text-green-500" : val < 0 ? "text-red-500" : "text-muted-foreground";

  // Buy community shares mutation
  const buyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/community/checkout-session", { quantity: buyQuantity });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.purchaseUrl) window.location.href = data.purchaseUrl;
    },
    onError: (error: any) => {
      toast({ title: "Failed to start checkout", description: error.message || "Please try again", variant: "destructive" });
    },
  });

  // Create community boost mutation
  const createBoostMutation = useMutation({
    mutationFn: async (playerId: string) => {
      const player = playersWithGames.find(p => p.id === playerId);
      return apiRequest("POST", "/api/community-boosts/create", {
        playerId,
        sport: player?.sport || 'NBA',
        date: selectedDateStr,
      });
    },
    onSuccess: (_, playerId) => {
      queryClient.invalidateQueries({ queryKey: [communityBoostsUrl] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({
        title: "Community Boost Created!",
        description: "1 Community Share redeemed. All holders of this player now get +1x multiplier.",
      });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create boost", description: error.message || "Please try again", variant: "destructive" });
    },
  });

  const handleCreateBoost = (playerId: string) => {
    createBoostMutation.mutate(playerId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <DialogHeader className="p-4 pb-2 border-b bg-muted/10 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Star className="h-5 w-5 text-amber-500" />
            Community Boost Selector
          </DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="p-3 border-b bg-muted/30 shrink-0">
          {/* Community boost status */}
          <div className="flex items-center justify-between mb-3 py-2 px-3 bg-amber-500/10 rounded-md border border-amber-500/20">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">Boosts Remaining:</span>
              {userCommunityShares > 0 ? (
                <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30">{userCommunityShares}</Badge>
              ) : (
                <span className="text-sm text-muted-foreground">0</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                onClick={() => setBuyQuantity(q => Math.max(1, q - 1))}
                disabled={buyMutation.isPending || buyQuantity <= 1}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <Badge variant="outline" className="min-w-8 justify-center border-amber-500/30 text-amber-600">{buyQuantity}</Badge>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                onClick={() => setBuyQuantity(q => Math.min(25, q + 1))}
                disabled={buyMutation.isPending}
              >
                <Plus className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10" onClick={() => buyMutation.mutate()} disabled={buyMutation.isPending}>
                {buyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                Buy {buyQuantity}
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[140px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search players..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
            </div>

            <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="sport">Sport</SelectItem>
                <SelectItem value="price">Price</SelectItem>
                <SelectItem value="volume">Volume</SelectItem>
                <SelectItem value="marketCap">Mkt Cap</SelectItem>
                <SelectItem value="boosts">Boosts</SelectItem>
              </SelectContent>
            </Select>

            <Button size="icon" variant="ghost" onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')} className="h-8 w-8 shrink-0">
              <ArrowUpDown className={cn("h-4 w-4", sortDirection === 'asc' && "rotate-180")} />
            </Button>

            <Select value={sportFilter} onValueChange={setSportFilter}>
              <SelectTrigger className="w-[80px] h-8 text-xs">
                <SelectValue placeholder="Sport" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="NBA">NBA</SelectItem>
                <SelectItem value="NFL">NFL</SelectItem>
              </SelectContent>
            </Select>

            <Select value={gameStatusFilter} onValueChange={setGameStatusFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Games</SelectItem>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="live">Live Now</SelectItem>
                <SelectItem value="ended">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Player List */}
        <div className="flex-1 overflow-auto bg-card">
          <div className="w-full">
            {/* Table Header */}
            <div className="sticky top-0 z-20 bg-muted/80 backdrop-blur-sm border-b font-medium text-xs text-muted-foreground flex items-center px-2 py-2">
              <div className="flex-1 pl-2 cursor-pointer hover:text-foreground" onClick={() => handleSort('name')}>Player</div>
              <div className="w-16 sm:w-20 text-right cursor-pointer hover:text-foreground hidden sm:block" onClick={() => handleSort('sport')}>Sport</div>
              <div className="w-16 sm:w-20 text-right cursor-pointer hover:text-foreground" onClick={() => handleSort('price')}>Price</div>
              <div className="w-14 sm:w-16 text-right cursor-pointer hover:text-foreground hidden sm:block" onClick={() => handleSort('volume')}>Vol</div>
              <div className="w-16 text-center">Status</div>
              <div className="w-16 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort('boosts')}>Boosts</div>
              <div className="w-20 text-center">Action</div>
            </div>

            {/* Table Body */}
            <div className="divide-y relative">
              {isLoadingPlayers ? (
                <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center">
                  <Loader2 className="h-6 w-6 animate-spin mb-2" />
                  Loading players...
                </div>
              ) : filteredPlayers.length === 0 ? (
                <div className="py-20 text-center text-muted-foreground flex flex-col items-center gap-3 bg-muted/10 shrink-0 border-b">
                  <Search className="h-5 w-5 opacity-40" />
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">No players found</p>
                    <p className="text-[10px] opacity-70 px-4 max-w-[200px] mx-auto">
                      {search ? `No players match "${search}"` : "No players with games today"}
                    </p>
                  </div>
                </div>
              ) : (
                filteredPlayers.map((player) => {
                  const canBoost = player.gameStatus === 'upcoming' && userCommunityShares > 0;
                  return (
                    <div key={player.id} className="group flex flex-col transition-colors border-b last:border-0">
                      <div className={cn("flex items-center px-2 py-1.5 transition-colors text-sm", player.gameStatus === 'live' && "bg-red-50 dark:bg-red-950/20 border-l-2 border-l-red-500", player.gameStatus === 'ended' && "bg-muted/40 dark:bg-muted/20 border-l-2 border-l-muted-foreground")}>
                        {/* Player Info */}
                        <div className="flex-1 flex items-center gap-2 min-w-0 pr-2">
                          <div className="min-w-0 flex-1">
                            <PlayerName playerId={player.id} firstName={player.firstName} lastName={player.lastName} className="font-medium truncate leading-tight hover:underline text-sm sm:text-xs" />
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                              <Badge variant="secondary" className="text-[9px] px-0.5 h-3.5 min-w-[20px] justify-center rounded-[3px]">{player.team}</Badge>
                              <span className="font-mono">{player.position}</span>
                            </div>
                          </div>
                        </div>

                        {/* Sport */}
                        <div className="w-16 sm:w-20 text-right text-muted-foreground text-xs hidden sm:block">{player.sport}</div>

                        {/* Price */}
                        <div className="w-16 sm:w-20 text-right font-mono text-xs tabular-nums">${player.price.toFixed(2)}</div>

                        {/* Volume */}
                        <div className="w-14 sm:w-16 text-right font-mono text-xs tabular-nums text-muted-foreground hidden sm:block">{player.volume > 0 ? player.volume.toLocaleString() : '-'}</div>

                        {/* Game Status */}
                        <div className="w-16 text-center">
                          {player.gameStatus === 'upcoming' && player.gameStartTime && (
                            <Badge variant="outline" className="text-[9px] px-1 h-5 border-blue-200 text-blue-600 bg-blue-50">{format(new Date(player.gameStartTime), "h:mm a")}</Badge>
                          )}
                          {player.gameStatus === 'upcoming' && !player.gameStartTime && <Badge variant="outline" className="text-[9px] px-1 h-5">-</Badge>}
                          {player.gameStatus === 'live' && <Badge variant="destructive" className="text-[9px] px-1 h-5 animate-pulse font-bold">LIVE</Badge>}
                          {player.gameStatus === 'ended' && <Badge variant="secondary" className="text-[9px] px-1 h-5">FINAL</Badge>}
                          {player.gameStatus === 'none' && <Badge variant="outline" className="text-[9px] px-1 h-5 text-muted-foreground">--</Badge>}
                        </div>

                        {/* Boost Count */}
                        <div className="w-16 text-center">
                          <div className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs", player.boostCount > 0 ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground")}>
                            <Zap className="h-2.5 w-2.5" />
                            <span className="font-medium">{player.boostCount}</span>
                          </div>
                        </div>

                        {/* Action Button */}
                        <div className="w-20 text-center">
                          <Button size="sm" variant={canBoost ? "default" : "ghost"} disabled={!canBoost || createBoostMutation.isPending} onClick={() => handleCreateBoost(player.id)} className={cn("h-6 text-[10px] px-2", canBoost && "bg-amber-600 hover:bg-amber-700")}>
                            {createBoostMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : !canBoost ? (player.gameStatus === 'live' ? 'Live' : player.gameStatus === 'ended' ? 'End' : '-') : <><Zap className="h-2.5 w-2.5 mr-1" />Boost</>}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {/* Load More - only show when pagination is active */}
              {!isLoadingPlayers && usePagination && playersData && playersData.total > limit && (
                <div className="p-2 text-center">
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground w-full" onClick={() => setLimit(prev => prev + 50)}>
                    Show More ({Math.max(0, playersData.total - limit)} hidden)
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-[10px] text-muted-foreground py-2 px-4 border-t bg-muted/10 flex items-center gap-2">
          <Users className="h-3 w-3" />
          <span>Each boost gives +1x multiplier to ALL holders of that player</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

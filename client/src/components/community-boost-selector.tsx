/**
 * Community Boost Selector Component
 *
 * Allows users to create community boosts for any player with a game today.
 * Uses the same player list as the scout dashboard (/api/players and /api/games/today).
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, Loader2, Search, Zap, Users, ChevronUp, ChevronDown, Plus } from "lucide-react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

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
  currentPrice?: number;
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
}

export function CommunityBoostSelector({ open, onOpenChange, selectedDate }: CommunityBoostSelectorProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<'name' | 'team' | 'sport' | 'opponent'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

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

  // Fetch all players from the market directory
  const { data: playersData, isLoading: isLoadingPlayers } = useQuery<{ players: Player[] }>({
    queryKey: ["/api/players?limit=500"],
    enabled: open,
  });

  // Fetch user's community shares
  const { data: holdingsData } = useQuery<{ holdings: Array<{ assetType: string; assetId: string; quantity: number }> }>({
    queryKey: ["/api/portfolio"],
    enabled: open,
  });

  // Fetch community boosts for today to show counts
  const { data: communityBoostsData } = useQuery<{ communityBoosts: Array<{ playerId: string }> }>({
    queryKey: ["/api/community-boosts/all", "all"],
    enabled: open,
  });

  const userCommunityShares = holdingsData?.holdings.find(h => h.assetType === "community")?.quantity || 0;

  // Build a map of playerId -> game info
  const playerGameMap = useMemo(() => {
    const map = new Map<string, GameInfo>();
    if (!todaysGames) return map;

    for (const game of todaysGames) {
      map.set(game.homeTeam, game);
      map.set(game.awayTeam, game);
    }
    return map;
  }, [todaysGames]);

  // Count boosts per player
  const boostCountMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!communityBoostsData?.communityBoosts) return map;

    for (const boost of communityBoostsData.communityBoosts) {
      const current = map.get(boost.playerId) || 0;
      map.set(boost.playerId, current + 1);
    }
    return map;
  }, [communityBoostsData]);

  // Filter and enrich players with game info
  const playersWithGames: PlayerWithGame[] = useMemo(() => {
    if (!playersData?.players) return [];

    const now = new Date();

    return playersData.players
      .filter(player => playerGameMap.has(player.team))
      .map(player => {
        const game = playerGameMap.get(player.team);
        const gameStartTime = game?.startTime ? new Date(game.startTime) : null;
        const gameStarted = gameStartTime ? gameStartTime <= now : false;

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
        };
      });
  }, [playersData?.players, playerGameMap]);

  // Sort players
  const sortedPlayers = useMemo(() => {
    const players = [...playersWithGames];

    return players.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'name':
          comparison = `${a.firstName} ${a.lastName}`.localeCompare(
            `${b.firstName} ${b.lastName}`
          );
          break;
        case 'team':
          comparison = a.team.localeCompare(b.team);
          break;
        case 'sport':
          comparison = a.sport.localeCompare(b.sport);
          break;
        case 'opponent':
          comparison = (a.opponent || '').localeCompare(b.opponent || '');
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [playersWithGames, sortField, sortDirection]);

  // Filter by search
  const filteredPlayers = useMemo(() => {
    if (!search.trim()) return sortedPlayers;

    const searchLower = search.toLowerCase();
    return sortedPlayers.filter(p =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchLower) ||
      p.team.toLowerCase().includes(searchLower) ||
      p.sport.toLowerCase().includes(searchLower)
    );
  }, [sortedPlayers, search]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc'
      ? <ChevronUp className="h-3 w-3" />
      : <ChevronDown className="h-3 w-3" />;
  };

  // Buy community shares mutation
  const buyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/community/checkout-session", {
        quantity: 1,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.purchaseUrl) {
        window.location.href = data.purchaseUrl;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to start checkout",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleBuyCommunityShares = () => {
    buyMutation.mutate();
  };

  // Create community boost mutation
  const createBoostMutation = useMutation({
    mutationFn: async (playerId: string) => {
      const player = playersWithGames.find(p => p.id === playerId);
      return apiRequest("POST", "/api/community-boosts/create", {
        playerId,
        sport: player?.sport || 'NBA',
      });
    },
    onSuccess: (_, playerId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/community-boosts/all", "all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({
        title: "Community Boost Created!",
        description: "1 Community Share redeemed. All holders of this player now get +1x multiplier.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create boost",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleCreateBoost = (playerId: string) => {
    createBoostMutation.mutate(playerId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[70vh] flex flex-col p-3" onClick={(e) => e.stopPropagation()}>
        <DialogHeader className="p-0 pb-2">
          <DialogTitle className="flex items-center gap-1.5 text-sm">
            <Star className="h-4 w-4 text-amber-500" />
            Community Boost
          </DialogTitle>
        </DialogHeader>

        {/* Community shares section - compact */}
        <div className="flex items-center justify-between py-1.5 px-2 bg-amber-500/10 rounded-md border border-amber-500/20 mb-2">
          <div className="flex items-center gap-2">
            <Star className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium">Shares:</span>
            {userCommunityShares > 0 ? (
              <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30 text-xs py-0">
                {userCommunityShares}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">0</span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-5 text-[10px] px-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
            onClick={handleBuyCommunityShares}
            disabled={buyMutation.isPending}
          >
            {buyMutation.isPending ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
            ) : (
              <Plus className="h-2.5 w-2.5 mr-1" />
            )}
            Buy
          </Button>
        </div>

        {/* Search - compact */}
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-7 text-xs"
          />
        </div>

        {/* Sortable header - compact */}
        <div className="grid grid-cols-12 gap-1 px-2 py-1 text-[10px] font-medium text-muted-foreground border-b">
          <div className="col-span-4 cursor-pointer hover:text-foreground" onClick={() => handleSort('name')}>
            Player <SortIcon field="name" />
          </div>
          <div className="col-span-2 cursor-pointer hover:text-foreground" onClick={() => handleSort('team')}>
            Team <SortIcon field="team" />
          </div>
          <div className="col-span-2 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort('opponent')}>
            Opp <SortIcon field="opponent" />
          </div>
          <div className="col-span-2 text-center">
            #
          </div>
          <div className="col-span-2 text-right">
            Action
          </div>
        </div>

        {/* Player list */}
        <div className="flex-1 overflow-y-auto -mx-2">
          {isLoadingPlayers ? (
            <div className="space-y-1 py-2 px-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="grid grid-cols-12 gap-1 h-8">
                  <Skeleton className="col-span-4 h-6" />
                  <Skeleton className="col-span-2 h-6" />
                  <Skeleton className="col-span-2 h-6" />
                  <Skeleton className="col-span-2 h-6" />
                  <Skeleton className="col-span-2 h-6" />
                </div>
              ))}
            </div>
          ) : filteredPlayers.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {search ? `No players match "${search}"` : "No players with games today"}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filteredPlayers.map((player) => {
                const boostCount = boostCountMap.get(player.id) || 0;
                const canBoost = player.gameStatus === 'upcoming' && userCommunityShares > 0;

                return (
                  <div
                    key={player.id}
                    className={cn(
                      "grid grid-cols-12 gap-1 px-2 py-1.5 items-center hover:bg-accent/50 text-xs",
                      player.gameStatus === 'live' && "bg-yellow-500/5",
                      player.gameStatus === 'ended' && "bg-muted/30"
                    )}
                  >
                    <div className="col-span-4 min-w-0">
                      <div className="font-medium truncate">
                        {player.firstName} {player.lastName}
                      </div>
                      <div className="text-[9px] text-muted-foreground flex items-center gap-1">
                        {player.gameStatus === 'live' && (
                          <Badge variant="destructive" className="text-[8px] px-1 h-3 animate-pulse">LIVE</Badge>
                        )}
                        {player.gameStatus === 'upcoming' && player.gameStartTime && (
                          <span>{format(new Date(player.gameStartTime), 'h:mm a')}</span>
                        )}
                        {player.gameStatus === 'ended' && (
                          <Badge variant="secondary" className="text-[8px] px-1 h-3">Ended</Badge>
                        )}
                      </div>
                    </div>
                    <div className="col-span-2 text-muted-foreground truncate">
                      {player.team}
                    </div>
                    <div className="col-span-2 text-muted-foreground truncate text-center">
                      {player.opponent || '-'}
                    </div>
                    <div className="col-span-2 flex items-center justify-center">
                      <div className={cn(
                        "flex items-center gap-1 px-1.5 py-0.5 rounded text-xs",
                        boostCount > 0
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-muted text-muted-foreground"
                      )}>
                        <Zap className="h-2.5 w-2.5" />
                        <span className="font-medium">{boostCount}</span>
                      </div>
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <Button
                        size="sm"
                        variant={canBoost ? "default" : "ghost"}
                        disabled={!canBoost || createBoostMutation.isPending}
                        onClick={() => handleCreateBoost(player.id)}
                        className={cn(
                          "h-6 text-[10px] px-2",
                          canBoost && "bg-amber-600 hover:bg-amber-700"
                        )}
                      >
                        {createBoostMutation.isPending ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : !canBoost ? (
                          player.gameStatus === 'live' ? 'Live' : player.gameStatus === 'ended' ? 'End' : '-'
                        ) : (
                          <>
                            <Star className="h-2.5 w-2.5 mr-1" />
                            Boost
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info - compact */}
        <div className="text-[10px] text-muted-foreground py-1.5 border-t flex items-center gap-2">
          <Users className="h-2.5 w-2.5" />
          <span>Your boost gives +1x to ALL holders</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

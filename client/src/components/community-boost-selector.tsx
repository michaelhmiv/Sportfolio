/**
 * Community Boost Selector Component
 *
 * Allows users to create community boosts for any player with a game today.
 * Shows all players with games today, current community boost counts,
 * and allows sorting/searching. Costs 1 premium share per boost.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, Loader2, Search, Zap, Users, ChevronUp, ChevronDown, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface CommunityBoostSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate?: Date;
}

interface PlayerInfo {
  playerId: string;
  player: {
    id: string;
    firstName: string;
    lastName: string;
    team: string;
    sport: string;
  };
  sport: string;
  gameId: string | null;
  gameStartTime: string | null;
  gameStatus: 'upcoming' | 'live' | 'ended';
  hasGameToday: boolean;
  communityBoostCount: number;
  alreadyBoostedByUser: boolean;
  opponent: string | null;
}

interface EligiblePlayersResponse {
  date: string;
  players: PlayerInfo[];
  userCommunityShares: number;
  totalPlayers: number;
}

type SortField = 'name' | 'team' | 'sport' | 'boosts' | 'opponent';
type SortDirection = 'asc' | 'desc';

export function CommunityBoostSelector({ open, onOpenChange, selectedDate }: CommunityBoostSelectorProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>('boosts');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Format date for API
  const dateStr = selectedDate
    ? format(selectedDate, 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd');

  // Fetch eligible players
  const { data, isLoading, error } = useQuery<EligiblePlayersResponse>({
    queryKey: ["/api/community-boosts/eligible-players", dateStr],
    queryFn: async () => {
      const res = await fetch(`/api/community-boosts/eligible-players?date=${dateStr}`);
      if (!res.ok) throw new Error("Failed to fetch eligible players");
      return res.json();
    },
    enabled: open,
  });

  // Buy community shares mutation
  const buyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/community/checkout-session", {
        quantity: 1,
      });
      return res.json();
    },
    onSuccess: (data) => {
      // Redirect to Whop checkout
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
      const player = data?.players.find(p => p.playerId === playerId);
      return apiRequest("POST", "/api/community-boosts/create", {
        playerId,
        sport: player?.sport || 'NBA',
      });
    },
    onSuccess: (_, playerId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/community-boosts/eligible-players", dateStr] });
      queryClient.invalidateQueries({ queryKey: ["/api/community-boosts/all", dateStr] });
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

  // Sorting logic
  const sortedPlayers = useMemo(() => {
    if (!data?.players) return [];

    const players = [...data.players];

    return players.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'name':
          comparison = `${a.player.firstName} ${a.player.lastName}`.localeCompare(
            `${b.player.firstName} ${b.player.lastName}`
          );
          break;
        case 'team':
          comparison = a.player.team.localeCompare(b.player.team);
          break;
        case 'sport':
          comparison = a.player.sport.localeCompare(b.player.sport);
          break;
        case 'boosts':
          comparison = a.communityBoostCount - b.communityBoostCount;
          break;
        case 'opponent':
          comparison = (a.opponent || '').localeCompare(b.opponent || '');
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data?.players, sortField, sortDirection]);

  // Filter by search
  const filteredPlayers = useMemo(() => {
    if (!search.trim()) return sortedPlayers;

    const searchLower = search.toLowerCase();
    return sortedPlayers.filter(p =>
      `${p.player.firstName} ${p.player.lastName}`.toLowerCase().includes(searchLower) ||
      p.player.team.toLowerCase().includes(searchLower) ||
      p.player.sport.toLowerCase().includes(searchLower)
    );
  }, [sortedPlayers, search]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc'); // Default to descending for new field
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc'
      ? <ChevronUp className="h-3 w-3" />
      : <ChevronDown className="h-3 w-3" />;
  };

  const handleCreateBoost = (playerId: string) => {
    createBoostMutation.mutate(playerId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-500" />
            Create Community Boost
          </DialogTitle>
        </DialogHeader>

        {/* Community shares section - always show buy button */}
        <div className="flex items-center justify-between py-2 px-3 bg-amber-500/10 rounded-lg border border-amber-500/20 mb-2">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">Your Community Shares</span>
            {(data?.userCommunityShares ?? 0) > 0 && (
              <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30 ml-2">
                {data?.userCommunityShares} available
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
            onClick={handleBuyCommunityShares}
            disabled={buyMutation.isPending}
          >
            {buyMutation.isPending ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Redirecting...
              </>
            ) : (
              <>
                <Plus className="h-3 w-3 mr-1" />
                Buy More
              </>
            )}
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {/* Sortable header */}
        <div className="grid grid-cols-12 gap-2 px-2 py-1 text-xs font-medium text-muted-foreground border-b">
          <div className="col-span-4 flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleSort('name')}>
            Player <SortIcon field="name" />
          </div>
          <div className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleSort('sport')}>
            Sport <SortIcon field="sport" />
          </div>
          <div className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleSort('team')}>
            Team <SortIcon field="team" />
          </div>
          <div className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleSort('opponent')}>
            Opp <SortIcon field="opponent" />
          </div>
          <div className="col-span-2 flex items-center justify-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleSort('boosts')}>
            Boosts <SortIcon field="boosts" />
          </div>
        </div>

        {/* Player list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 py-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 px-2">
                  <Skeleton className="col-span-4 h-8" />
                  <Skeleton className="col-span-2 h-8" />
                  <Skeleton className="col-span-2 h-8" />
                  <Skeleton className="col-span-2 h-8" />
                  <Skeleton className="col-span-2 h-8" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="py-8 text-center text-destructive text-sm">
              <div className="font-medium mb-2">Error loading players</div>
              <div className="text-xs">{error.message}</div>
            </div>
          ) : filteredPlayers.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {search ? `No players match "${search}"` : "No players with games today"}
            </div>
          ) : (
            <div className="divide-y">
              {filteredPlayers.map((player) => (
                <div
                  key={player.playerId}
                  className={cn(
                    "grid grid-cols-12 gap-2 px-2 py-2 items-center hover:bg-accent/50",
                    player.gameStatus === 'live' && "bg-yellow-500/5",
                    player.gameStatus === 'ended' && "bg-muted/30"
                  )}
                >
                  <div className="col-span-4 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {player.player.firstName} {player.player.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      {player.gameStatus === 'live' && (
                        <Badge variant="destructive" className="text-[9px] px-1 h-4 animate-pulse">LIVE</Badge>
                      )}
                      {player.gameStatus === 'upcoming' && player.gameStartTime && (
                        <span>{format(new Date(player.gameStartTime), 'h:mm a')}</span>
                      )}
                      {player.gameStatus === 'ended' && (
                        <Badge variant="secondary" className="text-[9px] px-1 h-4">Ended</Badge>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                      {player.sport}
                    </Badge>
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground">
                    {player.player.team}
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground truncate">
                    {player.opponent || '-'}
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <div className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded",
                      player.communityBoostCount > 0
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-muted text-muted-foreground"
                    )}>
                      <Zap className="h-3 w-3" />
                      <span className="text-sm font-medium">{player.communityBoostCount}</span>
                    </div>
                    {player.alreadyBoostedByUser && (
                      <span className="text-[10px] text-green-600" title="You created this boost">✓</span>
                    )}
                  </div>
                  <div className="col-span-12 flex justify-end mt-1">
                    <Button
                      size="sm"
                      variant={player.alreadyBoostedByUser ? "outline" : "default"}
                      disabled={player.gameStatus !== 'upcoming' || createBoostMutation.isPending || player.alreadyBoostedByUser || (data?.userCommunityShares ?? 0) <= 0}
                      onClick={() => handleCreateBoost(player.playerId)}
                      className={cn(
                        "h-7 text-xs",
                        !player.alreadyBoostedByUser && player.gameStatus === 'upcoming' && "bg-amber-600 hover:bg-amber-700"
                      )}
                    >
                      {createBoostMutation.isPending ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Creating...
                        </>
                      ) : player.alreadyBoostedByUser ? (
                        <>
                          <Zap className="h-3 w-3 mr-1" />
                          Boosted
                        </>
                      ) : player.gameStatus !== 'upcoming' ? (
                        player.gameStatus === 'live' ? 'Game Live' : 'Game Ended'
                      ) : (
                        <>
                          <Star className="h-3 w-3 mr-1" />
                          Boost (+1x)
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="text-xs text-muted-foreground py-2 border-t flex items-center gap-2">
          <Users className="h-3 w-3" />
          <span>Your boost gives +1x multiplier to ALL holders of this player</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

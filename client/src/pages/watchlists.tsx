import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Star, Plus, Trash2, Edit2, Users, ChevronRight, X, Search, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { queryClient, authenticatedFetch } from "@/lib/queryClient";
import { Link } from "wouter";
import { PlayerName } from "@/components/player-name";
import type { Player } from "@shared/schema";
import { appendPlayerSearchParam, normalizePlayerSearchQuery } from "@/lib/player-search";

interface Watchlist {
  id: string;
  name: string;
  isDefault: boolean;
  color: string | null;
  itemCount: number;
}

export default function Watchlists() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [newListName, setNewListName] = useState("");
  const [editingList, setEditingList] = useState<Watchlist | null>(null);
  const [editName, setEditName] = useState("");
  const [expandedListId, setExpandedListId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addPlayerDialogOpen, setAddPlayerDialogOpen] = useState(false);
  const [addToWatchlistId, setAddToWatchlistId] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState("");
  const normalizedPlayerSearch = normalizePlayerSearchQuery(playerSearch);
  const shouldSearchPlayers = addPlayerDialogOpen && normalizedPlayerSearch.length >= 2;

  // Fetch all watchlists
  const {
    data: watchlists,
    isLoading,
    refetch,
  } = useQuery<Watchlist[]>({
    queryKey: ["/api/watchlists"],
    enabled: isAuthenticated,
  });

  // Fetch full player rows for expanded watchlist
  const { data: expandedPlayersData, refetch: refetchExpandedPlayers } = useQuery<{
    players: Player[];
    total: number;
  }>({
    queryKey: ["/api/players", "watchlist", expandedListId],
    queryFn: async () => {
      if (!expandedListId) return { players: [], total: 0 };
      const params = new URLSearchParams();
      params.set("isWatchlist", "true");
      params.set("watchlistId", expandedListId);
      params.set("limit", "5000");
      params.set("sortBy", "name");
      params.set("sortOrder", "asc");
      const res = await authenticatedFetch(`/api/players?${params.toString()}`);
      if (!res.ok) return { players: [], total: 0 };
      return res.json();
    },
    enabled: isAuthenticated && !!expandedListId,
  });

  // Search players from the server when adding to a watchlist
  const { data: searchPlayersData, isFetching: isSearchingPlayers } = useQuery<{
    players: Player[];
    total: number;
  }>({
    queryKey: ["/api/players", "search", normalizedPlayerSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      appendPlayerSearchParam(params, normalizedPlayerSearch);
      params.set("limit", "20");
      params.set("sortBy", "volume");
      params.set("sortOrder", "desc");
      const res = await authenticatedFetch(`/api/players?${params.toString()}`);
      if (!res.ok) return { players: [], total: 0 };
      return res.json();
    },
    enabled: shouldSearchPlayers,
  });

  const expandedPlayers = expandedPlayersData?.players || [];

  const searchResults = useMemo(
    () => searchPlayersData?.players || [],
    [searchPlayersData?.players],
  );

  // Create watchlist mutation
  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await authenticatedFetch("/api/watchlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create watchlist");
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setNewListName("");
      setCreateDialogOpen(false);
      toast({ title: "Watchlist created" });
    },
    onError: () => {
      toast({ title: "Failed to create watchlist", variant: "destructive" });
    },
  });

  // Update watchlist mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await authenticatedFetch(`/api/watchlists/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to update watchlist");
    },
    onSuccess: () => {
      refetch();
      setEditDialogOpen(false);
      setEditingList(null);
      toast({ title: "Watchlist updated" });
    },
    onError: () => {
      toast({ title: "Failed to update watchlist", variant: "destructive" });
    },
  });

  // Delete watchlist mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authenticatedFetch(`/api/watchlists/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete watchlist");
    },
    onSuccess: () => {
      refetch();
      if (expandedListId) setExpandedListId(null);
      toast({ title: "Watchlist deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete watchlist", variant: "destructive" });
    },
  });

  // Add player to watchlist
  const addPlayerMutation = useMutation({
    mutationFn: async ({ playerId, watchlistId }: { playerId: string; watchlistId: string }) => {
      const res = await authenticatedFetch(`/api/watchlist/${playerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchlistId }),
      });
      if (!res.ok) throw new Error("Failed to add player");
      return res.json();
    },
    onSuccess: () => {
      refetch();
      refetchExpandedPlayers();
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/players", "watchlist"] });
      setAddPlayerDialogOpen(false);
      setPlayerSearch("");
      setAddToWatchlistId(null);
      toast({ title: "Player added to watchlist" });
    },
    onError: () => {
      toast({ title: "Failed to add player", variant: "destructive" });
    },
  });

  // Remove player from watchlist
  const removePlayerMutation = useMutation({
    mutationFn: async ({ playerId, watchlistId }: { playerId: string; watchlistId: string }) => {
      const res = await authenticatedFetch(
        `/api/watchlist/${playerId}?watchlistId=${watchlistId}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error("Failed to remove player");
    },
    onSuccess: () => {
      refetch();
      refetchExpandedPlayers();
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/players", "watchlist"] });
      toast({ title: "Player removed from watchlist" });
    },
    onError: () => {
      toast({ title: "Failed to remove player", variant: "destructive" });
    },
  });

  const openAddPlayerDialog = (watchlistId: string) => {
    setAddToWatchlistId(watchlistId);
    setPlayerSearch("");
    setAddPlayerDialogOpen(true);
  };

  if (!isAuthenticated) {
    return (
      <div className="terminal-page p-4">
        <div className="max-w-4xl mx-auto">
          <Card variant="terminal">
            <CardContent className="p-8 text-center">
              <Star className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h2 className="terminal-heading mb-2 text-lg">Sign in to view your watchlists</h2>
              <p className="font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground mb-4">
                Create and manage custom watchlists to track your favorite players.
              </p>
              <Button variant="terminal" asChild>
                <Link href="/login">Sign In</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="max-w-4xl mx-auto">
        <div className="terminal-shell mb-6 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="terminal-strip">
                <Star className="h-3.5 w-3.5 text-primary" />
                Watchlist Desk
              </div>
              <div>
                <p className="terminal-kicker">Tracked Market Sets</p>
                <h1 className="terminal-heading text-xl sm:text-2xl">Your Watchlists</h1>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Group players into focused lists so you can scan favorites, themes, and trade ideas
                without losing the dashboard rhythm.
              </p>
            </div>

            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="terminal" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  New List
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-sm border border-border bg-card">
                <DialogHeader>
                  <DialogTitle className="terminal-heading text-base">
                    Create New Watchlist
                  </DialogTitle>
                </DialogHeader>
                <div className="py-4">
                  <Input
                    variant="terminal"
                    placeholder="Watchlist name"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newListName.trim()) {
                        createMutation.mutate(newListName.trim());
                      }
                    }}
                  />
                </div>
                <DialogFooter>
                  <Button variant="terminalOutline" onClick={() => setCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="terminal"
                    onClick={() => createMutation.mutate(newListName.trim())}
                    disabled={!newListName.trim() || createMutation.isPending}
                  >
                    {createMutation.isPending ? "Creating..." : "Create"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} variant="terminal" className="animate-pulse">
                <CardContent className="p-4">
                  <div className="h-6 w-32 border border-border bg-muted/50" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !watchlists?.length ? (
          <Card variant="terminal">
            <CardContent className="p-8 text-center">
              <Star className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h2 className="terminal-heading mb-2 text-base">No watchlists yet</h2>
              <p className="font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground mb-4">
                Create your first watchlist to start tracking players.
              </p>
              <Button variant="terminal" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Watchlist
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {watchlists.map((list) => (
              <Card
                key={list.id}
                variant="terminal"
                className={list.isDefault ? "border-primary/30" : ""}
              >
                <CardHeader className="p-4 pb-0">
                  <div className="flex items-center justify-between">
                    <div
                      className="flex items-center gap-3 flex-1 cursor-pointer"
                      onClick={() => setExpandedListId(expandedListId === list.id ? null : list.id)}
                    >
                      <div className="terminal-avatar">
                        <Star
                          className={`w-4 h-4 ${list.isDefault ? "text-primary fill-primary" : "text-muted-foreground"}`}
                        />
                      </div>
                      <div>
                        <CardTitle className="terminal-heading text-sm flex items-center gap-2">
                          {list.name}
                          {list.isDefault && (
                            <Badge variant="outline" className="font-mono text-[10px] uppercase">
                              Default
                            </Badge>
                          )}
                        </CardTitle>
                        <div className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                          <Users className="w-3 h-3" />
                          <span>
                            {list.itemCount} player{list.itemCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                      <ChevronRight
                        className={`w-4 h-4 text-muted-foreground ml-auto transition-transform ${expandedListId === list.id ? "rotate-90" : ""}`}
                      />
                    </div>

                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        variant="terminalOutline"
                        size="icon"
                        className="h-8 w-8"
                        title="Add player"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAddPlayerDialog(list.id);
                        }}
                      >
                        <UserPlus className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="terminalOutline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingList(list);
                          setEditName(list.name);
                          setEditDialogOpen(true);
                        }}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      {!list.isDefault && (
                        <Button
                          variant="terminalOutline"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(list.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>

                {expandedListId === list.id && (
                  <CardContent className="p-4 pt-3">
                    {!expandedPlayers?.length ? (
                      <div className="terminal-empty py-4 text-center text-sm text-muted-foreground">
                        No players in this watchlist.{" "}
                        <button
                          onClick={() => openAddPlayerDialog(list.id)}
                          className="text-primary hover:underline"
                        >
                          Add players
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {expandedPlayers.map((player) => (
                          <div
                            key={player.id}
                            className="terminal-shell flex items-center justify-between gap-2 p-2 transition-colors hover:border-primary/30"
                          >
                            <Link
                              href={`/player/${player.id}`}
                              className="flex items-center gap-3 flex-1"
                            >
                              <div className="terminal-avatar">
                                <span className="font-bold text-xs">
                                  {player.firstName?.[0]}
                                  {player.lastName?.[0]}
                                </span>
                              </div>
                              <div>
                                <PlayerName
                                  playerId={player.id}
                                  firstName={player.firstName}
                                  lastName={player.lastName}
                                  className="text-sm font-medium"
                                />
                                <div className="font-mono text-[11px] text-muted-foreground">
                                  {player.team} | {player.position}
                                </div>
                              </div>
                            </Link>
                            <Button
                              variant="terminalOutline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() =>
                                removePlayerMutation.mutate({
                                  playerId: player.id,
                                  watchlistId: list.id,
                                })
                              }
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="terminalOutline"
                          size="sm"
                          className="w-full mt-2"
                          onClick={() => openAddPlayerDialog(list.id)}
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Add more players
                        </Button>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="rounded-sm border border-border bg-card">
            <DialogHeader>
              <DialogTitle className="terminal-heading text-base">Edit Watchlist</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                variant="terminal"
                placeholder="Watchlist name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editName.trim() && editingList) {
                    updateMutation.mutate({ id: editingList.id, name: editName.trim() });
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button variant="terminalOutline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="terminal"
                onClick={() =>
                  editingList &&
                  updateMutation.mutate({ id: editingList.id, name: editName.trim() })
                }
                disabled={!editName.trim() || updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Player Dialog */}
        <Dialog open={addPlayerDialogOpen} onOpenChange={setAddPlayerDialogOpen}>
          <DialogContent className="max-w-md rounded-sm border border-border bg-card">
            <DialogHeader>
              <DialogTitle className="terminal-heading text-base">
                Add Player to Watchlist
              </DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  variant="terminal"
                  placeholder="Search players..."
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  className="pl-10"
                  autoFocus
                />
              </div>

              <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
                {playerSearch.trim() === "" ? (
                  <p className="terminal-empty py-4 text-center text-sm text-muted-foreground">
                    Type to search for players
                  </p>
                ) : normalizedPlayerSearch.length < 2 ? (
                  <p className="terminal-empty py-4 text-center text-sm text-muted-foreground">
                    Enter at least 2 characters
                  </p>
                ) : isSearchingPlayers ? (
                  <p className="terminal-empty py-4 text-center text-sm text-muted-foreground">
                    Searching players...
                  </p>
                ) : searchResults.length === 0 ? (
                  <p className="terminal-empty py-4 text-center text-sm text-muted-foreground">
                    No players found
                  </p>
                ) : (
                  searchResults.map((player) => (
                    <div
                      key={player.id}
                      className="terminal-shell flex cursor-pointer items-center justify-between gap-2 p-2 transition-colors hover:border-primary/30"
                      onClick={() => {
                        if (addToWatchlistId && !addPlayerMutation.isPending) {
                          addPlayerMutation.mutate({
                            playerId: player.id,
                            watchlistId: addToWatchlistId,
                          });
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="terminal-avatar">
                          <span className="font-bold text-xs">
                            {player.firstName?.[0]}
                            {player.lastName?.[0]}
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-medium">
                            <PlayerName
                              playerId={player.id}
                              firstName={player.firstName}
                              lastName={player.lastName}
                              className="text-sm"
                            />
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {player.team} | {player.position} | {player.sport}
                          </div>
                        </div>
                      </div>
                      <Plus className="w-4 h-4 text-muted-foreground" />
                    </div>
                  ))
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="terminalOutline" onClick={() => setAddPlayerDialogOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

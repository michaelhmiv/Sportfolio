import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Flame, History, Search, ShieldAlert, Zap } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, authenticatedFetch, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBoostsDate } from "@/features/boosts/use-boosts-date";
import { matchesPlayerSearch } from "@/lib/player-search";
import { PlayerName } from "@/components/player-name";
import { CommunityBoostSelector } from "@/components/community-boost-selector";
import type { Player } from "@shared/schema";

const BOOST_SLOTS = [10, 7, 5, 3, 2] as const;

type BoostSlot = {
  id: string;
  playerId: string;
  slotTier: number;
  sharesEntered: number | string;
  sharesBurned?: number | string;
  status: string;
  fantasyPoints?: string;
  gameEpsSb?: string;
  baseComponentSb?: string;
  boostBonusSb?: string;
  totalEconomicEarningsSb?: string;
  payout?: string;
  gameId?: string;
  player?: Player;
  communityBoostCount?: number;
  sport: string;
};

type EligiblePlayer = {
  playerId: string;
  player: Player;
  availableShares: number;
  gameId: string | null;
  gameStartTime: string | null;
  hasGameToday: boolean;
  gameStatus: "none" | "upcoming" | "live" | "ended";
  isAlreadyBoosted: boolean;
  communityBoostCount: number;
  hasCommunityBoost: boolean;
  userPremiumShares: number;
  sport: string;
};

type BoostHistory = {
  id: string;
  playerId: string;
  sharesUsed: number | string;
  fantasyPoints: string;
  multiplier: number;
  gameEpsSb?: string;
  baseComponentSb?: string;
  boostBonusSb?: string;
  totalEconomicEarningsSb?: string;
  payoutAmount: string;
  createdAt: string;
  player?: Player;
};

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fullName(player?: Player): string {
  if (!player) return "Player";
  return `${player.firstName || ""} ${player.lastName || ""}`.trim() || "Player";
}

export default function BoostsPage() {
  const { toast } = useToast();
  const { selectedDate, selectedDateKey, goToPreviousDay, goToNextDay } = useBoostsDate();
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<EligiblePlayer | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [search, setSearch] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const {
    data: boostsData,
    refetch: refetchBoosts,
    isLoading: boostsLoading,
  } = useQuery<{ boosts: BoostSlot[]; slotsRemaining: number; availableSlots: number[] }>({
    queryKey: ["/api/daily-boosts/all", selectedDateKey],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await authenticatedFetch(`/api/daily-boosts/all?date=${selectedDateKey}`, {
        headers,
      });
      if (!response.ok) throw new Error("Failed to fetch boosts");
      return response.json();
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  const {
    data: eligibleData,
    refetch: refetchEligible,
    isLoading: eligibleLoading,
  } = useQuery<{ eligiblePlayers: EligiblePlayer[]; totalEligible: number }>({
    queryKey: ["/api/daily-boosts/eligible-all", selectedDateKey],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await authenticatedFetch(
        `/api/daily-boosts/eligible-all?date=${selectedDateKey}`,
        { headers },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to fetch eligible players");
      }
      return response.json();
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: historyData } = useQuery<{
    payouts: BoostHistory[];
    totalEarned: string;
    totalBoosts: number;
  }>({
    queryKey: ["/api/daily-boosts/history"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await authenticatedFetch("/api/daily-boosts/history", { headers });
      if (!response.ok) throw new Error("Failed to fetch boost history");
      return response.json();
    },
    staleTime: 30_000,
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot || !selectedPlayer) throw new Error("Choose a player and Boost slot");
      const sharesEntered = n(quantity);
      if (!(sharesEntered > 0)) throw new Error("Enter a positive share quantity");
      if (sharesEntered > selectedPlayer.availableShares + 1e-9) {
        throw new Error(`Only ${selectedPlayer.availableShares.toFixed(4)} Singles are available`);
      }
      const response = await apiRequest("POST", "/api/daily-boosts/assign", {
        playerId: selectedPlayer.playerId,
        sport: selectedPlayer.sport,
        slotTier: selectedSlot,
        sharesEntered,
        date: selectedDateKey,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: `${selectedSlot}x Boost committed`,
        description: `${quantity} Singles will be permanently burned when the game begins.`,
      });
      setSelectorOpen(false);
      setSelectedPlayer(null);
      setQuantity("1");
      void refetchBoosts();
      void refetchEligible();
    },
    onError: (error: Error) => {
      toast({ title: "Boost failed", description: error.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (boostId: string) => apiRequest("DELETE", `/api/daily-boosts/${boostId}`),
    onSuccess: () => {
      toast({ title: "Boost removed", description: "Reserved Singles are available again." });
      setRemoveId(null);
      void refetchBoosts();
      void refetchEligible();
    },
    onError: (error: Error) => {
      toast({ title: "Remove failed", description: error.message, variant: "destructive" });
    },
  });

  const filteredPlayers = useMemo(
    () =>
      (eligibleData?.eligiblePlayers || []).filter(
        (entry) =>
          !entry.isAlreadyBoosted &&
          entry.hasGameToday &&
          entry.gameStatus === "upcoming" &&
          entry.availableShares > 0 &&
          matchesPlayerSearch(entry.player, search),
      ),
    [eligibleData?.eligiblePlayers, search],
  );

  const boostForTier = (tier: number) => boostsData?.boosts?.find((boost) => boost.slotTier === tier);
  const active = (boostsData?.boosts || []).filter((boost) => boost.status === "active").length;
  const locked = (boostsData?.boosts || []).filter((boost) => boost.status === "locked").length;
  const burned = (boostsData?.boosts || []).reduce((sum, boost) => sum + n(boost.sharesBurned), 0);

  const openSlot = (tier: number) => {
    if (boostForTier(tier)) return;
    setSelectedSlot(tier);
    setSelectedPlayer(null);
    setQuantity("1");
    setSearch("");
    setSelectorOpen(true);
  };

  return (
    <div className="terminal-page px-2 py-3 sm:p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="terminal-shell p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="terminal-strip mb-2"><Zap className="h-3.5 w-3.5" /> Boost Desk</div>
              <h1 className="terminal-heading text-xl sm:text-2xl">Daily Boosts</h1>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground sm:text-sm">
                Keep Singles for durable player earnings, or sacrifice some for a larger one-game payout.
                Boosted Singles are permanently burned when the game begins.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="icon" variant="terminalOutline" onClick={goToPreviousDay}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="min-w-[130px] text-center">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Session</div>
                <div className="text-sm font-medium">{format(selectedDate, "EEE, MMM d")}</div>
              </div>
              <Button size="icon" variant="terminalOutline" onClick={goToNextDay}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-xs sm:max-w-lg">
            <div className="terminal-shell p-2"><div className="terminal-label">Committed</div><div className="terminal-value">{active}/5</div></div>
            <div className="terminal-shell p-2"><div className="terminal-label">Live</div><div className="terminal-value">{locked}</div></div>
            <div className="terminal-shell p-2"><div className="terminal-label">Burned</div><div className="terminal-value">{burned.toLocaleString()}</div></div>
          </div>
        </section>

        <div className="grid gap-2 sm:grid-cols-5">
          {BOOST_SLOTS.map((tier) => {
            const boost = boostForTier(tier);
            const effectiveMultiplier = tier + n(boost?.communityBoostCount);
            return (
              <Card
                key={tier}
                className={`min-h-[150px] ${boost ? "border-primary/30" : "cursor-pointer hover-elevate"}`}
                onClick={() => openSlot(tier)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-1.5">{tier === 10 ? <Flame className="h-4 w-4" /> : <Zap className="h-4 w-4" />}{tier}x</span>
                    {boost && <Badge variant={boost.status === "locked" ? "default" : "outline"}>{boost.status}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {boost ? (
                    <>
                      <div>
                        <PlayerName player={boost.player} fallbackId={boost.playerId} className="font-medium" />
                        <div className="text-xs text-muted-foreground">{n(boost.sharesEntered).toLocaleString()} Singles committed</div>
                      </div>
                      {effectiveMultiplier !== tier && <div className="text-xs text-positive">Community effect: {effectiveMultiplier}x effective</div>}
                      {boost.status === "processed" && (
                        <div className="grid grid-cols-2 gap-1 text-xs">
                          <div><div className="text-muted-foreground">Bonus</div><div className="font-mono">{n(boost.boostBonusSb).toFixed(2)} SB</div></div>
                          <div><div className="text-muted-foreground">Total game</div><div className="font-mono">{n(boost.totalEconomicEarningsSb ?? boost.payout).toFixed(2)} SB</div></div>
                        </div>
                      )}
                      {boost.status === "active" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="w-full"
                          onClick={(event) => { event.stopPropagation(); setRemoveId(boost.id); }}
                        >
                          Remove before lock
                        </Button>
                      )}
                    </>
                  ) : (
                    <div className="flex h-20 flex-col items-center justify-center gap-1 text-center text-muted-foreground">
                      <Zap className="h-5 w-5" />
                      <span className="text-xs">Choose player + quantity</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex gap-3 p-3 text-xs sm:text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <strong>Boosts consume the underlying Singles.</strong> The shares still receive their normal
              1x game EPS from the record snapshot, then the Boost adds the extra multiplier bonus. Once the
              valid game begins, the committed shares are gone even if the player performs poorly.
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> Recent Boost Results</CardTitle></CardHeader>
            <CardContent>
              {(historyData?.payouts || []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No settled Boosts yet.</div>
              ) : (
                <div className="divide-y divide-border">
                  {(historyData?.payouts || []).slice(0, 12).map((entry) => (
                    <div key={entry.id} className="grid grid-cols-[1fr_auto] gap-3 py-2 text-sm">
                      <div>
                        <div className="font-medium"><PlayerName player={entry.player} fallbackId={entry.playerId} /></div>
                        <div className="text-xs text-muted-foreground">{n(entry.sharesUsed).toLocaleString()} Singles · {entry.multiplier}x · {n(entry.fantasyPoints).toFixed(1)} FP</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-medium">+{n(entry.boostBonusSb ?? entry.payoutAmount).toFixed(2)} SB</div>
                        <div className="text-[10px] uppercase text-muted-foreground">Boost bonus</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Community Boost</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Community Boosts add to a player's effective Daily Boost multiplier for the session.
              </p>
              <Button variant="terminalOutline" className="w-full" onClick={() => setCommunityOpen(true)}>
                Manage Community Boost
              </Button>
              <div className="rounded-md border border-border p-2 text-xs text-muted-foreground">
                Base player earnings remain capped independently. Community effects only change the incremental Boost bonus.
              </div>
            </CardContent>
          </Card>
        </div>

        <Sheet open={selectorOpen} onOpenChange={setSelectorOpen}>
          <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-[440px] sm:rounded-none">
            <SheetHeader>
              <SheetTitle>{selectedSlot}x Boost</SheetTitle>
              <SheetDescription>Choose a player and how many Singles you are willing to permanently sacrifice.</SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {selectedPlayer ? (
                <>
                  <Card>
                    <CardContent className="space-y-3 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <PlayerName player={selectedPlayer.player} fallbackId={selectedPlayer.playerId} className="font-medium" />
                          <div className="text-xs text-muted-foreground">{selectedPlayer.player.team} · {selectedPlayer.sport}</div>
                        </div>
                        <Badge variant="outline">{selectedPlayer.availableShares.toLocaleString()} available</Badge>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium" htmlFor="boost-quantity">Singles to Boost</label>
                        <Input
                          id="boost-quantity"
                          inputMode="decimal"
                          value={quantity}
                          onChange={(event) => setQuantity(event.target.value)}
                          placeholder="1"
                        />
                        <div className="mt-2 flex gap-1">
                          {[0.1, 0.25, 0.5, 1].map((fraction) => (
                            <Button
                              key={fraction}
                              size="sm"
                              variant="outline"
                              onClick={() => setQuantity(Math.max(0.0001, selectedPlayer.availableShares * fraction).toFixed(4).replace(/0+$/, "").replace(/\.$/, ""))}
                            >
                              {fraction === 1 ? "Max" : `${fraction * 100}%`}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                    <strong>Permanent burn:</strong> {n(quantity).toLocaleString()} Singles will be removed when this valid game begins. They cannot be recovered after lock.
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setSelectedPlayer(null)}>Back</Button>
                    <Button className="flex-1" disabled={assignMutation.isPending || !(n(quantity) > 0)} onClick={() => assignMutation.mutate()}>
                      Confirm {selectedSlot}x
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search eligible players" className="pl-9" />
                  </div>
                  {eligibleLoading ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">Loading holdings…</div>
                  ) : filteredPlayers.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No eligible Singles with an upcoming game.</div>
                  ) : (
                    <div className="space-y-1">
                      {filteredPlayers.map((entry) => (
                        <button
                          key={`${entry.sport}:${entry.playerId}`}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-md border border-border p-3 text-left hover:bg-muted/40"
                          onClick={() => { setSelectedPlayer(entry); setQuantity("1"); }}
                        >
                          <div>
                            <PlayerName player={entry.player} fallbackId={entry.playerId} className="font-medium" />
                            <div className="text-xs text-muted-foreground">{entry.player.team} · {entry.sport}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-sm">{entry.availableShares.toLocaleString()}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">available</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>

        <CommunityBoostSelector open={communityOpen} onOpenChange={setCommunityOpen} selectedDate={selectedDateKey} />

        <AlertDialog open={Boolean(removeId)} onOpenChange={(open) => !open && setRemoveId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this Boost?</AlertDialogTitle>
              <AlertDialogDescription>
                This is only possible before lock. The reserved Singles will return to your available balance.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Boost</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => removeId && removeMutation.mutate(removeId)}
                disabled={removeMutation.isPending}
              >
                Remove Boost
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {boostsLoading && <div className="text-center text-xs text-muted-foreground">Refreshing Boosts…</div>}
      </div>
    </div>
  );
}

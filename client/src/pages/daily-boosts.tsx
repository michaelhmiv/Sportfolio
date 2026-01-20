import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Zap, Trophy, TrendingUp, AlertTriangle, History, Info, Crown, Globe, Flame, Search, X, Clock } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { Player, CommunityBoost, User } from "@shared/schema";
import { PlayerName } from "@/components/player-name";
import { format } from "date-fns";

interface BoostSlot {
    id: string;
    playerId: string;
    slotTier: number;
    sharesEntered: number;
    status: string;
    fantasyPoints?: string;
    payout?: string;
    gameId?: string;
    player?: Player;
}

interface EligiblePlayer {
    playerId: string;
    player: Player;
    availableShares: number;
    powerLevel: string;
    totalShares: number;
    gameId: string | null;
    gameStartTime: string | null;
    isAlreadyBoosted: boolean;
    gameStarted: boolean;
}

interface BoostHistory {
    id: string;
    playerId: string;
    sharesUsed: number;
    fantasyPoints: string;
    multiplier: number;
    payoutAmount: string;
    createdAt: string;
    player?: Player;
}

const MULTIPLIER_SLOTS = [
    { tier: 5, label: "5x", color: "from-yellow-500 to-amber-600", icon: Flame },
    { tier: 4, label: "4x", color: "from-orange-500 to-red-500", icon: Zap },
    { tier: 3, label: "3x", color: "from-purple-500 to-pink-500", icon: TrendingUp },
    { tier: 2, label: "2x", color: "from-blue-500 to-cyan-500", icon: TrendingUp },
];

export default function DailyBoosts() {
    const { toast } = useToast();
    const { isAuthenticated } = useAuth();
    const [sport, setSport] = useState<"NBA" | "NFL">("NBA");
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
    const [sharesToEnter, setSharesToEnter] = useState(1);
    const [search, setSearch] = useState("");
    const [showCommunityModal, setShowCommunityModal] = useState(false);
    const [communitySearch, setCommunitySearch] = useState("");

    // Fetch current boosts
    const { data: boostsData, isLoading: loadingBoosts, refetch: refetchBoosts } = useQuery<{
        boosts: BoostSlot[];
        slotsRemaining: number;
        availableSlots: number[];
    }>({
        queryKey: ["/api/daily-boosts", sport, format(selectedDate, 'yyyy-MM-dd')],
        queryFn: async () => {
            const dateStr = format(selectedDate, 'yyyy-MM-dd');
            const res = await fetch(`/api/daily-boosts/${sport}?date=${dateStr}`);
            if (!res.ok) throw new Error("Failed to fetch boosts");
            return res.json();
        },
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    // Fetch eligible players
    const { data: eligibleData, isLoading: loadingEligible } = useQuery<{
        eligiblePlayers: EligiblePlayer[];
        totalEligible: number;
    }>({
        queryKey: ["/api/daily-boosts/eligible", sport, format(selectedDate, 'yyyy-MM-dd')],
        queryFn: async () => {
            const dateStr = format(selectedDate, 'yyyy-MM-dd');
            const res = await fetch(`/api/daily-boosts/eligible/${sport}?date=${dateStr}`);
            if (!res.ok) throw new Error("Failed to fetch eligible players");
            return res.json();
        },
        refetchInterval: 60000,
    });

    // Fetch live progress
    const { data: liveData, refetch: refetchLive } = useQuery<{
        boosts: (BoostSlot & { liveFantasyPoints: number; estimatedPayout: string; gameStatus: string })[];
        totalEstimatedEarnings: string;
    }>({
        queryKey: ["/api/daily-boosts/live", sport, format(selectedDate, 'yyyy-MM-dd')],
        queryFn: async () => {
            const dateStr = format(selectedDate, 'yyyy-MM-dd');
            const res = await fetch(`/api/daily-boosts/live/${sport}?date=${dateStr}`);
            if (!res.ok) throw new Error("Failed to fetch live data");
            return res.json();
        },
        refetchInterval: 10000, // Every 10 seconds for live updates
    });

    // Fetch history
    const { data: historyData } = useQuery<{
        payouts: BoostHistory[];
        totalEarned: string;
        totalBoosts: number;
    }>({
        queryKey: ["/api/daily-boosts/history"],
        queryFn: async () => {
            const res = await fetch("/api/daily-boosts/history");
            if (!res.ok) throw new Error("Failed to fetch history");
            return res.json();
        },
    });

    // Assign boost mutation
    const assignBoostMutation = useMutation({
        mutationFn: async (data: { playerId: string; slotTier: number; sharesEntered: number }) => {
            return await apiRequest("POST", "/api/daily-boosts/assign", {
                ...data,
                sport,
                date: format(selectedDate, 'yyyy-MM-dd')
            });
        },
        onSuccess: () => {
            toast({ title: "Player boosted! 🚀", description: "Shares will be burned when the game starts." });
            refetchBoosts();
            setSelectedSlot(null);
            setSharesToEnter(1);
            queryClient.invalidateQueries({ queryKey: ["/api/daily-boosts/eligible", sport, format(selectedDate, 'yyyy-MM-dd')] });
        },
        onError: (error: Error) => {
            toast({ title: "Boost failed", description: error.message, variant: "destructive" });
        },
    });

    // Community Boosts Query
    const { data: communityBoosts, refetch: refetchCommunity } = useQuery<(CommunityBoost & { creator: User; player: Player })[]>({
        queryKey: ["/api/community-boosts", sport, format(selectedDate, 'yyyy-MM-dd')],
        queryFn: async () => {
            const dateStr = format(selectedDate, 'yyyy-MM-dd');
            const res = await fetch(`/api/community-boosts/${sport}?date=${dateStr}`);
            if (!res.ok) throw new Error("Failed to fetch community boosts");
            return res.json();
        },
        refetchInterval: 30000,
    });

    // Premium Status Query (to check for shares)
    const { data: premiumStatus } = useQuery<{ premiumShares: number }>({
        queryKey: ["/api/premium/status"],
        queryFn: async () => {
            const res = await fetch("/api/premium/status");
            if (!res.ok) throw new Error("Failed to fetch premium status");
            return res.json();
        }
    });

    // Create Community Boost Mutation
    const createCommunityBoostMutation = useMutation({
        mutationFn: async (playerId: string) => {
            return await apiRequest("POST", "/api/community-boosts/create", {
                playerId,
                sport,
                date: format(selectedDate, 'yyyy-MM-dd')
            });
        },
        onSuccess: () => {
            toast({
                title: "Community Boost Activated! 🚀",
                description: "You've boosted this player for everyone! 1 Premium Share redeemed."
            });
            refetchCommunity();
            queryClient.invalidateQueries({ queryKey: ["/api/premium/status"] });
            setShowCommunityModal(false);
        },
        onError: (error: Error) => {
            toast({ title: "Boost failed", description: error.message, variant: "destructive" });
        },
    });

    // Remove boost mutation
    const removeBoostMutation = useMutation({
        mutationFn: async (boostId: string) => {
            return await apiRequest("DELETE", `/api/daily-boosts/${boostId}`);
        },
        onSuccess: () => {
            toast({ title: "Boost removed" });
            refetchBoosts();
            queryClient.invalidateQueries({ queryKey: ["/api/daily-boosts/eligible", sport, format(selectedDate, 'yyyy-MM-dd')] });
        },
        onError: (error: Error) => {
            toast({ title: "Remove failed", description: error.message, variant: "destructive" });
        },
    });

    const handleAssignBoost = (playerId: string) => {
        if (!selectedSlot) return;
        assignBoostMutation.mutate({
            playerId,
            slotTier: selectedSlot,
            sharesEntered: sharesToEnter,
        });
    };

    const getSlotBoost = (tier: number) => {
        return boostsData?.boosts?.find(b => b.slotTier === tier);
    };

    const liveBoostForSlot = (tier: number) => {
        return liveData?.boosts?.find(b => b.slotTier === tier);
    };

    const filteredPlayers = eligibleData?.eligiblePlayers?.filter(ep => {
        const name = `${ep.player.firstName} ${ep.player.lastName}`.toLowerCase();
        return name.includes(search.toLowerCase());
    }) || [];

    const totalEstimated = liveData?.totalEstimatedEarnings || "0.00";

    return (
        <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h1 className="text-3xl font-bold flex items-center gap-3">
                                <Zap className="w-8 h-8 text-yellow-500" />
                                Daily Boosts
                            </h1>
                            <p className="text-muted-foreground mt-1">
                                Boost 4 players for multiplied earnings. Shares are <span className="text-destructive font-semibold">burned</span> when games start!
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Date Selector */}
                        <div className="flex bg-muted/50 p-1 rounded-lg items-center">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    const prev = new Date(selectedDate);
                                    prev.setDate(prev.getDate() - 1);
                                    setSelectedDate(prev);
                                }}
                                className="h-8 w-8 p-0"
                            >
                                <span className="sr-only">Previous Day</span>
                                ←
                            </Button>
                            <div className="px-3 text-sm font-medium w-32 text-center">
                                {format(selectedDate, 'EEE, MMM d')}
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    const next = new Date(selectedDate);
                                    next.setDate(next.getDate() + 1);
                                    setSelectedDate(next);
                                }}
                                className="h-8 w-8 p-0"
                            >
                                <span className="sr-only">Next Day</span>
                                →
                            </Button>
                        </div>

                        <Tabs value={sport} onValueChange={(v) => setSport(v as "NBA" | "NFL")}>
                            <TabsList>
                                <TabsTrigger value="NBA">NBA</TabsTrigger>
                                <TabsTrigger value="NFL">NFL</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>
                </div>

                {/* Warning banner */}
                <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm">
                    <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                    <span>
                        <strong>Risk/Reward:</strong> Boosted shares are permanently consumed when the game starts.
                        You earn <strong>shares × fantasy points × multiplier</strong> in cash.
                    </span>
                </div>
            </div>

            {/* Live Earnings Summary */}
            {liveData && parseFloat(totalEstimated) > 0 && (
                <Card className="mb-6 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/30">
                    <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <TrendingUp className="w-6 h-6 text-green-500" />
                                <span className="text-lg">Today's Estimated Earnings</span>
                            </div>
                            <span className="text-3xl font-mono font-bold text-green-500">
                                ${totalEstimated}
                            </span>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Boost Slots - Left side */}
                <div className="lg:col-span-2 space-y-4">
                    <h2 className="text-lg font-semibold">Your Boost Slots</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {MULTIPLIER_SLOTS.map(({ tier, label, color, icon: Icon }) => {
                            const boost = getSlotBoost(tier);
                            const liveBoost = liveBoostForSlot(tier);
                            const isAvailable = boostsData?.availableSlots?.includes(tier);
                            const isSelected = selectedSlot === tier;

                            return (
                                <Card
                                    key={tier}
                                    className={`relative overflow-hidden transition-all ${isSelected ? 'ring-2 ring-primary' : ''
                                        } ${boost ? 'border-2 border-primary/50' : ''}`}
                                >
                                    {/* Multiplier badge */}
                                    <div className={`absolute top-0 right-0 bg-gradient-to-br ${color} text-white px-4 py-1 rounded-bl-lg font-bold text-lg`}>
                                        {label}
                                    </div>

                                    <CardHeader className="pb-2">
                                        <div className="flex items-center gap-2">
                                            <Icon className={`w-5 h-5 ${boost ? 'text-primary' : 'text-muted-foreground'}`} />
                                            <CardTitle className="text-sm">Slot {5 - tier + 1}</CardTitle>
                                        </div>
                                    </CardHeader>

                                    <CardContent>
                                        {boost ? (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="font-medium">
                                                            {boost.player && (
                                                                <PlayerName
                                                                    playerId={boost.player.id}
                                                                    firstName={boost.player.firstName}
                                                                    lastName={boost.player.lastName}
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {boost.player?.team} · {boost.sharesEntered} shares
                                                        </div>
                                                    </div>
                                                    {boost.status === "active" && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => removeBoostMutation.mutate(boost.id)}
                                                            disabled={removeBoostMutation.isPending}
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                </div>

                                                {/* Live stats */}
                                                {liveBoost && (
                                                    <div className="p-2 bg-muted/50 rounded-md">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">Fantasy Pts</span>
                                                            <span className="font-mono">{liveBoost.liveFantasyPoints.toFixed(1)}</span>
                                                        </div>
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">Est. Payout</span>
                                                            <span className="font-mono text-green-500">${liveBoost.estimatedPayout}</span>
                                                        </div>
                                                        <Badge variant="outline" className="mt-1 text-xs">
                                                            {liveBoost.gameStatus}
                                                        </Badge>
                                                    </div>
                                                )}

                                                {boost.status === "active" && (
                                                    <Badge variant="secondary" className="w-full justify-center">
                                                        <Clock className="w-3 h-3 mr-1" /> Waiting for game
                                                    </Badge>
                                                )}
                                                {boost.status === "locked" && (
                                                    <Badge className="w-full justify-center bg-yellow-500/20 text-yellow-600 border-yellow-500/30">
                                                        🔥 Shares Burned - Game Live
                                                    </Badge>
                                                )}
                                                {boost.status === "processed" && (
                                                    <Badge className="w-full justify-center bg-green-500/20 text-green-600 border-green-500/30">
                                                        ✓ Settled: ${boost.payout}
                                                    </Badge>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {isAvailable ? (
                                                    <>
                                                        <p className="text-sm text-muted-foreground">
                                                            Click to select a player for {label} earnings
                                                        </p>
                                                        <Button
                                                            variant={isSelected ? "default" : "outline"}
                                                            className="w-full"
                                                            onClick={() => setSelectedSlot(isSelected ? null : tier)}
                                                        >
                                                            {isSelected ? "Cancel Selection" : "Select Player"}
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <p className="text-sm text-muted-foreground text-center py-4">
                                                        Slot unavailable
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </div>


                {/* Community Boosts Section */}
                <div className="lg:col-span-2 space-y-4 mt-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Globe className="w-5 h-5 text-blue-400" />
                            Community Boosts
                        </h2>
                        <Button
                            size="sm"
                            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 border-0"
                            onClick={() => {
                                if ((premiumStatus?.premiumShares || 0) < 1) {
                                    toast({
                                        title: "No Premium Shares",
                                        description: "You need at least 1 Premium Share to activate a community boost.",
                                        variant: "destructive"
                                    });
                                    return;
                                }
                                setShowCommunityModal(true);
                            }}
                        >
                            <Crown className="w-4 h-4 mr-2 text-yellow-300" />
                            Activate Boost
                        </Button>
                    </div>

                    {communityBoosts && communityBoosts.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {communityBoosts.map((boost) => (
                                <Card key={boost.id} className="relative overflow-hidden border-blue-500/30 bg-blue-500/5">
                                    <div className="absolute top-0 right-0 bg-blue-500 text-white px-3 py-1 rounded-bl-lg font-bold text-xs flex items-center gap-1">
                                        <Globe className="w-3 h-3" /> Global 5x
                                    </div>
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <PlayerName
                                                    playerId={boost.player.id}
                                                    firstName={boost.player.firstName}
                                                    lastName={boost.player.lastName}
                                                />
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                by {boost.creator.username}
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-muted-foreground">Beneficiaries</span>
                                            <span className="font-mono">{boost.beneficiaryCount || 0}</span>
                                        </div>
                                        {boost.totalPayout && (
                                            <div className="flex justify-between items-center text-sm mt-1">
                                                <span className="text-muted-foreground">Total Payout</span>
                                                <span className="font-mono text-green-500 font-bold">${boost.totalPayout}</span>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <Card className="border-dashed">
                            <CardContent className="py-8 text-center text-muted-foreground">
                                <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <p>No active community boosts today.</p>
                                <p className="text-xs mt-1">Be the first to boost a player for everyone!</p>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Eligible Players - Right side */}
                <div className="space-y-4">
                    <Tabs defaultValue="players">
                        <TabsList className="w-full">
                            <TabsTrigger value="players" className="flex-1">Eligible Players</TabsTrigger>
                            <TabsTrigger value="history" className="flex-1">History</TabsTrigger>
                        </TabsList>

                        <TabsContent value="players" className="mt-4">
                            <Card>
                                <CardHeader className="pb-3">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search players..."
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            className="pl-9"
                                        />
                                    </div>
                                </CardHeader>
                                <CardContent className="max-h-[500px] overflow-y-auto space-y-2">
                                    {loadingEligible ? (
                                        <div className="py-8 text-center text-muted-foreground">Loading players...</div>
                                    ) : filteredPlayers.length === 0 ? (
                                        <div className="py-8 text-center text-muted-foreground">
                                            No eligible players with games today
                                        </div>
                                    ) : (
                                        filteredPlayers.map((ep) => (
                                            <div
                                                key={ep.playerId}
                                                className={`p-3 border rounded-lg transition-all ${ep.isAlreadyBoosted ? 'opacity-50' : 'hover:border-primary'
                                                    } ${ep.gameStarted ? 'bg-destructive/5' : ''}`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                                            <span className="font-bold text-sm">
                                                                {ep.player.firstName[0]}{ep.player.lastName[0]}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <div className="font-medium">
                                                                <PlayerName
                                                                    playerId={ep.player.id}
                                                                    firstName={ep.player.firstName}
                                                                    lastName={ep.player.lastName}
                                                                />
                                                            </div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {ep.player.team} · {ep.availableShares} shares
                                                                {parseFloat(ep.powerLevel || "0") > 0 && (
                                                                    <span className="text-purple-400 ml-1">· ⚡{ep.powerLevel} PL</span>
                                                                )}
                                                            </div>
                                                            {ep.gameStartTime && (
                                                                <div className="text-xs text-muted-foreground">
                                                                    Game: {format(new Date(ep.gameStartTime), "h:mm a")}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {selectedSlot && !ep.isAlreadyBoosted && !ep.gameStarted && (
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                type="number"
                                                                value={sharesToEnter}
                                                                onChange={(e) => setSharesToEnter(Math.max(1, Math.min(ep.availableShares, parseInt(e.target.value) || 1)))}
                                                                className="w-16 text-center"
                                                                min={1}
                                                                max={ep.availableShares}
                                                            />
                                                            <Button
                                                                size="sm"
                                                                onClick={() => handleAssignBoost(ep.playerId)}
                                                                disabled={assignBoostMutation.isPending}
                                                            >
                                                                <Zap className="w-4 h-4 mr-1" />
                                                                {MULTIPLIER_SLOTS.find(s => s.tier === selectedSlot)?.label}
                                                            </Button>
                                                        </div>
                                                    )}

                                                    {ep.isAlreadyBoosted && (
                                                        <Badge variant="secondary">Boosted</Badge>
                                                    )}
                                                    {ep.gameStarted && !ep.isAlreadyBoosted && (
                                                        <Badge variant="destructive">Game Started</Badge>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="history" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-sm flex items-center gap-2">
                                            <History className="w-4 h-4" />
                                            Payout History
                                        </CardTitle>
                                        {historyData && (
                                            <Badge variant="outline">
                                                Total: ${historyData.totalEarned}
                                            </Badge>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="max-h-[400px] overflow-y-auto space-y-2">
                                    {!historyData?.payouts || historyData.payouts.length === 0 ? (
                                        <div className="py-8 text-center text-muted-foreground">
                                            No boost payouts yet
                                        </div>
                                    ) : (
                                        historyData.payouts.map((payout) => (
                                            <div key={payout.id} className="p-3 border rounded-md">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="font-medium">
                                                            {payout.player && `${payout.player.firstName} ${payout.player.lastName}`}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {payout.sharesUsed} shares × {payout.fantasyPoints} FP × {payout.multiplier}x
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {format(new Date(payout.createdAt), "MMM d, yyyy")}
                                                        </div>
                                                    </div>
                                                    <span className="font-mono text-lg font-bold text-green-500">
                                                        +${payout.payoutAmount}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>

            {/* Community Boost Modal */}
            <Dialog open={showCommunityModal} onOpenChange={setShowCommunityModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Crown className="w-5 h-5 text-yellow-500" />
                            Activate Community Boost
                        </DialogTitle>
                        <DialogDescription>
                            Redeem <strong>1 Premium Share</strong> to give EVERYONE a <strong>5x Multiplier</strong> on this player today.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search any player..."
                                value={communitySearch}
                                onChange={(e) => setCommunitySearch(e.target.value)}
                                className="pl-9"
                            />
                        </div>

                        <div className="max-h-[300px] overflow-y-auto space-y-2">
                            {/* For MVP, showing eligible players (holdings) + search filtering */}
                            {/* Ideally this would search ALL players via API */}
                            {eligibleData?.eligiblePlayers
                                ?.filter(ep => {
                                    const name = `${ep.player.firstName} ${ep.player.lastName}`.toLowerCase();
                                    return name.includes(communitySearch.toLowerCase());
                                })
                                .slice(0, 10)
                                .map((ep) => (
                                    <div
                                        key={ep.playerId}
                                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                                        onClick={() => createCommunityBoostMutation.mutate(ep.playerId)}
                                    >
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                                                {ep.player.position}
                                            </div>
                                            <div className="min-w-0 truncate">
                                                <div className="font-medium truncate">
                                                    {ep.player.firstName} {ep.player.lastName}
                                                </div>
                                                <div className="text-xs text-muted-foreground truncate">
                                                    {ep.player.team} • {ep.gameStartTime ? format(new Date(ep.gameStartTime), 'h:mm a') : 'TBD'}
                                                </div>
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            disabled={createCommunityBoostMutation.isPending}
                                            className="shrink-0 ml-2"
                                        >
                                            {createCommunityBoostMutation.isPending ? "Boosting..." : "Boost 5x"}
                                        </Button>
                                    </div>
                                ))
                            }
                            {(!eligibleData?.eligiblePlayers || eligibleData.eligiblePlayers.length === 0) && (
                                <div className="text-center text-muted-foreground py-8">
                                    No players found with games today.
                                </div>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

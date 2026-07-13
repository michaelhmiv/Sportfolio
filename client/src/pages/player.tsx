import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, useSearch, Link } from "wouter";
import { useWebSocket } from "@/lib/websocket";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/use-app-state";
import { formatAdaptiveCurrency } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  TrendingUp,
  TrendingDown,
  BarChart2,
  Droplets,
  Info,
  Heart,
  Zap,
  ShoppingCart,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { apiRequest, authenticatedFetch, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { invalidatePortfolioQueries } from "@/lib/cache-invalidation";
import type { Player, Trade, PriceHistory } from "@shared/schema";
import { SchemaOrg, schemas } from "@/components/schema-org";
import { InjuryIndicator } from "@/components/player-name";
import { useInjuries } from "@/lib/injury-context";
import { AnimatedPrice } from "@/components/ui/animated-price";
import { Confetti, CelebrationBurst } from "@/components/ui/confetti";
import { PlayerModal } from "@/components/player-modal";
import {
  MlbPlayerContextPanel,
  type MlbPlayerContext,
} from "@/components/mlb-player-context-panel";
import { AmmTradePanel } from "@/components/amm-trade-panel";
import { Progress } from "@/components/ui/progress";

interface PlayerPageData {
  player: Player;
  priceHistory: PriceHistory[];
  recentTrades: (Trade & { buyer: { username: string }; seller: { username: string } })[];
  userBalance: string;
  userHolding?: { quantity: number; avgCostBasis: string };
}

interface AmmPoolData {
  playerId: string;
  poolInitialized?: boolean;
  shares: number;
  playMoney: number;
  currentPrice: number;
  totalVolume: number;
  totalTrades: number;
  lpSharesTotal: number;
  feesAccumulated: number;
}

interface UserLpPosition {
  playerId: string;
  lpShares: number;
  totalLpShares: number;
  ownershipPercentage: number;
  equivalentShares: number;
  equivalentPlayMoney: number;
  positionValue: number;
  feesEarnedToDate: number;
}

type TimeRange = "1D" | "1W" | "1M" | "1Y";

export default function PlayerPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const id = (rawId || "").split("?")[0].split("#")[0].trim();
  const searchParams = new URLSearchParams(useSearch());
  const initialTradeType =
    searchParams.get("tab") === "buy"
      ? "buy"
      : searchParams.get("tab") === "sell"
        ? "sell"
        : undefined;
  const initialPanel = searchParams.get("panel");
  const { toast } = useToast();
  const { subscribe } = useWebSocket();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { shouldPoll, isMobile } = useAppState();
  const { getInjury } = useInjuries();
  const [timeRange, setTimeRange] = useState<TimeRange>("1D");
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [statsModalOpen, setStatsModalOpen] = useState(false);

  // Watchlist state
  const { data: watchlistIds = [] } = useQuery<string[]>({
    queryKey: ["/api/watchlist"],
    enabled: isAuthenticated,
  });
  const isWatchlisted = watchlistIds.includes(id);
  const toggleWatchlistMutation = useMutation({
    mutationFn: async (currentlyWatchlisted: boolean) => {
      if (currentlyWatchlisted) {
        await apiRequest("DELETE", `/api/watchlist/${id}`);
      } else {
        await apiRequest("POST", `/api/watchlist/${id}`);
      }
    },
    onSuccess: (_data, wasWatchlisted) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: wasWatchlisted ? "Removed from watchlist" : "Added to Favorites" });
    },
    onError: () => {
      toast({ title: "Failed to update watchlist", variant: "destructive" });
    },
  });

  // Liquidity UI (simple, no jargon)
  const [addLiquidityOpen, setAddLiquidityOpen] = useState(false);
  const [removeLiquidityOpen, setRemoveLiquidityOpen] = useState(false);
  const [maxSharesToUse, setMaxSharesToUse] = useState(0);
  const [maxPlayMoneyToUse, setMaxPlayMoneyToUse] = useState(0);
  const [linkAmounts, setLinkAmounts] = useState(false);
  const [lastEdited, setLastEdited] = useState<"shares" | "sb" | null>(null);
  const [removePercent, setRemovePercent] = useState(50);

  // Add liquidity mode: auto-detect (zap), dual-max (optimal), or fixed-ratio
  const [addLiquidityMode, setAddLiquidityMode] = useState<
    "auto-detect" | "dual-max" | "fixed-ratio"
  >("auto-detect");
  const [zapQuote, setZapQuote] = useState<{
    side: "shares" | "sb";
    sharesIn?: number;
    sbIn?: number;
    sharesSold?: number;
    sharesBought?: number;
    sbReceived?: number;
    totalSwapCost?: number;
    sharesDeposited: number;
    playMoneyDeposited: number;
    estimatedLpSharesMinted: number;
    estimatedOwnershipPercentage: number;
    priceAfterSwap: number;
  } | null>(null);
  const [isLoadingZapQuote, setIsLoadingZapQuote] = useState(false);

  // Fetch player data
  const {
    data,
    isLoading,
    isError,
    error: playerError,
  } = useQuery<PlayerPageData>({
    queryKey: ["/api/player", id, timeRange],
    queryFn: async () => {
      const url = `/api/player/${encodeURIComponent(id)}?range=${timeRange}`;
      const res = await authenticatedFetch(url);
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(
          text
            ? `Player API ${res.status}: ${text}`
            : `Player API ${res.status}: ${res.statusText}`,
        );
        (err as any).status = res.status;
        throw err;
      }
      return res.json();
    },
    enabled: !!id && !authLoading && isAuthenticated,
    staleTime: 15000,
    placeholderData: (previousData) => previousData,
  });

  // Fetch AMM pool data with proper error handling
  const {
    data: poolData,
    isLoading: isPoolLoading,
    error: poolError,
  } = useQuery<AmmPoolData>({
    queryKey: ["/api/amm", id],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/amm/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch pool data: ${res.status} ${errorText}`);
      }
      return res.json();
    },
    enabled: !!id,
    refetchInterval: shouldPoll ? (isMobile ? 10000 : 5000) : false,
    refetchIntervalInBackground: false, // Don't poll when tab is inactive
    staleTime: 5000,
    retry: 3,
    retryDelay: 1000,
  });
  const isPoolInitialized = poolData?.poolInitialized !== false;

  // Fetch user's LP position
  const { data: lpPosition } = useQuery<UserLpPosition>({
    queryKey: ["/api/lp", id, "position"],
    queryFn: async () => {
      const url = `/api/lp/${encodeURIComponent(id)}/position`;
      const res = await authenticatedFetch(url);
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(
          text ? `LP API ${res.status}: ${text}` : `LP API ${res.status}: ${res.statusText}`,
        );
        (err as any).status = res.status;
        throw err;
      }
      const data = await res.json();
      return data.position;
    },
    enabled: !!id && isAuthenticated,
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
  });

  const currentPoolPrice = isPoolInitialized ? (poolData?.currentPrice ?? null) : null;

  const { data: mlbContext, isLoading: isMlbContextLoading } = useQuery<MlbPlayerContext>({
    queryKey: ["/api/player", id, "mlb-context"],
    enabled: !!id && !authLoading && isAuthenticated && data?.player?.sport === "MLB",
    staleTime: 60000,
  });

  const userSharesBalance = parseFloat(String(data?.userHolding?.quantity || 0));
  const userPlayMoneyBalance = parseFloat(String(data?.userBalance || 0));

  const estimatedSharesDeposited =
    currentPoolPrice && currentPoolPrice > 0
      ? Math.min(maxSharesToUse, maxPlayMoneyToUse / currentPoolPrice)
      : maxSharesToUse > 0 && maxPlayMoneyToUse > 0
        ? maxSharesToUse
        : 0;
  const estimatedPlayMoneyDeposited =
    currentPoolPrice && currentPoolPrice > 0
      ? estimatedSharesDeposited * currentPoolPrice
      : maxSharesToUse > 0 && maxPlayMoneyToUse > 0
        ? maxPlayMoneyToUse
        : 0;
  const estimatedTotalValue = estimatedPlayMoneyDeposited * 2;
  const estimatedSharesUnused = Math.max(0, maxSharesToUse - estimatedSharesDeposited);
  const estimatedPlayMoneyUnused = Math.max(0, maxPlayMoneyToUse - estimatedPlayMoneyDeposited);

  const isLinkingConstrained =
    linkAmounts && currentPoolPrice
      ? (lastEdited === "shares" &&
          maxSharesToUse * currentPoolPrice > userPlayMoneyBalance + 1e-9) ||
        (lastEdited === "sb" && maxPlayMoneyToUse / currentPoolPrice > userSharesBalance + 1e-9)
      : false;

  useEffect(() => {
    if (initialPanel !== "lp") return;
    setAddLiquidityOpen(true);
  }, [initialPanel]);

  useEffect(() => {
    if (!linkAmounts) return;
    if (!currentPoolPrice) return;

    if (lastEdited === "shares") {
      const requiredSb = maxSharesToUse * currentPoolPrice;
      const nextSb = Math.min(userPlayMoneyBalance, requiredSb);
      if (Math.abs(nextSb - maxPlayMoneyToUse) > 0.0001) {
        setMaxPlayMoneyToUse(nextSb);
      }
    }

    if (lastEdited === "sb") {
      const requiredShares = maxPlayMoneyToUse / currentPoolPrice;
      const nextShares = Math.min(userSharesBalance, requiredShares);
      if (Math.abs(nextShares - maxSharesToUse) > 0.0001) {
        setMaxSharesToUse(nextShares);
      }
    }
  }, [
    linkAmounts,
    lastEdited,
    currentPoolPrice,
    maxSharesToUse,
    maxPlayMoneyToUse,
    userSharesBalance,
    userPlayMoneyBalance,
  ]);

  useEffect(() => {
    if (!addLiquidityOpen) return;
    if (isPoolInitialized) return;
    if (addLiquidityMode !== "auto-detect") return;

    setAddLiquidityMode("dual-max");
    setZapQuote(null);
  }, [addLiquidityOpen, isPoolInitialized, addLiquidityMode]);

  // Fetch zap quote for auto-detect mode
  useEffect(() => {
    const fetchZapQuote = async () => {
      if (addLiquidityMode !== "auto-detect") {
        setZapQuote(null);
        return;
      }
      if (!isPoolInitialized) {
        setZapQuote(null);
        return;
      }

      // Only fetch quote when user has adjusted one side
      if (lastEdited === "shares" && maxSharesToUse > 0) {
        setIsLoadingZapQuote(true);
        try {
          const res = await authenticatedFetch(
            `/api/lp/${encodeURIComponent(id)}/zap-quote?shares=${maxSharesToUse}`,
          );
          if (res.ok) {
            const data = await res.json();
            setZapQuote(data);
          }
        } catch (e) {
          console.error("Failed to fetch zap quote:", e);
        } finally {
          setIsLoadingZapQuote(false);
        }
      } else if (lastEdited === "sb" && maxPlayMoneyToUse > 0) {
        setIsLoadingZapQuote(true);
        try {
          const res = await authenticatedFetch(
            `/api/lp/${encodeURIComponent(id)}/zap-quote?sb=${maxPlayMoneyToUse}`,
          );
          if (res.ok) {
            const data = await res.json();
            setZapQuote(data);
          }
        } catch (e) {
          console.error("Failed to fetch zap quote:", e);
        } finally {
          setIsLoadingZapQuote(false);
        }
      } else {
        setZapQuote(null);
      }
    };

    const timer = setTimeout(fetchZapQuote, 300);
    return () => clearTimeout(timer);
  }, [addLiquidityMode, lastEdited, maxSharesToUse, maxPlayMoneyToUse, id, isPoolInitialized]);

  const addLiquidityOptimalMutation = useMutation({
    mutationFn: async () => {
      if (maxSharesToUse <= 0 || maxPlayMoneyToUse <= 0)
        throw new Error("Select shares and SB to use");
      const res = await apiRequest("POST", `/api/lp/${encodeURIComponent(id)}/add-optimal`, {
        maxShares: maxSharesToUse,
        maxPlayMoney: maxPlayMoneyToUse,
      });
      return res.json();
    },
    onSuccess: async (result: any) => {
      toast({
        title: "Liquidity Added",
        description: `Used ${Number(result.sharesDeposited || 0).toFixed(4)} shares + $${Number(result.playMoneyDeposited || 0).toFixed(2)}`,
      });
      setAddLiquidityOpen(false);
      setMaxSharesToUse(0);
      setMaxPlayMoneyToUse(0);
      setLinkAmounts(false);
      setLastEdited(null);

      invalidatePortfolioQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/amm", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/lp", id, "position"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lp/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
    },
    onError: (error: Error) => {
      toast({ title: "Add Liquidity Failed", description: error.message, variant: "destructive" });
    },
  });

  const removeLiquidityMutation = useMutation({
    mutationFn: async () => {
      if (!lpPosition || lpPosition.lpShares <= 0) throw new Error("No LP position to remove");
      const pct = Math.max(0, Math.min(100, removePercent));
      const lpSharesToRemove = (lpPosition.lpShares * pct) / 100;
      if (lpSharesToRemove <= 0) throw new Error("Select an amount to remove");
      const res = await apiRequest("POST", `/api/lp/${encodeURIComponent(id)}/remove`, {
        lpShares: lpSharesToRemove,
      });
      return res.json();
    },
    onSuccess: async (result: any) => {
      toast({
        title: "Liquidity Removed",
        description: `Received ${Number(result.sharesReceived || 0).toFixed(2)} shares + $${Number(result.playMoneyReceived || 0).toFixed(2)}`,
      });
      setRemoveLiquidityOpen(false);
      invalidatePortfolioQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/amm", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/lp", id, "position"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lp/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
    },
    onError: (error: Error) => {
      toast({
        title: "Remove Liquidity Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Zap mutations for single-sided liquidity
  const zapAddSharesMutation = useMutation({
    mutationFn: async (sharesIn: number) => {
      if (sharesIn <= 0) throw new Error("Select shares to deposit");
      const res = await apiRequest("POST", `/api/lp/${encodeURIComponent(id)}/zap-add`, {
        shares: sharesIn,
      });
      return res.json();
    },
    onSuccess: async (result: any) => {
      toast({
        title: "Liquidity Added",
        description: `Deposited ${Number(result.sharesDeposited || 0).toFixed(4)} shares. ${Number(result.sharesSold || 0).toFixed(4)} shares auto-sold for $${Number(result.sbReceived || 0).toFixed(2)} to balance.`,
      });
      setAddLiquidityOpen(false);
      setMaxSharesToUse(0);
      setMaxPlayMoneyToUse(0);
      setZapQuote(null);
      setLinkAmounts(false);
      setLastEdited(null);

      invalidatePortfolioQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/amm", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/lp", id, "position"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lp/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
    },
    onError: (error: Error) => {
      toast({ title: "Add Liquidity Failed", description: error.message, variant: "destructive" });
    },
  });

  const zapAddSbMutation = useMutation({
    mutationFn: async (sbIn: number) => {
      if (sbIn <= 0) throw new Error("Select SB to deposit");
      const res = await apiRequest("POST", `/api/lp/${encodeURIComponent(id)}/zap-add`, {
        sb: sbIn,
      });
      return res.json();
    },
    onSuccess: async (result: any) => {
      toast({
        title: "Liquidity Added",
        description: `Deposited $${Number(result.sbIn || 0).toFixed(2)} SB. $${Number(result.totalSwapCost || 0).toFixed(2)} auto-swapped for ${Number(result.sharesBought || 0).toFixed(4)} shares to balance.`,
      });
      setAddLiquidityOpen(false);
      setMaxSharesToUse(0);
      setMaxPlayMoneyToUse(0);
      setZapQuote(null);
      setLinkAmounts(false);
      setLastEdited(null);

      invalidatePortfolioQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/amm", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/lp", id, "position"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lp/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
    },
    onError: (error: Error) => {
      toast({ title: "Add Liquidity Failed", description: error.message, variant: "destructive" });
    },
  });

  // WebSocket subscriptions for real-time updates
  useEffect(() => {
    if (!id) return;

    const unsubTrade = subscribe("trade", (data) => {
      if (data.playerId === id) {
        queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
        queryClient.invalidateQueries({ queryKey: ["/api/amm", id] });
      }
    });

    const unsubPortfolio = subscribe("portfolio", (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
    });

    return () => {
      unsubTrade();
      unsubPortfolio();
    };
  }, [id, timeRange, subscribe]);

  const handleTradeSuccess = () => {
    setCelebrationKey((prev) => prev + 1);
    invalidatePortfolioQueries();
    queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
    queryClient.invalidateQueries({ queryKey: ["/api/amm", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/lp", id, "position"] });

    toast({
      title: "Trade Successful!",
      description: "Your transaction has been completed.",
    });
  };

  const handleRetryPlayerLoad = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/player", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
    queryClient.invalidateQueries({ queryKey: ["/api/amm", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/lp", id, "position"] });
  };

  // Calculate Y-axis domain with 5% padding for better chart visualization.
  const chartDomain = useMemo(() => {
    const priceHistory = data?.priceHistory ?? [];
    if (priceHistory.length === 0) return undefined;
    const prices = priceHistory.map((p) =>
      typeof p.price === "string" ? parseFloat(p.price) : p.price,
    );
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (minPrice === maxPrice) {
      const value = minPrice || 1;
      return [Math.max(0, value * 0.9), value * 1.1];
    }
    const range = maxPrice - minPrice;
    const padding = range * 0.05;
    return [Math.max(0, minPrice - padding), maxPrice + padding];
  }, [data?.priceHistory]);

  if (!authLoading && !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-bold mb-2">Sign In Required</h2>
            <p className="text-muted-foreground mb-4">Please sign in to view player pages.</p>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" onClick={handleRetryPlayerLoad}>
                Refresh
              </Button>
              <Button onClick={() => setLocation("/")}>Back</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    const status = (playerError as any)?.status ?? null;
    const message = playerError instanceof Error ? playerError.message : "Failed to load player";

    const title =
      status === 401
        ? "Sign In Required"
        : status === 404
          ? "Player Not Found"
          : "Unable to Load Player";

    const description =
      status === 401
        ? "Your session expired or you are not signed in. Please refresh or sign in again."
        : status === 404
          ? "The player you're looking for doesn't exist or has been removed."
          : message;

    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-bold mb-2">{title}</h2>
            <p className="text-muted-foreground mb-4">{description}</p>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" onClick={handleRetryPlayerLoad}>
                Refresh
              </Button>
              {status === 401 ? (
                <Button asChild>
                  <Link href={`/login?redirect=${encodeURIComponent(`/player/${id}`)}`}>
                    Sign In
                  </Link>
                </Button>
              ) : (
                <Button onClick={() => setLocation("/")}>Back</Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (authLoading || isLoading || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading player...</div>
      </div>
    );
  }

  const { player, priceHistory, recentTrades } = data;
  const playerName = `${player.firstName} ${player.lastName}`;

  // AMM-first display price: prefer live pool spot price over cached player.lastTradePrice
  const effectiveCurrentPrice =
    poolData?.currentPrice ?? (player.lastTradePrice ? parseFloat(player.lastTradePrice) : null);

  // Only show change when we have at least two AMM chart points in range
  const displayedPriceChange =
    priceHistory.length >= 2 && effectiveCurrentPrice !== null
      ? effectiveCurrentPrice -
        (typeof priceHistory[0].price === "string"
          ? parseFloat(priceHistory[0].price)
          : priceHistory[0].price)
      : null;

  return (
    <div className="terminal-page p-2 sm:p-3 lg:p-4">
      {celebrationKey > 0 && (
        <>
          <Confetti
            key={`confetti-${celebrationKey}`}
            active={true}
            type="coins"
            particleCount={30}
            duration={2000}
          />
          <CelebrationBurst key={`burst-${celebrationKey}`} active={true} />
        </>
      )}
      <SchemaOrg
        schema={schemas.createPlayer({
          name: playerName,
          team: player.team,
          position: player.position,
          id: player.id,
        })}
      />
      <div className="max-w-7xl mx-auto">
        {/* Player Header */}
        <div className="mb-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="terminal-avatar h-10 w-10 flex-shrink-0 sm:h-12 sm:w-12">
                <span className="text-sm sm:text-base font-bold">
                  {player.firstName[0]}
                  {player.lastName[0]}
                </span>
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold inline-flex items-center gap-1.5">
                  {player.firstName} {player.lastName}
                  {getInjury(player.id) && (
                    <InjuryIndicator injury={getInjury(player.id)!} size="md" />
                  )}
                </h1>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge className="text-xs">{player.team}</Badge>
                  <Badge variant="outline" className="text-xs">
                    {player.position}
                  </Badge>
                  {player.jerseyNumber && (
                    <span className="text-xs text-muted-foreground">#{player.jerseyNumber}</span>
                  )}
                  <Button
                    variant="terminalOutline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setStatsModalOpen(true)}
                    data-testid="button-view-stats"
                  >
                    <BarChart2 className="w-3 h-3 mr-1" />
                    Stats
                  </Button>
                </div>
              </div>
            </div>
            <div className="text-left sm:text-right flex items-center sm:block gap-2">
              <div className="font-mono font-bold" data-testid="text-current-price">
                {effectiveCurrentPrice !== null ? (
                  <AnimatedPrice
                    value={effectiveCurrentPrice}
                    size="sm"
                    className="text-lg sm:text-xl justify-start sm:justify-end"
                  />
                ) : (
                  <span className="text-muted-foreground text-sm">No market value</span>
                )}
              </div>
              {displayedPriceChange !== null && (
                <div
                  className={`flex items-center gap-0.5 ${displayedPriceChange >= 0 ? "text-positive" : "text-negative"}`}
                >
                  {displayedPriceChange >= 0 ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  <span className="text-xs font-mono">
                    {displayedPriceChange >= 0 ? "+" : ""}
                    {displayedPriceChange.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Left Column - Chart & Stats */}
          <div className="lg:col-span-2 space-y-3">
            {/* Price Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">
                    Price History
                  </CardTitle>
                  <div className="flex gap-1">
                    {(["1D", "1W", "1M", "1Y"] as TimeRange[]).map((range) => (
                      <Button
                        key={range}
                        variant={timeRange === range ? "default" : "outline"}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setTimeRange(range)}
                      >
                        {range}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[250px] sm:h-[300px]">
                  {priceHistory.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center px-4">
                      <div>
                        <div className="text-sm text-muted-foreground">No AMM trades yet</div>
                        {effectiveCurrentPrice !== null && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Current spot: ${effectiveCurrentPrice.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={priceHistory}>
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(value) => new Date(value).toLocaleDateString()}
                          stroke="currentColor"
                          fontSize={10}
                        />
                        <YAxis
                          stroke="currentColor"
                          fontSize={10}
                          tickFormatter={(value) => `$${value}`}
                          domain={chartDomain}
                        />
                        <RechartsTooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-background border rounded-compact p-2 shadow-lg">
                                  <div className="font-mono font-bold">
                                    $
                                    {typeof payload[0].value === "number"
                                      ? payload[0].value.toFixed(2)
                                      : typeof payload[0].value === "string"
                                        ? parseFloat(payload[0].value).toFixed(2)
                                        : "0.00"}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {new Date(payload[0].payload.timestamp).toLocaleString()}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="price"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* AMM Pool Info & Recent Trades */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* AMM Pool Stats */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Droplets className="w-4 h-4 text-category-liquidity" />
                    <CardTitle className="text-sm font-medium uppercase tracking-wide">
                      AMM Pool
                    </CardTitle>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="w-3 h-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs text-xs">1% fee to LPs, 1% burned.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </CardHeader>
                <CardContent className="p-3 space-y-3">
                  {isPoolLoading ? (
                    <div className="text-center text-muted-foreground py-4">
                      <div className="animate-pulse">Loading pool data...</div>
                    </div>
                  ) : poolError ? (
                    <div className="text-center py-4">
                      <div className="text-destructive text-sm mb-2">Failed to load pool data</div>
                      <div className="text-xs text-muted-foreground mb-3 px-4">
                        {poolError instanceof Error ? poolError.message : "Unknown error"}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          queryClient.invalidateQueries({ queryKey: ["/api/amm", id] })
                        }
                      >
                        Retry
                      </Button>
                    </div>
                  ) : poolData ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 bg-muted/50 rounded-compact">
                          <div className="text-[10px] text-muted-foreground uppercase">
                            Pool Shares
                          </div>
                          <div className="font-mono font-bold text-sm">
                            {poolData.shares.toLocaleString()}
                          </div>
                        </div>
                        <div className="p-2 bg-muted/50 rounded-compact">
                          <div className="text-[10px] text-muted-foreground uppercase">
                            Pool TVL
                          </div>
                          <div className="font-mono font-bold text-sm">
                            {formatAdaptiveCurrency(
                              poolData.playMoney + poolData.shares * poolData.currentPrice,
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="p-2 bg-muted/50 rounded-compact">
                        <div className="text-[10px] text-muted-foreground uppercase">
                          Total Volume
                        </div>
                        <div className="font-mono font-bold">
                          {formatAdaptiveCurrency(poolData.totalVolume)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {poolData.totalTrades.toLocaleString()} trades
                        </div>
                      </div>

                      {!isPoolInitialized && (
                        <div className="rounded-compact border bg-status-warning/10 border-status-warning/30 p-2 text-xs text-status-warning">
                          Pool uninitialized. First two-sided LP add sets the starting market price.
                        </div>
                      )}

                      {lpPosition && lpPosition.lpShares > 0 && (
                        <div className="rounded-compact border border-category-liquidity/20 bg-category-liquidity/10 p-2">
                          <div className="text-[10px] font-semibold uppercase text-category-liquidity">
                            Your LP Position
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-sm">Ownership</span>
                            <span className="font-mono font-bold">
                              {(lpPosition.ownershipPercentage * 100).toFixed(2)}%
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Value</span>
                            <span className="font-mono">
                              ${lpPosition.positionValue.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Fees earned</span>
                            <span className="font-mono">
                              ${lpPosition.feesEarnedToDate.toFixed(2)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {Math.round(lpPosition.equivalentShares)} shares in pool
                          </div>
                        </div>
                      )}

                      <div
                        className={
                          lpPosition && lpPosition.lpShares > 0
                            ? "grid grid-cols-2 gap-2"
                            : "grid grid-cols-1 gap-2"
                        }
                      >
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            setAddLiquidityOpen(true);
                            setAddLiquidityMode(isPoolInitialized ? "auto-detect" : "dual-max");
                            setMaxSharesToUse(0);
                            setMaxPlayMoneyToUse(0);
                            setLinkAmounts(false);
                            setLastEdited(null);
                            setZapQuote(null);
                          }}
                        >
                          Add Liquidity
                        </Button>
                        {lpPosition && lpPosition.lpShares > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => {
                              setRemovePercent(50);
                              setRemoveLiquidityOpen(true);
                            }}
                          >
                            Remove Liquidity
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-muted-foreground py-4">
                      No pool data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Trades */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">
                    Recent Trades
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {recentTrades.slice(0, 8).map((trade) => (
                      <div key={trade.id} className="p-2 flex justify-between items-center text-xs">
                        <div>
                          <span className="font-mono font-medium">${trade.price}</span>
                          <span className="text-muted-foreground ml-2">{trade.quantity} sh</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(trade.executedAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Right Column - Trading Panel */}
          <div id="trade-panel" className="space-y-3">
            {player.sport === "MLB" && (
              <MlbPlayerContextPanel context={mlbContext} isLoading={isMlbContextLoading} />
            )}
            <AmmTradePanel
              playerId={id}
              playerName={playerName}
              currentPrice={effectiveCurrentPrice}
              userBalance={parseFloat(data.userBalance || "0")}
              userShares={data.userHolding?.quantity || 0}
              onTradeSuccess={handleTradeSuccess}
              initialTradeType={initialTradeType}
            />
          </div>
        </div>
      </div>

      <Dialog open={addLiquidityOpen} onOpenChange={setAddLiquidityOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-add-liquidity">
          <DialogHeader>
            <DialogTitle>Add Liquidity</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Mode Selector */}
            {isPoolInitialized ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={addLiquidityMode === "auto-detect" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => {
                    setAddLiquidityMode("auto-detect");
                    setMaxSharesToUse(0);
                    setMaxPlayMoneyToUse(0);
                    setLastEdited(null);
                    setZapQuote(null);
                    setLinkAmounts(false);
                  }}
                >
                  Auto-Detect
                </Button>
                <Button
                  type="button"
                  variant={addLiquidityMode === "dual-max" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => {
                    setAddLiquidityMode("dual-max");
                    setMaxSharesToUse(0);
                    setMaxPlayMoneyToUse(0);
                    setLastEdited(null);
                    setZapQuote(null);
                    setLinkAmounts(false);
                  }}
                >
                  Dual Max
                </Button>
                <Button
                  type="button"
                  variant={addLiquidityMode === "fixed-ratio" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => {
                    setAddLiquidityMode("fixed-ratio");
                    setMaxSharesToUse(0);
                    setMaxPlayMoneyToUse(0);
                    setLastEdited(null);
                    setZapQuote(null);
                    setLinkAmounts(true);
                  }}
                >
                  Fixed Ratio
                </Button>
              </div>
            ) : (
              <div className="rounded-control border bg-muted/30 p-3 text-xs text-muted-foreground">
                Set opening shares and SB to initialize this pool. Your first deposit sets the
                starting market price.
              </div>
            )}

            {/* Mode Description */}
            {isPoolInitialized && (
              <div className="text-xs text-muted-foreground">
                {addLiquidityMode === "auto-detect" && (
                  <>Drag one slider. We auto-trade to balance your deposit. Simplest option.</>
                )}
                {addLiquidityMode === "dual-max" && (
                  <>Use max of both assets. We'll balance at execution time.</>
                )}
                {addLiquidityMode === "fixed-ratio" && (
                  <>Both sliders linked. Deposit must match current pool price exactly.</>
                )}
              </div>
            )}

            <div className="rounded-control border bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current price</span>
                <span className="font-mono">
                  {currentPoolPrice != null ? `$${currentPoolPrice.toFixed(2)}` : "Uninitialized"}
                  {currentPoolPrice != null ? " / share" : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Your balance</span>
                <span className="font-mono">
                  {userSharesBalance.toFixed(4)} shares, ${userPlayMoneyBalance.toFixed(2)} SB
                </span>
              </div>
            </div>

            {/* Shares Slider with Max */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>
                  {!isPoolInitialized
                    ? "Shares to deposit"
                    : addLiquidityMode === "auto-detect" && lastEdited === "sb"
                      ? "Shares to buy"
                      : addLiquidityMode === "auto-detect" && lastEdited === "shares"
                        ? "Shares to deposit"
                        : "Max shares to use"}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">{maxSharesToUse.toFixed(4)}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      setMaxSharesToUse(userSharesBalance);
                      setLastEdited("shares");
                    }}
                    disabled={userSharesBalance <= 0}
                  >
                    Max
                  </Button>
                </div>
              </div>
              <Slider
                value={[maxSharesToUse]}
                min={0}
                max={Math.max(0, userSharesBalance)}
                step={0.01}
                onValueChange={(v) => {
                  const next = v[0] ?? 0;
                  setMaxSharesToUse(next);
                  setLastEdited("shares");
                }}
              />
            </div>

            {/* SB Slider with Max */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>
                  {!isPoolInitialized
                    ? "SB to deposit"
                    : addLiquidityMode === "auto-detect" && lastEdited === "shares"
                      ? "SB from sale"
                      : addLiquidityMode === "auto-detect" && lastEdited === "sb"
                        ? "SB to deposit"
                        : "Max SB to use"}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">${maxPlayMoneyToUse.toFixed(2)}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      setMaxPlayMoneyToUse(userPlayMoneyBalance);
                      setLastEdited("sb");
                    }}
                    disabled={userPlayMoneyBalance <= 0}
                  >
                    Max
                  </Button>
                </div>
              </div>
              <Slider
                value={[maxPlayMoneyToUse]}
                min={0}
                max={Math.max(0, userPlayMoneyBalance)}
                step={1}
                onValueChange={(v) => {
                  const next = v[0] ?? 0;
                  setMaxPlayMoneyToUse(next);
                  setLastEdited("sb");
                }}
              />
            </div>

            {/* Auto-Detect Zap Quote Display */}
            {addLiquidityMode === "auto-detect" && zapQuote && (
              <div className="rounded-control border bg-accent/10 p-3 text-xs space-y-1">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-2">
                  Auto-Trade Preview
                </div>
                {zapQuote.side === "shares" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Shares to sell</span>
                      <span className="font-mono">{zapQuote.sharesSold?.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SB from sale</span>
                      <span className="font-mono">${zapQuote.sbReceived?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Shares to deposit</span>
                      <span className="font-mono">{zapQuote.sharesDeposited.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SB to deposit</span>
                      <span className="font-mono">${zapQuote.playMoneyDeposited.toFixed(2)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SB to swap</span>
                      <span className="font-mono">${zapQuote.totalSwapCost?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Shares from swap</span>
                      <span className="font-mono">{zapQuote.sharesBought?.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Shares to deposit</span>
                      <span className="font-mono">{zapQuote.sharesDeposited.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SB to deposit</span>
                      <span className="font-mono">${zapQuote.playMoneyDeposited.toFixed(2)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between pt-1 border-t border-dashed">
                  <span className="text-muted-foreground">Est. LP shares</span>
                  <span className="font-mono">{zapQuote.estimatedLpSharesMinted.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. ownership</span>
                  <span className="font-mono">
                    {(zapQuote.estimatedOwnershipPercentage * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            {/* Dual Max / Fixed Ratio Estimates */}
            {(addLiquidityMode === "dual-max" || addLiquidityMode === "fixed-ratio") && (
              <div className="rounded-control border bg-muted/30 p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. deposit</span>
                  <span className="font-mono">
                    {estimatedSharesDeposited.toFixed(4)} shares + $
                    {estimatedPlayMoneyDeposited.toFixed(2)}
                  </span>
                </div>
                {addLiquidityMode === "dual-max" && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Est. unused</span>
                      <span className="font-mono">
                        {estimatedSharesUnused.toFixed(4)} shares + $
                        {estimatedPlayMoneyUnused.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Est. total value</span>
                      <span className="font-mono">${estimatedTotalValue.toFixed(2)}</span>
                    </div>
                  </>
                )}
                {addLiquidityMode === "fixed-ratio" && linkAmounts && isLinkingConstrained && (
                  <div className="text-xs text-status-warning">
                    Limited by your {lastEdited === "shares" ? "SB balance" : "shares"}. Deposit
                    will be reduced.
                  </div>
                )}
              </div>
            )}

            {/* Execute Button */}
            {addLiquidityMode === "auto-detect" && (
              <Button
                className="w-full"
                onClick={() => {
                  if (zapQuote?.side === "shares" && maxSharesToUse > 0) {
                    zapAddSharesMutation.mutate(maxSharesToUse);
                  } else if (zapQuote?.side === "sb" && maxPlayMoneyToUse > 0) {
                    zapAddSbMutation.mutate(maxPlayMoneyToUse);
                  }
                }}
                disabled={
                  !isPoolInitialized ||
                  zapAddSharesMutation.isPending ||
                  zapAddSbMutation.isPending ||
                  !zapQuote ||
                  (lastEdited === "shares" && maxSharesToUse <= 0) ||
                  (lastEdited === "sb" && maxPlayMoneyToUse <= 0)
                }
              >
                {zapAddSharesMutation.isPending || zapAddSbMutation.isPending
                  ? "Adding..."
                  : "Add Liquidity"}
              </Button>
            )}

            {addLiquidityMode === "dual-max" && (
              <Button
                className="w-full"
                onClick={() => addLiquidityOptimalMutation.mutate()}
                disabled={
                  addLiquidityOptimalMutation.isPending ||
                  estimatedSharesDeposited <= 0 ||
                  estimatedPlayMoneyDeposited <= 0
                }
              >
                {addLiquidityOptimalMutation.isPending
                  ? "Adding..."
                  : isPoolInitialized
                    ? "Add Liquidity"
                    : "Initialize Pool"}
              </Button>
            )}

            {addLiquidityMode === "fixed-ratio" && (
              <Button
                className="w-full"
                onClick={() => {
                  // For fixed ratio, we use the add-optimal endpoint but ensure strict ratio
                  if (estimatedSharesDeposited > 0 && estimatedPlayMoneyDeposited > 0) {
                    addLiquidityOptimalMutation.mutate();
                  }
                }}
                disabled={
                  addLiquidityOptimalMutation.isPending ||
                  estimatedSharesDeposited <= 0 ||
                  estimatedPlayMoneyDeposited <= 0 ||
                  isLinkingConstrained
                }
              >
                {addLiquidityOptimalMutation.isPending ? "Adding..." : "Add Liquidity"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={removeLiquidityOpen} onOpenChange={setRemoveLiquidityOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-remove-liquidity">
          <DialogHeader>
            <DialogTitle>Remove Liquidity</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              Estimated returns may adjust slightly at execution.
            </div>

            <div className="rounded-control border bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Your ownership</span>
                <span className="font-mono">
                  {lpPosition ? `${(lpPosition.ownershipPercentage * 100).toFixed(2)}%` : "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fees earned</span>
                <span className="font-mono">
                  ${lpPosition ? lpPosition.feesEarnedToDate.toFixed(2) : "0.00"}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Remove percent</span>
                <span className="font-mono">{removePercent}%</span>
              </div>
              <Slider
                value={[removePercent]}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => setRemovePercent(v[0] ?? 0)}
              />
            </div>

            <div className="rounded-control border bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. shares</span>
                <span className="font-mono">
                  {lpPosition
                    ? (lpPosition.equivalentShares * (removePercent / 100)).toFixed(2)
                    : "0.00"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. SB</span>
                <span className="font-mono">
                  $
                  {lpPosition
                    ? (lpPosition.equivalentPlayMoney * (removePercent / 100)).toFixed(2)
                    : "0.00"}
                </span>
              </div>
            </div>

            <Button
              className="w-full"
              variant="outline"
              onClick={() => removeLiquidityMutation.mutate()}
              disabled={
                removeLiquidityMutation.isPending ||
                !lpPosition ||
                lpPosition.lpShares <= 0 ||
                removePercent <= 0
              }
            >
              {removeLiquidityMutation.isPending ? "Removing..." : "Remove Liquidity"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Player Stats Modal */}
      <PlayerModal playerId={id} open={statsModalOpen} onOpenChange={setStatsModalOpen} />

      {/* Sticky action bar — mobile/tablet only (hidden on lg+ where trade panel is in-view) */}
      {isAuthenticated && (
        <div
          className="lg:hidden fixed bottom-16 sm:bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur px-3 py-2"
          data-testid="sticky-action-bar"
        >
          <div className="flex items-center gap-2 max-w-7xl mx-auto">
            <Button
              className="flex-1 h-9 text-xs"
              size="sm"
              onClick={() =>
                document.getElementById("trade-panel")?.scrollIntoView({ behavior: "smooth" })
              }
              data-testid="button-sticky-trade"
            >
              <ShoppingCart className="w-3.5 h-3.5 mr-1" />
              Trade
            </Button>
            <Button
              variant="terminalOutline"
              size="sm"
              className="h-9 text-xs px-3"
              asChild
              data-testid="button-sticky-boost"
            >
              <Link href={`/boosts?preselect=${id}`}>
                <Zap className="w-3.5 h-3.5 mr-1" />
                Boost
              </Link>
            </Button>
            <Button
              variant="terminalOutline"
              size="sm"
              className={`h-9 px-3 ${isWatchlisted ? "text-market-negative" : ""}`}
              onClick={() => toggleWatchlistMutation.mutate(isWatchlisted)}
              disabled={toggleWatchlistMutation.isPending}
              aria-label={isWatchlisted ? "Remove from watchlist" : "Add to watchlist"}
              data-testid="button-sticky-watchlist"
            >
              <Heart className={`w-3.5 h-3.5 ${isWatchlisted ? "fill-current" : ""}`} />
            </Button>
            <Button
              variant="terminalOutline"
              size="sm"
              className="h-9 text-xs px-3"
              asChild
              data-testid="button-sticky-scout"
            >
              <Link href="/scout">Scout</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "wouter";
import { useWebSocket } from "@/lib/websocket";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, BarChart2, Droplets, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { invalidatePortfolioQueries } from "@/lib/cache-invalidation";
import type { Player, Trade, PriceHistory } from "@shared/schema";
import { SchemaOrg, schemas } from "@/components/schema-org";
import { AnimatedPrice } from "@/components/ui/animated-price";
import { Confetti, CelebrationBurst } from "@/components/ui/confetti";
import { PlayerModal } from "@/components/player-modal";
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
}

type TimeRange = "1D" | "1W" | "1M" | "1Y";

export default function PlayerPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = new URLSearchParams(useSearch());
  const initialTradeType = searchParams.get("tab") === "buy" ? "buy" : undefined;
  const { toast } = useToast();
  const { subscribe } = useWebSocket();
  const { isAuthenticated, isLoading: authLoading, session } = useAuth();
  const [timeRange, setTimeRange] = useState<TimeRange>("1D");
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [statsModalOpen, setStatsModalOpen] = useState(false);

  // Fetch player data
  const { data, isLoading, isError } = useQuery<PlayerPageData>({
    queryKey: ["/api/player", id, timeRange],
    queryFn: async () => {
      const headers: HeadersInit = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/player/${id}?range=${timeRange}`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch player data");
      return res.json();
    },
    enabled: !!id && !authLoading,
  });

  // Fetch AMM pool data with proper error handling
  const { data: poolData, isLoading: isPoolLoading, error: poolError } = useQuery<AmmPoolData>({
    queryKey: ["/api/amm", id],
    queryFn: async () => {
      const res = await fetch(`/api/amm/${id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch pool data: ${res.status} ${errorText}`);
      }
      return res.json();
    },
    enabled: !!id,
    refetchInterval: 5000,
    refetchIntervalInBackground: false, // Don't poll when tab is inactive
    retry: 3,
    retryDelay: 1000,
  });

  // Fetch user's LP position
  const { data: lpPosition } = useQuery<UserLpPosition>({
    queryKey: ["/api/lp", id, "position"],
    queryFn: async () => {
      const headers: HeadersInit = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/lp/${id}/position`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch LP position");
      const data = await res.json();
      return data.position;
    },
    enabled: !!id && isAuthenticated,
  });

  // WebSocket subscriptions for real-time updates
  useEffect(() => {
    if (!id) return;

    const unsubTrade = subscribe('trade', (data) => {
      if (data.playerId === id) {
        queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
        queryClient.invalidateQueries({ queryKey: ["/api/amm", id] });
      }
    });

    const unsubPortfolio = subscribe('portfolio', (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
    });

    return () => {
      unsubTrade();
      unsubPortfolio();
    };
  }, [id, timeRange, subscribe]);

  const handleTradeSuccess = () => {
    setCelebrationKey(prev => prev + 1);
    invalidatePortfolioQueries();
    queryClient.invalidateQueries({ queryKey: ["/api/player", id, timeRange] });
    queryClient.invalidateQueries({ queryKey: ["/api/amm", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/lp", id, "position"] });
    
    toast({
      title: "Trade Successful!",
      description: "Your transaction has been completed.",
    });
  };

  if (isError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-bold mb-2">Player Not Found</h2>
            <p className="text-muted-foreground mb-4">The player you're looking for doesn't exist or has been removed.</p>
            <Button onClick={() => window.location.href = "/"}>Back to Dashboard</Button>
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
  
  // Calculate Y-axis domain with 5% padding for better chart visualization
  const chartDomain = (() => {
    if (priceHistory.length === 0) return undefined;
    const prices = priceHistory.map(p => typeof p.price === 'string' ? parseFloat(p.price) : p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (minPrice === maxPrice) {
      const value = minPrice || 1;
      return [Math.max(0, value * 0.9), value * 1.1];
    }
    const range = maxPrice - minPrice;
    const padding = range * 0.05;
    return [Math.max(0, minPrice - padding), maxPrice + padding];
  })();

  return (
    <div className="min-h-screen bg-background p-2 sm:p-3 lg:p-4">
      {celebrationKey > 0 && (
        <>
          <Confetti 
            key={`confetti-${celebrationKey}`}
            active={true} 
            type="coins" 
            particleCount={30}
            duration={2000}
          />
          <CelebrationBurst 
            key={`burst-${celebrationKey}`}
            active={true} 
          />
        </>
      )}
      <SchemaOrg schema={schemas.createPlayer({
        name: playerName,
        team: player.team,
        position: player.position,
        id: player.id
      })} />
      <div className="max-w-7xl mx-auto">
        {/* Player Header */}
        <div className="mb-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-sm sm:text-base font-bold">{player.firstName[0]}{player.lastName[0]}</span>
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold">{player.firstName} {player.lastName}</h1>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge className="text-xs">{player.team}</Badge>
                  <Badge variant="outline" className="text-xs">{player.position}</Badge>
                  {player.jerseyNumber && <span className="text-xs text-muted-foreground">#{player.jerseyNumber}</span>}
                  <Button 
                    variant="ghost" 
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
                {player.lastTradePrice ? (
                  <AnimatedPrice 
                    value={parseFloat(player.lastTradePrice)} 
                    size="sm" 
                    className="text-lg sm:text-xl justify-start sm:justify-end"
                  />
                ) : (
                  <span className="text-muted-foreground text-sm">No market value</span>
                )}
              </div>
              {player.lastTradePrice && (
                <div className={`flex items-center gap-0.5 ${parseFloat(player.priceChange24h) >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {parseFloat(player.priceChange24h) >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  <span className="text-xs font-mono">{parseFloat(player.priceChange24h) >= 0 ? '+' : ''}{parseFloat(player.priceChange24h).toFixed(2)}</span>
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
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">Price History</CardTitle>
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
                              <div className="bg-background border rounded p-2 shadow-lg">
                                <div className="font-mono font-bold">
                                  ${typeof payload[0].value === 'number' ? payload[0].value.toFixed(2) : typeof payload[0].value === 'string' ? parseFloat(payload[0].value).toFixed(2) : '0.00'}
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
                </div>
              </CardContent>
            </Card>

            {/* AMM Pool Info & Recent Trades */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* AMM Pool Stats */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Droplets className="w-4 h-4 text-blue-500" />
                    <CardTitle className="text-sm font-medium uppercase tracking-wide">AMM Pool</CardTitle>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="w-3 h-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs text-xs">
                          Constant Product AMM (x × y = k). Trade instantly against the pool. 
                          1% fee benefits LPs, 1% burned.
                        </p>
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
                        onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/amm", id] })}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : poolData ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 bg-muted/50 rounded">
                          <div className="text-[10px] text-muted-foreground uppercase">Pool Shares</div>
                          <div className="font-mono font-bold text-sm">{poolData.shares.toLocaleString()}</div>
                        </div>
                        <div className="p-2 bg-muted/50 rounded">
                          <div className="text-[10px] text-muted-foreground uppercase">Pool Liquidity</div>
                          <div className="font-mono font-bold text-sm">${poolData.playMoney.toLocaleString()}</div>
                        </div>
                      </div>

                      <div className="p-2 bg-muted/50 rounded">
                        <div className="text-[10px] text-muted-foreground uppercase">Total Volume</div>
                        <div className="font-mono font-bold">${poolData.totalVolume.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">{poolData.totalTrades.toLocaleString()} trades</div>
                      </div>

                      {lpPosition && lpPosition.lpShares > 0 && (
                        <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded">
                          <div className="text-[10px] text-blue-600 uppercase font-semibold">Your LP Position</div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-sm">Ownership</span>
                            <span className="font-mono font-bold">{(lpPosition.ownershipPercentage * 100).toFixed(2)}%</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Value</span>
                            <span className="font-mono">${lpPosition.positionValue.toFixed(2)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {Math.round(lpPosition.equivalentShares)} shares in pool
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center text-muted-foreground py-4">No pool data available</div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Trades */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">Recent Trades</CardTitle>
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
          <div className="space-y-3">
            <AmmTradePanel
              playerId={id}
              playerName={playerName}
              currentPrice={player.lastTradePrice ? parseFloat(player.lastTradePrice) : null}
              userBalance={parseFloat(data.userBalance || "0")}
              userShares={data.userHolding?.quantity || 0}
              onTradeSuccess={handleTradeSuccess}
              initialTradeType={initialTradeType}
            />
          </div>
        </div>
      </div>

      {/* Player Stats Modal */}
      <PlayerModal
        playerId={id}
        open={statsModalOpen}
        onOpenChange={setStatsModalOpen}
      />
    </div>
  );
}

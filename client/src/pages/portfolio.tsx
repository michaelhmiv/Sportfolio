import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useWebSocket } from "@/lib/websocket";
import { useNotifications } from "@/lib/notification-context";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TrendingUp, TrendingDown, DollarSign, Crown, Clock, ShoppingCart, Trophy, ArrowUpRight, ArrowDownRight, ArrowUpDown, ChevronUp, ChevronDown, Plus, BarChart3, Zap, ChevronRight, LayoutGrid, List, HelpCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { apiRequest, queryClient, authenticatedFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { invalidatePortfolioQueries } from "@/lib/cache-invalidation";
import type { Holding, Player } from "@shared/schema";
import { PlayerName } from "@/components/player-name";
import { Shimmer, ShimmerCard } from "@/components/ui/animations";
import { AnimatedPrice } from "@/components/ui/animated-price";
import { EmptyState } from "@/components/ui/empty-state";
import { useSport } from "@/lib/sport-context";
import { SportSelector } from "@/components/sport-selector";
import { PortfolioCardView } from "@/components/portfolio-card-view";
import { PlayerModal } from "@/components/player-modal";
import { CardAccent, BackgroundPattern } from "@/components/ui/decorative-elements";

interface PortfolioData {
  balance: string;
  portfolioValue: string;
  totalPnL: string;
  totalPnLPercent: string;
  holdings: (Holding & {
    player?: Player;
    currentValue: string;
    pnl: string;
    pnlPercent: string;
    power?: number;
    powerLevel?: string;
    totalPlayerPower?: string;
    isPowered?: boolean;
  })[];
  premiumShares: number;
  isPremium: boolean;
  premiumExpiresAt?: string;
}

interface UserActivity {
  id: string;
  timestamp: string;
  category: 'scout' | 'market' | 'contest';
  type: string;
  description: string;
  cashDelta?: string;
  shareDelta?: number;
  balanceAfter?: string;
  metadata: {
    playerName?: string;
    playerId?: number;
    contestId?: string;
    contestName?: string;
    tradePrice?: string;
    orderType?: string;
    side?: string;
    quantity?: number;
    shares?: number;
    entryFee?: string;
    payout?: string;
    rank?: number;
    totalEntries?: number;
  };
}

interface ActivityResponse {
  activities: UserActivity[];
  total: number;
  limit: number;
  offset: number;
}

type SortField = 'name' | 'quantity' | 'avgCost' | 'price' | 'bid' | 'ask' | 'value' | 'pnl';
type SortDirection = 'asc' | 'desc';

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'avgCost', label: 'Avg Cost' },
  { value: 'price', label: 'Price' },
  { value: 'bid', label: 'Bid' },
  { value: 'ask', label: 'Ask' },
  { value: 'value', label: 'Value' },
  { value: 'pnl', label: 'P&L' },
];

// Helper function to calculate P&L
function calculatePnL(quantity: number, avgCost: string, lastTradePrice: string | null | undefined) {
  if (!lastTradePrice) {
    return {
      currentValue: null,
      pnl: null,
      pnlPercent: null,
    };
  }

  const cost = parseFloat(avgCost);
  const price = parseFloat(lastTradePrice);
  const totalValue = quantity * price;
  const totalCost = quantity * cost;
  const pnl = totalValue - totalCost;
  const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

  return {
    currentValue: totalValue.toFixed(2),
    pnl: pnl.toFixed(2),
    pnlPercent: pnlPercent.toFixed(2),
  };
}

export default function Portfolio() {
  const { toast } = useToast();
  const { subscribe } = useWebSocket();
  const { unreadCount, clearUnread } = useNotifications();
  const [activeTab, setActiveTab] = useState("holdings");
  const [chartTimeRange, setChartTimeRange] = useState("1M");
  const [sortField, setSortField] = useState<SortField>('value');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const { sport } = useSport();
  
  // View toggle state - persist in localStorage
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('portfolioViewMode') as 'card' | 'list') || 'list';
    }
    return 'list';
  });

  // Condense dialog state
  const [condenseDialogOpen, setCondenseDialogOpen] = useState(false);
  const [selectedPlayerForCondense, setSelectedPlayerForCondense] = useState<{ id: string; name: string } | null>(null);
  const [sharesToCondenseInput, setSharesToCondenseInput] = useState<string>("");

  // Player modal state
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerModalOpen, setPlayerModalOpen] = useState(false);

  // Expanded share table state (per player)
  const [expandedShareSortField, setExpandedShareSortField] = useState<'quantity' | 'power'>('quantity');
  const [expandedShareSortDir, setExpandedShareSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedHoldingIds, setSelectedHoldingIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<PortfolioData>({
    queryKey: ["/api/portfolio"],
  });

  // LP Positions data
  const { data: lpPositions } = useQuery({
    queryKey: ["/api/lp/positions"],
    queryFn: async () => {
      const res = await fetch('/api/lp/positions');
      if (!res.ok) throw new Error('Failed to fetch LP positions');
      return res.json();
    },
  });

  // Premium market data - CRITICAL: Only show real trade data, never fabricated prices
  type PremiumMarketData = {
    lastTradePrice: number | null;
    circulation: number;
    totalTrades: number;
  };

  const { data: premiumMarketData } = useQuery<PremiumMarketData>({
    queryKey: ["/api/premium/market-data"],
  });

  const { data: chartData } = useQuery<{ history: Array<{ date: string; cashBalance: number; portfolioValue: number; netWorth: number }>; timeRange: string }>({
    queryKey: ["/api/user/portfolio-history", chartTimeRange],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/user/portfolio-history?timeRange=${chartTimeRange}`);
      if (!res.ok) throw new Error('Failed to fetch portfolio history');
      return res.json();
    },
  });

  // Clear notifications when viewing Activity tab
  useEffect(() => {
    if (activeTab === "activity") {
      clearUnread();
    }
  }, [activeTab, clearUnread]);

  // WebSocket listener for real-time portfolio updates
  useEffect(() => {
    // Portfolio events will auto-invalidate via WebSocket provider
    // But we can also subscribe for custom logic if needed
    const unsubPortfolio = subscribe('portfolio', () => {
      // Additional portfolio-specific logic could go here
    });

    const unsubTrade = subscribe('trade', () => {
      // Trades affect holdings and orders
    });

    const unsubOrderBook = subscribe('orderBook', () => {
      // Order book changes might affect pending orders
    });

    return () => {
      unsubTrade();
    };
  }, [subscribe]);

  const redeemPremiumMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/premium/redeem", {});
    },
    onSuccess: async () => {
      await invalidatePortfolioQueries();
      toast({ title: "Premium activated!", description: "You now have premium access for 30 days" });
    },
    onError: (error: Error) => {
      toast({ title: "Redemption failed", description: error.message, variant: "destructive" });
    },
  });

  // Condense shares into Power Level (5:1 ratio)
  const condenseSharesMutation = useMutation({
    mutationFn: async ({ playerId, sharesToCondense }: { playerId: string; sharesToCondense: number }) => {
      return await apiRequest("POST", "/api/holdings/condense", { playerId, sharesToCondense });
    },
    onSuccess: async (data: any) => {
      await invalidatePortfolioQueries();
      setCondenseDialogOpen(false);
      setSelectedPlayerForCondense(null);
      setSharesToCondenseInput("");
      toast({
        title: "Shares Powered Up! ⚡",
        description: data.message || `Powered up ${data.sharesCondensed} shares into ${data.powerLevelGained} Power Level`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Power Up failed", description: error.message, variant: "destructive" });
    },
  });

  // Open condense dialog
  const openCondenseDialog = (playerId: string, playerName: string, availableShares: number) => {
    setSelectedPlayerForCondense({ id: playerId, name: playerName });
    // Default to the maximum condensable shares (rounded down to nearest multiple of 5)
    const maxCondensable = Math.floor(availableShares / 5) * 5;
    setSharesToCondenseInput(maxCondensable.toString());
    setCondenseDialogOpen(true);
  };

  // Handle condense from dialog
  const handleCondenseFromDialog = () => {
    if (!selectedPlayerForCondense) return;
    const shares = parseInt(sharesToCondenseInput);
    if (isNaN(shares) || shares < 5 || shares % 5 !== 0) {
      toast({
        title: "Invalid selection",
        description: "Please enter a valid number of shares (minimum 5, must be divisible by 5)",
        variant: "destructive",
      });
      return;
    }
    condenseSharesMutation.mutate({ playerId: selectedPlayerForCondense.id, sharesToCondense: shares });
  };

  // Toggle sort direction or change sort field
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // Name sorts A-Z (asc) by default, numeric fields sort high-to-low (desc)
      setSortDirection(field === 'name' ? 'asc' : 'desc');
    }
  };

  // Toggle holding selection
  const toggleHoldingSelection = (holdingId: string) => {
    setSelectedHoldingIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(holdingId)) {
        newSet.delete(holdingId);
      } else {
        newSet.add(holdingId);
      }
      return newSet;
    });
  };

  // Select all holdings
  const selectAllHoldings = (holdingIds: string[]) => {
    setSelectedHoldingIds(new Set(holdingIds));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedHoldingIds(new Set());
  };

  // Handle view mode change
  const handleViewModeChange = (mode: 'card' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('portfolioViewMode', mode);
  };

  // Handle expanded share table sort
  const handleExpandedShareSort = (field: 'quantity' | 'power') => {
    if (expandedShareSortField === field) {
      setExpandedShareSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setExpandedShareSortField(field);
      setExpandedShareSortDir('desc');
    }
  };

  // Open condense dialog with selected holdings
  const openCondenseFromExpanded = (playerId: string, playerName: string, regularQuantity: number) => {
    clearSelection();
    setSelectedPlayerForCondense({ id: playerId, name: playerName });
    // Default to the maximum condensable shares (rounded down to nearest multiple of 5)
    const maxCondensable = Math.floor(regularQuantity / 5) * 5;
    setSharesToCondenseInput(maxCondensable.toString());
    setCondenseDialogOpen(true);
  };

  // Parse currency string to number (strips $, commas, etc.)
  const parseCurrency = (value: string | null | undefined): number => {
    if (!value) return 0;
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  // Get sort value for a holding
  const getSortValue = (holding: PortfolioData['holdings'][0], field: SortField): number | string => {
    switch (field) {
      case 'name':
        return `${holding.player?.lastName || ''} ${holding.player?.firstName || ''}`.toLowerCase();
      case 'quantity':
        return holding.quantity;
      case 'avgCost':
        return parseCurrency(holding.avgCostBasis);
      case 'price':
        return parseCurrency(holding.player?.lastTradePrice);
      case 'value':
        return parseCurrency(holding.currentValue);
      case 'pnl':
        return parseCurrency(holding.pnl);
      default:
        return 0;
    }
  };

  // Transform holdings: group regular shares and powered shares per player
  // Returns one entry per player with a breakdown array
  interface ShareBreakdown {
    quantity: number;
    power: number;
    powerLevel: string;
    avgCostBasis: string;
    id?: string;
  }

  interface PlayerGroup {
    player: Player;
    regular: ShareBreakdown | null;
    powered: ShareBreakdown[];
    totalShares: number;
    totalPower: string;
    currentValue: string;
    pnl: string;
    pnlPercent: string;
    avgCostBasis: string;
  }

  const playerHoldings: PlayerGroup[] = (() => {
    const playerMap = new Map<string, PlayerGroup>();

    // First pass: group by player
    data?.holdings.filter(h => h.assetType === "player" && h.player).forEach((holding) => {
      const playerId = holding.player!.id;
      const player = holding.player!;

      if (!playerMap.has(playerId)) {
        // Calculate PnL from the first holding for this player
        const { currentValue, pnl, pnlPercent } = calculatePnL(
          parseFloat(holding.quantity),
          holding.avgCostBasis,
          player.lastTradePrice
        );

        playerMap.set(playerId, {
          player,
          regular: null,
          powered: [],
          totalShares: 0,
          totalPower: "0.00",
          currentValue: currentValue || "0.00",
          pnl: pnl || "0.00",
          pnlPercent: pnlPercent || "0.00",
          avgCostBasis: holding.avgCostBasis,
        });
      }

      const group = playerMap.get(playerId)!;

      const shareBreakdown: ShareBreakdown = {
        quantity: parseFloat(holding.quantity),
        power: holding.power || 1,
        powerLevel: holding.powerLevel || parseFloat(holding.quantity).toFixed(2),
        avgCostBasis: holding.avgCostBasis,
        id: holding.id,
      };

      if ((holding.power || 1) === 1) {
        // Regular share - combine quantities and average cost
        if (group.regular) {
          const holdingQty = parseFloat(holding.quantity);
          const totalCost = parseFloat(group.regular.avgCostBasis || "0") * group.regular.quantity +
                            parseFloat(holding.avgCostBasis || "0") * holdingQty;
          const totalQty = group.regular.quantity + holdingQty;
          const newAvgCost = totalQty > 0 ? (totalCost / totalQty).toFixed(4) : "0.0000";
          group.regular = {
            ...group.regular,
            quantity: totalQty,
            avgCostBasis: newAvgCost,
            powerLevel: totalQty.toFixed(2),
          };
        } else {
          group.regular = shareBreakdown;
        }
      } else {
        // Powered share
        group.powered.push(shareBreakdown);
      }

      // Update totals
      group.totalShares = (group.regular?.quantity || 0) + group.powered.reduce((sum, p) => sum + p.quantity, 0);
      const regularPower = group.regular?.quantity || 0;
      const poweredPower = group.powered.reduce((sum, p) => sum + (p.power * p.quantity), 0);
      group.totalPower = (regularPower + poweredPower).toFixed(2);
    });

    return Array.from(playerMap.values());
  })();

  // Sort player holdings and filter by selected sport
  // Include holdings with regular shares OR power level (power level is an attribute of shares)
  const sortedHoldings = playerHoldings
    .filter(h => (h.totalShares > 0 || parseFloat(h.regular?.powerLevel || "0") > 0) && (!sport || sport === 'ALL' || h.player.sport === sport))
    .slice()
    .sort((a, b) => {
      const aName = `${a.player.lastName} ${a.player.firstName}`.toLowerCase();
      const bName = `${b.player.lastName} ${b.player.firstName}`.toLowerCase();

      switch (sortField) {
        case 'name':
          return sortDirection === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName);
        case 'quantity':
          return sortDirection === 'asc' ? a.totalShares - b.totalShares : b.totalShares - a.totalShares;
        case 'avgCost':
          return sortDirection === 'asc'
            ? parseCurrency(a.avgCostBasis) - parseCurrency(b.avgCostBasis)
            : parseCurrency(b.avgCostBasis) - parseCurrency(a.avgCostBasis);
        case 'price':
          return sortDirection === 'asc'
            ? parseCurrency(a.player.lastTradePrice) - parseCurrency(b.player.lastTradePrice)
            : parseCurrency(b.player.lastTradePrice) - parseCurrency(a.player.lastTradePrice);
        case 'value':
          return sortDirection === 'asc'
            ? parseCurrency(a.currentValue) - parseCurrency(b.currentValue)
            : parseCurrency(b.currentValue) - parseCurrency(a.currentValue);
        case 'pnl':
          return sortDirection === 'asc'
            ? parseCurrency(a.pnl) - parseCurrency(b.pnl)
            : parseCurrency(b.pnl) - parseCurrency(a.pnl);
        default:
          return 0;
      }
    });

  // Render sort icon for column header
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    }
    return sortDirection === 'asc'
      ? <ChevronUp className="w-3 h-3 ml-1" />
      : <ChevronDown className="w-3 h-3 ml-1" />;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-3 sm:p-4">
        <div className="max-w-7xl mx-auto">
          <Shimmer height="36px" width="150px" className="mb-6 hidden sm:block" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <ShimmerCard lines={2} />
            <ShimmerCard lines={2} />
            <ShimmerCard lines={2} />
          </div>
          <ShimmerCard lines={6} className="mb-4" />
          <ShimmerCard lines={8} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-3 sm:p-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="hidden sm:block text-xl font-bold">Portfolio</h1>
            <SportSelector />
          </div>

          {/* Portfolio Summary - Mobile: Single row, Desktop: 3 cards */}
          <div className="mb-4 sm:mb-4">
            {/* Mobile Layout - All stats in one row */}
            <Card className="md:hidden">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="text-muted-foreground uppercase tracking-wide mb-0.5">Cash</div>
                    <div className="font-mono font-bold" data-testid="text-cash-balance">${data?.balance}</div>
                  </div>
                  <div className="flex-1 min-w-0 text-center">
                    <div className="text-muted-foreground uppercase tracking-wide mb-0.5">Portfolio</div>
                    <div className="font-mono font-bold" data-testid="text-portfolio-value">${data?.portfolioValue}</div>
                  </div>
                  <div className="flex-1 min-w-0 text-center">
                    <div className="text-muted-foreground uppercase tracking-wide mb-0.5">P&L</div>
                    <div className={`font-mono font-bold ${parseFloat(data?.totalPnL || "0") >= 0 ? 'text-positive' : 'text-negative'}`} data-testid="text-total-pnl">
                      {parseFloat(data?.totalPnL || "0") >= 0 ? '+' : ''}${data?.totalPnL}
                    </div>
                  </div>
                  <Link href="/premium">
                    <div className="flex-1 min-w-0 text-right cursor-pointer hover-elevate rounded-md p-1 -m-1" data-testid="link-premium-mobile">
                      <div className="flex items-center justify-end gap-1 text-muted-foreground uppercase tracking-wide mb-0.5">
                        <Crown className="w-3 h-3 text-yellow-500" />
                        <span>Premium</span>
                        <Plus className="w-3 h-3 text-yellow-500" />
                      </div>
                      <div className="font-mono font-bold text-yellow-500" data-testid="text-premium-shares">
                        {data?.premiumShares || 0}
                      </div>
                    </div>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Desktop Layout - 4 separate cards */}
            <div className="hidden md:grid md:grid-cols-4 gap-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">Cash Balance</CardTitle>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-mono font-bold" data-testid="text-cash-balance-desktop">${data?.balance}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">Portfolio Value</CardTitle>
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-mono font-bold" data-testid="text-portfolio-value-desktop">${data?.portfolioValue}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">Total P&L</CardTitle>
                  {parseFloat(data?.totalPnL || "0") >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-positive" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-negative" />
                  )}
                </CardHeader>
                <CardContent>
                  <div className={`text-lg font-mono font-bold ${parseFloat(data?.totalPnL || "0") >= 0 ? 'text-positive' : 'text-negative'}`} data-testid="text-total-pnl-desktop">
                    {parseFloat(data?.totalPnL || "0") >= 0 ? '+' : ''}${data?.totalPnL}
                  </div>
                  <div className={`text-xs ${parseFloat(data?.totalPnL || "0") >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {parseFloat(data?.totalPnL || "0") >= 0 ? '+' : ''}{data?.totalPnLPercent}%
                  </div>
                </CardContent>
              </Card>

              <Card className={`${data?.isPremium ? "border-yellow-500/50 bg-gradient-to-br from-yellow-500/5 to-amber-500/5" : ""} hover-elevate cursor-pointer`}>
                <Link href="/premium">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium uppercase tracking-wide">Premium Shares</CardTitle>
                    <div className="flex items-center gap-1">
                      <Crown className="w-4 h-4 text-yellow-500" />
                      <Plus className="w-4 h-4 text-yellow-500" data-testid="button-add-premium-desktop" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg font-mono font-bold text-yellow-500" data-testid="text-premium-shares-desktop">
                      {data?.premiumShares || 0}
                    </div>
                    {data?.isPremium && data?.premiumExpiresAt && (
                      <div className="text-xs text-muted-foreground">
                        Expires {formatDistanceToNow(new Date(data.premiumExpiresAt), { addSuffix: true })}
                      </div>
                    )}
                    {(!data?.isPremium && (data?.premiumShares || 0) > 0) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs border-yellow-500/50 text-yellow-600 hover:bg-yellow-500/10"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          redeemPremiumMutation.mutate();
                        }}
                        disabled={redeemPremiumMutation.isPending}
                        data-testid="button-redeem-premium-desktop"
                      >
                        {redeemPremiumMutation.isPending ? "Redeeming..." : "Redeem for 30 days"}
                      </Button>
                    )}
                  </CardContent>
                </Link>
              </Card>
            </div>
          </div>
        </div>

        {/* Portfolio Value Chart */}
        <Card className="mb-4 sm:mb-4 relative overflow-hidden">
          <CardAccent variant="top" color="primary" intensity="medium" />
          <BackgroundPattern variant="grid" color="primary" opacity={0.02} />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium uppercase tracking-wide">Portfolio Value</CardTitle>
            <div className="flex gap-1">
              {["1D", "7D", "1M", "1Y", "ALL"].map((range) => (
                <Button
                  key={range}
                  variant={chartTimeRange === range ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChartTimeRange(range)}
                  className="h-7 px-2 text-xs"
                  data-testid={`button-chart-${range.toLowerCase()}`}
                >
                  {range}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pt-2 relative z-10">
            {chartData && chartData.history.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData.history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                    formatter={(value: any) => [`$${parseFloat(value).toFixed(2)}`, 'Portfolio Value']}
                    labelFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleDateString();
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="portfolioValue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={true}
                    animationDuration={1200}
                    animationEasing="ease-out"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground" data-testid="text-no-chart-data">
                No historical data available yet. Portfolio snapshots are created daily.
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3 sm:space-y-3">
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="holdings" data-testid="tab-holdings">Holdings</TabsTrigger>
              <TabsTrigger value="orders" data-testid="tab-open-orders">Open Orders</TabsTrigger>
              <TabsTrigger
                value="activity"
                data-testid="tab-activity"
                className={unreadCount > 0 ? "relative ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}
              >
                <span className="flex items-center gap-1.5">
                  Activity
                  <AnimatePresence>
                    {unreadCount > 0 && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                      >
                        <Badge
                          variant="default"
                          className="min-w-5 h-5 flex items-center justify-center px-1.5 text-xs font-bold"
                          data-testid="badge-activity-count"
                        >
                          {unreadCount}
                        </Badge>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              {/* View Toggle - Always visible */}
              <div className="flex items-center bg-muted rounded-lg p-1">
                <Button
                  variant={viewMode === 'card' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => handleViewModeChange('card')}
                  data-testid="button-view-card"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => handleViewModeChange('list')}
                  data-testid="button-view-list"
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
              <Link href="/analytics">
                <Button variant="outline" size="sm" className="gap-2 bg-primary/5 border-primary/30 hover:bg-primary/10" data-testid="button-analytics-portfolio">
                  <BarChart3 className="w-4 h-4" />
                  <span className="hidden sm:inline">Analytics</span>
                </Button>
              </Link>
            </div>
          </div>

          {/* Holdings */}
          <TabsContent value="holdings">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium uppercase tracking-wide">Your Holdings</CardTitle>
                {/* Mobile sort dropdown */}
                <div className="sm:hidden flex items-center gap-2">
                  <Select value={sortField} onValueChange={(val) => setSortField(val as SortField)}>
                    <SelectTrigger className="h-8 text-xs w-[100px]" data-testid="select-mobile-sort-field">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      {SORT_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                    data-testid="button-mobile-sort-direction"
                  >
                    {sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!data?.premiumShares && sortedHoldings.length === 0 ? (
                  <EmptyState
                    icon="wallet"
                    title="Your portfolio is empty"
                    description="Start trading to build your portfolio. Browse the marketplace to find players to invest in."
                    action={{ label: "Browse Marketplace", onClick: () => window.location.href = "/marketplace" }}
                    size="sm"
                    className="py-8"
                    data-testid="empty-holdings"
                  />
                ) : viewMode === 'card' ? (
                  <PortfolioCardView
                    holdings={sortedHoldings}
                    lpPositions={lpPositions}
                    onPowerUp={openCondenseDialog}
                    onSelectPlayer={(playerId) => {
                      setSelectedPlayerId(playerId);
                      setPlayerModalOpen(true);
                    }}
                    sortField={sortField}
                  />
                ) : (
                  <div>
                    <table className="w-full">
                      <thead className="border-b bg-muted/50 hidden sm:table-header-group">
                        <tr>
                          <th
                            className="text-left px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort('name')}
                            data-testid="th-sort-name"
                          >
                            <span className="flex items-center">Asset<SortIcon field="name" /></span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort('quantity')}
                            data-testid="th-sort-quantity"
                          >
                            <span className="flex items-center justify-end">Qty<SortIcon field="quantity" /></span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort('avgCost')}
                            data-testid="th-sort-avgcost"
                          >
                            <span className="flex items-center justify-end">Avg<SortIcon field="avgCost" /></span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden md:table-cell cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort('price')}
                            data-testid="th-sort-price"
                          >
                            <span className="flex items-center justify-end">Price<SortIcon field="price" /></span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort('bid')}
                            data-testid="th-sort-bid"
                          >
                            <span className="flex items-center justify-end">Bid<SortIcon field="bid" /></span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort('ask')}
                            data-testid="th-sort-ask"
                          >
                            <span className="flex items-center justify-end">Ask<SortIcon field="ask" /></span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden xl:table-cell cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort('value')}
                            data-testid="th-sort-value"
                          >
                            <span className="flex items-center justify-end">Value<SortIcon field="value" /></span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data?.premiumShares ?? 0) > 0 && data && (
                          <tr className="border-b hover-elevate bg-gradient-to-r from-yellow-500/5 to-amber-500/5" data-testid="row-premium-shares">
                            {/* Mobile layout */}
                            <td className="px-2 py-2 sm:hidden" colSpan={7}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                                    <Crown className="w-4 h-4 text-yellow-500" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-sm text-yellow-500">Premium Share</div>
                                    <div className="text-xs text-muted-foreground">Qty: {data.premiumShares} • 30 Days Access</div>
                                    <div className="flex items-center gap-1.5 text-xs mt-0.5">
                                      {premiumMarketData?.lastTradePrice !== null && premiumMarketData?.lastTradePrice !== undefined ? (
                                        <span className="font-mono font-bold text-yellow-500">${premiumMarketData.lastTradePrice.toFixed(2)}</span>
                                      ) : (
                                        <span className="text-muted-foreground">No trades</span>
                                      )}
                                      <span className="text-muted-foreground">•</span>
                                      <span className="font-mono">Value: {premiumMarketData?.lastTradePrice !== null && premiumMarketData?.lastTradePrice !== undefined
                                        ? `$${(data.premiumShares * premiumMarketData.lastTradePrice).toFixed(2)}`
                                        : "-"}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  <Link href="/premium/trade">
                                    <Button size="sm" variant="outline" className="border-yellow-500/50 text-yellow-500" data-testid="button-trade-premium">
                                      Trade
                                    </Button>
                                  </Link>
                                  <Button
                                    size="sm"
                                    onClick={() => redeemPremiumMutation.mutate()}
                                    disabled={redeemPremiumMutation.isPending || data.isPremium}
                                    className="bg-yellow-500 hover:bg-yellow-600 text-black"
                                    data-testid="button-redeem-premium"
                                  >
                                    {data.isPremium ? "Active" : "Redeem"}
                                  </Button>
                                </div>
                              </div>
                            </td>

                            {/* Desktop layout */}
                            <td className="px-2 py-1.5 hidden sm:table-cell">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                                  <Crown className="w-4 h-4 text-yellow-500" />
                                </div>
                                <div>
                                  <div className="font-medium text-sm text-yellow-500">Premium Share</div>
                                  <div className="text-xs text-muted-foreground">30 Days Access</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono hidden sm:table-cell text-yellow-500 font-bold">{data.premiumShares}</td>
                            <td className="px-2 py-1.5 text-right font-mono hidden md:table-cell text-yellow-500">
                              {premiumMarketData?.lastTradePrice !== null && premiumMarketData?.lastTradePrice !== undefined
                                ? `$${premiumMarketData.lastTradePrice.toFixed(2)}`
                                : "-"}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono hidden xl:table-cell text-yellow-500 font-bold">
                              {premiumMarketData?.lastTradePrice !== null && premiumMarketData?.lastTradePrice !== undefined
                                ? `$${(data.premiumShares * premiumMarketData.lastTradePrice).toFixed(2)}`
                                : "-"}
                            </td>
                            <td className="px-2 py-1.5 text-right hidden sm:table-cell">
                              <div className="flex gap-1 justify-end">
                                <Link href="/premium/trade">
                                  <Button size="sm" variant="outline" className="border-yellow-500/50 text-yellow-500" data-testid="button-trade-premium-desktop">
                                    Trade
                                  </Button>
                                </Link>
                                <Button
                                  size="sm"
                                  onClick={() => redeemPremiumMutation.mutate()}
                                  disabled={redeemPremiumMutation.isPending || data.isPremium}
                                  className="bg-yellow-500 hover:bg-yellow-600 text-black"
                                  data-testid="button-redeem-premium-desktop"
                                >
                                  {data.isPremium ? "Active" : "Redeem"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                        {sortedHoldings.map((group) => {
                          const hasPoweredShares = group.powered.length > 0;
                          const hasRegularShares = group.regular !== null;

                          return (
                            <Collapsible key={group.player.id} asChild>
                              <>
                                {/* Main row - always visible */}
                                <tr className="border-b last:border-0 hover-elevate" data-testid={`row-holding-${group.player.id}`}>
                                  {/* Mobile layout */}
                                  <td className="px-2 py-2 sm:hidden" colSpan={7}>
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                          <span className="font-bold text-xs">{group.player.firstName[0]}{group.player.lastName[0]}</span>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <div className="font-medium text-sm flex items-center gap-1">
                                            <PlayerName
                                              playerId={group.player.id}
                                              firstName={group.player.firstName}
                                              lastName={group.player.lastName}
                                              className="text-sm"
                                            />
                                            {parseFloat(group.totalPower) > 0 && (
                                              <Badge variant="outline" className="text-[10px] h-4 px-1 border-purple-500/50 text-purple-400 bg-purple-500/10">
                                                ⚡ {group.totalPower}
                                              </Badge>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                                            <span>{group.player.team}</span>
                                            <span>•</span>
                                            <span>{group.player.position}</span>
                                            <span>•</span>
                                            <span className="font-mono">
                                              Qty: {group.totalShares}
                                              {(() => {
                                                const lpPos = lpPositions?.find((lp: any) => lp.playerId === group.player.id);
                                                const lpShares = lpPos ? Math.round(lpPos.equivalentShares || 0) : 0;
                                                return lpShares > 0 ? ` (${lpShares} in pool)` : null;
                                              })()}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1.5 text-xs mt-0.5">
                                            <span className="text-muted-foreground">Avg: ${group.avgCostBasis}</span>
                                            <span className="text-muted-foreground">•</span>
                                            <AnimatedPrice
                                              value={parseFloat(group.player.lastTradePrice || "0")}
                                              size="sm"
                                              className="font-mono font-bold"
                                            />
                                            <span className="text-muted-foreground">•</span>
                                            <button
                                              className={`font-mono font-medium hover:underline ${
                                                parseFloat(group.pnl || "0") >= 0 ? 'text-positive hover:text-green-400' : 'text-negative hover:text-red-400'
                                              }`}
                                              title="Click to manage Power Level"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (hasRegularShares && group.regular!.quantity >= 5) {
                                                  openCondenseDialog(
                                                    group.player.id,
                                                    `${group.player.firstName} ${group.player.lastName}`,
                                                    group.regular!.quantity
                                                  );
                                                }
                                              }}
                                            >
                                              {parseFloat(group.pnl || "0") >= 0 ? '+' : ''}${group.pnl}
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                      <CollapsibleTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="flex-shrink-0"
                                          data-testid={`button-expand-${group.player.id}`}
                                        >
                                          <ChevronRight className="w-4 h-4 transition-transform data-[state=open]:rotate-90" />
                                        </Button>
                                      </CollapsibleTrigger>
                                    </div>
                                  </td>

                                  {/* Desktop layout */}
                                  <td className="px-2 py-1.5 hidden sm:table-cell">
                                    <div className="flex items-center gap-2">
                                      <CollapsibleTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="p-0 hover:bg-transparent"
                                          data-testid={`button-expand-${group.player.id}`}
                                        >
                                          <ChevronRight className="w-4 h-4 mr-1 transition-transform data-[state=open]:rotate-90" />
                                        </Button>
                                      </CollapsibleTrigger>
                                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                        <span className="font-bold text-xs">{group.player.firstName[0]}{group.player.lastName[0]}</span>
                                      </div>
                                      <div>
                                        <div className="font-medium text-sm flex items-center gap-1">
                                          <PlayerName
                                            playerId={group.player.id}
                                            firstName={group.player.firstName}
                                            lastName={group.player.lastName}
                                            className="text-sm"
                                          />
                                          {parseFloat(group.totalPower) > 0 && (
                                            <Badge variant="outline" className="text-[10px] h-4 px-1 border-purple-500/50 text-purple-400 bg-purple-500/10">
                                              ⚡ {group.totalPower}
                                            </Badge>
                                          )}
                                        </div>
                                        <div className="text-xs text-muted-foreground hidden md:inline">{group.player.team} • {group.player.position}</div>
                                        <div className="text-xs text-muted-foreground md:hidden">{group.player.team} • {group.player.position}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono text-sm hidden sm:table-cell">
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span title="Total shares">
                                        {group.totalShares}
                                        {(() => {
                                          const lpPos = lpPositions?.find((lp: any) => lp.playerId === group.player.id);
                                          const lpShares = lpPos ? Math.round(lpPos.equivalentShares || 0) : 0;
                                          return lpShares > 0 ? (
                                            <span className="text-xs text-blue-400 ml-1">({lpShares} pool)</span>
                                          ) : null;
                                        })()}
                                      </span>
                                      {parseFloat(group.totalPower) > 0 && group.regular && (
                                        <button
                                          className="text-xs text-purple-400 hover:text-purple-300 hover:underline cursor-pointer text-right"
                                          title="Click to power up shares"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openCondenseDialog(
                                              group.player.id,
                                              `${group.player.firstName} ${group.player.lastName}`,
                                              group.regular!.quantity
                                            );
                                          }}
                                          data-testid={`button-pnl-${group.player.id}`}
                                        >
                                          ⚡ {group.totalPower}
                                        </button>
                                      )}
                                      {/* P&L - clickable to open power up dialog */}
                                      <button
                                        className={`text-xs font-medium hover:underline cursor-pointer text-right ${
                                          parseFloat(group.pnl) >= 0 ? 'text-positive hover:text-green-400' : 'text-negative hover:text-red-400'
                                        }`}
                                        title="Click to manage Power Level"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (hasRegularShares && group.regular!.quantity >= 5) {
                                            openCondenseDialog(
                                              group.player.id,
                                              `${group.player.firstName} ${group.player.lastName}`,
                                              group.regular!.quantity
                                            );
                                          }
                                        }}
                                        data-testid={`button-pl-${group.player.id}`}
                                      >
                                        {parseFloat(group.pnl) >= 0 ? '+' : ''}${group.pnl}
                                        <span className="ml-1 opacity-70">({parseFloat(group.pnlPercent) >= 0 ? '+' : ''}{group.pnlPercent}%)</span>
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono text-sm hidden sm:table-cell">${group.avgCostBasis}</td>
                                  <td className="px-2 py-1.5 text-right hidden md:table-cell">
                                    <AnimatedPrice
                                      value={parseFloat(group.player.lastTradePrice || "0")}
                                      size="sm"
                                      className="font-mono font-bold justify-end"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono font-bold text-sm hidden xl:table-cell">
                                    ${group.currentValue}
                                  </td>
                                </tr>

                                {/* Expanded detail rows - Share Holdings Table */}
                                <CollapsibleContent asChild>
                                  <tr className="bg-muted/30">
                                    <td colSpan={7} className="px-0">
                                      {(() => {
                                        // Build share holdings list with types
                                        const shareHoldings: Array<{
                                          id: string | undefined;
                                          type: 'regular' | 'powered';
                                          quantity: number;
                                          power: number;
                                          powerLevel: string;
                                        }> = [];

                                        if (hasRegularShares) {
                                          shareHoldings.push({
                                            id: group.regular!.id,
                                            type: 'regular',
                                            quantity: group.regular!.quantity,
                                            power: 1,
                                            powerLevel: group.regular!.quantity.toFixed(2),
                                          });
                                        }

                                        group.powered.forEach((share, idx) => {
                                          shareHoldings.push({
                                            id: share.id,
                                            type: 'powered',
                                            quantity: share.quantity,
                                            power: share.power,
                                            powerLevel: share.powerLevel,
                                          });
                                        });

                                        // Sort the holdings
                                        const sortedHoldings = [...shareHoldings].sort((a, b) => {
                                          const sortValA = expandedShareSortField === 'quantity' ? a.quantity : parseFloat(a.powerLevel);
                                          const sortValB = expandedShareSortField === 'quantity' ? b.quantity : parseFloat(b.powerLevel);
                                          return expandedShareSortDir === 'asc' ? sortValA - sortValB : sortValB - sortValA;
                                        });

                                        const allHoldingIds = sortedHoldings.map(h => h.id).filter((id): id is string => !!id);
                                        const allSelected = allHoldingIds.every(id => selectedHoldingIds.has(id));

                                        return (
                                          <div className="p-3">
                                            <table className="w-full text-xs">
                                              <thead>
                                                <tr className="text-muted-foreground border-b border-border/50">
                                                  <th className="text-left pb-2 pl-1">
                                                    <input
                                                      type="checkbox"
                                                      checked={allSelected && allHoldingIds.length > 0}
                                                      onChange={(e) => {
                                                        if (e.target.checked) {
                                                          selectAllHoldings(allHoldingIds);
                                                        } else {
                                                          clearSelection();
                                                        }
                                                      }}
                                                      className="rounded border-input"
                                                    />
                                                  </th>
                                                  <th
                                                    className="text-left pb-2 cursor-pointer hover:text-foreground"
                                                    onClick={() => handleExpandedShareSort('quantity')}
                                                  >
                                                    <span className="flex items-center gap-1">
                                                      Qty
                                                      {expandedShareSortField === 'quantity' && (
                                                        expandedShareSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                                                      )}
                                                    </span>
                                                  </th>
                                                  <th
                                                    className="text-left pb-2 cursor-pointer hover:text-foreground"
                                                    onClick={() => handleExpandedShareSort('power')}
                                                  >
                                                    <span className="flex items-center gap-1">
                                                      Power
                                                      {expandedShareSortField === 'power' && (
                                                        expandedShareSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                                                      )}
                                                    </span>
                                                  </th>
                                                  <th className="text-right pb-2 pr-1">Action</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-border/30">
                                                {sortedHoldings.map((share, idx) => {
                                                  const holdingId = share.id || `temp-${idx}`;
                                                  const isSelected = selectedHoldingIds.has(holdingId);
                                                  const isRegular = share.type === 'regular';
                                                  const canPowerUp = isRegular ? share.quantity >= 5 : true;

                                                  return (
                                                    <tr key={holdingId} className={`${isRegular ? 'bg-green-500/5' : 'bg-purple-500/5'} hover:bg-muted/50 transition-colors`}>
                                                      <td className="py-2 pl-1">
                                                        <input
                                                          type="checkbox"
                                                          checked={isSelected}
                                                          onChange={() => toggleHoldingSelection(holdingId)}
                                                          className="rounded border-input"
                                                        />
                                                      </td>
                                                      <td className="py-2">
                                                        <span className="font-mono">{share.quantity}</span>
                                                        <span className={`ml-1 text-[10px] ${isRegular ? 'text-muted-foreground' : 'text-purple-400'}`}>
                                                          @ {share.power}x
                                                        </span>
                                                      </td>
                                                      <td className="py-2">
                                                        <span className={`font-mono font-medium ${isRegular ? 'text-muted-foreground' : 'text-purple-400'}`}>
                                                          {share.powerLevel}
                                                        </span>
                                                      </td>
                                                      <td className="py-2 pr-1 text-right">
                                                        {isRegular ? (
                                                          <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-6 px-2 text-xs bg-green-500/10 hover:bg-green-500/20 text-green-600"
                                                            onClick={() => openCondenseFromExpanded(
                                                              group.player.id,
                                                              `${group.player.firstName} ${group.player.lastName}`,
                                                              share.quantity
                                                            )}
                                                            disabled={!canPowerUp}
                                                          >
                                                            Power Up
                                                          </Button>
                                                        ) : (
                                                          <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-6 px-2 text-xs bg-purple-500/10 hover:bg-purple-500/20 text-purple-600"
                                                            disabled
                                                          >
                                                            Powered
                                                          </Button>
                                                        )}
                                                      </td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>

                                            {/* Selection summary */}
                                            {selectedHoldingIds.size > 0 && (
                                              <div className="mt-3 flex items-center justify-between bg-muted/50 rounded p-2">
                                                <span className="text-xs text-muted-foreground">
                                                  {selectedHoldingIds.size} lot{selectedHoldingIds.size > 1 ? 's' : ''} selected
                                                </span>
                                                <Button
                                                  size="sm"
                                                  className="h-7 bg-purple-500 hover:bg-purple-600 text-xs"
                                                  onClick={() => openCondenseFromExpanded(
                                                    group.player.id,
                                                    `${group.player.firstName} ${group.player.lastName}`,
                                                    group.regular?.quantity || 0
                                                  )}
                                                >
                                                  Power Up Selected
                                                </Button>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </td>
                                  </tr>
                                </CollapsibleContent>
                              </>
                            </Collapsible>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Feed */}
          <TabsContent value="activity">
            <ActivityFeed />
          </TabsContent>
        </Tabs>

        {/* Power Up Dialog */}
        <Dialog open={condenseDialogOpen} onOpenChange={setCondenseDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-purple-400" />
                Power Up Shares
              </DialogTitle>
              <DialogDescription>
                Convert regular shares into Power Level at a 5:1 ratio.
                Power Level shares are used exclusively for Daily Boosts.
              </DialogDescription>
            </DialogHeader>
            {selectedPlayerForCondense && data?.holdings && (
              <div className="space-y-4 py-4">
                {/* Player info */}
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="font-medium">{selectedPlayerForCondense.name}</div>
                  {(() => {
                    const holding = data.holdings.find(h => h.player?.id === selectedPlayerForCondense.id);
                    if (!holding) return null;
                    return (
                      <div className="text-sm text-muted-foreground mt-1 space-y-1">
                        <div className="flex justify-between">
                          <span>Regular Shares:</span>
                          <span className="font-mono">{holding.quantity}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Current Power Level:</span>
                          <span className="font-mono text-purple-400">{parseFloat(holding.powerLevel || "0") > 0 ? holding.powerLevel : "0.00"}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Share input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Shares to Power Up</label>
                  <Input
                    type="number"
                    value={sharesToCondenseInput}
                    onChange={(e) => setSharesToCondenseInput(e.target.value)}
                    placeholder="Enter shares to power up"
                    min={5}
                    step={5}
                  />
                  <p className="text-xs text-muted-foreground">
                    Must be at least 5 and divisible by 5. Each 5 shares = 1 Power Level.
                  </p>
                </div>

                {/* Preview */}
                {(() => {
                  const shares = parseInt(sharesToCondenseInput);
                  const isValid = !isNaN(shares) && shares >= 5 && shares % 5 === 0;
                  if (!isValid) return null;

                  const holding = data.holdings.find(h => h.player?.id === selectedPlayerForCondense?.id);
                  if (!holding) return null;

                  const powerCreated = shares / 5;
                  const remainingShares = parseFloat(holding.quantity) - shares;

                  return (
                    <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg space-y-2">
                      <div className="text-sm font-medium text-purple-400">Conversion Result</div>
                      <div className="flex justify-between text-sm">
                        <span>Regular shares consumed:</span>
                        <span className="font-mono">-{shares}</span>
                      </div>
                      <div className="flex justify-between text-sm font-medium">
                        <span>Powered share created:</span>
                        <span className="font-mono text-purple-400">1 share @ {powerCreated.toFixed(2)} power</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Regular shares remaining:</span>
                        <span className="font-mono">{remainingShares}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCondenseDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCondenseFromDialog}
                disabled={condenseSharesMutation.isPending}
                className="bg-purple-500 hover:bg-purple-600"
              >
                {condenseSharesMutation.isPending ? "Powering Up..." : "Power Up Shares"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Player Stats Modal */}
        <PlayerModal
          playerId={selectedPlayerId}
          open={playerModalOpen}
          onOpenChange={setPlayerModalOpen}
        />
      </div>
    </div>
  );
}

function ActivityFeed() {
  const { data: activityData, isLoading } = useQuery<ActivityResponse>({
    queryKey: ['/api/activity'],
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          {[85, 75, 90, 70, 80].map((width, i) => (
            <div key={i} className="flex items-center gap-3">
              <Shimmer width="40px" height="40px" className="rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Shimmer height="14px" width={`${width}%`} />
                <Shimmer height="12px" width="120px" />
              </div>
              <Shimmer height="16px" width="60px" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!activityData || activityData.activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide">Activity History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <EmptyState
            icon="inbox"
            title="No activity yet"
            description="Start trading, scouting, or entering contests to see your activity here."
            size="sm"
            className="py-8"
            data-testid="empty-activity"
          />
        </CardContent>
      </Card>
    );
  }

  const getActivityIcon = (category: string, type: string) => {
    if (category === 'scout') return <Clock className="w-4 h-4" />;
    if (category === 'market') return <ShoppingCart className="w-4 h-4" />;
    if (category === 'contest') return <Trophy className="w-4 h-4" />;
    return null;
  };

  const getCategoryColor = (category: string) => {
    if (category === 'scout') return 'text-yellow-500';
    if (category === 'market') return 'text-blue-500';
    if (category === 'contest') return 'text-purple-500';
    return 'text-muted-foreground';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide">Activity History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {activityData.activities.map((activity) => {
            const cashDelta = activity.cashDelta ? parseFloat(activity.cashDelta) : null;
            const isPositive = cashDelta && cashDelta > 0;
            const isNegative = cashDelta && cashDelta < 0;

            return (
              <div
                key={activity.id}
                className="p-3 sm:p-4 hover-elevate flex items-start gap-3"
                data-testid={`activity-${activity.id}`}
              >
                {/* Icon */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center ${getCategoryColor(activity.category)}`}>
                  {getActivityIcon(activity.category, activity.type)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Description with player link */}
                  <div className="text-sm font-medium mb-1">
                    {activity.metadata.playerId ? (
                      <Link href={`/player/${activity.metadata.playerId}`} className="hover:underline">
                        {activity.description}
                      </Link>
                    ) : activity.metadata.contestId ? (
                      <Link href={`/contest/${activity.metadata.contestId}`} className="hover:underline">
                        {activity.description}
                      </Link>
                    ) : (
                      activity.description
                    )}
                  </div>

                  {/* Metadata */}
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <span className="capitalize">{activity.category}</span>
                    <span>•</span>
                    <span>{formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}</span>

                    {/* Show shares for scout */}
                    {activity.shareDelta && activity.shareDelta > 0 && (
                      <>
                        <span>•</span>
                        <span className="font-mono text-green-500">
                          +{activity.shareDelta} {activity.shareDelta === 1 ? 'share' : 'shares'}
                        </span>
                      </>
                    )}

                    {/* Show order details for market */}
                    {activity.metadata.orderType && (
                      <>
                        <span>•</span>
                        <span className="capitalize">{activity.metadata.orderType}</span>
                      </>
                    )}

                    {/* Show trade price for market */}
                    {activity.metadata.tradePrice && (
                      <>
                        <span>•</span>
                        <span className="font-mono">${activity.metadata.tradePrice}</span>
                      </>
                    )}

                    {/* Show rank for contest payouts */}
                    {activity.metadata.rank && activity.metadata.totalEntries && (
                      <>
                        <span>•</span>
                        <span>
                          Rank {activity.metadata.rank} of {activity.metadata.totalEntries}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Cash Delta */}
                {cashDelta !== null && cashDelta !== 0 && (
                  <div className="flex-shrink-0 text-right">
                    <div className={`flex items-center gap-1 font-mono font-bold text-sm ${isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-muted-foreground'}`}>
                      {isPositive && <ArrowUpRight className="w-3 h-3" />}
                      {isNegative && <ArrowDownRight className="w-3 h-3" />}
                      <span data-testid={`cash-delta-${activity.id}`}>
                        {isPositive ? '+' : ''}${activity.cashDelta}
                      </span>
                    </div>
                    {activity.balanceAfter && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Bal: ${activity.balanceAfter}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

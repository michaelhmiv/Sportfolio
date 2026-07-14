import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import { formatAdaptiveCurrency } from "@/lib/currency";
import { useWebSocket } from "@/lib/websocket";
import { useNotifications } from "@/lib/notification-context";
import { useAuth } from "@/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Briefcase,
  Crown,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  Plus,
  BarChart3,
  Database,
  Droplets,
  ChevronRight,
  FileText,
  LayoutGrid,
  List,
  HelpCircle,
  RefreshCw,
  ArrowRightLeft,
  Zap,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { apiRequest, queryClient, authenticatedFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { invalidatePortfolioQueries } from "@/lib/cache-invalidation";
import type { Holding, Player } from "@shared/schema";
import { PlayerName } from "@/components/player-name";
import { Shimmer, ShimmerCard, PullToRefreshIndicator } from "@/components/ui/animations";
import { AnimatedPrice } from "@/components/ui/animated-price";
import { EmptyState } from "@/components/ui/empty-state";
import { useSport } from "@/lib/sport-context";
import { SportSelector } from "@/components/sport-selector";
import { PortfolioCardView } from "@/components/portfolio-card-view";
import { PortfolioActivityTab } from "@/components/portfolio-activity-tab";
import { PortfolioStackingTab } from "@/components/portfolio-stacking-tab";
import { PlayerModal } from "@/components/player-modal";
import { CardAccent, BackgroundPattern } from "@/components/ui/decorative-elements";
import {
  buildStackingCandidates,
  formatStackNumber,
  getCompactStackStatus,
  type PortfolioStackingEligibility,
} from "@/pages/portfolio-stacking-helpers";
import {
  formatPortfolioUnits,
  formatStackToastMessage,
  type StackSharesResponse,
} from "@/pages/portfolio-stack-feedback";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";

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
    multiplier?: string;
    effectiveShares?: string;
    totalPlayerEffectiveShares?: string;
    isStackedShare?: boolean;
    lockedQuantity?: number;
    availableQuantity?: number;
  })[];
  premiumShares: number;
  isPremium: boolean;
  premiumExpiresAt?: string;
}

type SortField = "name" | "singles" | "stackPower" | "avgCost" | "price" | "value" | "pnl" | "tvl";
type SortDirection = "asc" | "desc";

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "singles", label: "Shares" },
  { value: "stackPower", label: "Power" },
  { value: "avgCost", label: "Avg Cost" },
  { value: "price", label: "Price" },
  { value: "value", label: "Value" },
  { value: "pnl", label: "P&L" },
  { value: "tvl", label: "Pool TVL" },
];

// Helper function to calculate P&L
function calculatePnL(
  quantity: number,
  avgCost: string,
  lastTradePrice: string | null | undefined,
) {
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

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMobileCompactUnits(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  if (Math.abs(value) < 1000) {
    return formatPortfolioUnits(value);
  }

  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
}

// LP position sort options
type LpSortField = "player" | "ownership" | "fees" | "value";

export default function Portfolio() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { subscribe } = useWebSocket();
  const { unreadCount, clearUnread } = useNotifications();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("holdings");
  const [chartTimeRange, setChartTimeRange] = useState("1M");
  const [benchmarkPlayerId, setBenchmarkPlayerId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [lpSortField, setLpSortField] = useState<LpSortField>("value");
  const [lpSortDirection, setLpSortDirection] = useState<SortDirection>("desc");
  const { sport } = useSport();

  // View toggle state - persist in localStorage
  const [viewMode, setViewMode] = useState<"card" | "list">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("portfolioViewMode") as "card" | "list") || "list";
    }
    return "list";
  });

  // Stack Shares dialog state
  const [stackSharesDialogOpen, setStackSharesDialogOpen] = useState(false);
  const [selectedPlayerForStacking, setSelectedPlayerForStacking] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [sharesToStackInput, setSharesToStackInput] = useState<string>("");

  // Player modal state
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerModalOpen, setPlayerModalOpen] = useState(false);

  // Expanded share table state (per player)
  const [expandedShareSortField, setExpandedShareSortField] = useState<"quantity" | "multiplier">(
    "quantity",
  );
  const [expandedShareSortDir, setExpandedShareSortDir] = useState<"asc" | "desc">("desc");
  const [selectedHoldingIds, setSelectedHoldingIds] = useState<Set<string>>(new Set());

  const {
    data,
    isLoading,
    refetch: portfolioRefetch,
  } = useQuery<PortfolioData>({
    queryKey: ["/api/portfolio"],
    enabled: isAuthenticated,
    staleTime: 15000,
    placeholderData: (previousData) => previousData,
  });

  // LP Positions data
  const {
    data: lpPositions,
    isLoading: lpLoading,
    isError: lpError,
    refetch: lpRefetch,
  } = useQuery({
    queryKey: ["/api/lp/positions"],
    queryFn: async () => {
      const res = await authenticatedFetch("/api/lp/positions");
      if (!res.ok) throw new Error("Failed to fetch LP positions");
      return res.json();
    },
    enabled: isAuthenticated,
    retry: 2,
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
  });

  const { data: stackingEligibility } = useQuery<{
    eligiblePlayers: PortfolioStackingEligibility[];
  }>({
    queryKey: ["/api/daily-boosts/eligible-all", "portfolio"],
    queryFn: async () => {
      const res = await authenticatedFetch("/api/daily-boosts/eligible-all");
      if (!res.ok) {
        throw new Error("Failed to fetch stacking context");
      }
      return res.json();
    },
    enabled: isAuthenticated,
    retry: 1,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });

  // Compute LP aggregate totals and sorted positions
  const lpAggregates = useMemo(() => {
    if (!lpPositions || lpPositions.length === 0) {
      return { totalValue: 0, totalFees: 0, sortedPositions: [] };
    }

    let totalValue = 0;
    let totalFees = 0;

    for (const pos of lpPositions) {
      totalValue += Number(pos.positionValue || 0);
      totalFees += Number(pos.feesEarnedToDate || 0);
    }

    // Sort positions
    const sortedPositions = [...lpPositions].sort((a: any, b: any) => {
      let aVal: number = 0;
      let bVal: number = 0;

      switch (lpSortField) {
        case "player":
          const aName = (a.player?.name || a.playerId || "").toLowerCase();
          const bName = (b.player?.name || b.playerId || "").toLowerCase();
          return lpSortDirection === "asc"
            ? aName.localeCompare(bName)
            : bName.localeCompare(aName);
        case "ownership":
          aVal = Number(a.ownershipPercentage || 0);
          bVal = Number(b.ownershipPercentage || 0);
          break;
        case "fees":
          aVal = Number(a.feesEarnedToDate || 0);
          bVal = Number(b.feesEarnedToDate || 0);
          break;
        case "value":
          aVal = Number(a.positionValue || 0);
          bVal = Number(b.positionValue || 0);
          break;
      }

      return lpSortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });

    return { totalValue, totalFees, sortedPositions };
  }, [lpPositions, lpSortField, lpSortDirection]);

  // LP sort handler
  const handleLpSort = (field: LpSortField) => {
    if (lpSortField === field) {
      setLpSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setLpSortField(field);
      setLpSortDirection(field === "player" ? "asc" : "desc");
    }
  };

  // Premium market data - CRITICAL: Only show real trade data, never fabricated prices
  type PremiumMarketData = {
    lastTradePrice: number | null;
    circulation: number;
    totalTrades: number;
  };

  const { data: premiumMarketData } = useQuery<PremiumMarketData>({
    queryKey: ["/api/premium/market-data"],
    staleTime: 60000,
    placeholderData: (previousData) => previousData,
  });

  const { data: chartData } = useQuery<{
    history: Array<{ date: string; cashBalance: number; portfolioValue: number; netWorth: number }>;
    timeRange: string;
  }>({
    queryKey: ["/api/user/portfolio-history", chartTimeRange],
    queryFn: async () => {
      const res = await authenticatedFetch(
        `/api/user/portfolio-history?timeRange=${chartTimeRange}`,
      );
      if (!res.ok) throw new Error("Failed to fetch portfolio history");
      return res.json();
    },
    enabled: activeTab === "holdings",
    staleTime: 60000,
    placeholderData: (previousData) => previousData,
  });

  // Benchmark player price overlay
  const RANGE_DAYS: Record<string, number> = {
    "1D": 1,
    "7D": 7,
    "1M": 30,
    "1Y": 365,
    ALL: 3650,
  };
  const { data: benchmarkRaw } = useQuery<Record<string, Array<{ date: string; price: number }>>>({
    queryKey: ["/api/players/sparklines/dated", benchmarkPlayerId, chartTimeRange],
    queryFn: async () => {
      const days = RANGE_DAYS[chartTimeRange] ?? 30;
      const res = await authenticatedFetch(
        `/api/players/sparklines?ids=${benchmarkPlayerId}&days=${days}&dates=true`,
      );
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!benchmarkPlayerId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  });

  // Merge benchmark prices into chart history by closest date
  const mergedChartData = useMemo(() => {
    const history = chartData?.history ?? [];
    if (!benchmarkPlayerId || !benchmarkRaw?.[benchmarkPlayerId]?.length) {
      return history;
    }
    const priceMap = new Map<string, number>();
    for (const point of benchmarkRaw[benchmarkPlayerId]) {
      const day = point.date.split("T")[0];
      // price_history rows are ordered by timestamp ascending; later points for the same
      // calendar day overwrite earlier ones, so we end up with the last recorded price per day
      priceMap.set(day, point.price);
    }
    return history.map((pt) => ({
      ...pt,
      benchmarkPrice: priceMap.get(pt.date.split("T")[0]) ?? null,
    }));
  }, [chartData, benchmarkPlayerId, benchmarkRaw]);

  // Unique held players for the benchmark selector
  const heldPlayers = useMemo(() => {
    const seen = new Set<string>();
    return (data?.holdings ?? []).reduce(
      (acc, h) => {
        const playerId = h.assetId || h.player?.id;
        if (!playerId || seen.has(playerId)) return acc;

        seen.add(playerId);
        acc.push({
          id: playerId,
          name: h.player ? `${h.player.firstName} ${h.player.lastName}` : playerId,
        });
        return acc;
      },
      [] as { id: string; name: string }[],
    );
  }, [data?.holdings]);

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
    const unsubPortfolio = subscribe("portfolio", () => {
      // Additional portfolio-specific logic could go here
    });

    const unsubTrade = subscribe("trade", () => {
      // Trades affect holdings
    });

    return () => {
      unsubPortfolio();
      unsubTrade();
    };
  }, [subscribe]);

  // Pull-to-refresh
  const { containerRef, isRefreshing, pullDistance } = usePullToRefresh<HTMLDivElement>({
    onRefresh: async () => {
      await Promise.all([portfolioRefetch(), lpRefetch()]);
    },
  });

  const redeemPremiumMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/premium/redeem", {});
    },
    onSuccess: async () => {
      await invalidatePortfolioQueries();
      toast({
        title: "Premium activated!",
        description: "You now have premium access for 30 days",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Redemption failed", description: error.message, variant: "destructive" });
    },
  });

  // Stack regular shares into a single multiplier share.
  const stackSharesMutation = useMutation({
    mutationFn: async ({
      playerId,
      sharesToStack,
    }: {
      playerId: string;
      sharesToStack: number;
    }) => {
      const response = await apiRequest("POST", "/api/holdings/stack-shares", {
        playerId,
        sharesToStack,
      });
      return (await response.json()) as StackSharesResponse;
    },
    onSuccess: async (data) => {
      await invalidatePortfolioQueries();
      setStackSharesDialogOpen(false);
      setSelectedPlayerForStacking(null);
      setSharesToStackInput("");
      toast({
        title: "Shares Stacked",
        description: formatStackToastMessage(data),
      });
    },
    onError: (error: Error) => {
      toast({ title: "Stack Shares failed", description: error.message, variant: "destructive" });
    },
  });

  // Open Stack Shares dialog
  const openStackSharesDialog = (playerId: string, playerName: string, availableShares: number) => {
    const safePlayerName = playerName?.trim() || "Selected player";
    setSelectedPlayerForStacking({ id: playerId, name: safePlayerName });
    // Default to the maximum stackable shares (round down to nearest multiple of 2)
    const maxStackable = Math.floor(availableShares / 2) * 2;
    setSharesToStackInput(maxStackable.toString());
    setStackSharesDialogOpen(true);
  };

  // Handle Stack Shares from dialog
  const handleStackSharesFromDialog = () => {
    if (!selectedPlayerForStacking || !selectedStackingCandidate) return;
    const shares = parseInt(sharesToStackInput);
    if (isNaN(shares) || shares < 4 || shares % 2 !== 0) {
      toast({
        title: "Invalid selection",
        description: "Please enter an even number of shares (minimum 4)",
        variant: "destructive",
      });
      return;
    }
    if (shares > selectedStackingCandidate.availableToStack) {
      toast({
        title: "Not enough unlocked shares",
        description: `Only ${selectedStackingCandidate.availableToStack.toFixed(2)} unlocked shares are available to stack right now.`,
        variant: "destructive",
      });
      return;
    }
    stackSharesMutation.mutate({
      playerId: selectedPlayerForStacking.id,
      sharesToStack: shares,
    });
  };

  // Toggle sort direction or change sort field
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      // Name sorts A-Z (asc) by default, numeric fields sort high-to-low (desc)
      setSortDirection(field === "name" ? "asc" : "desc");
    }
  };

  // Toggle holding selection
  const toggleHoldingSelection = (holdingId: string) => {
    setSelectedHoldingIds((prev) => {
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
  const handleViewModeChange = (mode: "card" | "list") => {
    setViewMode(mode);
    localStorage.setItem("portfolioViewMode", mode);
  };

  // Handle expanded share table sort
  const handleExpandedShareSort = (field: "quantity" | "multiplier") => {
    if (expandedShareSortField === field) {
      setExpandedShareSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setExpandedShareSortField(field);
      setExpandedShareSortDir("desc");
    }
  };

  // Open Stack Shares dialog with selected holdings
  const openStackSharesFromExpanded = (
    playerId: string,
    playerName: string,
    availableRegularShares: number,
  ) => {
    clearSelection();
    setSelectedPlayerForStacking({ id: playerId, name: playerName });
    // Default to the maximum even stackable share count.
    const maxStackable = Math.floor(availableRegularShares / 2) * 2;
    setSharesToStackInput(maxStackable.toString());
    setStackSharesDialogOpen(true);
  };

  // Parse currency string to number (strips $, commas, etc.)
  const parseCurrency = (value: string | null | undefined): number => {
    if (!value) return 0;
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  // Transform holdings: group regular shares and stacked shares per player
  // Returns one entry per player with a breakdown array
  interface ShareBreakdown {
    quantity: number;
    multiplier: number;
    effectiveShares: string;
    avgCostBasis: string;
    availableQuantity: number;
    id?: string;
  }

  interface PlayerGroup {
    player: Player;
    regular: ShareBreakdown | null;
    stacked: ShareBreakdown[];
    totalShares: number;
    totalPower: string;
    singlesCount: number;
    availableSingles: number;
    stackPower: number;
    currentValue: string;
    pnl: string;
    pnlPercent: string;
    avgCostBasis: string;
  }

  const playerHoldings: PlayerGroup[] = (() => {
    const playerMap = new Map<string, PlayerGroup>();

    // First pass: group by player
    data?.holdings
      .filter((h) => h.assetType === "player" && h.player)
      .forEach((holding) => {
        const playerId = holding.player!.id;
        const player = holding.player!;

        if (!playerMap.has(playerId)) {
          // Calculate PnL from the first holding for this player
          const { currentValue, pnl, pnlPercent } = calculatePnL(
            parseFloat(holding.quantity),
            holding.avgCostBasis,
            player.lastTradePrice,
          );

          playerMap.set(playerId, {
            player,
            regular: null,
            stacked: [],
            totalShares: 0,
            totalPower: "0.00",
            singlesCount: 0,
            availableSingles: 0,
            stackPower: 0,
            currentValue: currentValue || "0.00",
            pnl: pnl || "0.00",
            pnlPercent: pnlPercent || "0.00",
            avgCostBasis: holding.avgCostBasis,
          });
        }

        const group = playerMap.get(playerId)!;

        const shareBreakdown: ShareBreakdown = {
          quantity: parseFloat(holding.quantity),
          multiplier: parseFloat(holding.multiplier || "1"),
          effectiveShares: holding.effectiveShares || parseFloat(holding.quantity).toFixed(2),
          avgCostBasis: holding.avgCostBasis,
          availableQuantity: Number(holding.availableQuantity || 0),
          id: holding.id,
        };

        if (!holding.isStackedShare) {
          // Regular share - combine quantities and average cost
          if (group.regular) {
            const holdingQty = parseFloat(holding.quantity);
            const totalCost =
              parseFloat(group.regular.avgCostBasis || "0") * group.regular.quantity +
              parseFloat(holding.avgCostBasis || "0") * holdingQty;
            const totalQty = group.regular.quantity + holdingQty;
            const newAvgCost = totalQty > 0 ? (totalCost / totalQty).toFixed(4) : "0.0000";
            group.regular = {
              ...group.regular,
              quantity: totalQty,
              avgCostBasis: newAvgCost,
              effectiveShares: totalQty.toFixed(2),
              availableQuantity: group.regular.availableQuantity + shareBreakdown.availableQuantity,
            };
          } else {
            group.regular = shareBreakdown;
          }
        } else {
          // Stacked share
          group.stacked.push(shareBreakdown);
        }

        // Update totals
        group.totalShares =
          (group.regular?.quantity || 0) + group.stacked.reduce((sum, p) => sum + p.quantity, 0);
        group.singlesCount = group.regular?.quantity || 0;
        group.availableSingles = group.regular?.availableQuantity || 0;
        group.stackPower = group.stacked.reduce((sum, p) => sum + p.multiplier * p.quantity, 0);
        group.totalPower = (group.singlesCount + group.stackPower).toFixed(2);
      });

    return Array.from(playerMap.values());
  })();

  // Sort player holdings and filter by selected sport
  // Include holdings with regular shares or effective-share state.
  const sortedHoldings = playerHoldings
    .filter(
      (h) =>
        (h.totalShares > 0 || parseFloat(h.regular?.effectiveShares || "0") > 0) &&
        (!sport || sport === "ALL" || h.player.sport === sport),
    )
    .slice()
    .sort((a, b) => {
      const aName = `${a.player.lastName} ${a.player.firstName}`.toLowerCase();
      const bName = `${b.player.lastName} ${b.player.firstName}`.toLowerCase();

      switch (sortField) {
        case "name":
          return sortDirection === "asc" ? aName.localeCompare(bName) : bName.localeCompare(aName);
        case "singles":
          return sortDirection === "asc"
            ? a.singlesCount - b.singlesCount
            : b.singlesCount - a.singlesCount;
        case "stackPower":
          return sortDirection === "asc"
            ? a.stackPower - b.stackPower
            : b.stackPower - a.stackPower;
        case "avgCost":
          return sortDirection === "asc"
            ? parseCurrency(a.avgCostBasis) - parseCurrency(b.avgCostBasis)
            : parseCurrency(b.avgCostBasis) - parseCurrency(a.avgCostBasis);
        case "price":
          return sortDirection === "asc"
            ? parseCurrency(a.player.lastTradePrice) - parseCurrency(b.player.lastTradePrice)
            : parseCurrency(b.player.lastTradePrice) - parseCurrency(a.player.lastTradePrice);
        case "value":
          return sortDirection === "asc"
            ? parseCurrency(a.currentValue) - parseCurrency(b.currentValue)
            : parseCurrency(b.currentValue) - parseCurrency(a.currentValue);
        case "pnl":
          return sortDirection === "asc"
            ? parseCurrency(a.pnl) - parseCurrency(b.pnl)
            : parseCurrency(b.pnl) - parseCurrency(a.pnl);
        case "tvl": {
          const aTvl = (a.player as any)?.poolTvl || 0;
          const bTvl = (b.player as any)?.poolTvl || 0;
          return sortDirection === "asc" ? aTvl - bTvl : bTvl - aTvl;
        }
        default:
          return 0;
      }
    });

  const allStackingCandidates = useMemo(
    () =>
      buildStackingCandidates(
        data?.holdings || [],
        stackingEligibility?.eligiblePlayers || [],
        "ALL",
      ),
    [data?.holdings, stackingEligibility?.eligiblePlayers],
  );

  const stackingCandidates = useMemo(
    () =>
      buildStackingCandidates(
        data?.holdings || [],
        stackingEligibility?.eligiblePlayers || [],
        sport,
      ),
    [data?.holdings, stackingEligibility?.eligiblePlayers, sport],
  );

  const selectedStackingCandidate = useMemo(
    () =>
      allStackingCandidates.find(
        (candidate) => candidate.playerId === selectedPlayerForStacking?.id,
      ) || null,
    [allStackingCandidates, selectedPlayerForStacking?.id],
  );

  const stackingDialogPlayerName = useMemo(() => {
    if (selectedStackingCandidate) {
      const fullName =
        `${selectedStackingCandidate.player.firstName || ""} ${selectedStackingCandidate.player.lastName || ""}`.trim();
      return fullName || selectedPlayerForStacking?.name || "Selected player";
    }

    return selectedPlayerForStacking?.name || "Selected player";
  }, [selectedPlayerForStacking?.name, selectedStackingCandidate]);

  // Render sort icon for column header
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    }
    return sortDirection === "asc" ? (
      <ChevronUp className="w-3 h-3 ml-1" />
    ) : (
      <ChevronDown className="w-3 h-3 ml-1" />
    );
  };

  if (isLoading) {
    return (
      <div className="terminal-page p-3 sm:p-4">
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
    <div ref={containerRef} className="terminal-page p-3 sm:p-4">
      <PullToRefreshIndicator pullProgress={pullDistance / 72} isRefreshing={isRefreshing} />
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
                    <div className="font-mono font-bold" data-testid="text-cash-balance">
                      ${data?.balance}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 text-center">
                    <div className="text-muted-foreground uppercase tracking-wide mb-0.5">
                      Portfolio
                    </div>
                    <div className="font-mono font-bold" data-testid="text-portfolio-value">
                      ${data?.portfolioValue}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 text-center">
                    <div className="text-muted-foreground uppercase tracking-wide mb-0.5">P&L</div>
                    <div
                      className={`font-mono font-bold ${parseFloat(data?.totalPnL || "0") >= 0 ? "text-positive" : "text-negative"}`}
                      data-testid="text-total-pnl"
                    >
                      {parseFloat(data?.totalPnL || "0") >= 0 ? "+" : ""}${data?.totalPnL}
                    </div>
                  </div>
                  <Link href="/premium">
                    <div
                      className="flex-1 min-w-0 text-right cursor-pointer hover-elevate rounded-control p-1 -m-1"
                      data-testid="link-premium-mobile"
                    >
                      <div className="flex items-center justify-end gap-1 text-muted-foreground uppercase tracking-wide mb-0.5">
                        <Crown className="w-3 h-3 text-premium" />
                        <span>Premium</span>
                        <Plus className="w-3 h-3 text-premium" />
                      </div>
                      <div
                        className="font-mono font-bold text-premium"
                        data-testid="text-premium-shares"
                      >
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
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">
                    Cash Balance
                  </CardTitle>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div
                    className="text-lg font-mono font-bold"
                    data-testid="text-cash-balance-desktop"
                  >
                    ${data?.balance}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">
                    Portfolio Value
                  </CardTitle>
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div
                    className="text-lg font-mono font-bold"
                    data-testid="text-portfolio-value-desktop"
                  >
                    ${data?.portfolioValue}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium uppercase tracking-wide">
                    Total P&L
                  </CardTitle>
                  {parseFloat(data?.totalPnL || "0") >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-positive" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-negative" />
                  )}
                </CardHeader>
                <CardContent>
                  <div
                    className={`text-lg font-mono font-bold ${parseFloat(data?.totalPnL || "0") >= 0 ? "text-positive" : "text-negative"}`}
                    data-testid="text-total-pnl-desktop"
                  >
                    {parseFloat(data?.totalPnL || "0") >= 0 ? "+" : ""}${data?.totalPnL}
                  </div>
                  <div
                    className={`text-xs ${parseFloat(data?.totalPnL || "0") >= 0 ? "text-positive" : "text-negative"}`}
                  >
                    {parseFloat(data?.totalPnL || "0") >= 0 ? "+" : ""}
                    {data?.totalPnLPercent}%
                  </div>
                </CardContent>
              </Card>

              <Card
                variant="terminal"
                className={`${data?.isPremium ? "border-premium/30 bg-premium/5" : ""} hover-elevate cursor-pointer`}
              >
                <Link href="/premium">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium uppercase tracking-wide">
                      Premium Shares
                    </CardTitle>
                    <div className="flex items-center gap-1">
                      <Crown className="w-4 h-4 text-premium" />
                      <Plus
                        className="w-4 h-4 text-premium"
                        data-testid="button-add-premium-desktop"
                      />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div
                      className="text-lg font-mono font-bold text-premium"
                      data-testid="text-premium-shares-desktop"
                    >
                      {data?.premiumShares || 0}
                    </div>
                    {data?.isPremium && data?.premiumExpiresAt && (
                      <div className="text-xs text-muted-foreground">
                        Expires{" "}
                        {formatDistanceToNow(new Date(data.premiumExpiresAt), { addSuffix: true })}
                      </div>
                    )}
                    {!data?.isPremium && (data?.premiumShares || 0) > 0 && (
                      <Button
                        size="sm"
                        variant="terminalOutline"
                        className="mt-2 h-7 text-xs border-premium/50 text-premium hover:bg-premium/10"
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
        <Card variant="terminal" className="mb-4 sm:mb-4 relative overflow-hidden">
          <CardAccent variant="top" color="primary" intensity="medium" />
          <BackgroundPattern variant="grid" color="primary" opacity={0.02} />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium uppercase tracking-wide">
              Portfolio Value
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {heldPlayers.length > 0 && (
                <Select
                  value={benchmarkPlayerId ?? "none"}
                  onValueChange={(v) => setBenchmarkPlayerId(v === "none" ? null : v)}
                >
                  <SelectTrigger className="h-7 w-36 text-xs border-border/50">
                    <SelectValue placeholder="vs. player..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No comparison</SelectItem>
                    {heldPlayers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex gap-1">
                {["1D", "7D", "1M", "1Y", "ALL"].map((range) => (
                  <Button
                    key={range}
                    variant={chartTimeRange === range ? "terminal" : "terminalOutline"}
                    size="sm"
                    onClick={() => setChartTimeRange(range)}
                    className="h-7 px-2 text-xs"
                    data-testid={`button-chart-${range.toLowerCase()}`}
                  >
                    {range}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2 relative z-10">
            {chartData && chartData.history.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={mergedChartData}>
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
                    yAxisId="left"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                  />
                  {benchmarkPlayerId && (
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#f59e0b"
                      fontSize={10}
                      tickFormatter={(value) => `$${parseFloat(value).toFixed(2)}`}
                    />
                  )}
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    formatter={(value: any, name: string) => {
                      const formatted = `$${parseFloat(value).toFixed(2)}`;
                      if (name === "benchmarkPrice") {
                        const player = heldPlayers.find((p) => p.id === benchmarkPlayerId);
                        return [formatted, player?.name ?? "Player"];
                      }
                      return [formatted, "Portfolio Value"];
                    }}
                    labelFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleDateString();
                    }}
                  />
                  {benchmarkPlayerId && <Legend />}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="portfolioValue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={true}
                    animationDuration={1200}
                    animationEasing="ease-out"
                    name="Portfolio"
                  />
                  {benchmarkPlayerId && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="benchmarkPrice"
                      stroke="#f59e0b"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                      connectNulls={true}
                      isAnimationActive={false}
                      name={heldPlayers.find((p) => p.id === benchmarkPlayerId)?.name ?? "Player"}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div
                className="h-[200px] flex items-center justify-center text-sm text-muted-foreground"
                data-testid="text-no-chart-data"
              >
                No historical data available yet. Portfolio snapshots are created daily.
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3 sm:space-y-3">
          <div className="flex items-center justify-between gap-2">
            <TabsList
              variant="terminal"
              className="grid flex-1 min-w-0 grid-cols-4 justify-stretch sm:w-auto sm:flex-none"
            >
              <TabsTrigger
                variant="terminal"
                value="holdings"
                data-testid="tab-holdings"
                aria-label="Portfolio holdings"
                title="Portfolio"
                className="h-9 px-0"
              >
                <Briefcase className="h-4 w-4" />
                <span className="sr-only">Portfolio</span>
              </TabsTrigger>
              <TabsTrigger
                variant="terminal"
                value="stacking"
                data-testid="tab-stacking"
                aria-label="Stacking"
                title="Stacking"
                className="h-9 px-0"
              >
                <Database className="h-4 w-4" />
                <span className="sr-only">Stacking</span>
              </TabsTrigger>
              <TabsTrigger
                variant="terminal"
                value="liquidity"
                data-testid="tab-liquidity"
                aria-label="Liquidity"
                title="Liquidity"
                className="h-9 px-0"
              >
                <Droplets className="h-4 w-4" />
                <span className="sr-only">Liquidity</span>
              </TabsTrigger>
              <TabsTrigger
                variant="terminal"
                value="activity"
                data-testid="tab-activity"
                aria-label="Activity"
                title="Activity"
                className={
                  unreadCount > 0
                    ? "relative h-9 px-0 ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "relative h-9 px-0"
                }
              >
                <FileText className="h-4 w-4" />
                <span className="sr-only">Activity</span>
                <AnimatePresence>
                  {unreadCount > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="absolute right-1.5 top-1.5"
                    >
                      <Badge
                        variant="default"
                        className="flex h-4 min-w-4 items-center justify-center px-1 text-[10px] font-bold"
                        data-testid="badge-activity-count"
                      >
                        {unreadCount}
                      </Badge>
                    </motion.span>
                  )}
                </AnimatePresence>
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              {/* View Toggle - Holdings only */}
              {activeTab === "holdings" && (
                <div className="terminal-shell flex items-center p-1">
                  <Button
                    variant={viewMode === "card" ? "terminal" : "terminalOutline"}
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handleViewModeChange("card")}
                    data-testid="button-view-card"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "terminal" : "terminalOutline"}
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handleViewModeChange("list")}
                    data-testid="button-view-list"
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>
              )}
              <Link href="/analytics">
                <Button
                  variant="terminalOutline"
                  size="sm"
                  className="gap-2 bg-primary/5 border-primary/30 hover:bg-primary/10"
                  data-testid="button-analytics-portfolio"
                >
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
                <CardTitle className="text-sm font-medium uppercase tracking-wide">
                  Your Holdings
                </CardTitle>
                {/* Mobile sort dropdown */}
                <div className="sm:hidden flex items-center gap-2">
                  <Select value={sortField} onValueChange={(val) => setSortField(val as SortField)}>
                    <SelectTrigger
                      className="h-8 text-xs w-[100px]"
                      data-testid="select-mobile-sort-field"
                    >
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      {SORT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))}
                    data-testid="button-mobile-sort-direction"
                  >
                    {sortDirection === "asc" ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!data?.premiumShares && sortedHoldings.length === 0 ? (
                  <EmptyState
                    icon="wallet"
                    title="Your portfolio is empty"
                    description="Start trading to build your portfolio. Browse player pools to find players to invest in."
                    action={{
                      label: "Browse Player Pools",
                      onClick: () => (window.location.href = "/pools"),
                    }}
                    size="sm"
                    className="py-8"
                    data-testid="empty-holdings"
                  />
                ) : viewMode === "card" ? (
                  <PortfolioCardView
                    holdings={sortedHoldings}
                    lpPositions={lpPositions}
                    onStackShares={openStackSharesDialog}
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
                            onClick={() => handleSort("name")}
                            data-testid="th-sort-name"
                          >
                            <span className="flex items-center">
                              Asset
                              <SortIcon field="name" />
                            </span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort("singles")}
                            data-testid="th-sort-singles"
                          >
                            <span className="flex items-center justify-end">
                              Shares
                              <SortIcon field="singles" />
                            </span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort("stackPower")}
                            data-testid="th-sort-power"
                          >
                            <span className="flex items-center justify-end">
                              Power
                              <SortIcon field="stackPower" />
                            </span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort("avgCost")}
                            data-testid="th-sort-avgcost"
                          >
                            <span className="flex items-center justify-end">
                              Avg
                              <SortIcon field="avgCost" />
                            </span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden md:table-cell cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort("price")}
                            data-testid="th-sort-price"
                          >
                            <span className="flex items-center justify-end">
                              Price
                              <SortIcon field="price" />
                            </span>
                          </th>
                          <th
                            className="text-right px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden xl:table-cell cursor-pointer hover:text-foreground select-none"
                            onClick={() => handleSort("value")}
                            data-testid="th-sort-value"
                          >
                            <span className="flex items-center justify-end">
                              Value
                              <SortIcon field="value" />
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data?.premiumShares ?? 0) > 0 && data && (
                          <tr
                            className="border-b border-border bg-premium/5 hover-elevate"
                            data-testid="row-premium-shares"
                          >
                            {/* Mobile layout */}
                            <td className="px-2 py-2 sm:hidden" colSpan={6}>
                              <div className="flex items-start gap-2">
                                <div className="terminal-avatar mt-0.5 flex-shrink-0 border-premium/20 bg-premium/10 text-premium">
                                  <Crown className="h-4 w-4 text-premium" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="truncate text-sm font-medium text-premium">
                                      Premium Share
                                    </div>
                                    {data.isPremium ? (
                                      <span className="rounded-compact border border-premium/30 bg-premium/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-premium">
                                        Active
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    Qty {formatStackNumber(toFiniteNumber(data.premiumShares))} · 30
                                    days access
                                  </div>
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {premiumMarketData?.lastTradePrice !== null &&
                                    premiumMarketData?.lastTradePrice !== undefined
                                      ? `Last $${premiumMarketData.lastTradePrice.toFixed(2)} · Value $${(toFiniteNumber(data.premiumShares) * premiumMarketData.lastTradePrice).toFixed(2)}`
                                      : "No trades"}
                                  </div>
                                  {!data.isPremium && (
                                    <Button
                                      size="sm"
                                      onClick={() => redeemPremiumMutation.mutate()}
                                      disabled={redeemPremiumMutation.isPending}
                                      variant="ghost"
                                      className="mt-1 h-6 px-0 text-[10px] text-premium hover:text-premium"
                                      data-testid="button-redeem-premium"
                                    >
                                      Redeem
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Desktop layout */}
                            <td className="px-2 py-1.5 hidden sm:table-cell">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <div className="terminal-avatar flex-shrink-0 border-premium/20 bg-premium/10 text-premium">
                                    <Crown className="w-4 h-4 text-premium" />
                                  </div>
                                  <div>
                                    <div className="font-medium text-sm text-premium">
                                      Premium Share
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      30 Days Access
                                    </div>
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => redeemPremiumMutation.mutate()}
                                  disabled={redeemPremiumMutation.isPending || data.isPremium}
                                  variant="terminal"
                                  className="border-premium/40 bg-premium text-premium-foreground hover:bg-premium/90"
                                  data-testid="button-redeem-premium-desktop"
                                >
                                  {data.isPremium ? "Active" : "Redeem"}
                                </Button>
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono hidden sm:table-cell text-premium font-bold">
                              {data.premiumShares}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono hidden sm:table-cell text-premium">
                              -
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono hidden sm:table-cell text-premium">
                              -
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono hidden md:table-cell text-premium">
                              {premiumMarketData?.lastTradePrice !== null &&
                              premiumMarketData?.lastTradePrice !== undefined
                                ? `$${premiumMarketData.lastTradePrice.toFixed(2)}`
                                : "-"}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono hidden xl:table-cell text-premium font-bold">
                              {premiumMarketData?.lastTradePrice !== null &&
                              premiumMarketData?.lastTradePrice !== undefined
                                ? `$${(data.premiumShares * premiumMarketData.lastTradePrice).toFixed(2)}`
                                : "-"}
                            </td>
                          </tr>
                        )}
                        {sortedHoldings.map((group) => {
                          const hasRegularShares = group.regular !== null;
                          const singlesCount = Math.max(0, group.singlesCount);
                          const availableSingles = Math.max(0, group.availableSingles);
                          const stackPower = Math.max(0, group.stackPower);
                          const stackStatus = getCompactStackStatus({
                            availableSingles,
                            stackPower,
                          });

                          return (
                            <Collapsible key={group.player.id} asChild>
                              <>
                                {/* Main row - always visible */}
                                <tr
                                  className="border-b last:border-0 hover-elevate"
                                  data-testid={`row-holding-${group.player.id}`}
                                >
                                  {/* Mobile layout */}
                                  <td className="px-2 py-2 sm:hidden" colSpan={6}>
                                    <CollapsibleTrigger asChild>
                                      <button
                                        type="button"
                                        className="w-full text-left"
                                        data-testid={`button-expand-mobile-${group.player.id}`}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex min-w-0 flex-1 items-start gap-2">
                                            <div className="terminal-avatar mt-0.5 flex-shrink-0">
                                              <span className="font-bold text-xs">
                                                {group.player.firstName[0]}
                                                {group.player.lastName[0]}
                                              </span>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <div className="flex items-center justify-between gap-2">
                                                <div className="min-w-0 flex items-center gap-1.5">
                                                  <PlayerName
                                                    playerId={group.player.id}
                                                    firstName={group.player.firstName}
                                                    lastName={group.player.lastName}
                                                    className="truncate text-sm font-medium"
                                                  />
                                                  <span className="shrink-0 rounded-compact border border-border/70 bg-muted/20 px-1.5 py-0.5 font-mono text-[10px]">
                                                    S {formatMobileCompactUnits(singlesCount)}
                                                  </span>
                                                  <span className="shrink-0 rounded-compact border border-category-stacking/30 bg-category-stacking/10 px-1.5 py-0.5 font-mono text-[10px] text-category-stacking">
                                                    P {formatMobileCompactUnits(stackPower)}p
                                                  </span>
                                                </div>
                                                <span className="font-mono text-sm font-semibold">
                                                  ${group.currentValue}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between gap-2 text-xs">
                                                <span className="truncate text-muted-foreground">
                                                  {group.player.team} / {group.player.position}
                                                </span>
                                                <span
                                                  className={`font-mono font-semibold ${
                                                    toFiniteNumber(group.pnl) >= 0
                                                      ? "text-positive"
                                                      : "text-negative"
                                                  }`}
                                                >
                                                  {toFiniteNumber(group.pnl) >= 0 ? "+" : ""}$
                                                  {group.pnl}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                          <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-90" />
                                        </div>
                                      </button>
                                    </CollapsibleTrigger>
                                  </td>

                                  {/* Desktop layout */}
                                  <td className="px-2 py-1.5 hidden sm:table-cell">
                                    <div className="flex items-center gap-2">
                                      <CollapsibleTrigger asChild>
                                        <Button
                                          variant="terminalOutline"
                                          size="sm"
                                          className="p-0 hover:bg-transparent"
                                          data-testid={`button-expand-${group.player.id}`}
                                        >
                                          <ChevronRight className="w-4 h-4 mr-1 transition-transform data-[state=open]:rotate-90" />
                                        </Button>
                                      </CollapsibleTrigger>
                                      <div className="terminal-avatar flex-shrink-0">
                                        <span className="font-bold text-xs">
                                          {group.player.firstName[0]}
                                          {group.player.lastName[0]}
                                        </span>
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
                                            <Badge
                                              variant="outline"
                                              className="text-[10px] h-4 px-1 border-category-stacking/50 text-category-stacking bg-category-stacking/10"
                                            >
                                              {group.totalPower} effective
                                            </Badge>
                                          )}
                                        </div>
                                        <div className="text-xs text-muted-foreground hidden md:inline">
                                          {group.player.team} / {group.player.position}
                                        </div>
                                        <div className="text-xs text-muted-foreground md:hidden">
                                          {group.player.team} / {group.player.position}
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-7 px-2 text-xs ml-2 hidden md:inline-flex"
                                          asChild
                                          data-testid={`button-trade-desktop-${group.player.id}`}
                                        >
                                          <Link href={`/player/${group.player.id}`}>
                                            <ArrowRightLeft className="w-3 h-3 mr-1" />
                                            Trade
                                          </Link>
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-7 px-2 text-xs hidden md:inline-flex"
                                          asChild
                                          data-testid={`button-boost-desktop-${group.player.id}`}
                                        >
                                          <Link href={`/boosts?preselect=${group.player.id}`}>
                                            <Zap className="w-3 h-3 mr-1" />
                                            Boost
                                          </Link>
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-7 px-2 text-xs ml-2 hidden md:inline-flex"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setLocation(
                                              `/player/${group.player.id}?panel=lp&lpTab=zap`,
                                            );
                                          }}
                                          data-testid={`button-pool-desktop-${group.player.id}`}
                                        >
                                          <Droplets className="w-3 h-3 mr-1" />
                                          Pool
                                        </Button>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono text-sm hidden sm:table-cell">
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span title="Shares">
                                        {formatPortfolioUnits(singlesCount)}
                                      </span>
                                      {availableSingles < singlesCount && (
                                        <span
                                          className="text-[10px] text-muted-foreground"
                                          title="Unlocked shares available for stacking/actions"
                                        >
                                          {formatPortfolioUnits(availableSingles)} avail
                                        </span>
                                      )}
                                      {/* P&L quick read in list view */}
                                      <button
                                        className={`text-xs font-medium hover:underline cursor-pointer text-right ${
                                          parseFloat(group.pnl) >= 0
                                            ? "text-positive hover:text-market-positive"
                                            : "text-negative hover:text-market-negative"
                                        }`}
                                        title="Open stacking"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (hasRegularShares && availableSingles >= 4) {
                                            openStackSharesDialog(
                                              group.player.id,
                                              `${group.player.firstName} ${group.player.lastName}`,
                                              availableSingles,
                                            );
                                          }
                                        }}
                                        data-testid={`button-pl-${group.player.id}`}
                                      >
                                        {parseFloat(group.pnl) >= 0 ? "+" : ""}${group.pnl}
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono text-sm hidden sm:table-cell">
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span
                                        className={`font-semibold ${
                                          stackPower > 0
                                            ? "text-category-stacking"
                                            : "text-muted-foreground"
                                        }`}
                                        title="Stack power"
                                      >
                                        {formatPortfolioUnits(stackPower)}p
                                      </span>
                                      {stackStatus.kind !== "none" && (
                                        <span className="text-[10px] text-muted-foreground">
                                          {stackStatus.label}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono text-sm hidden sm:table-cell">
                                    ${group.avgCostBasis}
                                  </td>
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
                                    <td colSpan={6} className="px-0">
                                      {(() => {
                                        // Build share holdings list with types
                                        const shareHoldings: Array<{
                                          id: string | undefined;
                                          type: "regular" | "stacked";
                                          quantity: number;
                                          multiplier: number;
                                          effectiveShares: string;
                                          availableQuantity: number;
                                        }> = [];

                                        if (hasRegularShares) {
                                          shareHoldings.push({
                                            id: group.regular!.id,
                                            type: "regular",
                                            quantity: group.regular!.quantity,
                                            multiplier: 1,
                                            effectiveShares: group.regular!.quantity.toFixed(2),
                                            availableQuantity: group.regular!.availableQuantity,
                                          });
                                        }

                                        group.stacked.forEach((share, idx) => {
                                          shareHoldings.push({
                                            id: share.id,
                                            type: "stacked",
                                            quantity: share.quantity,
                                            multiplier: share.multiplier,
                                            effectiveShares: share.effectiveShares,
                                            availableQuantity: share.availableQuantity,
                                          });
                                        });

                                        // Sort the holdings
                                        const sortedHoldings = [...shareHoldings].sort((a, b) => {
                                          const sortValA =
                                            expandedShareSortField === "quantity"
                                              ? a.quantity
                                              : a.multiplier;
                                          const sortValB =
                                            expandedShareSortField === "quantity"
                                              ? b.quantity
                                              : b.multiplier;
                                          return expandedShareSortDir === "asc"
                                            ? sortValA - sortValB
                                            : sortValB - sortValA;
                                        });

                                        const allHoldingIds = sortedHoldings
                                          .map((h) => h.id)
                                          .filter((id): id is string => !!id);
                                        const allSelected = allHoldingIds.every((id) =>
                                          selectedHoldingIds.has(id),
                                        );

                                        return (
                                          <div className="p-3">
                                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                              <Button
                                                size="sm"
                                                variant="terminalOutline"
                                                className="h-7 px-2 text-xs"
                                                asChild
                                              >
                                                <Link href={`/player/${group.player.id}`}>
                                                  <ArrowRightLeft className="mr-1 h-3 w-3" />
                                                  Trade
                                                </Link>
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="terminalOutline"
                                                className="h-7 px-2 text-xs"
                                                asChild
                                              >
                                                <Link href={`/boosts?preselect=${group.player.id}`}>
                                                  <Zap className="mr-1 h-3 w-3" />
                                                  Boost
                                                </Link>
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="terminalOutline"
                                                className="h-7 px-2 text-xs"
                                                onClick={() =>
                                                  setLocation(
                                                    `/player/${group.player.id}?panel=lp&lpTab=zap`,
                                                  )
                                                }
                                              >
                                                <Droplets className="mr-1 h-3 w-3" />
                                                Pool
                                              </Button>
                                              {hasRegularShares && availableSingles >= 4 && (
                                                <Button
                                                  size="sm"
                                                  variant="terminal"
                                                  className="h-7 px-2 text-xs"
                                                  onClick={() =>
                                                    openStackSharesDialog(
                                                      group.player.id,
                                                      `${group.player.firstName} ${group.player.lastName}`,
                                                      availableSingles,
                                                    )
                                                  }
                                                >
                                                  Stack
                                                </Button>
                                              )}
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 px-2 text-xs"
                                                onClick={() => {
                                                  setSelectedPlayerId(group.player.id);
                                                  setPlayerModalOpen(true);
                                                }}
                                              >
                                                View Player
                                              </Button>
                                            </div>
                                            <table className="w-full text-xs">
                                              <thead>
                                                <tr className="text-muted-foreground border-b border-border/50">
                                                  <th className="text-left pb-2 pl-1">
                                                    <input
                                                      type="checkbox"
                                                      checked={
                                                        allSelected && allHoldingIds.length > 0
                                                      }
                                                      onChange={(e) => {
                                                        if (e.target.checked) {
                                                          selectAllHoldings(allHoldingIds);
                                                        } else {
                                                          clearSelection();
                                                        }
                                                      }}
                                                      className="rounded-compact border-input"
                                                    />
                                                  </th>
                                                  <th
                                                    className="text-left pb-2 cursor-pointer hover:text-foreground"
                                                    onClick={() =>
                                                      handleExpandedShareSort("quantity")
                                                    }
                                                  >
                                                    <span className="flex items-center gap-1">
                                                      Qty
                                                      {expandedShareSortField === "quantity" &&
                                                        (expandedShareSortDir === "asc" ? (
                                                          <ChevronUp className="w-3 h-3" />
                                                        ) : (
                                                          <ChevronDown className="w-3 h-3" />
                                                        ))}
                                                    </span>
                                                  </th>
                                                  <th
                                                    className="text-left pb-2 cursor-pointer hover:text-foreground"
                                                    onClick={() =>
                                                      handleExpandedShareSort("multiplier")
                                                    }
                                                  >
                                                    <span className="flex items-center gap-1">
                                                      Multi
                                                      {expandedShareSortField === "multiplier" &&
                                                        (expandedShareSortDir === "asc" ? (
                                                          <ChevronUp className="w-3 h-3" />
                                                        ) : (
                                                          <ChevronDown className="w-3 h-3" />
                                                        ))}
                                                    </span>
                                                  </th>
                                                  <th className="text-right pb-2 pr-1">Action</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-border/30">
                                                {sortedHoldings.map((share, idx) => {
                                                  const holdingId = share.id || `temp-${idx}`;
                                                  const isSelected =
                                                    selectedHoldingIds.has(holdingId);
                                                  const isRegular = share.type === "regular";
                                                  const canStackMore = isRegular
                                                    ? share.availableQuantity >= 4
                                                    : true;

                                                  return (
                                                    <tr
                                                      key={holdingId}
                                                      className={`${isRegular ? "bg-market-positive/5" : "bg-category-stacking/5"} hover:bg-muted/50 transition-colors`}
                                                    >
                                                      <td className="py-2 pl-1">
                                                        <input
                                                          type="checkbox"
                                                          checked={isSelected}
                                                          onChange={() =>
                                                            toggleHoldingSelection(holdingId)
                                                          }
                                                          className="rounded-compact border-input"
                                                        />
                                                      </td>
                                                      <td className="py-2">
                                                        <span className="font-mono">
                                                          {share.quantity}
                                                        </span>
                                                        <span
                                                          className={`ml-1 text-[10px] ${isRegular ? "text-muted-foreground" : "text-category-stacking"}`}
                                                        >
                                                          @ {share.multiplier}x
                                                        </span>
                                                      </td>
                                                      <td className="py-2">
                                                        <span
                                                          className={`font-mono font-medium ${isRegular ? "text-muted-foreground" : "text-category-stacking"}`}
                                                        >
                                                          {share.effectiveShares}
                                                        </span>
                                                      </td>
                                                      <td className="py-2 pr-1 text-right">
                                                        {isRegular ? (
                                                          <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-6 bg-market-positive/10 px-2 text-xs text-market-positive hover:bg-hover"
                                                            onClick={() =>
                                                              openStackSharesFromExpanded(
                                                                group.player.id,
                                                                `${group.player.firstName} ${group.player.lastName}`,
                                                                share.availableQuantity,
                                                              )
                                                            }
                                                            disabled={!canStackMore}
                                                          >
                                                            Stack Shares
                                                          </Button>
                                                        ) : (
                                                          <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-6 bg-category-stacking/10 px-2 text-xs text-category-stacking"
                                                            disabled
                                                          >
                                                            Stacked
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
                                              <div className="mt-3 flex items-center justify-between bg-muted/50 rounded-compact p-2">
                                                <span className="text-xs text-muted-foreground">
                                                  {selectedHoldingIds.size} lot
                                                  {selectedHoldingIds.size > 1 ? "s" : ""} selected
                                                </span>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  className="h-7 border-category-stacking/40 bg-category-stacking/10 text-xs text-category-stacking hover:bg-hover hover:text-category-stacking"
                                                  onClick={() =>
                                                    openStackSharesFromExpanded(
                                                      group.player.id,
                                                      `${group.player.firstName} ${group.player.lastName}`,
                                                      group.regular?.availableQuantity || 0,
                                                    )
                                                  }
                                                >
                                                  Stack Selected
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

          <TabsContent value="stacking">
            <PortfolioStackingTab
              candidates={stackingCandidates}
              onSelectPlayer={(playerId) => {
                setSelectedPlayerId(playerId);
                setPlayerModalOpen(true);
              }}
              onStackShares={openStackSharesDialog}
            />
          </TabsContent>

          {/* Liquidity */}
          <TabsContent value="liquidity">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-sm font-medium uppercase tracking-wide">
                  Your Liquidity
                </CardTitle>
                {/* Sort dropdown for mobile */}
                {lpAggregates.sortedPositions.length > 1 && (
                  <Select
                    value={lpSortField}
                    onValueChange={(val) => setLpSortField(val as LpSortField)}
                  >
                    <SelectTrigger className="h-8 text-xs w-[100px]" data-testid="select-lp-sort">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="player">Player</SelectItem>
                      <SelectItem value="value">Value</SelectItem>
                      <SelectItem value="fees">Fees</SelectItem>
                      <SelectItem value="ownership">Pool %</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Auth check */}
                {!isAuthenticated && !authLoading ? (
                  <EmptyState
                    icon="wallet"
                    title="Sign in to view liquidity"
                    description="Log in to see your liquidity positions across player pools."
                    size="sm"
                    className="py-8"
                    data-testid="lp-auth-required"
                  />
                ) : lpLoading ? (
                  /* Loading state */
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="terminal-shell flex items-center gap-3 p-3">
                        <Shimmer
                          width="40px"
                          height="40px"
                          className="rounded-compact flex-shrink-0"
                        />
                        <div className="flex-1 space-y-2">
                          <Shimmer height="14px" width="60%" />
                          <Shimmer height="12px" width="80%" />
                        </div>
                        <Shimmer height="32px" width="70px" className="rounded-compact" />
                      </div>
                    ))}
                  </div>
                ) : lpError ? (
                  /* Error state */
                  <div className="text-center py-6">
                    <div className="text-sm text-destructive mb-2">
                      Failed to load liquidity positions
                    </div>
                    <Button
                      size="sm"
                      variant="terminalOutline"
                      onClick={() => lpRefetch()}
                      className="gap-2"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry
                    </Button>
                  </div>
                ) : lpAggregates.sortedPositions.length === 0 ? (
                  /* Empty state */
                  <EmptyState
                    icon="droplets"
                    title="No liquidity positions yet"
                    description="Add liquidity to player pools to earn fees from trading activity."
                    action={{
                      label: "Explore Player Pools",
                      onClick: () => (window.location.href = "/pools"),
                    }}
                    size="sm"
                    className="py-8"
                    data-testid="empty-liquidity"
                  />
                ) : (
                  <>
                    {/* Aggregate totals */}
                    <div className="terminal-shell grid grid-cols-2 gap-3 p-3">
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wide">
                          Total Value
                        </div>
                        <div className="font-mono font-bold text-lg">
                          {formatAdaptiveCurrency(lpAggregates.totalValue)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wide">
                          Total Fees Earned
                        </div>
                        <div className="font-mono font-bold text-lg text-positive">
                          {formatAdaptiveCurrency(lpAggregates.totalFees)}
                        </div>
                      </div>
                    </div>

                    {/* Position list - mobile-first card layout */}
                    <div className="divide-y rounded-control border">
                      {lpAggregates.sortedPositions.map((pos: any) => (
                        <div key={pos.playerId} className="p-3 hover-elevate">
                          {/* Mobile layout */}
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              className="text-left flex-1 min-w-0"
                              onClick={() => {
                                if (pos.player?.id || pos.playerId) {
                                  setSelectedPlayerId(String(pos.player?.id || pos.playerId));
                                  setPlayerModalOpen(true);
                                }
                              }}
                            >
                              <div className="font-medium text-sm truncate">
                                {pos.player?.name || pos.playerId}
                              </div>
                              {pos.player?.team && pos.player?.position && (
                                <div className="text-xs text-muted-foreground mb-1">
                                  {pos.player.team} | {pos.player.position}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                <span className="font-mono">
                                  {(Number(pos.ownershipPercentage || 0) * 100).toFixed(2)}% pool
                                  share
                                </span>
                                <span className="text-muted-foreground">|</span>
                                <span className="font-mono text-positive">
                                  Fees ${Number(pos.feesEarnedToDate || 0).toFixed(2)}
                                </span>
                              </div>
                              {pos.positionValue != null && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  Value:{" "}
                                  <span className="font-mono font-medium text-foreground">
                                    ${Number(pos.positionValue).toFixed(2)}
                                  </span>
                                  {pos.equivalentShares != null && (
                                    <span className="ml-2">
                                      ({Math.round(pos.equivalentShares)} shares)
                                    </span>
                                  )}
                                </div>
                              )}
                            </button>
                            <Link href={`/player/${pos.playerId}?panel=lp`}>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-3 text-xs flex-shrink-0"
                              >
                                <Droplets className="w-3 h-3 mr-1" />
                                Pool
                              </Button>
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Feed */}
          <TabsContent value="activity">
            <PortfolioActivityTab />
          </TabsContent>
        </Tabs>

        {/* Stack Shares Dialog */}
        <Dialog open={stackSharesDialogOpen} onOpenChange={setStackSharesDialogOpen}>
          <DialogContent className="sm:max-w-md rounded-compact border border-border bg-card">
            <DialogHeader>
              <DialogTitle>Stack Shares</DialogTitle>
              <DialogDescription>
                Convert unlocked shares into stack power. Every 2 shares add 1p, and one stack share
                carries that power into boost payouts.
              </DialogDescription>
            </DialogHeader>
            {selectedPlayerForStacking && (
              <div className="space-y-4 py-4">
                {/* Player info */}
                <div className="terminal-shell p-3">
                  <div className="font-medium">{stackingDialogPlayerName}</div>
                  {selectedStackingCandidate ? (
                    <div className="mt-1 space-y-1 text-sm text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Shares Available:</span>
                        <span className="font-mono">
                          {formatPortfolioUnits(selectedStackingCandidate.availableToStack)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Current Stack Power:</span>
                        <span className="font-mono text-category-stacking">
                          {formatPortfolioUnits(
                            Math.max(0, selectedStackingCandidate.bestStackedMultiplier),
                          )}
                          p
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-muted-foreground">
                      Stack details are refreshing. Close and reopen if this does not populate.
                    </div>
                  )}
                </div>

                {/* Share input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Shares to Add</label>
                  <Input
                    variant="terminal"
                    type="number"
                    value={sharesToStackInput}
                    onChange={(e) => setSharesToStackInput(e.target.value)}
                    placeholder="Enter shares to add"
                    min={4}
                    step={2}
                    max={
                      selectedStackingCandidate
                        ? Math.floor(selectedStackingCandidate.availableToStack)
                        : undefined
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Must be at least 4 unlocked shares and even. Every 2 shares add 1p to stack
                    power, and the other half are burned.
                  </p>
                </div>

                {/* Preview */}
                {(() => {
                  if (!selectedStackingCandidate) return null;
                  const shares = parseInt(sharesToStackInput);
                  const isValid =
                    !isNaN(shares) &&
                    shares >= 4 &&
                    shares % 2 === 0 &&
                    shares <= selectedStackingCandidate.availableToStack;
                  if (!isValid) return null;

                  const powerAdded = shares / 2;
                  const existingStackPower = Math.max(
                    0,
                    selectedStackingCandidate.bestStackedMultiplier,
                  );
                  const resultingStackPower = existingStackPower + powerAdded;
                  const remainingShares = selectedStackingCandidate.regularShares - shares;

                  return (
                    <div className="terminal-shell space-y-2 border-category-stacking/20 bg-category-stacking/10 p-3">
                      <div className="text-sm font-medium text-category-stacking">Stack Result</div>
                      <div className="flex justify-between text-sm">
                        <span>Shares consumed:</span>
                        <span className="font-mono">-{shares}</span>
                      </div>
                      <div className="flex justify-between text-sm font-medium">
                        <span>Added stack power:</span>
                        <span className="font-mono text-category-stacking">
                          +{formatPortfolioUnits(powerAdded)}p
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>New stack power:</span>
                        <span className="font-mono text-category-stacking">
                          {formatPortfolioUnits(resultingStackPower)}p
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Shares burned:</span>
                        <span className="font-mono">-{formatPortfolioUnits(powerAdded)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Shares remaining:</span>
                        <span className="font-mono">
                          {formatPortfolioUnits(Math.max(0, remainingShares))}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            <DialogFooter>
              <Button variant="terminalOutline" onClick={() => setStackSharesDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="terminal"
                onClick={handleStackSharesFromDialog}
                disabled={stackSharesMutation.isPending || !selectedStackingCandidate}
                className="border-category-stacking/40"
              >
                {stackSharesMutation.isPending ? "Stacking..." : "Stack Shares"}
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

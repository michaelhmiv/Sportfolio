import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUpDown, Crown, Droplets, LayoutGrid, List, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ShimmerCard } from "@/components/ui/animations";
import { SportSelector } from "@/components/sport-selector";
import { PortfolioActivityTab } from "@/components/portfolio-activity-tab";
import { PlayerModal } from "@/components/player-modal";
import { useAuth } from "@/hooks/useAuth";
import { useSport } from "@/lib/sport-context";
import { authenticatedFetch } from "@/lib/queryClient";
import { formatAdaptiveCurrency } from "@/lib/currency";
import type { Holding, Player } from "@shared/schema";

type PortfolioPosition = Holding & {
  player?: Player & {
    marketStatus?: "priced" | "unpriced";
    marketPrice?: number | null;
    poolTvl?: number | null;
  };
  currentValue: string | null;
  pnl: string | null;
  pnlPercent: string | null;
  lockedQuantity?: number;
  availableQuantity?: number;
  isCanonicalPosition: true;
  singles: number;
};

interface PortfolioData {
  balance: string;
  availableBalance?: string;
  portfolioValue: string;
  netWorth?: string;
  totalPnL: string;
  totalPnLPercent: string;
  totalSingles?: number;
  positions: PortfolioPosition[];
  holdings: Array<PortfolioPosition | Holding>;
  premiumShares: number;
  isPremium: boolean;
  premiumExpiresAt?: string;
  warnings?: string[];
}

type SortField = "name" | "singles" | "avgCost" | "price" | "value" | "pnl";
type SortDirection = "asc" | "desc";

type LpPosition = {
  playerId: string;
  player?: { firstName?: string; lastName?: string; name?: string };
  ownershipPercentage?: number | string;
  positionValue?: number | string | null;
  feesEarnedToDate?: number | string | null;
  equivalentShares?: number | string | null;
  equivalentPlayMoney?: number | string | null;
};

const SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: "value", label: "Value" },
  { value: "pnl", label: "P&L" },
  { value: "singles", label: "Singles" },
  { value: "price", label: "Price" },
  { value: "avgCost", label: "Avg cost" },
  { value: "name", label: "Name" },
];

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function playerName(position: PortfolioPosition): string {
  const first = position.player?.firstName || "";
  const last = position.player?.lastName || "";
  return `${first} ${last}`.trim() || position.assetId;
}

export default function Portfolio() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { sport } = useSport();
  const [activeTab, setActiveTab] = useState("holdings");
  const [sortField, setSortField] = useState<SortField>("value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [viewMode, setViewMode] = useState<"card" | "list">(() => {
    if (typeof window === "undefined") return "list";
    return (localStorage.getItem("portfolioViewMode") as "card" | "list") || "list";
  });
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerModalOpen, setPlayerModalOpen] = useState(false);

  const { data, isLoading } = useQuery<PortfolioData>({
    queryKey: ["/api/portfolio"],
    enabled: isAuthenticated,
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
  });

  const { data: lpPositions = [], isLoading: lpLoading } = useQuery<LpPosition[]>({
    queryKey: ["/api/lp/positions"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/lp/positions");
      if (!response.ok) throw new Error("Failed to fetch liquidity positions");
      return response.json();
    },
    enabled: isAuthenticated && activeTab === "liquidity",
    staleTime: 30_000,
  });

  const positions = useMemo(() => {
    const selectedSport = String(sport || "ALL").toUpperCase();
    const rows = (data?.positions || []).filter((position) => {
      if (!position.player) return false;
      return selectedSport === "ALL" || String(position.player.sport).toUpperCase() === selectedSport;
    });

    const sorted = [...rows].sort((left, right) => {
      const leftName = playerName(left).toLowerCase();
      const rightName = playerName(right).toLowerCase();
      let result = 0;
      switch (sortField) {
        case "name":
          result = leftName.localeCompare(rightName);
          break;
        case "singles":
          result = numberValue(left.singles) - numberValue(right.singles);
          break;
        case "avgCost":
          result = numberValue(left.avgCostBasis) - numberValue(right.avgCostBasis);
          break;
        case "price":
          result = numberValue(left.player?.marketPrice) - numberValue(right.player?.marketPrice);
          break;
        case "pnl":
          result = numberValue(left.pnl) - numberValue(right.pnl);
          break;
        case "value":
        default:
          result = numberValue(left.currentValue) - numberValue(right.currentValue);
          break;
      }
      return sortDirection === "asc" ? result : -result;
    });
    return sorted;
  }, [data?.positions, sport, sortField, sortDirection]);

  if (authLoading || isLoading) {
    return (
      <div className="terminal-page p-3 sm:p-4">
        <div className="mx-auto max-w-7xl space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <ShimmerCard lines={2} />
            <ShimmerCard lines={2} />
            <ShimmerCard lines={2} />
          </div>
          <ShimmerCard lines={8} />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="terminal-page p-3 sm:p-4">
        <div className="mx-auto max-w-4xl">
          <EmptyState
            icon="wallet"
            title="Sign in to view your portfolio"
            description="Your Singles, liquidity positions, player earnings, and activity appear here."
          />
        </div>
      </div>
    );
  }

  const pnl = numberValue(data?.totalPnL);
  const cash = numberValue(data?.balance);
  const portfolioValue = numberValue(data?.portfolioValue);
  const netWorth = numberValue(data?.netWorth ?? cash + portfolioValue);

  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold sm:text-xl">Portfolio</h1>
            <p className="text-xs text-muted-foreground">
              Singles earn player distributions and can be committed directly to Daily Boosts.
            </p>
          </div>
          <SportSelector />
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          <Card>
            <CardContent className="p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Cash</div>
              <div className="font-mono text-lg font-bold">{formatAdaptiveCurrency(cash)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Portfolio</div>
              <div className="font-mono text-lg font-bold">{formatAdaptiveCurrency(portfolioValue)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Net worth</div>
              <div className="font-mono text-lg font-bold">{formatAdaptiveCurrency(netWorth)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                <span>P&amp;L</span>
                {pnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              </div>
              <div className={`font-mono text-lg font-bold ${pnl >= 0 ? "text-positive" : "text-negative"}`}>
                {pnl >= 0 ? "+" : ""}{formatAdaptiveCurrency(pnl)}
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:min-w-[420px]">
            <TabsTrigger value="holdings">Singles</TabsTrigger>
            <TabsTrigger value="liquidity">Liquidity</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="holdings" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{positions.length} players</span>
                {data?.totalSingles != null && <span>· {numberValue(data.totalSingles).toLocaleString()} Singles</span>}
              </div>
              <div className="flex items-center gap-2">
                <Select value={sortField} onValueChange={(value) => setSortField(value as SortField)}>
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="terminalOutline"
                  size="sm"
                  onClick={() => setSortDirection((value) => (value === "asc" ? "desc" : "asc"))}
                >
                  {sortDirection === "asc" ? "Asc" : "Desc"}
                </Button>
                <div className="hidden gap-1 sm:flex">
                  <Button
                    size="icon"
                    variant={viewMode === "card" ? "terminal" : "ghost"}
                    onClick={() => {
                      setViewMode("card");
                      localStorage.setItem("portfolioViewMode", "card");
                    }}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant={viewMode === "list" ? "terminal" : "ghost"}
                    onClick={() => {
                      setViewMode("list");
                      localStorage.setItem("portfolioViewMode", "list");
                    }}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {positions.length === 0 ? (
              <EmptyState
                icon="wallet"
                title="No Singles held"
                description="Scout or buy player Singles to build a position and participate in player earnings."
              />
            ) : viewMode === "card" ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {positions.map((position) => {
                  const currentPnl = numberValue(position.pnl);
                  return (
                    <Card
                      key={position.assetId}
                      className="cursor-pointer hover-elevate"
                      onClick={() => {
                        setSelectedPlayerId(position.assetId);
                        setPlayerModalOpen(true);
                      }}
                    >
                      <CardContent className="space-y-3 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{playerName(position)}</div>
                            <div className="text-xs text-muted-foreground">
                              {position.player?.team} · {position.player?.sport}
                            </div>
                          </div>
                          <Badge variant="outline">{numberValue(position.singles).toLocaleString()} Singles</Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">Price</div>
                            <div className="font-mono">{position.player?.marketPrice == null ? "Unpriced" : formatAdaptiveCurrency(position.player.marketPrice)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Value</div>
                            <div className="font-mono">{position.currentValue == null ? "—" : formatAdaptiveCurrency(numberValue(position.currentValue))}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">P&amp;L</div>
                            <div className={`font-mono ${currentPnl >= 0 ? "text-positive" : "text-negative"}`}>
                              {currentPnl >= 0 ? "+" : ""}{formatAdaptiveCurrency(currentPnl)}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {numberValue(position.availableQuantity).toLocaleString()} available · {numberValue(position.lockedQuantity).toLocaleString()} committed/locked
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {positions.map((position) => {
                      const currentPnl = numberValue(position.pnl);
                      return (
                        <button
                          type="button"
                          key={position.assetId}
                          className="grid w-full grid-cols-[1fr_auto] items-center gap-3 p-3 text-left hover:bg-muted/40 sm:grid-cols-[minmax(180px,1fr)_100px_100px_110px]"
                          onClick={() => {
                            setSelectedPlayerId(position.assetId);
                            setPlayerModalOpen(true);
                          }}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{playerName(position)}</div>
                            <div className="text-xs text-muted-foreground">{position.player?.team} · {position.player?.sport}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-sm">{numberValue(position.singles).toLocaleString()}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">Singles</div>
                          </div>
                          <div className="hidden text-right sm:block">
                            <div className="font-mono text-sm">{position.currentValue == null ? "—" : formatAdaptiveCurrency(numberValue(position.currentValue))}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">Value</div>
                          </div>
                          <div className={`hidden text-right font-mono text-sm sm:block ${currentPnl >= 0 ? "text-positive" : "text-negative"}`}>
                            {currentPnl >= 0 ? "+" : ""}{formatAdaptiveCurrency(currentPnl)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-dashed">
              <CardContent className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">Want more upside on a game?</div>
                  <div className="text-xs text-muted-foreground">
                    Commit Singles directly to a Daily Boost. Boosted shares are permanently burned when the game begins.
                  </div>
                </div>
                <Link href="/boosts">
                  <Button size="sm">Open Boosts</Button>
                </Link>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="liquidity">
            {lpLoading ? (
              <ShimmerCard lines={6} />
            ) : lpPositions.length === 0 ? (
              <EmptyState icon="wallet" title="No liquidity positions" description="Provide liquidity to a player pool to see LP positions here." />
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {lpPositions.map((position) => {
                  const name = position.player?.name || `${position.player?.firstName || ""} ${position.player?.lastName || ""}`.trim() || position.playerId;
                  return (
                    <Card key={position.playerId}>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Droplets className="h-4 w-4" /> {name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-3 gap-2 text-xs">
                        <div><div className="text-muted-foreground">Value</div><div className="font-mono">{formatAdaptiveCurrency(numberValue(position.positionValue))}</div></div>
                        <div><div className="text-muted-foreground">Pool</div><div className="font-mono">{numberValue(position.ownershipPercentage).toFixed(2)}%</div></div>
                        <div><div className="text-muted-foreground">Fees</div><div className="font-mono">{formatAdaptiveCurrency(numberValue(position.feesEarnedToDate))}</div></div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="activity">
            <PortfolioActivityTab />
          </TabsContent>
        </Tabs>

        {(data?.premiumShares || 0) > 0 && (
          <Link href="/premium">
            <Card className="cursor-pointer border-premium/30 bg-premium/5 hover-elevate">
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2"><Crown className="h-4 w-4 text-premium" /><span className="text-sm font-medium">Premium Shares</span></div>
                <span className="font-mono font-bold text-premium">{data?.premiumShares || 0}</span>
              </CardContent>
            </Card>
          </Link>
        )}

        <PlayerModal
          playerId={selectedPlayerId}
          open={playerModalOpen}
          onOpenChange={setPlayerModalOpen}
        />
      </div>
    </div>
  );
}

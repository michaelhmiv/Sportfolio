import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CircleDollarSign,
  FlaskConical,
  Gauge,
  LineChart as LineChartIcon,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
  Waves,
  X,
} from "lucide-react";
import type {
  AnalyticsTimeRange,
  MarketCorrelation,
  MarketOverview,
  MarketScreenerRow,
  MarketSeries,
  MarketTapeItem,
} from "@shared/analytics-market";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCompactCurrency, formatStandardCurrency } from "@/lib/currency";
import { openPlayerModal } from "@/lib/player-modal-events";

const SPORTS = ["ALL", "MLB", "NASCAR", "NFL", "NHL"] as const;
const TIME_RANGES: Array<{ value: AnalyticsTimeRange; label: string }> = [
  { value: "1d", label: "1D" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];
const MARKET_SORTS = [
  ["marketCap", "Market cap"],
  ["volume", "Volume"],
  ["return", "Return"],
  ["netFlow", "Net flow"],
  ["turnover", "Turnover"],
  ["tvl", "TVL"],
  ["trades", "Trades"],
  ["depth", "5% depth"],
] as const;

type MarketSort = (typeof MARKET_SORTS)[number][0];
type TapeSide = "all" | "buy" | "sell" | "peer";

type MarketsResponse = {
  summary: string;
  sport: string;
  timeRange: AnalyticsTimeRange;
  sort: MarketSort;
  total: number;
  rows: MarketScreenerRow[];
  generatedAt: string;
};

type TapeResponse = {
  summary: string;
  sport: string;
  side: TapeSide;
  minNotional: number;
  items: MarketTapeItem[];
  generatedAt: string;
};

type CompareResponse = {
  summary: string;
  timeRange: AnalyticsTimeRange;
  rows: MarketScreenerRow[];
  generatedAt: string;
};

type CorrelationsResponse = {
  summary: string;
  timeRange: AnalyticsTimeRange;
  minSamples: number;
  methodology: string;
  pairs: MarketCorrelation[];
  generatedAt: string;
};

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value > 0) return `+${value.toFixed(digits)}%`;
  return `${value.toFixed(digits)}%`;
}

function formatRatio(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(value * 100 >= 10 ? 0 : 1)}%`;
}

function formatSignedCurrency(value: number) {
  if (!Number.isFinite(value) || value === 0) return "$0";
  return `${value > 0 ? "+" : "-"}${formatCompactCurrency(Math.abs(value))}`;
}

function movementClass(value: number | null | undefined) {
  if (value == null || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-market-positive" : "text-market-negative";
}

function flowClass(value: number) {
  if (value === 0) return "text-muted-foreground";
  return value > 0 ? "text-market-positive" : "text-market-negative";
}

function IndexSparkline({ points }: { points: MarketSeries["points"] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-compact border border-dashed border-border/70 text-sm text-muted-foreground">
        Index history will build as transactions accumulate.
      </div>
    );
  }

  const values = points.map((point) => point.indexValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const line = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 92 - ((point.indexValue - min) / spread) * 78;
      return `${x},${y}`;
    })
    .join(" ");
  const last = points[points.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Equal-weight index
          </p>
          <p className="text-2xl font-bold tabular-nums">{last.indexValue.toFixed(2)}</p>
        </div>
        <p className={movementClass(last.indexValue - 100)}>
          {formatPercent(last.indexValue - 100)}
        </p>
      </div>
      <svg viewBox="0 0 100 100" className="h-40 w-full overflow-visible" preserveAspectRatio="none">
        <line x1="0" x2="100" y1="50" y2="50" className="stroke-border" strokeWidth="0.5" />
        <polyline
          points={line}
          fill="none"
          className="stroke-primary"
          strokeWidth="2.2"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{points[0].date}</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: string;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className={`mt-1 truncate text-xl font-bold tabular-nums sm:text-2xl ${tone || ""}`}>
              {value}
            </p>
          </div>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function RegimeStrip({ overview }: { overview: MarketOverview }) {
  const netSupply = overview.supply?.netIssuance ?? 0;
  const items = [
    ["Breadth", `${overview.breadth.advancingPercent.toFixed(0)}% ↑`],
    ["Turnover", formatRatio(overview.turnover)],
    ["Net flow", formatSignedCurrency(overview.netFlow)],
    ["Net supply", overview.supply ? `${netSupply > 0 ? "+" : ""}${netSupply.toLocaleString()}` : "—"],
  ];

  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-compact border bg-card sm:grid-cols-4">
      {items.map(([label, value], index) => (
        <div
          key={label}
          className={`p-3 ${index % 2 === 0 ? "border-r" : ""} ${index < 2 ? "border-b sm:border-b-0" : ""} sm:border-r sm:last:border-r-0`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums">{value}</p>
        </div>
      ))}
    </div>
  );
}

function MarketRow({
  row,
  selected,
  onToggleResearch,
}: {
  row: MarketScreenerRow;
  selected: boolean;
  onToggleResearch: () => void;
}) {
  return (
    <div className="rounded-compact border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => openPlayerModal(row.playerId)}
          className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate font-semibold">{row.playerName}</p>
            {row.thinPool && <Badge variant="outline">Thin</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.sport} · {row.team || "No team"} · {row.position || "—"}
          </p>
        </button>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums">
            {row.price == null ? "Unpriced" : formatStandardCurrency(row.price)}
          </p>
          <p className={`text-xs font-semibold tabular-nums ${movementClass(row.periodReturnPct)}`}>
            {formatPercent(row.periodReturnPct)}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Volume</p>
          <p className="mt-0.5 font-semibold tabular-nums">{formatCompactCurrency(row.volume)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">TVL</p>
          <p className="mt-0.5 font-semibold tabular-nums">
            {row.tvl == null ? "—" : formatCompactCurrency(row.tvl)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Net flow</p>
          <p className={`mt-0.5 font-semibold tabular-nums ${flowClass(row.netFlow)}`}>
            {formatSignedCurrency(row.netFlow)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
        <span>{row.trades.toLocaleString()} trades · {formatRatio(row.turnover)} turnover</span>
        <Button variant={selected ? "secondary" : "ghost"} size="sm" onClick={onToggleResearch}>
          {selected ? <Check className="mr-1 h-3.5 w-3.5" /> : <FlaskConical className="mr-1 h-3.5 w-3.5" />}
          {selected ? "Selected" : "Research"}
        </Button>
      </div>
    </div>
  );
}

function TapeRow({ item }: { item: MarketTapeItem }) {
  const SideIcon = item.side === "buy" ? ArrowUpRight : item.side === "sell" ? ArrowDownRight : Activity;
  return (
    <button
      type="button"
      onClick={() => openPlayerModal(item.playerId)}
      className="w-full rounded-compact border bg-card p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SideIcon
              className={`h-4 w-4 shrink-0 ${item.side === "buy" ? "text-market-positive" : item.side === "sell" ? "text-market-negative" : "text-muted-foreground"}`}
            />
            <p className="truncate font-semibold">{item.playerName}</p>
            {item.isWhale && <Badge>Whale</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.side.toUpperCase()} · {item.quantity.toLocaleString()} sh @ {formatStandardCurrency(item.price)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold tabular-nums">{formatCompactCurrency(item.notional)}</p>
          <p className="text-[11px] text-muted-foreground">
            {new Date(item.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
      </div>
    </button>
  );
}

function ResearchTable({ rows }: { rows: MarketScreenerRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.playerId} className="rounded-compact border bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <button type="button" className="truncate font-semibold hover:underline" onClick={() => openPlayerModal(row.playerId)}>
              {row.playerName}
            </button>
            <span className={`font-bold tabular-nums ${movementClass(row.periodReturnPct)}`}>
              {formatPercent(row.periodReturnPct)}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div><p className="text-muted-foreground">Price</p><p className="font-semibold">{row.price == null ? "—" : formatStandardCurrency(row.price)}</p></div>
            <div><p className="text-muted-foreground">Market cap</p><p className="font-semibold">{row.marketCap == null ? "—" : formatCompactCurrency(row.marketCap)}</p></div>
            <div><p className="text-muted-foreground">TVL</p><p className="font-semibold">{row.tvl == null ? "—" : formatCompactCurrency(row.tvl)}</p></div>
            <div><p className="text-muted-foreground">Volume</p><p className="font-semibold">{formatCompactCurrency(row.volume)}</p></div>
            <div><p className="text-muted-foreground">Turnover</p><p className="font-semibold">{formatRatio(row.turnover)}</p></div>
            <div><p className="text-muted-foreground">Net flow</p><p className={`font-semibold ${flowClass(row.netFlow)}`}>{formatSignedCurrency(row.netFlow)}</p></div>
            <div><p className="text-muted-foreground">5% buy depth</p><p className="font-semibold">{row.buyDepth5Pct == null ? "—" : formatCompactCurrency(row.buyDepth5Pct)}</p></div>
            <div><p className="text-muted-foreground">5% sell depth</p><p className="font-semibold">{row.sellDepth5Pct == null ? "—" : formatCompactCurrency(row.sellDepth5Pct)}</p></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const [selectedSport, setSelectedSport] = useState("ALL");
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>("30d");
  const [marketSort, setMarketSort] = useState<MarketSort>("volume");
  const [marketSearch, setMarketSearch] = useState("");
  const [tapeSide, setTapeSide] = useState<TapeSide>("all");
  const [minNotional, setMinNotional] = useState("0");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);

  const overviewUrl = `/api/analytics/v2/overview?sport=${selectedSport}&timeRange=${timeRange}`;
  const seriesUrl = `/api/analytics/v2/series?sport=${selectedSport}&timeRange=${timeRange}`;
  const marketsUrl = `/api/analytics/v2/markets?sport=${selectedSport}&timeRange=${timeRange}&sort=${marketSort}&limit=60&search=${encodeURIComponent(marketSearch)}`;
  const tapeUrl = `/api/analytics/v2/tape?sport=${selectedSport}&side=${tapeSide}&limit=50&minNotional=${encodeURIComponent(minNotional || "0")}`;

  const { data: overview, isLoading: overviewLoading } = useQuery<MarketOverview>({
    queryKey: [overviewUrl],
    staleTime: 15_000,
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
  const { data: series } = useQuery<MarketSeries>({
    queryKey: [seriesUrl],
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
  const { data: markets, isLoading: marketsLoading } = useQuery<MarketsResponse>({
    queryKey: [marketsUrl],
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
  const { data: tape } = useQuery<TapeResponse>({
    queryKey: [tapeUrl],
    staleTime: 5_000,
    refetchInterval: 15_000,
    placeholderData: (previous) => previous,
  });

  const selectedIds = selectedPlayers.join(",");
  const { data: comparison } = useQuery<CompareResponse>({
    queryKey: [`/api/analytics/v2/compare?playerIds=${selectedIds}&timeRange=${timeRange}`],
    enabled: selectedPlayers.length > 0,
    staleTime: 15_000,
  });
  const { data: correlations } = useQuery<CorrelationsResponse>({
    queryKey: [
      `/api/analytics/v2/correlations?playerIds=${selectedIds}&timeRange=${timeRange}&minSamples=5`,
    ],
    enabled: selectedPlayers.length > 1,
    staleTime: 60_000,
  });

  const marketRows = Array.isArray(markets?.rows) ? markets.rows : [];
  const tapeItems = Array.isArray(tape?.items) ? tape.items : [];
  const selectedSet = useMemo(() => new Set(selectedPlayers), [selectedPlayers]);
  const selectedNames = useMemo(
    () =>
      selectedPlayers.map((playerId) => ({
        playerId,
        name: marketRows.find((row) => row.playerId === playerId)?.playerName ||
          comparison?.rows.find((row) => row.playerId === playerId)?.playerName ||
          playerId,
      })),
    [comparison?.rows, marketRows, selectedPlayers],
  );

  const toggleResearch = (playerId: string) => {
    setSelectedPlayers((current) => {
      if (current.includes(playerId)) return current.filter((id) => id !== playerId);
      if (current.length >= 8) return current;
      return [...current, playerId];
    });
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-3 pb-24 pt-4 sm:px-6 sm:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Market Intelligence</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Public Sportfolio economy, transaction flow, liquidity, and player-market research.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={selectedSport} onValueChange={setSelectedSport}>
            <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SPORTS.map((sport) => <SelectItem key={sport} value={sport}>{sport === "ALL" ? "All sports" : sport}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={(value) => setTimeRange(value as AnalyticsTimeRange)}>
            <SelectTrigger className="w-full sm:w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((range) => <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-4 p-1 sm:w-auto sm:min-w-[500px]">
          <TabsTrigger value="overview" className="px-2 text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="markets" className="px-2 text-xs sm:text-sm">Markets</TabsTrigger>
          <TabsTrigger value="tape" className="px-2 text-xs sm:text-sm">Tape</TabsTrigger>
          <TabsTrigger value="research" className="px-2 text-xs sm:text-sm">Research</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {overviewLoading && !overview ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading market state…</CardContent></Card>
          ) : overview ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
                <MetricCard label="Market index" value={formatPercent(overview.periodReturnPct)} detail={`${timeRange.toUpperCase()} equal-weight move`} icon={TrendingUp} tone={movementClass(overview.periodReturnPct)} />
                <MetricCard label="Market cap" value={formatCompactCurrency(overview.marketCap)} detail={`${overview.pricedMarkets} priced markets`} icon={CircleDollarSign} />
                <MetricCard label="TVL" value={formatCompactCurrency(overview.tvl)} detail={`${overview.thinPoolPercent.toFixed(0)}% thin pools`} icon={Waves} />
                <MetricCard label="Volume" value={formatCompactCurrency(overview.volume)} detail={`${overview.trades.toLocaleString()} trades`} icon={Activity} />
              </div>

              <RegimeStrip overview={overview} />

              {overview.snapshotHealth.isPartial && (
                <div className="flex items-start gap-2 rounded-compact border border-warning/40 bg-warning/10 p-3 text-sm">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-semibold">Historical snapshot coverage is incomplete</p>
                    <p className="text-xs text-muted-foreground">
                      {overview.snapshotHealth.snapshotCount} snapshots found · {overview.snapshotHealth.missingDates.length} missing dates. Live market metrics remain current.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><LineChartIcon className="h-4 w-4" />Sportfolio index</CardTitle>
                  </CardHeader>
                  <CardContent><IndexSparkline points={series?.points || []} /></CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Market condition</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><p className="text-xs text-muted-foreground">Liquidity use</p><p className="font-bold">{formatRatio(overview.liquidityUtilization)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Top-10 concentration</p><p className="font-bold">{overview.top10MarketCapShare.toFixed(1)}%</p></div>
                      <div><p className="text-xs text-muted-foreground">Average trade</p><p className="font-bold">{formatCompactCurrency(overview.averageTradeSize)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Whale volume</p><p className="font-bold">{formatCompactCurrency(overview.whaleVolume)}</p></div>
                    </div>
                    <div className="border-t pt-3">
                      <p className="text-xs text-muted-foreground">Breadth</p>
                      <div className="mt-1 flex gap-3 text-sm font-semibold">
                        <span className="text-market-positive">{overview.breadth.risers} up</span>
                        <span className="text-market-negative">{overview.breadth.fallers} down</span>
                        <span className="text-muted-foreground">{overview.breadth.flat} flat</span>
                      </div>
                    </div>
                    {overview.supply && (
                      <div className="border-t pt-3">
                        <p className="text-xs text-muted-foreground">Supply flow</p>
                        <p className="mt-1 text-sm font-semibold">+{overview.supply.sharesScouted.toLocaleString()} scouted · +{overview.supply.sharesVested.toLocaleString()} vested · −{overview.supply.sharesBurned.toLocaleString()} burned</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {selectedSport === "ALL" && overview.sports.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Where money is moving</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {overview.sports.map((sport) => (
                      <button key={sport.sport} type="button" onClick={() => setSelectedSport(sport.sport)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-compact border p-3 text-left hover:bg-muted/40">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><span className="font-semibold">{sport.sport}</span><span className={`text-sm font-semibold ${movementClass(sport.periodReturnPct)}`}>{formatPercent(sport.periodReturnPct)}</span></div>
                          <p className="mt-1 text-xs text-muted-foreground">{formatCompactCurrency(sport.marketCap)} cap · {formatCompactCurrency(sport.tvl)} TVL · {sport.trades.toLocaleString()} trades</p>
                        </div>
                        <div className="text-right"><p className="font-bold">{formatCompactCurrency(sport.volume)}</p><p className={`text-xs ${flowClass(sport.netFlow)}`}>{formatSignedCurrency(sport.netFlow)} flow</p></div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="markets" className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_190px]">
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={marketSearch} onChange={(event) => setMarketSearch(event.target.value)} placeholder="Search player, team, position…" className="pl-9" /></div>
            <Select value={marketSort} onValueChange={(value) => setMarketSort(value as MarketSort)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MARKET_SORTS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{markets?.total ?? 0} matching markets</span><span>Tap a player for full pool detail</span></div>
          {marketsLoading && marketRows.length === 0 ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading player markets…</CardContent></Card> : <div className="grid gap-2 lg:grid-cols-2">{marketRows.map((row) => <MarketRow key={row.playerId} row={row} selected={selectedSet.has(row.playerId)} onToggleResearch={() => toggleResearch(row.playerId)} />)}</div>}
        </TabsContent>

        <TabsContent value="tape" className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[180px_220px_auto]">
            <Select value={tapeSide} onValueChange={(value) => setTapeSide(value as TapeSide)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All trades</SelectItem><SelectItem value="buy">Pool buys</SelectItem><SelectItem value="sell">Pool sells</SelectItem><SelectItem value="peer">Peer trades</SelectItem></SelectContent></Select>
            <Input type="number" min="0" value={minNotional} onChange={(event) => setMinNotional(event.target.value)} placeholder="Minimum notional" />
            <div className="col-span-2 flex items-center justify-end text-xs text-muted-foreground sm:col-span-1"><Gauge className="mr-1 h-3.5 w-3.5" />Public transaction ledger</div>
          </div>
          <div className="space-y-2">{tapeItems.length ? tapeItems.map((item) => <TapeRow key={item.id} item={item} />) : <Card><CardContent className="p-6 text-sm text-muted-foreground">No transactions match these filters.</CardContent></Card>}</div>
        </TabsContent>

        <TabsContent value="research" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" />Research set</CardTitle></CardHeader>
            <CardContent>
              {selectedNames.length ? <div className="flex flex-wrap gap-2">{selectedNames.map((player) => <Badge key={player.playerId} variant="secondary" className="gap-1 py-1"><button type="button" onClick={() => openPlayerModal(player.playerId)}>{player.name}</button><button type="button" aria-label={`Remove ${player.name}`} onClick={() => toggleResearch(player.playerId)}><X className="h-3 w-3" /></button></Badge>)}</div> : <p className="text-sm text-muted-foreground">Add players from Markets to compare price, liquidity, flow, returns, and AMM depth.</p>}
              <p className="mt-2 text-xs text-muted-foreground">Up to 8 markets. Correlation requires at least 5 aligned daily observations.</p>
            </CardContent>
          </Card>

          {comparison?.rows?.length ? <><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">Absolute market comparison</h2></div><ResearchTable rows={comparison.rows} /></> : null}

          {selectedPlayers.length > 1 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />Return correlations</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {correlations?.pairs?.length ? correlations.pairs.map((pair) => <div key={`${pair.player1Id}:${pair.player2Id}`} className="flex items-center justify-between gap-3 rounded-compact border p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{pair.player1Name} ↔ {pair.player2Name}</p><p className="text-xs text-muted-foreground">Pearson · {pair.sampleCount} aligned daily observations</p></div><div className="shrink-0 text-right"><p className="text-lg font-bold tabular-nums">{pair.correlation.toFixed(2)}</p><p className="text-[11px] text-muted-foreground">−1 to +1</p></div></div>) : <p className="text-sm text-muted-foreground">Not enough aligned daily observations yet for a defensible correlation.</p>}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

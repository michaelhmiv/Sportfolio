import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Coins,
  DollarSign,
  Flame,
  GitCompare,
  Layers3,
  Link2,
  Search,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Player } from "@shared/schema";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnimatedNumber, FadeIn, StaggerContainer, StaggerItem } from "@/components/ui/animations";
import { BackgroundPattern, CardAccent } from "@/components/ui/decorative-elements";
import { formatCompactCurrency, formatStandardCurrency } from "@/lib/currency";
import { openPlayerModal } from "@/lib/player-modal-events";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildCompareRadarData,
  filterCorrelationsBySport,
  getCorrelationPairKey,
  type CorrelationPair,
} from "./analytics-helpers";

interface PowerRanking {
  rank: number;
  player: {
    id: string;
    firstName: string;
    lastName: string;
    team: string;
    position: string;
    lastTradePrice: string;
    volume24h: number;
    priceChange24h: string;
  };
  compositeScore: number;
  priceChange7d: number;
  avgFantasyPoints: number;
}

interface PositionRanking {
  position: string;
  players: {
    rank: number;
    player: {
      id: string;
      firstName: string;
      lastName: string;
      team: string;
      position: string;
      lastTradePrice: string;
      volume24h: number;
      priceChange24h: string;
    };
    avgFantasyPoints: number;
    priceChange7d: number;
  }[];
}

interface MarketHealth {
  transactions: number;
  transactionChange: number;
  volume: number;
  volumeChange: number;
  marketCap: number;
  marketCapChange: number;
  sharesMined: number;
  sharesBurned: number;
  totalShares: number;
  periodSharesMined: number;
  periodSharesBurned: number;
  timeSeries: {
    date: string;
    transactions: number;
    volume: number;
    marketCap: number;
  }[];
  shareEconomyTimeSeries: {
    date: string;
    sharesMined: number;
    sharesBurned: number;
  }[];
}

interface ComparisonPlayer {
  id: string;
  name: string;
  team: string;
  position: string;
  shares: number;
  marketCap: number;
  price: number;
  volume: number;
  priceChange24h: number;
  boostUsagePercent: number;
  timesUsedInBoosts: number;
  ammVolume: number;
  ammTrades: number;
  poolLiquidity: number;
  poolShares: number;
  ammVolumeHistory: { timestamp: string; volume: number }[];
}

interface SportBreakdown {
  sport: string;
  totalPlayers: number;
  activePlayers: number;
  totalVolume24h: number;
  totalMarketCap: number;
  avgPriceChange24h: number;
  tradesInRange: number;
  tradedVolumeInRange: number;
}

interface AnalyticsData {
  marketHealth: MarketHealth;
  powerRankings: PowerRanking[];
  positionRankings: PositionRanking[];
  sportBreakdown?: SportBreakdown[];
  marketStats: {
    totalVolume24h: number;
    totalTrades24h: number;
    avgPriceChange: number;
    mostActiveTeam: string;
  };
}

interface MarketSnapshot {
  date: string;
  marketCap: number;
  transactions: number;
  volume: number;
  sharesMined: number;
  sharesBurned: number;
  totalShares: number;
}

interface SnapshotsResponse {
  timeRange: string;
  startDate: string;
  endDate: string;
  snapshots: MarketSnapshot[];
}

type TimeRange = "7D" | "30D" | "3M" | "1Y" | "All";
type AnalyticsSection = "pulse" | "leaders" | "compare" | "relationships";
type MetricType =
  | "marketCap"
  | "transactions"
  | "volume"
  | "sharesMined"
  | "sharesBurned"
  | "totalShares";

type AccentColor = "primary" | "success" | "warning" | "destructive" | "premium";

const ALL_SPORTS = "ALL";
const MAX_COMPARE_PLAYERS = 5;

const ANALYTICS_COMPACT_TYPE = {
  pageTitle: "text-xl font-bold tracking-tight sm:text-2xl",
  sectionTitle: "terminal-heading text-sm font-medium uppercase tracking-wide",
  label: "text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs",
  meta: "text-[10px] text-muted-foreground sm:text-xs",
  body: "text-xs text-muted-foreground sm:text-sm",
  primaryValue: "font-mono text-base font-bold sm:text-xl",
  secondaryValue: "font-mono text-xs font-semibold sm:text-sm",
  heroValue: "font-mono text-3xl font-bold tracking-tight sm:text-4xl",
  chip: "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px]",
} as const;

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "7D": "7 Days",
  "30D": "30 Days",
  "3M": "3 Months",
  "1Y": "1 Year",
  All: "All Time",
};

const SECTION_LABELS: Record<AnalyticsSection, string> = {
  pulse: "Pulse",
  leaders: "Leaders",
  compare: "Compare",
  relationships: "Relationships",
};

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const metricDescriptors: Record<
  MetricType,
  {
    label: string;
    summary: string;
    icon: LucideIcon;
    accent: AccentColor;
    chartColor: string;
    surfaceClass: string;
  }
> = {
  marketCap: {
    label: "Market Cap",
    summary: "Total market value flowing through active player markets.",
    icon: BarChart3,
    accent: "primary",
    chartColor: "hsl(var(--primary))",
    surfaceClass: "border-primary/30 bg-primary/5 text-primary",
  },
  transactions: {
    label: "Transactions",
    summary: "Executed trades reflecting live market participation.",
    icon: Activity,
    accent: "warning",
    chartColor: "hsl(var(--chart-4))",
    surfaceClass: "border-yellow-500/30 bg-yellow-500/5 text-yellow-400",
  },
  volume: {
    label: "Volume",
    summary: "Cash moving through the market across the selected time range.",
    icon: DollarSign,
    accent: "success",
    chartColor: "hsl(var(--chart-2))",
    surfaceClass: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
  },
  sharesMined: {
    label: "Shares Scouted",
    summary: "Fresh scout output entering the economy over the current window.",
    icon: Sparkles,
    accent: "premium",
    chartColor: "hsl(var(--chart-5))",
    surfaceClass: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  },
  sharesBurned: {
    label: "Shares Burned",
    summary: "Supply removed through boost and settlement mechanics.",
    icon: Flame,
    accent: "destructive",
    chartColor: "hsl(var(--destructive))",
    surfaceClass: "border-red-500/30 bg-red-500/5 text-red-400",
  },
  totalShares: {
    label: "Total Shares",
    summary: "Current supply circulating across the live economy.",
    icon: Coins,
    accent: "primary",
    chartColor: "hsl(var(--chart-3))",
    surfaceClass: "border-sky-500/30 bg-sky-500/5 text-sky-300",
  },
};

function getSnapshotMetricValue(snapshot: MarketSnapshot, metric: MetricType) {
  return snapshot[metric];
}

function formatMetricValue(metric: MetricType, value: number, compact = false) {
  const absolute = Math.abs(value);

  if (metric === "marketCap" || metric === "volume") {
    const formatted = compact ? formatCompactCurrency(absolute) : formatStandardCurrency(absolute);
    return value < 0 ? `-${formatted}` : formatted;
  }

  if (compact) {
    const formatted = compactNumberFormatter.format(absolute);
    return value < 0 ? `-${formatted}` : formatted;
  }

  const formatted = integerFormatter.format(absolute);
  return value < 0 ? `-${formatted}` : formatted;
}

function formatSignedMetricValue(metric: MetricType, value: number, compact = false) {
  const formatted = formatMetricValue(metric, Math.abs(value), compact);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatSignedPercent(value: number) {
  if (value > 0) return `+${value.toFixed(1)}%`;
  if (value < 0) return `${value.toFixed(1)}%`;
  return "0.0%";
}

function getChangeTone(value: number) {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-muted-foreground";
}

function getChangeIcon(value: number) {
  if (value > 0) return ArrowUpRight;
  if (value < 0) return ArrowDownRight;
  return TrendingUp;
}

function getAnimatedMetricParts(metric: MetricType, value: number) {
  const absolute = Math.abs(value);
  let scaled = absolute;
  let suffix = "";

  if (absolute >= 1_000_000_000) {
    scaled = absolute / 1_000_000_000;
    suffix = "B";
  } else if (absolute >= 1_000_000) {
    scaled = absolute / 1_000_000;
    suffix = "M";
  } else if (absolute >= 1_000) {
    scaled = absolute / 1_000;
    suffix = "K";
  }

  const decimals =
    metric === "marketCap" || metric === "volume"
      ? scaled >= 100
        ? 0
        : 1
      : scaled >= 100
        ? 0
        : scaled >= 10
          ? 1
          : 0;

  return {
    value: scaled,
    decimals,
    prefix:
      metric === "marketCap" || metric === "volume"
        ? `${value < 0 ? "-" : ""}$`
        : value < 0
          ? "-"
          : "",
    suffix,
  };
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatLongDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getMetricChangeSummary(
  metric: MetricType,
  marketHealth: MarketHealth | undefined,
  snapshots: MarketSnapshot[],
) {
  if (!marketHealth) {
    return {
      value: 0,
      label: "No movement",
      detail: "Waiting for analytics data",
    };
  }

  if (metric === "marketCap") {
    return {
      value: marketHealth.marketCapChange,
      label: formatSignedPercent(marketHealth.marketCapChange),
      detail: "vs prior window",
    };
  }

  if (metric === "transactions") {
    return {
      value: marketHealth.transactionChange,
      label: formatSignedPercent(marketHealth.transactionChange),
      detail: "vs prior window",
    };
  }

  if (metric === "volume") {
    return {
      value: marketHealth.volumeChange,
      label: formatSignedPercent(marketHealth.volumeChange),
      detail: "vs prior window",
    };
  }

  if (metric === "sharesMined") {
    return {
      value: marketHealth.periodSharesMined,
      label: `+${formatMetricValue(metric, marketHealth.periodSharesMined, true)}`,
      detail: "added in range",
    };
  }

  if (metric === "sharesBurned") {
    return {
      value: marketHealth.periodSharesBurned,
      label: `+${formatMetricValue(metric, marketHealth.periodSharesBurned, true)}`,
      detail: "burned in range",
    };
  }

  const firstValue = snapshots.length > 0 ? getSnapshotMetricValue(snapshots[0], metric) : 0;
  const lastValue =
    snapshots.length > 0 ? getSnapshotMetricValue(snapshots[snapshots.length - 1], metric) : 0;
  const delta = lastValue - firstValue;

  return {
    value: delta,
    label: formatSignedMetricValue(metric, delta, true),
    detail: "net change in range",
  };
}

function getRelationshipLabel(value: number) {
  if (value >= 0.8) return "Locked together";
  if (value >= 0.65) return "Strong sync";
  if (value >= 0.5) return "Shared trend";
  return "Loose link";
}

function getShortName(name: string) {
  const parts = name.split(" ");
  if (parts.length === 1) {
    return name.slice(0, 10);
  }

  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function MetricSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) {
    return (
      <div className="h-14 rounded-sm border border-dashed border-border/60 bg-background/40" />
    );
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 44 - ((value - minValue) / range) * 32;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 48" className="h-14 w-full overflow-visible">
      <polyline
        fill="none"
        points={points}
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="100"
        cy={44 - ((values[values.length - 1] - minValue) / range) * 32}
        fill={color}
        r="3"
      />
    </svg>
  );
}

function AnimatedMetricValue({
  metric,
  value,
  className,
}: {
  metric: MetricType;
  value: number;
  className: string;
}) {
  const parts = getAnimatedMetricParts(metric, value);

  return (
    <AnimatedNumber
      value={parts.value}
      decimals={parts.decimals}
      prefix={parts.prefix}
      suffix={parts.suffix}
      className={className}
    />
  );
}

function RelationshipRadarSvg({
  pairs,
  playerById,
  activePairKey,
  onActivate,
}: {
  pairs: CorrelationPair[];
  playerById: Record<string, Player | undefined>;
  activePairKey: string | null;
  onActivate: (pairKey: string) => void;
}) {
  const nodeIds: string[] = [];
  for (const pair of pairs) {
    if (!nodeIds.includes(pair.player1Id)) {
      nodeIds.push(pair.player1Id);
    }
    if (!nodeIds.includes(pair.player2Id)) {
      nodeIds.push(pair.player2Id);
    }
    if (nodeIds.length >= 8) {
      break;
    }
  }

  if (nodeIds.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-sm border border-dashed border-border/70 bg-background/40 text-sm text-muted-foreground">
        No relationship data for this sport.
      </div>
    );
  }

  const visibleNodeIds = nodeIds.slice(0, 8);
  const visiblePairs = pairs.filter(
    (pair) => visibleNodeIds.includes(pair.player1Id) && visibleNodeIds.includes(pair.player2Id),
  );
  const size = 420;
  const center = size / 2;
  const radius = 145;
  const positions = visibleNodeIds.reduce<Record<string, { x: number; y: number }>>(
    (acc, nodeId, index) => {
      const angle = (Math.PI * 2 * index) / visibleNodeIds.length - Math.PI / 2;
      acc[nodeId] = {
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle),
      };
      return acc;
    },
    {},
  );

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-[320px] w-full rounded-sm border border-border/70 bg-background/40"
      data-testid="chart-relationship-radar"
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="hsl(var(--border) / 0.5)"
        strokeDasharray="4 8"
      />
      <circle
        cx={center}
        cy={center}
        r={radius * 0.6}
        fill="none"
        stroke="hsl(var(--border) / 0.35)"
        strokeDasharray="4 8"
      />
      <circle
        cx={center}
        cy={center}
        r={radius * 0.3}
        fill="none"
        stroke="hsl(var(--border) / 0.25)"
        strokeDasharray="4 8"
      />

      {visiblePairs.map((pair) => {
        const key = getCorrelationPairKey(pair);
        const pointA = positions[pair.player1Id];
        const pointB = positions[pair.player2Id];
        const isActive = key === activePairKey;

        return (
          <line
            key={key}
            x1={pointA.x}
            y1={pointA.y}
            x2={pointB.x}
            y2={pointB.y}
            stroke={isActive ? "hsl(var(--primary))" : "hsl(var(--border))"}
            strokeOpacity={isActive ? 1 : 0.7}
            strokeWidth={1 + pair.correlation * 5}
            onMouseEnter={() => onActivate(key)}
            onClick={() => onActivate(key)}
            style={{ cursor: "pointer" }}
          />
        );
      })}

      {visibleNodeIds.map((nodeId) => {
        const player = playerById[nodeId];
        const point = positions[nodeId];
        const isHighlighted = visiblePairs.some((pair) => {
          const key = getCorrelationPairKey(pair);
          return key === activePairKey && (pair.player1Id === nodeId || pair.player2Id === nodeId);
        });
        const label = player ? `${player.firstName[0]}${player.lastName[0]}` : nodeId.slice(0, 2);

        return (
          <g key={nodeId}>
            <circle
              cx={point.x}
              cy={point.y}
              r={isHighlighted ? 18 : 14}
              fill={isHighlighted ? "hsl(var(--primary))" : "hsl(var(--card))"}
              stroke="hsl(var(--border))"
              strokeWidth="2"
            />
            <text
              x={point.x}
              y={point.y + 4}
              fill={isHighlighted ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))"}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
            >
              {label}
            </text>
            <text
              x={point.x}
              y={point.y + 30}
              fill="hsl(var(--muted-foreground))"
              textAnchor="middle"
              fontSize="10"
            >
              {player ? getShortName(`${player.firstName} ${player.lastName}`) : nodeId.slice(0, 8)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Analytics() {
  const [timeRange, setTimeRange] = useState<TimeRange>("30D");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricType>("marketCap");
  const [selectedSport, setSelectedSport] = useState<string>(ALL_SPORTS);
  const [activeSection, setActiveSection] = useState<AnalyticsSection>("pulse");
  const [selectedSpotlightId, setSelectedSpotlightId] = useState<string | null>(null);
  const [compareSearchOpen, setCompareSearchOpen] = useState(false);
  const [compareSearchQuery, setCompareSearchQuery] = useState("");
  const [selectedRelationshipKey, setSelectedRelationshipKey] = useState<string | null>(null);
  const deferredCompareSearch = useDeferredValue(compareSearchQuery);
  const handleOpenPlayerModal = (
    event: React.MouseEvent | React.KeyboardEvent,
    playerId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    openPlayerModal(playerId);
  };
  const renderModalPlayerName = (playerId: string, label: string, className = "") => (
    <span
      role="button"
      tabIndex={0}
      onClick={(event) => handleOpenPlayerModal(event, playerId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          handleOpenPlayerModal(event, playerId);
        }
      }}
      className={`${className} cursor-pointer underline-offset-2 hover:underline focus-visible:underline`}
    >
      {label}
    </span>
  );

  const { data: analyticsData, isLoading } = useQuery<AnalyticsData>({
    queryKey: [`/api/analytics?timeRange=${timeRange}`],
    refetchInterval: 30000,
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
  });

  const { data: snapshotsData } = useQuery<SnapshotsResponse>({
    queryKey: [`/api/analytics/snapshots?timeRange=${timeRange}`],
    refetchInterval: 60000,
    staleTime: 60000,
    placeholderData: (previousData) => previousData,
  });

  const { data: comparisonData, isLoading: comparisonLoading } = useQuery<{
    players: ComparisonPlayer[];
  }>({
    queryKey: [
      `/api/analytics/compare?playerIds=${selectedPlayers.join(",")}&timeRange=${timeRange}`,
    ],
    enabled: selectedPlayers.length > 0,
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
  });

  const { data: correlationsData } = useQuery<CorrelationPair[]>({
    queryKey: ["/api/analytics/correlations"],
    refetchInterval: 60000,
    staleTime: 60000,
    placeholderData: (previousData) => previousData,
  });

  const { data: playersData } = useQuery<{ players: Player[] }>({
    queryKey: ["/api/players"],
    staleTime: 60000,
    placeholderData: (previousData) => previousData,
  });

  const marketHealth = analyticsData?.marketHealth;
  const snapshots = Array.isArray(snapshotsData?.snapshots) ? snapshotsData.snapshots : [];
  const allPlayers = useMemo(
    () => (Array.isArray(playersData?.players) ? playersData.players : []),
    [playersData?.players],
  );
  const playerById = useMemo(
    () =>
      allPlayers.reduce<Record<string, Player>>((acc, player) => {
        acc[player.id] = player;
        return acc;
      }, {}),
    [allPlayers],
  );

  const powerRankings = useMemo(
    () => (Array.isArray(analyticsData?.powerRankings) ? analyticsData.powerRankings : []),
    [analyticsData?.powerRankings],
  );
  const positionRankings = useMemo(
    () => (Array.isArray(analyticsData?.positionRankings) ? analyticsData.positionRankings : []),
    [analyticsData?.positionRankings],
  );
  const sportBreakdown = useMemo(
    () => (Array.isArray(analyticsData?.sportBreakdown) ? analyticsData.sportBreakdown : []),
    [analyticsData?.sportBreakdown],
  );
  const filteredPowerRankings = useMemo(
    () =>
      powerRankings.filter(
        (ranking) =>
          selectedSport === ALL_SPORTS ||
          allPlayers.length === 0 ||
          playerById[ranking.player.id]?.sport?.toUpperCase() === selectedSport,
      ),
    [allPlayers.length, playerById, powerRankings, selectedSport],
  );
  const filteredPositionRankings = useMemo(
    () =>
      positionRankings
        .map((positionRanking) => ({
          ...positionRanking,
          players: positionRanking.players.filter(
            (ranking) =>
              selectedSport === ALL_SPORTS ||
              allPlayers.length === 0 ||
              playerById[ranking.player.id]?.sport?.toUpperCase() === selectedSport,
          ),
        }))
        .filter((positionRanking) => positionRanking.players.length > 0),
    [allPlayers.length, playerById, positionRankings, selectedSport],
  );
  const filteredSportBreakdown = useMemo(
    () =>
      selectedSport === ALL_SPORTS
        ? sportBreakdown
        : sportBreakdown.filter((sport) => sport.sport === selectedSport),
    [selectedSport, sportBreakdown],
  );
  const recommendedComparePlayers = useMemo(
    () =>
      filteredPowerRankings
        .slice(0, 6)
        .map((ranking) => playerById[ranking.player.id])
        .filter((player): player is Player =>
          Boolean(player && player.isActive && !selectedPlayers.includes(player.id)),
        ),
    [filteredPowerRankings, playerById, selectedPlayers],
  );
  const filteredPlayerSearchResults = useMemo(
    () =>
      allPlayers
        .filter((player) => {
          if (
            !player.isActive ||
            selectedPlayers.includes(player.id) ||
            (selectedSport !== ALL_SPORTS &&
              allPlayers.length > 0 &&
              playerById[player.id]?.sport?.toUpperCase() !== selectedSport)
          ) {
            return false;
          }

          if (!deferredCompareSearch.trim()) {
            return true;
          }

          const haystack =
            `${player.firstName} ${player.lastName} ${player.team} ${player.position} ${player.sport || ""}`.toLowerCase();
          return haystack.includes(deferredCompareSearch.trim().toLowerCase());
        })
        .slice(0, 12),
    [allPlayers, deferredCompareSearch, playerById, selectedPlayers, selectedSport],
  );

  const spotlightRanking =
    filteredPowerRankings.find((ranking) => ranking.player.id === selectedSpotlightId) ??
    filteredPowerRankings[0] ??
    null;
  const spotlightPlayer = spotlightRanking ? playerById[spotlightRanking.player.id] : undefined;
  const selectedMetricDescriptor = metricDescriptors[selectedMetric];
  const SelectedMetricIcon = selectedMetricDescriptor.icon;
  const selectedMetricSeries = snapshots.map((snapshot) =>
    getSnapshotMetricValue(snapshot, selectedMetric),
  );
  const selectedMetricChange = getMetricChangeSummary(selectedMetric, marketHealth, snapshots);
  const selectedMetricCurrentValue = marketHealth ? marketHealth[selectedMetric] : 0;
  const pulseHigh = selectedMetricSeries.length > 0 ? Math.max(...selectedMetricSeries) : 0;
  const pulseLow = selectedMetricSeries.length > 0 ? Math.min(...selectedMetricSeries) : 0;
  const pulseAverage =
    selectedMetricSeries.length > 0
      ? selectedMetricSeries.reduce((sum, value) => sum + value, 0) / selectedMetricSeries.length
      : 0;
  const pulseDelta =
    selectedMetricSeries.length > 1
      ? selectedMetricSeries[selectedMetricSeries.length - 1] - selectedMetricSeries[0]
      : 0;
  const pulseAverageMovement =
    selectedMetricSeries.length > 1
      ? selectedMetricSeries
          .slice(1)
          .reduce((sum, value, index) => sum + Math.abs(value - selectedMetricSeries[index]), 0) /
        (selectedMetricSeries.length - 1)
      : 0;
  const pulseChartData = snapshots.map((snapshot) => ({
    date: snapshot.date,
    selectedValue: getSnapshotMetricValue(snapshot, selectedMetric),
    average: pulseAverage,
  }));
  const pulseChartConfig: ChartConfig = {
    selectedValue: {
      label: selectedMetricDescriptor.label,
      color: selectedMetricDescriptor.chartColor,
    },
    average: {
      label: "Period Avg",
      color: "hsl(var(--muted-foreground))",
    },
  };

  const comparisonPlayers = Array.isArray(comparisonData?.players) ? comparisonData.players : [];
  const radarData = buildCompareRadarData(comparisonPlayers);
  const radarChartConfig = comparisonPlayers.reduce<ChartConfig>((acc, player, index) => {
    acc[player.id] = {
      label: player.name,
      color: CHART_COLORS[index % CHART_COLORS.length],
    };
    return acc;
  }, {});
  const ammTrendMap = comparisonPlayers.reduce<Record<string, Record<string, number>>>(
    (acc, player) => {
      for (const historyPoint of player.ammVolumeHistory) {
        if (!acc[historyPoint.timestamp]) {
          acc[historyPoint.timestamp] = {};
        }

        acc[historyPoint.timestamp][player.id] = historyPoint.volume;
      }

      return acc;
    },
    {},
  );
  const ammTrendData = Object.entries(ammTrendMap)
    .sort(([left], [right]) => new Date(left).getTime() - new Date(right).getTime())
    .map(([timestamp, values]) => ({
      timestamp,
      ...values,
    }));
  const ammTrendConfig = comparisonPlayers.reduce<ChartConfig>((acc, player, index) => {
    acc[player.id] = {
      label: player.name,
      color: CHART_COLORS[index % CHART_COLORS.length],
    };
    return acc;
  }, {});

  const correlationPairs = Array.isArray(correlationsData) ? correlationsData : [];
  const filteredCorrelations = filterCorrelationsBySport(
    correlationPairs,
    playerById,
    selectedSport,
  );
  const relationshipPairs = filteredCorrelations.slice(0, 12);
  const activeRelationshipPair =
    relationshipPairs.find((pair) => getCorrelationPairKey(pair) === selectedRelationshipKey) ??
    relationshipPairs[0] ??
    null;
  const activeRelationshipKey = activeRelationshipPair
    ? getCorrelationPairKey(activeRelationshipPair)
    : null;
  const activeRelationshipPlayers = activeRelationshipPair
    ? {
        player1: playerById[activeRelationshipPair.player1Id],
        player2: playerById[activeRelationshipPair.player2Id],
      }
    : { player1: undefined, player2: undefined };

  const handlePlayerSelect = (playerId: string) => {
    if (selectedPlayers.includes(playerId)) {
      setSelectedPlayers(selectedPlayers.filter((id) => id !== playerId));
      return;
    }

    if (selectedPlayers.length >= MAX_COMPARE_PLAYERS) {
      return;
    }

    setSelectedPlayers([...selectedPlayers, playerId]);
    setCompareSearchQuery("");
    setCompareSearchOpen(false);
  };

  if (isLoading) {
    return (
      <div className="terminal-page p-3 sm:p-4">
        <div className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center">
          <div className="space-y-3 text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-sm border-b-2 border-primary" />
            <p className={ANALYTICS_COMPACT_TYPE.body}>Loading market command center...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-page p-3 sm:p-4" data-testid="analytics-shell">
      <Tabs
        value={activeSection}
        onValueChange={(value) => setActiveSection(value as AnalyticsSection)}
        className="mx-auto max-w-7xl space-y-3 sm:space-y-4"
      >
        <FadeIn direction="up" distance={16}>
          <Card variant="terminal" className="relative overflow-hidden">
            <CardAccent variant="top" color="primary" intensity="medium" />
            <BackgroundPattern variant="gradient-mesh" color="primary" opacity={0.08} />
            <CardHeader className="relative z-10 space-y-3 p-3 sm:p-5">
              {/* Mobile-first: title + controls inline */}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className={ANALYTICS_COMPACT_TYPE.label}>Analytics</div>
                  <h1
                    className={ANALYTICS_COMPACT_TYPE.pageTitle}
                    data-testid="text-analytics-title"
                  >
                    Market Command Center
                  </h1>
                  <p className={`${ANALYTICS_COMPACT_TYPE.body} hidden sm:block`}>
                    Interactive pulse, live leaders, compare drills, and relationship mapping.
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`hidden rounded-sm border-border/70 bg-background/60 sm:inline-flex ${ANALYTICS_COMPACT_TYPE.chip}`}
                  >
                    {selectedSport === ALL_SPORTS ? "All sports" : selectedSport}
                  </Badge>
                  <Select
                    value={timeRange}
                    onValueChange={(value) => setTimeRange(value as TimeRange)}
                  >
                    <SelectTrigger
                      className="h-8 w-[100px] rounded-sm border-border/70 bg-background/70 font-mono text-[11px] sm:w-[116px]"
                      data-testid="select-timerange"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TIME_RANGE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Section tab bar — sticky on mobile so it stays visible while scrolled */}
              <div className="overflow-x-auto pb-1" data-testid="rail-section-tabs">
                <TabsList variant="terminal" className="min-w-max gap-1">
                  {(Object.keys(SECTION_LABELS) as AnalyticsSection[]).map((section) => {
                    const Icon =
                      section === "pulse"
                        ? BarChart3
                        : section === "leaders"
                          ? Target
                          : section === "compare"
                            ? GitCompare
                            : Link2;

                    return (
                      <TabsTrigger
                        key={section}
                        value={section}
                        variant="terminal"
                        className="gap-1.5 px-2.5 py-2 text-[10px] sm:gap-2 sm:px-3 sm:text-[11px]"
                        data-testid={`tab-${section}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {SECTION_LABELS[section]}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>
            </CardHeader>
          </Card>
        </FadeIn>

        <TabsContent value="pulse" className="space-y-4">
          <StaggerContainer className="space-y-4">
            <StaggerItem>
              <div
                className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0"
                data-testid="rail-metric-deck"
              >
                <div className="flex snap-x snap-mandatory gap-2 sm:gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  {(Object.keys(metricDescriptors) as MetricType[]).map((metric) => {
                    const descriptor = metricDescriptors[metric];
                    const Icon = descriptor.icon;
                    const changeSummary = getMetricChangeSummary(metric, marketHealth, snapshots);
                    const currentValue = marketHealth ? marketHealth[metric] : 0;
                    const isActive = metric === selectedMetric;

                    return (
                      <button
                        key={metric}
                        type="button"
                        onClick={() => setSelectedMetric(metric)}
                        className="w-[170px] snap-start text-left sm:w-auto"
                        data-testid={`button-metric-${metric}`}
                      >
                        <Card
                          variant="terminal"
                          className={`relative h-full overflow-hidden transition-colors ${
                            isActive
                              ? "border-primary/60 bg-primary/8"
                              : "border-border/70 bg-background/60 hover:bg-muted/30"
                          }`}
                        >
                          <CardAccent
                            variant="top"
                            color={descriptor.accent}
                            intensity={isActive ? "high" : "low"}
                          />
                          <CardContent className="space-y-3 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div
                                  className={`${ANALYTICS_COMPACT_TYPE.label} flex items-center gap-1.5`}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                  {descriptor.label}
                                </div>
                                <AnimatedMetricValue
                                  metric={metric}
                                  value={currentValue}
                                  className="font-mono text-lg font-bold sm:text-xl"
                                />
                                <div
                                  className={`${ANALYTICS_COMPACT_TYPE.meta} flex items-center gap-1 ${getChangeTone(changeSummary.value)}`}
                                >
                                  {(() => {
                                    const ChangeIcon = getChangeIcon(changeSummary.value);
                                    return <ChangeIcon className="h-3 w-3" />;
                                  })()}
                                  {changeSummary.label}
                                </div>
                                <div className={ANALYTICS_COMPACT_TYPE.meta}>
                                  {changeSummary.detail}
                                </div>
                              </div>
                              <div className="min-w-[72px] flex-1">
                                <MetricSparkline
                                  values={snapshots.map((snapshot) =>
                                    getSnapshotMetricValue(snapshot, metric),
                                  )}
                                  color={descriptor.chartColor}
                                />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })}
                </div>
              </div>
            </StaggerItem>

            <StaggerItem>
              <Card variant="terminal" className="relative overflow-hidden">
                <CardAccent
                  variant="top"
                  color={selectedMetricDescriptor.accent}
                  intensity="medium"
                />
                <BackgroundPattern variant="gradient-mesh" color="primary" opacity={0.1} />
                <CardHeader className="relative z-10 space-y-3 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <div className={ANALYTICS_COMPACT_TYPE.label}>Market Pulse</div>
                      <CardTitle
                        className="flex items-center gap-2 text-base font-semibold sm:text-lg"
                        data-testid="text-pulse-heading"
                      >
                        <SelectedMetricIcon className="h-4 w-4 text-primary" />
                        {selectedMetricDescriptor.label}
                      </CardTitle>
                      <p className={ANALYTICS_COMPACT_TYPE.body}>
                        {selectedMetricDescriptor.summary}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <AnimatedMetricValue
                        metric={selectedMetric}
                        value={selectedMetricCurrentValue}
                        className={ANALYTICS_COMPACT_TYPE.heroValue}
                      />
                      <div
                        className={`${ANALYTICS_COMPACT_TYPE.meta} flex items-center gap-1 justify-start lg:justify-end ${getChangeTone(selectedMetricChange.value)}`}
                      >
                        {(() => {
                          const ChangeIcon = getChangeIcon(selectedMetricChange.value);
                          return <ChangeIcon className="h-3.5 w-3.5" />;
                        })()}
                        <span>{selectedMetricChange.label}</span>
                        <span className="text-muted-foreground">{selectedMetricChange.detail}</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="relative z-10 grid gap-4 p-4 pt-0 sm:p-5 sm:pt-0 xl:grid-cols-[minmax(0,1.4fr)_320px]">
                  <div className="space-y-3">
                    {pulseChartData.length > 0 ? (
                      <ChartContainer
                        config={pulseChartConfig}
                        className="h-[200px] w-full sm:h-[280px] lg:h-[320px]"
                      >
                        <AreaChart
                          data={pulseChartData}
                          margin={{ top: 12, right: 8, left: -16, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="analytics-pulse-fill" x1="0" y1="0" x2="0" y2="1">
                              <stop
                                offset="5%"
                                stopColor={selectedMetricDescriptor.chartColor}
                                stopOpacity={0.35}
                              />
                              <stop
                                offset="95%"
                                stopColor={selectedMetricDescriptor.chartColor}
                                stopOpacity={0.02}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="date"
                            tickFormatter={formatShortDate}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={24}
                          />
                          <YAxis
                            tickFormatter={(value: number) =>
                              formatMetricValue(selectedMetric, value, true)
                            }
                            tickLine={false}
                            axisLine={false}
                            width={72}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(label) => formatLongDate(String(label))}
                                formatter={(value, name) => (
                                  <div className="flex w-full items-center justify-between gap-4">
                                    <span className="text-muted-foreground">
                                      {name === "selectedValue"
                                        ? selectedMetricDescriptor.label
                                        : "Period Avg"}
                                    </span>
                                    <span className="font-mono font-medium text-foreground">
                                      {formatMetricValue(selectedMetric, Number(value))}
                                    </span>
                                  </div>
                                )}
                              />
                            }
                          />
                          <ChartLegend content={<ChartLegendContent />} />
                          <Area
                            type="monotone"
                            dataKey="selectedValue"
                            name="selectedValue"
                            stroke={selectedMetricDescriptor.chartColor}
                            fill="url(#analytics-pulse-fill)"
                            strokeWidth={3}
                            activeDot={{ r: 5 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="average"
                            name="average"
                            stroke="hsl(var(--muted-foreground))"
                            strokeDasharray="6 6"
                            strokeWidth={2}
                            dot={false}
                          />
                        </AreaChart>
                      </ChartContainer>
                    ) : (
                      <div className="flex h-[320px] items-center justify-center rounded-sm border border-dashed border-border/70 bg-background/40 text-sm text-muted-foreground">
                        No snapshot data available for this window.
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    {[
                      { label: "Period High", value: pulseHigh },
                      { label: "Period Low", value: pulseLow },
                      { label: "Avg Movement", value: pulseAverageMovement },
                      { label: "Net Delta", value: pulseDelta },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-sm border border-border/70 bg-background/60 p-3"
                      >
                        <div className={ANALYTICS_COMPACT_TYPE.label}>{stat.label}</div>
                        <div className={`${ANALYTICS_COMPACT_TYPE.primaryValue} mt-1`}>
                          {stat.label === "Net Delta"
                            ? formatSignedMetricValue(selectedMetric, stat.value, true)
                            : formatMetricValue(selectedMetric, stat.value, true)}
                        </div>
                        <div className={`${ANALYTICS_COMPACT_TYPE.meta} mt-1`}>
                          {stat.label === "Avg Movement"
                            ? "Average step-to-step movement"
                            : stat.label === "Net Delta"
                              ? "Last snapshot vs first snapshot"
                              : stat.label === "Period High"
                                ? "Peak recorded point"
                                : "Lowest recorded point"}
                        </div>
                      </div>
                    ))}

                    <div className="rounded-sm border border-border/70 bg-background/60 p-3 sm:col-span-2 xl:col-span-1">
                      <div className={ANALYTICS_COMPACT_TYPE.label}>Market Context</div>
                      <div className="mt-2 grid gap-2">
                        <div className="flex items-center justify-between">
                          <span className={ANALYTICS_COMPACT_TYPE.meta}>Avg Price Change</span>
                          <span
                            className={`${ANALYTICS_COMPACT_TYPE.secondaryValue} ${getChangeTone(
                              analyticsData?.marketStats.avgPriceChange ?? 0,
                            )}`}
                          >
                            {formatSignedPercent(analyticsData?.marketStats.avgPriceChange ?? 0)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={ANALYTICS_COMPACT_TYPE.meta}>Most Active Team</span>
                          <Badge variant="outline" className="rounded-sm">
                            {analyticsData?.marketStats.mostActiveTeam ?? "N/A"}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={ANALYTICS_COMPACT_TYPE.meta}>Avg Metric Value</span>
                          <span className={ANALYTICS_COMPACT_TYPE.secondaryValue}>
                            {formatMetricValue(selectedMetric, pulseAverage, true)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card variant="terminal" className="relative overflow-hidden">
                <CardAccent variant="top" color="success" intensity="medium" />
                <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
                  <div className={ANALYTICS_COMPACT_TYPE.label}>Sport Momentum Matrix</div>
                  <CardTitle className="flex items-center gap-2 text-base font-semibold sm:text-lg">
                    <Layers3 className="h-4 w-4 text-emerald-400" />
                    Filter the room
                  </CardTitle>
                  <p className={ANALYTICS_COMPACT_TYPE.body}>
                    Switch the command center to a single sport or reset back to the full market.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={selectedSport === ALL_SPORTS ? "terminal" : "terminalOutline"}
                      size="sm"
                      onClick={() => setSelectedSport(ALL_SPORTS)}
                      data-testid="button-sport-all"
                    >
                      All Sports
                    </Button>
                    {(analyticsData?.sportBreakdown ?? []).map((sport) => (
                      <Button
                        key={sport.sport}
                        variant={selectedSport === sport.sport ? "terminal" : "terminalOutline"}
                        size="sm"
                        onClick={() => setSelectedSport(sport.sport)}
                        data-testid={`button-sport-${sport.sport.toLowerCase()}`}
                      >
                        {sport.sport}
                      </Button>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {filteredSportBreakdown.length > 0 ? (
                      filteredSportBreakdown.map((sport) => (
                        <button
                          key={sport.sport}
                          type="button"
                          onClick={() =>
                            setSelectedSport(
                              selectedSport === sport.sport ? ALL_SPORTS : sport.sport,
                            )
                          }
                          className="text-left"
                        >
                          <div
                            className={`rounded-sm border p-3 transition-colors ${
                              selectedSport === sport.sport
                                ? "border-primary/60 bg-primary/8"
                                : "border-border/70 bg-background/50 hover:bg-muted/30"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline" className="rounded-sm">
                                {sport.sport}
                              </Badge>
                              <span className={ANALYTICS_COMPACT_TYPE.meta}>
                                {sport.activePlayers}/{sport.totalPlayers} active
                              </span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <div>
                                <div className={ANALYTICS_COMPACT_TYPE.label}>24h Volume</div>
                                <div className={ANALYTICS_COMPACT_TYPE.secondaryValue}>
                                  {formatMetricValue("volume", sport.totalVolume24h, true)}
                                </div>
                              </div>
                              <div>
                                <div className={ANALYTICS_COMPACT_TYPE.label}>Market Cap</div>
                                <div className={ANALYTICS_COMPACT_TYPE.secondaryValue}>
                                  {formatMetricValue("marketCap", sport.totalMarketCap, true)}
                                </div>
                              </div>
                              <div>
                                <div className={ANALYTICS_COMPACT_TYPE.label}>Trades</div>
                                <div className={ANALYTICS_COMPACT_TYPE.secondaryValue}>
                                  {formatMetricValue("transactions", sport.tradesInRange, true)}
                                </div>
                              </div>
                              <div>
                                <div className={ANALYTICS_COMPACT_TYPE.label}>Avg Change</div>
                                <div
                                  className={`${ANALYTICS_COMPACT_TYPE.secondaryValue} ${getChangeTone(
                                    sport.avgPriceChange24h,
                                  )}`}
                                >
                                  {formatSignedPercent(sport.avgPriceChange24h)}
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-sm border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground sm:col-span-2 xl:col-span-4">
                        No sport breakdown data is available for the current selection.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </StaggerItem>
          </StaggerContainer>
        </TabsContent>

        <TabsContent value="leaders" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <Card variant="terminal" className="h-fit">
              <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
                <div className={ANALYTICS_COMPACT_TYPE.label}>Player Spotlight</div>
                <CardTitle className="flex items-center gap-2 text-base font-semibold sm:text-lg">
                  <Target className="h-4 w-4 text-primary" />
                  Select a live leader
                </CardTitle>
                <p className={ANALYTICS_COMPACT_TYPE.body}>
                  Ranked by composite strength, activity, and recent fantasy production.
                </p>
              </CardHeader>
              <CardContent className="space-y-2 p-4 sm:p-5">
                {filteredPowerRankings.slice(0, 10).length > 0 ? (
                  filteredPowerRankings.slice(0, 10).map((ranking) => (
                    <button
                      key={ranking.player.id}
                      type="button"
                      onClick={() => setSelectedSpotlightId(ranking.player.id)}
                      className={`flex w-full items-center justify-between rounded-sm border p-2 text-left transition-colors ${
                        spotlightRanking?.player.id === ranking.player.id
                          ? "border-primary/60 bg-primary/8"
                          : "border-border/70 bg-background/40 hover:bg-muted/30"
                      }`}
                      data-testid={`button-spotlight-${ranking.player.id}`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            #{ranking.rank}
                          </span>
                          {renderModalPlayerName(
                            ranking.player.id,
                            `${ranking.player.firstName} ${ranking.player.lastName}`,
                            "truncate text-sm font-medium",
                          )}
                        </div>
                        <div className={ANALYTICS_COMPACT_TYPE.meta}>
                          {ranking.player.team} / {ranking.player.position}
                        </div>
                      </div>
                      <div
                        className={`${ANALYTICS_COMPACT_TYPE.secondaryValue} ${getChangeTone(
                          ranking.priceChange7d,
                        )}`}
                      >
                        {formatSignedPercent(ranking.priceChange7d)}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-sm border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                    No ranked players match the current sport filter.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card variant="terminal" className="relative overflow-hidden">
              <CardAccent variant="top" color="primary" intensity="medium" />
              <BackgroundPattern variant="hexagons" color="primary" opacity={0.05} />
              <CardHeader className="relative z-10 p-4 pb-0 sm:p-5 sm:pb-0">
                <div className={ANALYTICS_COMPACT_TYPE.label}>Selected Leader</div>
                <CardTitle className="text-base font-semibold sm:text-lg">
                  {spotlightRanking
                    ? `${spotlightRanking.player.firstName} ${spotlightRanking.player.lastName}`
                    : "No leader selected"}
                </CardTitle>
              </CardHeader>
              <CardContent className="relative z-10 space-y-4 p-4 sm:p-5">
                {spotlightRanking ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-sm">
                        #{spotlightRanking.rank}
                      </Badge>
                      {spotlightPlayer?.sport && (
                        <Badge variant="outline" className="rounded-sm">
                          {spotlightPlayer.sport}
                        </Badge>
                      )}
                      <Badge variant="outline" className="rounded-sm">
                        {spotlightRanking.player.team}
                      </Badge>
                      <Badge variant="outline" className="rounded-sm">
                        {spotlightRanking.player.position}
                      </Badge>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-sm border border-border/70 bg-background/50 p-3">
                        <div className={ANALYTICS_COMPACT_TYPE.label}>Price</div>
                        <div className={ANALYTICS_COMPACT_TYPE.primaryValue}>
                          {formatMetricValue(
                            "marketCap",
                            Number(spotlightRanking.player.lastTradePrice),
                          )}
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/70 bg-background/50 p-3">
                        <div className={ANALYTICS_COMPACT_TYPE.label}>24h Volume</div>
                        <div className={ANALYTICS_COMPACT_TYPE.primaryValue}>
                          {formatMetricValue(
                            "transactions",
                            spotlightRanking.player.volume24h,
                            true,
                          )}
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/70 bg-background/50 p-3">
                        <div className={ANALYTICS_COMPACT_TYPE.label}>Avg Fantasy</div>
                        <div className={ANALYTICS_COMPACT_TYPE.primaryValue}>
                          {spotlightRanking.avgFantasyPoints.toFixed(1)} FP
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/70 bg-background/50 p-3">
                        <div className={ANALYTICS_COMPACT_TYPE.label}>7d Change</div>
                        <div
                          className={`${ANALYTICS_COMPACT_TYPE.primaryValue} ${getChangeTone(
                            spotlightRanking.priceChange7d,
                          )}`}
                        >
                          {formatSignedPercent(spotlightRanking.priceChange7d)}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                      <div className="rounded-sm border border-border/70 bg-background/50 p-3">
                        <div className={ANALYTICS_COMPACT_TYPE.label}>Why this player is hot</div>
                        <div className="mt-3 grid gap-2">
                          <div className="flex items-center justify-between">
                            <span className={ANALYTICS_COMPACT_TYPE.meta}>Composite score</span>
                            <span className={ANALYTICS_COMPACT_TYPE.secondaryValue}>
                              {spotlightRanking.compositeScore.toFixed(1)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={ANALYTICS_COMPACT_TYPE.meta}>Volume momentum</span>
                            <span className={ANALYTICS_COMPACT_TYPE.secondaryValue}>
                              {formatMetricValue(
                                "transactions",
                                spotlightRanking.player.volume24h,
                                true,
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={ANALYTICS_COMPACT_TYPE.meta}>Recent price shift</span>
                            <span
                              className={`${ANALYTICS_COMPACT_TYPE.secondaryValue} ${getChangeTone(
                                spotlightRanking.priceChange7d,
                              )}`}
                            >
                              {formatSignedPercent(spotlightRanking.priceChange7d)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/70 bg-background/50 p-3">
                        <div className={ANALYTICS_COMPACT_TYPE.label}>Drill into market</div>
                        <div className="mt-2 space-y-2">
                          <p className={ANALYTICS_COMPACT_TYPE.body}>
                            Open the player page for full price action, pool activity, and trade
                            flows.
                          </p>
                          <Button asChild variant="terminal" size="sm" className="w-full">
                            <Link href={`/player/${spotlightRanking.player.id}`}>
                              Open Player Page
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-sm border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                    Select a player from the spotlight rail to inspect their current market profile.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card variant="terminal">
            <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
              <div className={ANALYTICS_COMPACT_TYPE.label}>Position Command Board</div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold sm:text-lg">
                <Users className="h-4 w-4 text-primary" />
                Position group drill-downs
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              {filteredPositionRankings.length > 0 ? (
                <Accordion type="single" collapsible className="w-full">
                  {filteredPositionRankings.map((positionRanking) => (
                    <AccordionItem key={positionRanking.position} value={positionRanking.position}>
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex min-w-0 items-center gap-3">
                          <Badge variant="outline" className="rounded-sm">
                            {positionRanking.position}
                          </Badge>
                          <span className={ANALYTICS_COMPACT_TYPE.meta}>
                            {positionRanking.players.length} leaders in view
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-2">
                        {positionRanking.players.slice(0, 5).map((ranking) => (
                          <Link key={ranking.player.id} href={`/player/${ranking.player.id}`}>
                            <div className="flex items-center justify-between rounded-sm border border-border/70 bg-background/40 p-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs text-muted-foreground">
                                    #{ranking.rank}
                                  </span>
                                  {renderModalPlayerName(
                                    ranking.player.id,
                                    `${ranking.player.firstName} ${ranking.player.lastName}`,
                                    "truncate text-sm font-medium",
                                  )}
                                </div>
                                <div className={ANALYTICS_COMPACT_TYPE.meta}>
                                  {ranking.player.team} / {ranking.player.position}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={ANALYTICS_COMPACT_TYPE.secondaryValue}>
                                  {ranking.avgFantasyPoints.toFixed(1)} FP
                                </div>
                                <div
                                  className={`${ANALYTICS_COMPACT_TYPE.meta} ${getChangeTone(
                                    ranking.priceChange7d,
                                  )}`}
                                >
                                  {formatSignedPercent(ranking.priceChange7d)}
                                </div>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : (
                <div className="rounded-sm border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                  Position breakdowns are only available where ranked players map into the current
                  position groups.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compare" className="space-y-4">
          <Card variant="terminal">
            <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
              <div className={ANALYTICS_COMPACT_TYPE.label}>Compare Lab</div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold sm:text-lg">
                <GitCompare className="h-4 w-4 text-primary" />
                Build a matchup board
              </CardTitle>
              <p className={ANALYTICS_COMPACT_TYPE.body}>
                Add up to five players, then inspect normalized radar shape, AMM flow, and exact
                values.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Popover open={compareSearchOpen} onOpenChange={setCompareSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="terminal" size="sm" data-testid="button-open-compare-search">
                      <Search className="h-3.5 w-3.5" />
                      Add Players
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[320px] rounded-sm border-border/70 bg-card p-0"
                  >
                    <div className="border-b border-border/70 p-3">
                      <Input
                        value={compareSearchQuery}
                        onChange={(event) => setCompareSearchQuery(event.target.value)}
                        placeholder="Search players, teams, or positions"
                        className="h-9 rounded-sm"
                        data-testid="input-compare-search"
                      />
                    </div>
                    <div className="max-h-72 space-y-1 overflow-y-auto p-2">
                      {(deferredCompareSearch.trim()
                        ? filteredPlayerSearchResults
                        : recommendedComparePlayers
                      ).length > 0 ? (
                        (deferredCompareSearch.trim()
                          ? filteredPlayerSearchResults
                          : recommendedComparePlayers
                        ).map((player) => (
                          <button
                            key={player.id}
                            type="button"
                            onClick={() => handlePlayerSelect(player.id)}
                            className="flex w-full items-center justify-between rounded-sm border border-transparent px-2 py-2 text-left hover:border-border hover:bg-muted/30"
                            data-testid={`button-compare-result-${player.id}`}
                          >
                            <div className="min-w-0">
                              {renderModalPlayerName(
                                player.id,
                                `${player.firstName} ${player.lastName}`,
                                "truncate text-sm font-medium",
                              )}
                              <div className={ANALYTICS_COMPACT_TYPE.meta}>
                                {player.team} / {player.position} / {player.sport}
                              </div>
                            </div>
                            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        ))
                      ) : (
                        <div className="p-3 text-sm text-muted-foreground">
                          No players match the current search and sport filter.
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                {recommendedComparePlayers.slice(0, 4).map((player) => (
                  <Button
                    key={player.id}
                    variant="terminalOutline"
                    size="sm"
                    onClick={() => handlePlayerSelect(player.id)}
                    disabled={selectedPlayers.includes(player.id)}
                  >
                    {renderModalPlayerName(
                      player.id,
                      `${player.firstName} ${player.lastName}`,
                      "inline",
                    )}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedPlayers.length > 0 ? (
                  selectedPlayers.map((playerId) => {
                    const player = playerById[playerId];
                    if (!player) return null;

                    return (
                      <div
                        key={playerId}
                        className="inline-flex items-center gap-2 rounded-sm border border-border/70 bg-background/50 px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium">
                            {renderModalPlayerName(
                              player.id,
                              `${player.firstName} ${player.lastName}`,
                              "inline",
                            )}
                          </div>
                          <div className={ANALYTICS_COMPACT_TYPE.meta}>
                            {player.team} / {player.position}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedPlayers(selectedPlayers.filter((id) => id !== playerId))
                          }
                          className="rounded-sm p-1 text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                          aria-label={`Remove ${player.firstName} ${player.lastName}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-sm border border-dashed border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
                    Start with the recommended players above or search for a custom board.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {comparisonLoading && selectedPlayers.length > 0 ? (
            <div className="flex justify-center py-12">
              <div className="h-10 w-10 animate-spin rounded-sm border-b-2 border-primary" />
            </div>
          ) : comparisonPlayers.length > 0 ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_320px]">
                <Card variant="terminal">
                  <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
                    <div className={ANALYTICS_COMPACT_TYPE.label}>Normalized Radar</div>
                    <CardTitle className="text-base font-semibold sm:text-lg">
                      Shape of the matchup
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 sm:p-5">
                    <ChartContainer
                      config={radarChartConfig}
                      className="h-[320px] w-full"
                      data-testid="chart-compare-radar"
                    >
                      <RadarChart data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis
                          angle={90}
                          domain={[0, 100]}
                          tick={false}
                          axisLine={false}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, name) => (
                                <div className="flex w-full items-center justify-between gap-4">
                                  <span className="text-muted-foreground">{String(name)}</span>
                                  <span className="font-mono font-medium text-foreground">
                                    {Number(value).toFixed(0)}
                                  </span>
                                </div>
                              )}
                            />
                          }
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                        {comparisonPlayers.map((player, index) => (
                          <Radar
                            key={player.id}
                            name={player.id}
                            dataKey={player.id}
                            stroke={CHART_COLORS[index % CHART_COLORS.length]}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                            fillOpacity={0.12}
                            strokeWidth={2}
                          />
                        ))}
                      </RadarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                <Card variant="terminal">
                  <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
                    <div className={ANALYTICS_COMPACT_TYPE.label}>Quick Read</div>
                    <CardTitle className="text-base font-semibold sm:text-lg">
                      Current board leaders
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 p-4 sm:p-5">
                    {[
                      {
                        label: "Highest Price",
                        player: comparisonPlayers
                          .slice()
                          .sort((left, right) => right.price - left.price)[0],
                        valueKey: "price" as const,
                      },
                      {
                        label: "Most Liquid Pool",
                        player: comparisonPlayers
                          .slice()
                          .sort((left, right) => right.poolLiquidity - left.poolLiquidity)[0],
                        valueKey: "poolLiquidity" as const,
                      },
                      {
                        label: "AMM Volume Leader",
                        player: comparisonPlayers
                          .slice()
                          .sort((left, right) => right.ammVolume - left.ammVolume)[0],
                        valueKey: "ammVolume" as const,
                      },
                      {
                        label: "Most Used In Boosts",
                        player: comparisonPlayers
                          .slice()
                          .sort(
                            (left, right) => right.boostUsagePercent - left.boostUsagePercent,
                          )[0],
                        valueKey: "boostUsagePercent" as const,
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="rounded-sm border border-border/70 bg-background/40 p-3"
                      >
                        <div className={ANALYTICS_COMPACT_TYPE.label}>{item.label}</div>
                        <div className="mt-1 text-sm font-medium">{item.player?.name ?? "N/A"}</div>
                        <div className={ANALYTICS_COMPACT_TYPE.meta}>
                          {item.valueKey === "boostUsagePercent"
                            ? `${item.player?.boostUsagePercent.toFixed(1) ?? "0.0"}%`
                            : formatMetricValue(
                                item.valueKey === "price"
                                  ? "marketCap"
                                  : item.valueKey === "ammVolume"
                                    ? "volume"
                                    : "marketCap",
                                Number(item.player?.[item.valueKey] ?? 0),
                                true,
                              )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <Card variant="terminal">
                <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
                  <div className={ANALYTICS_COMPACT_TYPE.label}>AMM Trend</div>
                  <CardTitle className="text-base font-semibold sm:text-lg">
                    Volume flow over time
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  {ammTrendData.length > 0 ? (
                    <ChartContainer
                      config={ammTrendConfig}
                      className="h-[260px] w-full"
                      data-testid="chart-amm-trend"
                    >
                      <LineChart data={ammTrendData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={formatShortDate}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tickFormatter={(value: number) =>
                            formatMetricValue("volume", value, true)
                          }
                          tickLine={false}
                          axisLine={false}
                          width={72}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(label) => formatLongDate(String(label))}
                              formatter={(value, name) => (
                                <div className="flex w-full items-center justify-between gap-4">
                                  <span className="text-muted-foreground">{String(name)}</span>
                                  <span className="font-mono font-medium text-foreground">
                                    {formatMetricValue("volume", Number(value))}
                                  </span>
                                </div>
                              )}
                            />
                          }
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                        {comparisonPlayers.map((player, index) => (
                          <Line
                            key={player.id}
                            type="monotone"
                            dataKey={player.id}
                            name={player.id}
                            stroke={CHART_COLORS[index % CHART_COLORS.length]}
                            strokeWidth={2.5}
                            dot={false}
                          />
                        ))}
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <div className="rounded-sm border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                      No AMM history is available for the selected players and time range.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card variant="terminal">
                <CardContent className="p-4 sm:p-5">
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="exact-values">
                      <AccordionTrigger className="py-2 hover:no-underline">
                        <div className="text-left">
                          <div className={ANALYTICS_COMPACT_TYPE.label}>Secondary Detail</div>
                          <div className="text-sm font-medium">Exact values table</div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border/70">
                                <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                                  Player
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                                  Price
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                                  Market Cap
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                                  Shares
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                                  AMM Vol
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                                  Liquidity
                                </th>
                                <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                                  Boost %
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {comparisonPlayers.map((player) => (
                                <tr
                                  key={player.id}
                                  className="border-b border-border/60 last:border-0"
                                >
                                  <td className="px-2 py-2">
                                    <div className="font-medium">
                                      {renderModalPlayerName(player.id, player.name, "inline")}
                                    </div>
                                    <div className={ANALYTICS_COMPACT_TYPE.meta}>
                                      {player.team} / {player.position}
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 text-right font-mono">
                                    {formatMetricValue("marketCap", player.price)}
                                  </td>
                                  <td className="px-2 py-2 text-right font-mono">
                                    {formatMetricValue("marketCap", player.marketCap, true)}
                                  </td>
                                  <td className="px-2 py-2 text-right font-mono">
                                    {formatMetricValue("transactions", player.shares, true)}
                                  </td>
                                  <td className="px-2 py-2 text-right font-mono">
                                    {formatMetricValue("volume", player.ammVolume, true)}
                                  </td>
                                  <td className="px-2 py-2 text-right font-mono">
                                    {formatMetricValue("marketCap", player.poolLiquidity, true)}
                                  </td>
                                  <td className="px-2 py-2 text-right font-mono">
                                    {player.boostUsagePercent.toFixed(1)}%
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card variant="terminal">
              <CardContent className="p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-sm border border-border/70 bg-background/50">
                  <GitCompare className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="text-base font-medium">No compare board yet</div>
                <p className={`${ANALYTICS_COMPACT_TYPE.body} mt-2`}>
                  Add players from the command rail to render the radar view and AMM trend lines.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="relationships" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <Card variant="terminal">
              <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
                <div className={ANALYTICS_COMPACT_TYPE.label}>Relationship Radar</div>
                <CardTitle className="flex items-center gap-2 text-base font-semibold sm:text-lg">
                  <Link2 className="h-4 w-4 text-primary" />
                  Top market links
                </CardTitle>
                <p className={ANALYTICS_COMPACT_TYPE.body}>
                  Explore the strongest player-to-player movement pairs in the active sport view.
                </p>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                <RelationshipRadarSvg
                  pairs={relationshipPairs}
                  playerById={playerById}
                  activePairKey={activeRelationshipKey}
                  onActivate={setSelectedRelationshipKey}
                />
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card variant="terminal">
                <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
                  <div className={ANALYTICS_COMPACT_TYPE.label}>Active Pair</div>
                  <CardTitle className="text-base font-semibold sm:text-lg">
                    {activeRelationshipPair
                      ? `${activeRelationshipPair.player1} <-> ${activeRelationshipPair.player2}`
                      : "No pair selected"}
                  </CardTitle>
                </CardHeader>
                <CardContent
                  className="space-y-3 p-4 sm:p-5"
                  data-testid="card-relationship-detail"
                >
                  {activeRelationshipPair ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="rounded-sm">
                          {selectedSport === ALL_SPORTS ? "Cross-market" : selectedSport}
                        </Badge>
                        <Badge variant="outline" className="rounded-sm">
                          {(activeRelationshipPair.correlation * 100).toFixed(0)}% strength
                        </Badge>
                        <Badge variant="outline" className="rounded-sm">
                          {getRelationshipLabel(activeRelationshipPair.correlation)}
                        </Badge>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        {[activeRelationshipPlayers.player1, activeRelationshipPlayers.player2].map(
                          (player, index) => (
                            <div
                              key={player?.id || index}
                              className="rounded-sm border border-border/70 bg-background/50 p-3"
                            >
                              <div className="text-sm font-medium">
                                {player
                                  ? `${player.firstName} ${player.lastName}`
                                  : "Unknown player"}
                              </div>
                              <div className={ANALYTICS_COMPACT_TYPE.meta}>
                                {player
                                  ? `${player.team} / ${player.position} / ${player.sport}`
                                  : "Missing player metadata"}
                              </div>
                              {player && (
                                <Button
                                  asChild
                                  variant="terminalOutline"
                                  size="sm"
                                  className="mt-3 w-full"
                                >
                                  <Link href={`/player/${player.id}`}>Open Player</Link>
                                </Button>
                              )}
                            </div>
                          ),
                        )}
                      </div>

                      <div className="rounded-sm border border-border/70 bg-background/50 p-3">
                        <div className={ANALYTICS_COMPACT_TYPE.label}>Interpretation</div>
                        <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                          {activeRelationshipPair.correlation >= 0.6 ? (
                            <TrendingUp className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-yellow-400" />
                          )}
                          {getRelationshipLabel(activeRelationshipPair.correlation)}
                        </div>
                        <p className={`${ANALYTICS_COMPACT_TYPE.body} mt-2`}>
                          These players are showing the strongest shared movement signature in the
                          current analytics sample.
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-sm border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                      No relationship data is available for the current selection.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card variant="terminal">
                <CardHeader className="space-y-2 p-4 pb-0 sm:p-5 sm:pb-0">
                  <div className={ANALYTICS_COMPACT_TYPE.label}>Pair Queue</div>
                  <CardTitle className="text-base font-semibold sm:text-lg">
                    Hover or tap to retarget
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-4 sm:p-5">
                  {relationshipPairs.length > 0 ? (
                    relationshipPairs.map((pair) => {
                      const pairKey = getCorrelationPairKey(pair);
                      const isActive = pairKey === activeRelationshipKey;

                      return (
                        <button
                          key={pairKey}
                          type="button"
                          onClick={() => setSelectedRelationshipKey(pairKey)}
                          onMouseEnter={() => setSelectedRelationshipKey(pairKey)}
                          className={`flex w-full items-center justify-between rounded-sm border p-2 text-left transition-colors ${
                            isActive
                              ? "border-primary/60 bg-primary/8"
                              : "border-border/70 bg-background/40 hover:bg-muted/30"
                          }`}
                          data-testid={`button-relationship-${pairKey.replace(/:/g, "-")}`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {getShortName(pair.player1)}
                              {" <-> "}
                              {getShortName(pair.player2)}
                            </div>
                            <div className={ANALYTICS_COMPACT_TYPE.meta}>
                              {getRelationshipLabel(pair.correlation)}
                            </div>
                          </div>
                          <div className={ANALYTICS_COMPACT_TYPE.secondaryValue}>
                            {(pair.correlation * 100).toFixed(0)}%
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-sm border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                      No pairs are available for this sport filter.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

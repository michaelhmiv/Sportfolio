import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PlayerModal } from "@/components/player-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardAccent } from "@/components/ui/decorative-elements";
import {
  getDefaultExposureTab,
  getGuestExposureRows,
  getMissingExposureRows,
  getOwnedExposureRowsFromGames,
  getOwnedExposureRowsFromRaces,
  getShowcaseExposureSummaryFromGames,
  getShowcaseExposureSummaryFromRaces,
  getSlateCountsFromGames,
  getSlateCountsFromRaces,
  type DashboardShowcaseEligiblePlayer,
  type DashboardShowcaseExposureRow,
  type DashboardShowcaseGameEntry,
  type DashboardShowcaseRace,
  type DashboardShowcaseRaceHolding,
  type DashboardShowcaseSlatePlayer,
  type DashboardShowcaseStatus,
  type DashboardShowcaseTab,
} from "@/components/dashboard-showcase-card.helpers";

interface DashboardShowcaseCardProps {
  isAuthenticated: boolean;
  sport: string;
  selectedDate: Date;
  gameEntries: DashboardShowcaseGameEntry[];
  slatePlayers?: DashboardShowcaseSlatePlayer[];
  races?: DashboardShowcaseRace[];
  raceHoldings?: DashboardShowcaseRaceHolding[];
  eligiblePlayers?: DashboardShowcaseEligiblePlayer[];
  onNavigate: (href: string) => void;
}

interface NascarSessionContext {
  sessionName: string;
  position: number | null;
  bestLapSpeed: number | null;
  bestLapTime: string | null;
  bestLapNumber: number | null;
}

interface NascarPerformanceContext {
  averageRunningPosition: number | null;
  averageSpeed: number | null;
  resultPosition: number | null;
  resultDelta: number | null;
  fastLapPct: number | null;
  passesMade: number | null;
  timesPassed: number | null;
  passingDifferential: number | null;
  qualityPasses: number | null;
  top15Laps: number | null;
  top15Pct: number | null;
  driverRating: number | null;
  averageRestartSpeed: number | null;
}

interface NascarDriverContext {
  playerId: string;
  driverId: number;
  driverName: string;
  practice: NascarSessionContext | null;
  qualifying: NascarSessionContext | null;
  startingPosition: number | null;
  performance: NascarPerformanceContext | null;
  performanceState: "live" | "final" | null;
}

interface NascarRaceContextResponse {
  gameId: string;
  raceId: number;
  seriesId: number;
  year: number;
  trackName: string | null;
  raceName: string | null;
  drivers: NascarDriverContext[];
}

const stateValueFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatSlateDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatStartLabel(startTime: string, status: DashboardShowcaseStatus) {
  if (status === "inprogress") return "Live";
  if (status === "completed") return "Final";
  if (status === "postponed") return "Postponed";

  return new Date(startTime).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatStateValue(row: DashboardShowcaseExposureRow) {
  if (row.value === null || Number.isNaN(row.value)) {
    return "--";
  }

  const suffix = row.valueKind === "avg" ? "avg" : "FP";
  return `${stateValueFormatter.format(row.value)} ${suffix}`;
}

function formatSignedMetric(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatNascarContextLines(context: NascarDriverContext | null | undefined) {
  if (!context) return [];

  const weekend: string[] = [];
  if (context.practice?.position) {
    weekend.push(
      `P${context.practice.position}${
        typeof context.practice.bestLapSpeed === "number"
          ? ` ${context.practice.bestLapSpeed.toFixed(1)} mph`
          : ""
      }`,
    );
  }
  if (context.qualifying?.position) {
    weekend.push(
      `Q${context.qualifying.position}${
        typeof context.qualifying.bestLapSpeed === "number"
          ? ` ${context.qualifying.bestLapSpeed.toFixed(1)} mph`
          : ""
      }`,
    );
  }
  if (context.startingPosition) {
    weekend.push(`Start P${context.startingPosition}`);
  }

  const performance: string[] = [];
  if (typeof context.performance?.averageRunningPosition === "number") {
    performance.push(`Avg ${context.performance.averageRunningPosition.toFixed(1)}`);
  }
  const resultDelta = formatSignedMetric(context.performance?.resultDelta);
  if (resultDelta) performance.push(`Result Δ ${resultDelta}`);
  if (typeof context.performance?.fastLapPct === "number") {
    performance.push(`Fast ${context.performance.fastLapPct.toFixed(1)}%`);
  }
  const passDelta = formatSignedMetric(context.performance?.passingDifferential);
  if (passDelta) performance.push(`Pass Δ ${passDelta}`);
  if (typeof context.performance?.top15Pct === "number") {
    performance.push(`Top15 ${context.performance.top15Pct.toFixed(0)}%`);
  }
  if (typeof context.performance?.driverRating === "number") {
    performance.push(`Rating ${context.performance.driverRating.toFixed(1)}`);
  }

  return [weekend.join(" · "), performance.join(" · ")].filter(Boolean);
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <Badge
      variant="outline"
      className="h-5 rounded-sm border-border/70 bg-background/30 px-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
    >
      <span className="mr-1 text-foreground">{value}</span>
      {label}
    </Badge>
  );
}

function ExposureTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-6 rounded-sm border px-2 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${
        active
          ? "border-primary/60 bg-primary/10 text-primary"
          : "border-border/70 bg-background/30 text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ExposureRow({
  row,
  mode,
  onOpenPlayer,
  nascarContext,
}: {
  row: DashboardShowcaseExposureRow;
  mode: DashboardShowcaseTab;
  onOpenPlayer: (playerId: string) => void;
  nascarContext?: NascarDriverContext | null;
}) {
  const badgeLabel =
    mode === "missing" ? "GAP" : mode === "top" ? "TOP" : row.isEarning ? "EARN" : "OWN";
  const badgeClass =
    mode === "missing"
      ? "text-amber-500"
      : row.isEarning
        ? "text-emerald-500"
        : "text-muted-foreground";
  const nascarContextLines = formatNascarContextLines(nascarContext);

  return (
    <button
      type="button"
      onClick={() => onOpenPlayer(row.playerId)}
      className="flex w-full items-start justify-between gap-2 rounded-sm border border-border/60 bg-background/40 px-2 py-1 text-left transition-colors hover:bg-background/70"
    >
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-foreground">{row.label}</div>
        <div className="mt-0.5 truncate text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
          {row.team} | {row.contextLabel} | {formatStartLabel(row.startTime, row.status)}
        </div>
        <div className="mt-0.5 truncate text-[9px] text-muted-foreground">{row.detail}</div>
        {nascarContextLines.map((line) => (
          <div
            key={line}
            className="mt-0.5 truncate font-mono text-[9px] text-foreground/80"
            title={line}
          >
            {line}
          </div>
        ))}
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-[10px] font-semibold text-foreground">
          {formatStateValue(row)}
        </div>
        <div
          className={`mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${badgeClass}`}
        >
          {badgeLabel}
        </div>
      </div>
    </button>
  );
}

export function DashboardShowcaseCard({
  isAuthenticated,
  sport,
  selectedDate,
  gameEntries,
  slatePlayers = [],
  races = [],
  raceHoldings = [],
  eligiblePlayers = [],
  onNavigate,
}: DashboardShowcaseCardProps) {
  const isNascar = sport === "NASCAR";
  const slateCounts = isNascar
    ? getSlateCountsFromRaces(races)
    : getSlateCountsFromGames(gameEntries);
  const totalSlateCount =
    slateCounts.live + slateCounts.upcoming + slateCounts.completed + slateCounts.postponed;
  const selectedDateLabel = formatSlateDate(selectedDate);

  const exposureSummary = isNascar
    ? getShowcaseExposureSummaryFromRaces(races, raceHoldings, eligiblePlayers, slatePlayers, sport)
    : getShowcaseExposureSummaryFromGames(gameEntries, eligiblePlayers, slatePlayers, sport);

  const ownedRows = isAuthenticated
    ? isNascar
      ? getOwnedExposureRowsFromRaces(races, raceHoldings, eligiblePlayers, slatePlayers, sport, 6)
      : getOwnedExposureRowsFromGames(gameEntries, eligiblePlayers, slatePlayers, sport, 6)
    : [];
  const missingRows = isAuthenticated ? getMissingExposureRows(slatePlayers, ownedRows, 6) : [];
  const guestRows = !isAuthenticated ? getGuestExposureRows(slatePlayers, 6) : [];

  const defaultTab = getDefaultExposureTab({
    isAuthenticated,
    ownedRows,
    missingRows,
  });
  const [activeTab, setActiveTab] = useState<DashboardShowcaseTab>(defaultTab);
  const [playerModalOpen, setPlayerModalOpen] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const contextRace = useMemo(() => {
    if (!isNascar || races.length === 0) return null;
    const priority: Record<DashboardShowcaseRace["status"], number> = {
      inprogress: 0,
      scheduled: 1,
      completed: 2,
    };
    return [...races].sort((left, right) => {
      const statusDelta = priority[left.status] - priority[right.status];
      if (statusDelta !== 0) return statusDelta;
      return new Date(left.raceDate).getTime() - new Date(right.raceDate).getTime();
    })[0];
  }, [isNascar, races]);

  const { data: nascarRaceContext } = useQuery<NascarRaceContextResponse>({
    queryKey: [
      "/api/nascar/races/context",
      contextRace?.raceId || null,
      selectedDate.getFullYear(),
    ],
    enabled: isNascar && Boolean(contextRace?.raceId),
    queryFn: async () => {
      const response = await fetch(
        `/api/nascar/races/${encodeURIComponent(contextRace!.raceId)}/context?year=${selectedDate.getFullYear()}`,
      );
      if (!response.ok) {
        throw new Error(`NASCAR context request failed: ${response.status}`);
      }
      return response.json();
    },
    staleTime: contextRace?.status === "inprogress" ? 15_000 : 120_000,
    refetchInterval: contextRace?.status === "inprogress" ? 30_000 : false,
    retry: 1,
  });

  const nascarContextByPlayerId = useMemo(
    () => new Map((nascarRaceContext?.drivers || []).map((driver) => [driver.playerId, driver])),
    [nascarRaceContext],
  );

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab, selectedDateLabel, sport]);

  const openPlayerModal = (playerId: string) => {
    setSelectedPlayerId(playerId);
    setPlayerModalOpen(true);
  };

  const visibleTabs = isAuthenticated
    ? [
        { id: "owned" as const, label: "Owned" },
        { id: "missing" as const, label: "Missing" },
      ]
    : [{ id: "top" as const, label: "Top Slate" }];

  const activeRows =
    activeTab === "owned" ? ownedRows : activeTab === "missing" ? missingRows : guestRows;

  const summaryLine = isAuthenticated
    ? `${selectedDateLabel} | ${exposureSummary.ownedCount} owned | ${exposureSummary.earningCount} earning | ${slateCounts.live} live`
    : `${selectedDateLabel} | ${slateCounts.live} live of ${totalSlateCount}`;

  const emptyState =
    activeTab === "owned"
      ? "No owned players on this slate."
      : activeTab === "missing"
        ? "Top slate coverage is clean right now."
        : "Top slate exposure will populate here.";

  return (
    <Card
      className="relative max-h-[46svh] overflow-hidden md:max-h-[340px]"
      data-testid="dashboard-showcase-card"
    >
      <CardAccent variant="top" color="primary" intensity="medium" />

      <CardHeader className="space-y-1.5 px-3 pb-2 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">
              Slate Exposure
            </CardTitle>
            <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {summaryLine}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Badge
              variant="outline"
              className="rounded-sm border-border/70 bg-background/30 px-1.5 text-[10px] uppercase tracking-[0.08em]"
            >
              {sport === "ALL" ? "All" : sport}
            </Badge>
            {!isAuthenticated && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] uppercase tracking-[0.08em]"
                onClick={() => onNavigate("/login")}
              >
                Sign In
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {isAuthenticated ? (
            <>
              <MetricPill label="owned" value={String(exposureSummary.ownedCount)} />
              <MetricPill label="earning" value={String(exposureSummary.earningCount)} />
              <MetricPill label="live" value={String(exposureSummary.liveCount)} />
            </>
          ) : (
            <>
              <MetricPill label="live" value={String(exposureSummary.liveCount)} />
              <MetricPill label="up" value={String(exposureSummary.upcomingCount)} />
              <MetricPill label="final" value={String(exposureSummary.completedCount)} />
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {visibleTabs.map((tab) => (
              <ExposureTabButton
                key={tab.id}
                active={activeTab === tab.id}
                label={tab.label}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
          <div className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {selectedDateLabel}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 pt-0">
        <div className="max-h-[24svh] space-y-1 overflow-y-auto pr-1 md:max-h-[240px]">
          {activeRows.length > 0 ? (
            activeRows.map((row) => (
              <ExposureRow
                key={row.id}
                row={row}
                mode={activeTab}
                onOpenPlayer={openPlayerModal}
                nascarContext={isNascar ? nascarContextByPlayerId.get(row.playerId) : null}
              />
            ))
          ) : (
            <div className="rounded-sm border border-dashed border-border/70 bg-background/20 px-2 py-2 text-[11px] text-muted-foreground">
              {emptyState}
            </div>
          )}
        </div>
      </CardContent>

      <PlayerModal
        playerId={selectedPlayerId}
        open={playerModalOpen}
        onOpenChange={(open) => {
          setPlayerModalOpen(open);
          if (!open) {
            setSelectedPlayerId(null);
          }
        }}
      />
    </Card>
  );
}

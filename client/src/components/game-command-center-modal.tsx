import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Zap,
  X,
  Binoculars,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { MlbProbableBadge } from "@/components/mlb-probable-badge";
import { Shimmer } from "@/components/ui/animations";
import { PlayerModal } from "@/components/player-modal";
import { apiRequest, authenticatedFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { GameInsight, GameInsightDetailResponse } from "@/types/game-insights";

interface GameCommandCenterModalProps {
  gameId: string;
  sport: string;
  date: string;
  initialInsight?: GameInsight | null;
  onClose: () => void;
}

type CommandCenterTab = "pre" | "during" | "post";

type InjuryEntry = GameInsightDetailResponse["injuries"][number];

type LivePlayerStats = {
  playerId?: string;
  name: string;
  team?: string;
  position?: string;
  min?: string;
  pts?: number;
  reb?: number;
  ast?: number;
  stl?: number;
  blk?: number;
  fgm?: number;
  fga?: number;
  fg3m?: number;
  fg3a?: number;
  ftm?: number;
  fta?: number;
  pf?: number;
  plusMinus?: number | null;
  turnover?: number;
  fg_pct?: number;
  passingCompletions?: number | null;
  passingAttempts?: number | null;
  passingYards?: number | null;
  passingTDs?: number | null;
  passingInterceptions?: number | null;
  rushingAttempts?: number | null;
  rushingYards?: number | null;
  rushingTDs?: number | null;
  receivingTargets?: number | null;
  receivingYards?: number | null;
  receivingTDs?: number | null;
  receptions?: number | null;
  atBats?: number;
  hits?: number;
  doubles?: number;
  triples?: number;
  homeRuns?: number;
  runs?: number;
  runsBattedIn?: number;
  walks?: number;
  stolenBases?: number;
  strikeoutsBatting?: number;
  inningsPitched?: number;
  pitchingStrikeouts?: number;
  earnedRuns?: number;
  wins?: number;
  saves?: number;
  runningPosition?: number;
  startingPosition?: number;
  finishPosition?: number | null;
  carNumber?: string;
  manufacturer?: string;
  lapsCompleted?: number;
  lapsLed?: number;
  fastestLaps?: number;
  positionDifferential?: number;
  averageRunningPosition?: number | null;
  averageSpeed?: number | null;
  bestLap?: number | null;
  bestLapSpeed?: number | null;
  bestLapTime?: string | null;
  delta?: number | null;
  isOnTrack?: boolean | null;
  isOnDvp?: boolean | null;
  providerPoints?: number | null;
  status?: string;
  goals?: number | null;
  points?: number | null;
  shotsOnGoal?: number | null;
  hits?: number | null;
  blockedShots?: number | null;
  saves?: number | null;
  goalsAgainst?: number | null;
  timeOnIce?: string | null;
  decision?: string | null;
  fantasyPoints?: number;
};

interface LiveStatsResponse {
  gameId: string;
  sport?: string;
  status: string;
  period?: number | null;
  periodType?: string | null;
  clock?: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homePlayers?: LivePlayerStats[];
  awayPlayers?: LivePlayerStats[];
  homeTopPerformers?: Array<{
    playerId?: string;
    name: string;
    team?: string;
    pts?: number;
    reb?: number;
    ast?: number;
    hits?: number;
    runs?: number;
    rbi?: number;
    position?: number;
    lapsLed?: number;
    fastestLaps?: number;
  }>;
  awayTopPerformers?: Array<{
    playerId?: string;
    name: string;
    team?: string;
    pts?: number;
    reb?: number;
    ast?: number;
    hits?: number;
    runs?: number;
    rbi?: number;
    position?: number;
    lapsLed?: number;
    fastestLaps?: number;
  }>;
  lapInfo?: {
    currentLap: number;
    totalLaps: number;
    lapsToGo: number;
    flagState: string;
    flagStateCode?: number | null;
    stage?: { stage_num?: number; finish_at_lap?: number; laps_in_stage?: number } | null;
    runName?: string | null;
    runType?: number | null;
    cautions?: number | null;
    leadChanges?: number | null;
    leaders?: number | null;
  } | null;
  userEarnings?: {
    totalEstimatedEarnings: number;
    ownedPlayers: Array<{
      playerId: string;
      name: string;
      team: string;
      quantity: number;
      effectiveShares: number;
      fantasyPoints: number;
      estimatedEarnings: number;
    }>;
  } | null;
  message?: string;
}

type PlayerModalLookupInput = {
  playerId?: string | null;
  name: string;
  team?: string | null;
};

interface GameStatsResponse {
  gameId: string;
  homeTeam: {
    players: Array<{
      playerId: string;
      playerName: string;
      fantasyPoints: number;
      points: number;
      rebounds: number;
      assists: number;
    }>;
    totals: Record<string, number> | null;
  };
  awayTeam: {
    players: Array<{
      playerId: string;
      playerName: string;
      fantasyPoints: number;
      points: number;
      rebounds: number;
      assists: number;
    }>;
    totals: Record<string, number> | null;
  };
  topPerformers: {
    topScorer: { playerName: string; points: number };
    topRebounder: { playerName: string; rebounds: number };
    topAssister: { playerName: string; assists: number };
  } | null;
  message?: string;
}

interface ScoutAssignment {
  id: string;
  playerId: string;
  scoutCount: number;
  player?: {
    firstName: string;
    lastName: string;
    team: string;
  } | null;
}

interface ScoutData {
  assignments: ScoutAssignment[];
  totalScouts: number;
  maxScouts: number;
  remaining: number;
  isPremium: boolean;
}

const formatName = (name: string) => {
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : name;
};

const formatCompactName = (name: string) => {
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length <= 1) return parts[0] || name;
  return `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`;
};

const formatPitcherMetric = (value: number | null | undefined, digits = 3) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
};

const formatPitcherEra = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value.toFixed(2);
};

const attendanceFormatter = new Intl.NumberFormat("en-US");

const formatAttendance = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return attendanceFormatter.format(value);
};

function MlbLinescorePanel({
  title,
  game,
  mlbPregame,
  showDecisions = false,
  embedded = false,
  resolvePlayerModalId,
  onOpenPlayerModal,
}: {
  title: string;
  game?: Pick<GameInsight, "awayTeam" | "homeTeam"> | null;
  mlbPregame?: GameInsight["mlbPregame"] | null;
  showDecisions?: boolean;
  embedded?: boolean;
  resolvePlayerModalId?: (input: PlayerModalLookupInput) => string | null;
  onOpenPlayerModal?: (playerId: string) => void;
}) {
  const gameState = mlbPregame?.gameState || null;
  const linescore = gameState?.linescore || null;

  if (!gameState && !linescore) {
    return null;
  }

  const attendanceLabel = null; // attendance disabled — unreliable data
  const decisions = gameState?.decisions;
  const renderDecisionName = (name: string) => {
    if (!resolvePlayerModalId || !onOpenPlayerModal) {
      return <div className="mt-1 font-semibold text-foreground">{name}</div>;
    }

    const resolvedPlayerId = resolvePlayerModalId({ name });
    if (!resolvedPlayerId) {
      return <div className="mt-1 font-semibold text-foreground">{name}</div>;
    }

    return (
      <button
        type="button"
        onClick={() => onOpenPlayerModal(resolvedPlayerId)}
        className="mt-1 text-left font-semibold text-foreground underline-offset-2 hover:underline focus-visible:underline"
      >
        {name}
      </button>
    );
  };

  return (
    <div className={embedded ? "space-y-3" : "rounded-sm border border-border/60 p-3"}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{title}</div>
        {gameState?.detailedStatus ? (
          <Badge variant="outline" className="text-[10px] border-border/80">
            {gameState.detailedStatus}
          </Badge>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {gameState?.inningLabel ? (
          <Badge variant="outline" className="text-[10px] border-border/80">
            {gameState.inningLabel}
          </Badge>
        ) : null}
        {gameState?.countSummary ? (
          <Badge variant="outline" className="text-[10px] border-border/80">
            {gameState.countSummary}
          </Badge>
        ) : null}
        {gameState?.weatherSummary ? (
          <Badge variant="outline" className="text-[10px] border-border/80">
            {gameState.weatherSummary}
          </Badge>
        ) : null}
      </div>

      {linescore ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] border-separate border-spacing-0 text-[10px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="border-b border-border/60 px-2 py-1 text-left font-medium">Team</th>
                {linescore.innings.map((inning) => (
                  <th
                    key={`${title}-inning-${inning.num}`}
                    className="border-b border-border/60 px-2 py-1 text-right font-medium"
                  >
                    {inning.num}
                  </th>
                ))}
                <th className="border-b border-border/60 px-2 py-1 text-right font-medium">R</th>
                <th className="border-b border-border/60 px-2 py-1 text-right font-medium">H</th>
                <th className="border-b border-border/60 px-2 py-1 text-right font-medium">E</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  team: game?.awayTeam || "Away",
                  inningScores: linescore.innings.map((inning) => inning.away),
                  totals: [
                    linescore.totals.awayRuns,
                    linescore.totals.awayHits,
                    linescore.totals.awayErrors,
                  ],
                },
                {
                  team: game?.homeTeam || "Home",
                  inningScores: linescore.innings.map((inning) => inning.home),
                  totals: [
                    linescore.totals.homeRuns,
                    linescore.totals.homeHits,
                    linescore.totals.homeErrors,
                  ],
                },
              ].map((row) => (
                <tr key={`${title}-${row.team}`}>
                  <td className="border-b border-border/40 px-2 py-1.5 font-semibold text-foreground">
                    {row.team}
                  </td>
                  {row.inningScores.map((value, index) => (
                    <td
                      key={`${title}-${row.team}-inning-${index + 1}`}
                      className="border-b border-border/40 px-2 py-1.5 text-right font-mono"
                    >
                      {value ?? "-"}
                    </td>
                  ))}
                  {row.totals.map((value, index) => (
                    <td
                      key={`${title}-${row.team}-total-${index + 1}`}
                      className="border-b border-border/40 px-2 py-1.5 text-right font-mono font-semibold"
                    >
                      {value ?? "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showDecisions && decisions ? (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {decisions.winner ? (
            <div className="rounded-sm border border-border/60 bg-background/40 p-2 text-xs">
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Winning Pitcher
              </div>
              {renderDecisionName(decisions.winner)}
            </div>
          ) : null}
          {decisions.loser ? (
            <div className="rounded-sm border border-border/60 bg-background/40 p-2 text-xs">
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Losing Pitcher
              </div>
              {renderDecisionName(decisions.loser)}
            </div>
          ) : null}
          {decisions.save ? (
            <div className="rounded-sm border border-border/60 bg-background/40 p-2 text-xs">
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Save
              </div>
              {renderDecisionName(decisions.save)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MlbLifecycleCard({
  game,
  mlbPregame,
  mlbSignals,
  activeTab,
  liveStats,
  userContext,
  isAuthenticated,
  isHydratingDetails,
  showMlbAdvanced,
  onToggleAdvanced,
  resolvePlayerModalId,
  onOpenPlayerModal,
}: {
  game?: GameInsight | null;
  mlbPregame?: GameInsight["mlbPregame"] | null;
  mlbSignals?: GameInsight["mlbSignals"] | null;
  activeTab: CommandCenterTab;
  liveStats?: LiveStatsResponse;
  userContext?: GameInsight["userContext"] | null;
  isAuthenticated: boolean;
  isHydratingDetails: boolean;
  showMlbAdvanced: boolean;
  onToggleAdvanced: () => void;
  resolvePlayerModalId: (input: PlayerModalLookupInput) => string | null;
  onOpenPlayerModal: (playerId: string) => void;
}) {
  if (!game || !mlbPregame) {
    return null;
  }

  const isPregame = activeTab === "pre";
  const lifecycleLabel = isPregame ? "Pregame" : activeTab === "during" ? "Live" : "Final";
  const scoreAvailable =
    !isPregame &&
    typeof liveStats?.awayScore === "number" &&
    typeof liveStats?.homeScore === "number";
  const scoreLine = scoreAvailable
    ? `${game.awayTeam} ${liveStats?.awayScore ?? 0} • ${liveStats?.homeScore ?? 0} ${game.homeTeam}`
    : null;
  const scheduledOwnedPlayers = userContext?.ownedPlayers || [];
  const liveOwnedPlayers = liveStats?.userEarnings?.ownedPlayers || [];
  const totalLiveEarnings = liveStats?.userEarnings?.totalEstimatedEarnings || 0;
  const hasMlbTeamContext = Boolean(mlbPregame.teamContexts.away || mlbPregame.teamContexts.home);
  const [scoringExpanded, setScoringExpanded] = useState(false);
  const attendanceLabel = null; // attendance disabled — unreliable data
  const ownershipBadgeLabel = isAuthenticated
    ? isPregame
      ? `${scheduledOwnedPlayers.length} held`
      : `${liveOwnedPlayers.length} live`
    : null;
  const normalizeLookupToken = (value: string | null | undefined) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  const buildNameTeamKey = (name: string | null | undefined, team: string | null | undefined) =>
    `${normalizeLookupToken(name)}::${normalizeLookupToken(team)}`;
  const scheduledExposureByNameTeam = new Map(
    scheduledOwnedPlayers.map((player) => [
      buildNameTeamKey(player.name, player.team),
      {
        badge: `${player.multiplier.toFixed(1)}x`,
        detail: `${player.totalShares.toFixed(1)} shares held`,
        tone: "text-purple-500",
      },
    ]),
  );
  const liveExposureByNameTeam = new Map(
    liveOwnedPlayers.map((player) => [
      buildNameTeamKey(player.name, player.team),
      {
        badge: `$${player.estimatedEarnings.toFixed(2)}`,
        detail: `${player.fantasyPoints.toFixed(1)} FP • ${player.effectiveShares.toFixed(1)} effective`,
        tone: "text-emerald-600 dark:text-emerald-400",
      },
    ]),
  );
  const renderModalPlayerName = ({
    name,
    team,
    playerId,
    className = "",
    label,
  }: {
    name: string;
    team?: string | null;
    playerId?: string | null;
    className?: string;
    label?: string;
  }) => {
    const resolvedPlayerId = resolvePlayerModalId({ playerId, name, team });
    const displayName = label || name;
    if (!resolvedPlayerId) {
      return <span className={className}>{displayName}</span>;
    }

    return (
      <button
        type="button"
        onClick={() => onOpenPlayerModal(resolvedPlayerId)}
        className={`${className} text-left underline-offset-2 hover:underline focus-visible:underline`}
      >
        {displayName}
      </button>
    );
  };

  return (
    <section className="mt-4 overflow-hidden rounded-md border border-border/70 bg-background/80">
      {!isPregame && mlbPregame.gameState ? (
        <MlbLinescorePanel
          title={activeTab === "during" ? "MLB Game State" : "Final Linescore"}
          game={game}
          mlbPregame={mlbPregame}
          showDecisions={activeTab === "post"}
          embedded
          resolvePlayerModalId={resolvePlayerModalId}
          onOpenPlayerModal={onOpenPlayerModal}
        />
      ) : null}

      {!isPregame && mlbPregame.scoringPlays.length ? (
        <div className="border-t border-border/60 px-3 py-3 sm:px-4">
          <button
            type="button"
            onClick={() => setScoringExpanded(!scoringExpanded)}
            className="flex w-full items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>Scoring summary ({mlbPregame.scoringPlays.length})</span>
            <ChevronDown
              className={`h-3 w-3 transition-transform ${scoringExpanded ? "rotate-180" : ""}`}
            />
          </button>
          {scoringExpanded ? (
            <div className="mt-3 space-y-2">
              {mlbPregame.scoringPlays.map((play, index) => (
                <div
                  key={`scoring-play-${play.inningLabel || "inning"}-${index}`}
                  className="rounded-sm border border-border/60 bg-background/40 p-2"
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    {play.inningLabel ? <span>{play.inningLabel}</span> : null}
                    {play.battingTeam ? <span>{play.battingTeam}</span> : null}
                    {play.scoreLabel ? <span>{play.scoreLabel}</span> : null}
                    {play.event ? <span>{play.event}</span> : null}
                  </div>
                  <div className="mt-1 text-xs text-foreground">{play.description}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {isPregame && (
        <div className="border-t border-border/60 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Your exposure
            </div>
            {ownershipBadgeLabel ? (
              <Badge variant="outline" className="text-[10px] border-border/80">
                {ownershipBadgeLabel}
              </Badge>
            ) : null}
          </div>

          {!isAuthenticated ? (
            <div className="mt-2 text-xs text-muted-foreground">
              Sign in to tie this matchup back to your holdings and earnings.
            </div>
          ) : isPregame ? (
            scheduledOwnedPlayers.length > 0 ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {scheduledOwnedPlayers.slice(0, 4).map((player) => (
                    <Badge
                      key={`pregame-owned-${player.playerId}`}
                      variant="outline"
                      className="text-[10px] gap-1 border-border/80"
                    >
                      {renderModalPlayerName({
                        name: player.name,
                        team: player.team,
                        playerId: player.playerId,
                        className: "text-purple-500",
                        label: formatCompactName(player.name),
                      })}
                      <span className="font-mono">{player.multiplier.toFixed(1)}x</span>
                    </Badge>
                  ))}
                  {scheduledOwnedPlayers.length > 4 ? (
                    <Badge variant="outline" className="text-[10px] border-border/80">
                      +{scheduledOwnedPlayers.length - 4}
                    </Badge>
                  ) : null}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Track posted lineups here against the players you already hold in this game.
                </div>
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">
                No current holdings in this matchup.
              </div>
            )
          ) : liveOwnedPlayers.length > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-sm border border-emerald-500/30 bg-background/70 px-2 py-1.5">
                <span className="text-xs text-muted-foreground">
                  {activeTab === "during" ? "Live estimated" : "Final estimated"}
                </span>
                <span className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  ${totalLiveEarnings.toFixed(2)}
                </span>
              </div>
              <div className="space-y-1.5">
                {liveOwnedPlayers.slice(0, 4).map((player) => (
                  <div
                    key={`live-owned-${player.playerId}`}
                    className="flex items-center justify-between gap-2 rounded-sm border border-border/60 bg-background/60 px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      {renderModalPlayerName({
                        name: player.name,
                        team: player.team,
                        playerId: player.playerId,
                        className: "truncate text-xs font-medium text-purple-500",
                        label: formatCompactName(player.name),
                      })}
                      <div className="text-[10px] text-muted-foreground">
                        {player.team} • {player.fantasyPoints.toFixed(1)} FP •{" "}
                        {player.effectiveShares.toFixed(1)} effective
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        ${player.estimatedEarnings.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {player.quantity.toFixed(2)} shares
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              No stacked or boosted earning lines are active in this matchup yet.
            </div>
          )}
        </div>
      )}

      {isPregame && (
        <div className="border-t border-border/60 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {isPregame ? "Probable starters" : "Starter context"}
            </div>
            {mlbPregame.advancedStatsAvailable ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={onToggleAdvanced}
              >
                {showMlbAdvanced ? (
                  <>
                    Hide advanced <ChevronUp className="ml-1 h-3 w-3" />
                  </>
                ) : (
                  <>
                    Show advanced <ChevronDown className="ml-1 h-3 w-3" />
                  </>
                )}
              </Button>
            ) : null}
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[
              {
                side: "Away",
                team: game.awayTeam || "Away",
                pitcher: mlbPregame.probablePitchers.away,
                stats: mlbPregame.probablePitcherStats.away,
              },
              {
                side: "Home",
                team: game.homeTeam || "Home",
                pitcher: mlbPregame.probablePitchers.home,
                stats: mlbPregame.probablePitcherStats.home,
              },
            ].map((entry) => {
              const probablePitcherId = entry.pitcher?.name
                ? resolvePlayerModalId({
                    name: entry.pitcher.name,
                    team: entry.team,
                  })
                : null;

              return (
                <div
                  key={`${entry.side}-${entry.team}`}
                  className="rounded-sm border border-border/60 bg-background/40 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {entry.team} probable
                    </div>
                    <div className="flex items-center gap-1">
                      <MlbProbableBadge />
                      {entry.stats ? (
                        <Badge variant="outline" className="text-[10px] border-border/80">
                          Advanced
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-2 text-sm font-semibold text-foreground">
                    {entry.pitcher?.name ? (
                      probablePitcherId ? (
                        <button
                          type="button"
                          onClick={() => onOpenPlayerModal(probablePitcherId)}
                          className="truncate text-left underline-offset-2 hover:underline focus-visible:underline"
                        >
                          {entry.pitcher.name}
                        </button>
                      ) : (
                        entry.pitcher.name
                      )
                    ) : (
                      "TBD"
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {entry.stats?.summary ||
                      entry.pitcher?.note ||
                      "Statcast expected stats are not available for this starter yet."}
                  </div>

                  {showMlbAdvanced && entry.stats ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-sm border border-border/60 bg-background/50 p-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          ERA
                        </div>
                        <div className="mt-1 font-mono">{formatPitcherEra(entry.stats.era)}</div>
                      </div>
                      <div className="rounded-sm border border-border/60 bg-background/50 p-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          xERA
                        </div>
                        <div className="mt-1 font-mono text-emerald-600 dark:text-emerald-400">
                          {formatPitcherEra(entry.stats.xera)}
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/60 bg-background/50 p-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          wOBA
                        </div>
                        <div className="mt-1 font-mono">
                          {formatPitcherMetric(entry.stats.woba)}
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/60 bg-background/50 p-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          xwOBA
                        </div>
                        <div className="mt-1 font-mono">
                          {formatPitcherMetric(entry.stats.expectedWoba)}
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/60 bg-background/50 p-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          AVG
                        </div>
                        <div className="mt-1 font-mono">
                          {formatPitcherMetric(entry.stats.battingAverage)}
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/60 bg-background/50 p-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          xAVG
                        </div>
                        <div className="mt-1 font-mono">
                          {formatPitcherMetric(entry.stats.expectedBattingAverage)}
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/60 bg-background/50 p-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          SLG
                        </div>
                        <div className="mt-1 font-mono">
                          {formatPitcherMetric(entry.stats.slugging)}
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/60 bg-background/50 p-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          xSLG
                        </div>
                        <div className="mt-1 font-mono">
                          {formatPitcherMetric(entry.stats.expectedSlugging)}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isPregame && (
        <div className="border-t border-border/60 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Starting lineups
            </div>
            {isHydratingDetails && !mlbPregame.lineupsPosted ? (
              <Badge variant="outline" className="text-[10px] border-border/80">
                Loading
              </Badge>
            ) : mlbPregame.lineupsPosted ? (
              <Badge variant="outline" className="text-[10px] border-border/80">
                Gameday
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-border/80">
                Pending
              </Badge>
            )}
          </div>

          {mlbPregame.lineupsPosted ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {[
                {
                  team: game.awayTeam || "Away",
                  lineup: mlbPregame.startingLineups.away,
                  note: mlbPregame.hitterMatchupNotes.away,
                  signal: mlbPregame.lineupSignals.away,
                  context: mlbPregame.teamContexts.away,
                  opposingPitcher:
                    mlbPregame.probablePitchers.home?.name || game.homeTeam || "Home",
                },
                {
                  team: game.homeTeam || "Home",
                  lineup: mlbPregame.startingLineups.home,
                  note: mlbPregame.hitterMatchupNotes.home,
                  signal: mlbPregame.lineupSignals.home,
                  context: mlbPregame.teamContexts.home,
                  opposingPitcher:
                    mlbPregame.probablePitchers.away?.name || game.awayTeam || "Away",
                },
              ].map((entry) => (
                <div
                  key={`${entry.team}-lineup`}
                  className="rounded-sm border border-border/60 bg-background/40 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground">
                        {entry.team}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {entry.context?.record ? `${entry.context.record} • ` : ""}
                        vs {entry.opposingPitcher}
                      </div>
                    </div>
                    {entry.context?.record ? (
                      <Badge variant="outline" className="text-[10px] border-border/80">
                        {entry.context.record}
                      </Badge>
                    ) : null}
                  </div>
                  {entry.note || entry.signal ? (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {entry.note || entry.signal}
                    </div>
                  ) : null}
                  {entry.lineup.length ? (
                    <div className="space-y-1.5">
                      {entry.lineup.map((player) => {
                        const exposure = (
                          isPregame ? scheduledExposureByNameTeam : liveExposureByNameTeam
                        ).get(buildNameTeamKey(player.name, entry.team));
                        const nameClass = `truncate font-medium ${exposure ? "text-purple-500" : "text-foreground"}`;

                        return (
                          <div
                            key={`${entry.team}-${player.slot}-${player.playerId || player.name}`}
                            className={`rounded-sm px-2 py-2 text-xs ${exposure ? "bg-purple-500/5" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-muted-foreground">
                                    {player.slot}.
                                  </span>
                                  {renderModalPlayerName({
                                    name: player.name,
                                    team: entry.team,
                                    playerId: player.playerId,
                                    className: nameClass,
                                  })}
                                </div>
                                {exposure ? (
                                  <div className="mt-1 pl-5 text-[11px] text-muted-foreground">
                                    {exposure.detail}
                                  </div>
                                ) : null}
                              </div>
                              <div className="shrink-0 text-right">
                                <div
                                  className={`font-mono text-[11px] ${exposure ? exposure.tone : "text-muted-foreground"}`}
                                >
                                  {exposure?.badge || player.position || "--"}
                                </div>
                                {!exposure && player.jerseyNumber ? (
                                  <div className="text-[10px] text-muted-foreground">
                                    #{player.jerseyNumber}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {entry.team} has not posted a lineup yet.
                    </div>
                  )}
                  {entry.context?.lastGameSummary || entry.context?.nextGameSummary ? (
                    <div className="mt-3 space-y-1.5 border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
                      {entry.context?.lastGameSummary ? (
                        <div>{entry.context.lastGameSummary}</div>
                      ) : null}
                      {entry.context?.nextGameSummary ? (
                        <div>{entry.context.nextGameSummary}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-xs text-muted-foreground">
              {isHydratingDetails
                ? "Loading the full MLB box score and batting orders..."
                : "MLB has not posted the batting orders for this game yet."}
            </div>
          )}
        </div>
      )}

      {isPregame && !mlbPregame.lineupsPosted ? (
        <div className="border-t border-border/60 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Hitter matchups
            </div>
            <Badge variant="outline" className="text-[10px] border-border/80">
              Display only
            </Badge>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[
              {
                team: game.awayTeam || "Away",
                note: mlbPregame.hitterMatchupNotes.away,
                signal: mlbPregame.lineupSignals.away,
                spotlights: mlbPregame.hitterSpotlights.away,
                opposingPitcher: mlbPregame.probablePitchers.home?.name || game.homeTeam || "Home",
              },
              {
                team: game.homeTeam || "Home",
                note: mlbPregame.hitterMatchupNotes.home,
                signal: mlbPregame.lineupSignals.home,
                spotlights: mlbPregame.hitterSpotlights.home,
                opposingPitcher: mlbPregame.probablePitchers.away?.name || game.awayTeam || "Away",
              },
            ].map((entry) => (
              <div
                key={`${entry.team}-hitters`}
                className="rounded-sm border border-border/60 bg-background/40 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground">
                    {entry.team} bats
                  </div>
                  <Badge variant="outline" className="text-[10px] border-border/80">
                    vs {entry.opposingPitcher}
                  </Badge>
                </div>

                <div className="mt-2 text-xs text-foreground">
                  {entry.note ||
                    entry.signal ||
                    "Waiting on posted lineup or hitter Statcast context."}
                </div>

                {entry.signal && entry.signal !== entry.note ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">{entry.signal}</div>
                ) : null}

                {entry.spotlights.length ? (
                  <div className="mt-3 space-y-2">
                    {entry.spotlights.map((player) => (
                      <div
                        key={`${entry.team}-${player.slot}-${player.name}`}
                        className="rounded-sm border border-border/60 bg-background/60 p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {player.slot}.
                              </span>
                              {renderModalPlayerName({
                                name: player.name,
                                team: entry.team,
                                className: "truncate text-xs font-semibold text-foreground",
                              })}
                              {player.position ? (
                                <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                                  {player.position}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-right font-mono text-[11px]">
                            <div>{formatPitcherMetric(player.expectedWoba)}</div>
                            <div className="text-muted-foreground">xwOBA</div>
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {player.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground">
                    No hitter spotlights available yet.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hasMlbTeamContext && !mlbPregame.lineupsPosted ? (
        <div className="border-t border-border/60 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Club context
            </div>
            <Badge variant="outline" className="text-[10px] border-border/80">
              Display only
            </Badge>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[
              {
                team: game.awayTeam || "Away",
                context: mlbPregame.teamContexts.away,
              },
              {
                team: game.homeTeam || "Home",
                context: mlbPregame.teamContexts.home,
              },
            ].map((entry) => (
              <div
                key={`${entry.team}-club-context`}
                className="rounded-sm border border-border/60 bg-background/40 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground">
                    {entry.team}
                  </div>
                  {entry.context?.record ? (
                    <Badge variant="outline" className="text-[10px] border-border/80">
                      {entry.context.record}
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-3 space-y-2 text-xs">
                  {entry.context?.lastGameSummary ? (
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        Last result
                      </div>
                      <div className="mt-1 text-foreground">{entry.context.lastGameSummary}</div>
                    </div>
                  ) : null}
                  {entry.context?.nextGameSummary ? (
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        On deck
                      </div>
                      <div className="mt-1 text-foreground">{entry.context.nextGameSummary}</div>
                    </div>
                  ) : null}
                  {!entry.context?.record &&
                  !entry.context?.lastGameSummary &&
                  !entry.context?.nextGameSummary ? (
                    <div className="text-muted-foreground">
                      Team context is not available for this club yet.
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const getPlayerIdVariants = (playerId: string, sport?: string) => {
  const rawId = String(playerId || "").trim();
  if (!rawId) return [] as string[];

  const variants = new Set<string>([rawId]);
  const normalizedSport = (sport || "").toUpperCase();

  if (
    rawId.startsWith("nba_") ||
    rawId.startsWith("nfl_") ||
    rawId.startsWith("mlb_") ||
    rawId.startsWith("nhl_")
  ) {
    variants.add(rawId.slice(4));
  } else {
    if (normalizedSport === "NBA") variants.add(`nba_${rawId}`);
    if (normalizedSport === "NFL") variants.add(`nfl_${rawId}`);
    if (normalizedSport === "MLB") variants.add(`mlb_${rawId}`);
    if (normalizedSport === "NHL") variants.add(`nhl_${rawId}`);
  }

  return Array.from(variants);
};

const resolveModalPlayerIdCandidate = ({
  playerId,
  sport,
  knownPlayerIds,
}: {
  playerId: string | null | undefined;
  sport: string;
  knownPlayerIds: Set<string>;
}): string | null => {
  const rawId = String(playerId || "").trim();
  if (!rawId) return null;

  const variants = getPlayerIdVariants(rawId, sport);
  for (const variant of variants) {
    if (/^(nba_|nfl_|mlb_|nascar_|nhl_)/i.test(variant) && knownPlayerIds.has(variant)) {
      return variant;
    }
  }
  for (const variant of variants) {
    if (knownPlayerIds.has(variant)) {
      return variant;
    }
  }

  const normalizedSport = (sport || "").toUpperCase();
  const lowerRawId = rawId.toLowerCase();
  if (normalizedSport === "NBA" && !lowerRawId.startsWith("nba_")) return `nba_${rawId}`;
  if (normalizedSport === "NFL" && !lowerRawId.startsWith("nfl_")) return `nfl_${rawId}`;
  if (normalizedSport === "MLB" && !lowerRawId.startsWith("mlb_")) return `mlb_${rawId}`;
  if (normalizedSport === "NASCAR" && !lowerRawId.startsWith("nascar_")) return `nascar_${rawId}`;
  if (normalizedSport === "NHL" && !lowerRawId.startsWith("nhl_")) return `nhl_${rawId}`;
  return rawId;
};

const normalizePlayerName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const getPlayerNameTeamKey = (name: string, team?: string) => {
  const normalizedTeam = String(team || "")
    .trim()
    .toUpperCase();
  const normalizedName = normalizePlayerName(name || "");
  return `${normalizedTeam}|${normalizedName}`;
};

const getAutoTab = (game?: Pick<GameInsight, "status" | "startTime"> | null): CommandCenterTab => {
  if (!game) return "pre";

  if (game.status === "completed") return "post";
  if (game.status === "inprogress") return "during";
  if (game.status === "postponed") return "pre";

  const now = new Date();
  const startTime = new Date(game.startTime);
  const timeSinceStart = now.getTime() - startTime.getTime();
  const threeHoursMs = 3 * 60 * 60 * 1000;

  if (timeSinceStart > 0 && timeSinceStart < threeHoursMs) {
    return "during";
  }

  if (timeSinceStart >= threeHoursMs) {
    return "post";
  }

  return "pre";
};

const hasMeaningfulLiveStats = (player: LivePlayerStats, sport: string): boolean => {
  const normalizedSport = (sport || "").toUpperCase();

  if (normalizedSport === "MLB") {
    const mlbStats = [
      player.fantasyPoints,
      player.atBats,
      player.hits,
      player.homeRuns,
      player.runs,
      player.runsBattedIn,
      player.walks,
      player.stolenBases,
      player.strikeoutsBatting,
      player.inningsPitched,
      player.pitchingStrikeouts,
      player.earnedRuns,
      player.wins,
      player.saves,
    ];

    return mlbStats.some((value) => (value ?? 0) !== 0);
  }

  if (normalizedSport === "NFL") {
    const nflStats = [
      player.fantasyPoints,
      player.passingAttempts,
      player.passingYards,
      player.passingTDs,
      player.passingInterceptions,
      player.rushingAttempts,
      player.rushingYards,
      player.rushingTDs,
      player.receivingTargets,
      player.receivingYards,
      player.receivingTDs,
      player.receptions,
    ];

    return nflStats.some((value) => (value ?? 0) !== 0);
  }

  if (normalizedSport === "NASCAR") {
    const nascarStats = [
      player.fantasyPoints,
      player.runningPosition,
      player.startingPosition,
      player.lapsCompleted,
      player.lapsLed,
      player.fastestLaps,
      player.positionDifferential,
      player.bestLapSpeed,
    ];

    return nascarStats.some((value) => (value ?? 0) !== 0);
  }

  const nbaStats = [
    player.fantasyPoints,
    player.pts,
    player.reb,
    player.ast,
    player.stl,
    player.blk,
    player.fgm,
    player.fga,
    player.fg3m,
    player.fg3a,
    player.ftm,
    player.fta,
    player.turnover,
    player.pf,
    player.plusMinus,
  ];

  if (nbaStats.some((value) => (value ?? 0) !== 0)) {
    return true;
  }

  if (!player.min) {
    return false;
  }

  const parsedMinutes = Number.parseInt(player.min.split(":")[0] || "0", 10);
  return Number.isFinite(parsedMinutes) && parsedMinutes > 0;
};

export function GameCommandCenterModal({
  gameId,
  sport,
  date,
  initialInsight,
  onClose,
}: GameCommandCenterModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [showAllInjuries, setShowAllInjuries] = useState(false);
  const [selectedLiveInjury, setSelectedLiveInjury] = useState<InjuryEntry | null>(null);
  const [selectedLivePlayerId, setSelectedLivePlayerId] = useState<string | null>(null);
  const [showBoostSelector, setShowBoostSelector] = useState(false);
  const [selectedTier, setSelectedTier] = useState<2 | 3 | 4 | 5 | null>(null);
  const [swapTargetPlayerId, setSwapTargetPlayerId] = useState<string | null>(null);
  const [showMlbAdvanced, setShowMlbAdvanced] = useState(false);

  const { data: insight, isLoading } = useQuery<GameInsightDetailResponse>({
    queryKey: ["/api/games", gameId, "insights", sport, date],
    queryFn: async () => {
      const res = await authenticatedFetch(
        `/api/games/${gameId}/insights?sport=${sport}&date=${date}`,
      );
      if (!res.ok) throw new Error("Failed to fetch game insights");
      return res.json();
    },
    enabled: !!gameId,
  });

  const game = insight?.game || initialInsight;
  const activeTab = useMemo(() => getAutoTab(game), [game]);
  const liveSport = (game?.sport || sport || "").toUpperCase();
  const leaders = insight?.leaders || game?.leaders;
  const userContext = insight?.userContext || game?.userContext || null;
  const boostSlotsRemaining = insight?.boostSlotsRemaining ?? null;
  const mlbPregame = liveSport === "MLB" ? game?.mlbPregame || null : null;
  const isHydratingMlbDetails =
    liveSport === "MLB" && isLoading && Boolean(initialInsight?.mlbPregame) && !insight;

  const {
    data: liveStats,
    isLoading: isLoadingLive,
    error: liveStatsError,
    refetch: refetchLive,
  } = useQuery<LiveStatsResponse>({
    queryKey: ["/api/games", gameId, "live-stats"],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/games/${gameId}/live-stats`);
      if (!res.ok) throw new Error("Failed to fetch live stats");
      return res.json();
    },
    enabled: !!gameId && (activeTab === "during" || (liveSport === "MLB" && activeTab === "post")),
    refetchInterval: activeTab === "during" ? 30000 : false,
  });

  const {
    data: gameStats,
    isLoading: isLoadingStats,
    refetch: refetchStats,
  } = useQuery<GameStatsResponse>({
    queryKey: ["/api/games", gameId, "stats"],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/games/${gameId}/stats`);
      if (!res.ok) throw new Error("Failed to fetch game stats");
      return res.json();
    },
    enabled: !!gameId && activeTab === "post",
  });

  const liveOwnedPlayers = useMemo(() => {
    const players = liveStats?.userEarnings?.ownedPlayers || [];
    return [...players].sort((a, b) => {
      if (b.estimatedEarnings !== a.estimatedEarnings) {
        return b.estimatedEarnings - a.estimatedEarnings;
      }
      if (b.fantasyPoints !== a.fantasyPoints) {
        return b.fantasyPoints - a.fantasyPoints;
      }
      return a.name.localeCompare(b.name);
    });
  }, [liveStats?.userEarnings?.ownedPlayers]);

  const liveEarningsByPlayerId = useMemo(() => {
    const map = new Map<
      string,
      { estimatedEarnings: number; quantity: number; effectiveShares: number }
    >();
    liveOwnedPlayers.forEach((player) => {
      const record = {
        estimatedEarnings: player.estimatedEarnings,
        quantity: player.quantity,
        effectiveShares: player.effectiveShares,
      };

      getPlayerIdVariants(player.playerId, liveSport).forEach((id) => {
        map.set(id, record);
      });
    });
    return map;
  }, [liveOwnedPlayers, liveSport]);

  const liveEarningsByNameTeam = useMemo(() => {
    const map = new Map<
      string,
      { estimatedEarnings: number; quantity: number; effectiveShares: number }
    >();

    liveOwnedPlayers.forEach((player) => {
      const key = getPlayerNameTeamKey(player.name, player.team);
      const existing = map.get(key);
      if (!existing || player.estimatedEarnings > existing.estimatedEarnings) {
        map.set(key, {
          estimatedEarnings: player.estimatedEarnings,
          quantity: player.quantity,
          effectiveShares: player.effectiveShares,
        });
      }
    });

    return map;
  }, [liveOwnedPlayers]);

  const liveOwnedPlayerIdByNameTeam = useMemo(() => {
    const map = new Map<string, string>();

    liveOwnedPlayers.forEach((player) => {
      map.set(getPlayerNameTeamKey(player.name, player.team), player.playerId);
    });

    return map;
  }, [liveOwnedPlayers]);

  const liveHomePlayers = useMemo(
    () =>
      [...(liveStats?.homePlayers || [])]
        .map((player) => ({
          ...player,
          team: player.team || liveStats?.homeTeam || game?.homeTeam || "Home",
        }))
        .sort((a, b) => (b.fantasyPoints || 0) - (a.fantasyPoints || 0)),
    [game?.homeTeam, liveStats?.homePlayers, liveStats?.homeTeam],
  );

  const liveAwayPlayers = useMemo(
    () =>
      [...(liveStats?.awayPlayers || [])]
        .map((player) => ({
          ...player,
          team: player.team || liveStats?.awayTeam || game?.awayTeam || "Away",
        }))
        .sort((a, b) => (b.fantasyPoints || 0) - (a.fantasyPoints || 0)),
    [game?.awayTeam, liveStats?.awayPlayers, liveStats?.awayTeam],
  );

  const liveInjuries = useMemo(() => {
    if (!insight?.injuries?.length) return [];
    if (!liveStats) return insight.injuries;
    return insight.injuries.filter(
      (injury) => injury.team === liveStats.homeTeam || injury.team === liveStats.awayTeam,
    );
  }, [insight?.injuries, liveStats]);

  const liveTeamSections = useMemo(() => {
    if (!liveStats) return [] as Array<{ team: string; players: LivePlayerStats[] }>;
    if (liveSport === "NASCAR") {
      return [
        {
          team: liveStats.awayTeam || "NASCAR",
          players: liveAwayPlayers.filter((player) => hasMeaningfulLiveStats(player, liveSport)),
        },
      ];
    }
    return [
      {
        team: liveStats.awayTeam,
        players: liveAwayPlayers.filter((player) => hasMeaningfulLiveStats(player, liveSport)),
      },
      {
        team: liveStats.homeTeam,
        players: liveHomePlayers.filter((player) => hasMeaningfulLiveStats(player, liveSport)),
      },
    ];
  }, [liveStats, liveAwayPlayers, liveHomePlayers, liveSport]);

  const totalLiveEarnings = liveStats?.userEarnings?.totalEstimatedEarnings || 0;
  const liveStatsErrorMessage =
    liveStatsError instanceof Error ? liveStatsError.message : "Failed to fetch live stats.";

  const { data: scoutData, isLoading: isLoadingScouts } = useQuery<ScoutData>({
    queryKey: ["/api/scouts"],
    enabled: isAuthenticated && activeTab === "pre",
  });

  const topFantasy = useMemo(() => {
    if (!gameStats?.homeTeam?.players?.length && !gameStats?.awayTeam?.players?.length) {
      return [];
    }
    const players = [
      ...(gameStats?.homeTeam?.players || []),
      ...(gameStats?.awayTeam?.players || []),
    ];
    return [...players].sort((a, b) => b.fantasyPoints - a.fantasyPoints).slice(0, 5);
  }, [gameStats]);

  const mlbLiveFantasyLeaders = useMemo(
    () =>
      [...liveAwayPlayers, ...liveHomePlayers]
        .sort((a, b) => (b.fantasyPoints || 0) - (a.fantasyPoints || 0))
        .slice(0, 5),
    [liveAwayPlayers, liveHomePlayers],
  );

  const mlbTopPerformers = useMemo(
    () =>
      [...(liveStats?.awayTopPerformers || []), ...(liveStats?.homeTopPerformers || [])]
        .sort((left, right) => (right.pts || 0) - (left.pts || 0))
        .slice(0, 4),
    [liveStats?.awayTopPerformers, liveStats?.homeTopPerformers],
  );

  // Split top players by team for Pre-Game tab
  const awayTeamPlayers = useMemo(() => {
    if (!insight?.topPlayers?.fantasy || !game) return [];
    return insight.topPlayers.fantasy.filter((p) => p.team === game.awayTeam).slice(0, 5);
  }, [insight?.topPlayers?.fantasy, game]);

  const homeTeamPlayers = useMemo(() => {
    if (!insight?.topPlayers?.fantasy || !game) return [];
    return insight.topPlayers.fantasy.filter((p) => p.team === game.homeTeam).slice(0, 5);
  }, [insight?.topPlayers?.fantasy, game]);

  const ownedPlayerData = useMemo(() => {
    const map = new Map<
      string,
      { multiplier: number; totalShares: number; availableShares: number }
    >();
    const ownedPlayers = userContext?.ownedPlayers || userContext?.topMultiplierPlayers || [];

    ownedPlayers.forEach((player) => {
      const existing = map.get(player.playerId);
      if (!existing) {
        map.set(player.playerId, {
          multiplier: player.multiplier,
          totalShares: player.totalShares,
          availableShares: player.availableShares,
        });
        return;
      }

      map.set(player.playerId, {
        multiplier: Math.max(existing.multiplier, player.multiplier),
        totalShares: Math.max(existing.totalShares, player.totalShares),
        availableShares: Math.max(existing.availableShares, player.availableShares),
      });
    });

    return map;
  }, [userContext?.ownedPlayers, userContext?.topMultiplierPlayers]);

  const ownedPlayerIds = useMemo(() => new Set(ownedPlayerData.keys()), [ownedPlayerData]);

  const knownPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    const addPlayerId = (value: string | null | undefined) => {
      const rawId = String(value || "").trim();
      if (!rawId) return;
      getPlayerIdVariants(rawId, liveSport).forEach((variant) => {
        ids.add(variant);
      });
    };

    (userContext?.ownedPlayers || []).forEach((player) => addPlayerId(player.playerId));
    (userContext?.topMultiplierPlayers || []).forEach((player) => addPlayerId(player.playerId));
    (insight?.topPlayers?.fantasy || []).forEach((player) => addPlayerId(player.playerId));
    (insight?.topPlayers?.shares || []).forEach((player) => addPlayerId(player.playerId));
    (insight?.topPlayers?.scouts || []).forEach((player) => addPlayerId(player.playerId));
    liveHomePlayers.forEach((player) => addPlayerId(player.playerId));
    liveAwayPlayers.forEach((player) => addPlayerId(player.playerId));
    liveOwnedPlayers.forEach((player) => addPlayerId(player.playerId));
    (mlbPregame?.startingLineups.away || []).forEach((player) => addPlayerId(player.playerId));
    (mlbPregame?.startingLineups.home || []).forEach((player) => addPlayerId(player.playerId));

    return ids;
  }, [
    insight?.topPlayers?.fantasy,
    insight?.topPlayers?.scouts,
    insight?.topPlayers?.shares,
    liveAwayPlayers,
    liveHomePlayers,
    liveOwnedPlayers,
    liveSport,
    mlbPregame?.startingLineups.away,
    mlbPregame?.startingLineups.home,
    userContext?.ownedPlayers,
    userContext?.topMultiplierPlayers,
  ]);

  const playerIdByNameTeam = useMemo(() => {
    const map = new Map<string, string>();

    const registerCandidate = ({
      playerId,
      name,
      team,
    }: {
      playerId: string | null | undefined;
      name: string | null | undefined;
      team?: string | null;
    }) => {
      const resolvedPlayerId = resolveModalPlayerIdCandidate({
        playerId,
        sport: liveSport,
        knownPlayerIds,
      });
      const normalizedName = String(name || "").trim();
      if (!resolvedPlayerId || !normalizedName) return;

      const exactKey = getPlayerNameTeamKey(normalizedName, team || undefined);
      if (!map.has(exactKey)) {
        map.set(exactKey, resolvedPlayerId);
      }

      const anyTeamKey = getPlayerNameTeamKey(normalizedName);
      if (!map.has(anyTeamKey)) {
        map.set(anyTeamKey, resolvedPlayerId);
      }
    };

    (insight?.topPlayers?.fantasy || []).forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
      }),
    );
    (insight?.topPlayers?.shares || []).forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
      }),
    );
    (insight?.topPlayers?.scouts || []).forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
      }),
    );
    (userContext?.ownedPlayers || []).forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
      }),
    );
    (userContext?.topMultiplierPlayers || []).forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
      }),
    );
    liveHomePlayers.forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: player.team || liveStats?.homeTeam || game?.homeTeam,
      }),
    );
    liveAwayPlayers.forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: player.team || liveStats?.awayTeam || game?.awayTeam,
      }),
    );
    liveOwnedPlayers.forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
      }),
    );
    (mlbPregame?.startingLineups.away || []).forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: game?.awayTeam || liveStats?.awayTeam,
      }),
    );
    (mlbPregame?.startingLineups.home || []).forEach((player) =>
      registerCandidate({
        playerId: player.playerId,
        name: player.name,
        team: game?.homeTeam || liveStats?.homeTeam,
      }),
    );

    return map;
  }, [
    game?.awayTeam,
    game?.homeTeam,
    insight?.topPlayers?.fantasy,
    insight?.topPlayers?.scouts,
    insight?.topPlayers?.shares,
    liveAwayPlayers,
    liveHomePlayers,
    liveOwnedPlayers,
    liveStats?.awayTeam,
    liveStats?.homeTeam,
    mlbPregame?.startingLineups.away,
    mlbPregame?.startingLineups.home,
    userContext?.ownedPlayers,
    userContext?.topMultiplierPlayers,
    knownPlayerIds,
    liveSport,
  ]);

  const resolvePlayerModalId = ({
    playerId,
    name,
    team,
  }: PlayerModalLookupInput): string | null => {
    const byId = resolveModalPlayerIdCandidate({
      playerId,
      sport: liveSport,
      knownPlayerIds,
    });
    if (byId) return byId;

    const normalizedName = String(name || "").trim();
    if (!normalizedName) return null;

    const exactKey = getPlayerNameTeamKey(normalizedName, team || undefined);
    const byTeam = playerIdByNameTeam.get(exactKey);
    if (byTeam) return byTeam;

    return playerIdByNameTeam.get(getPlayerNameTeamKey(normalizedName)) || null;
  };

  const scoutCandidates = useMemo(() => {
    if (!insight?.topPlayers?.fantasy || !game) return [];

    return insight.topPlayers.fantasy
      .filter((player) => player.team === game.homeTeam || player.team === game.awayTeam)
      .sort((a, b) => {
        if (b.avgFantasyPointsPerGame !== a.avgFantasyPointsPerGame) {
          return b.avgFantasyPointsPerGame - a.avgFantasyPointsPerGame;
        }
        return a.name.localeCompare(b.name);
      });
  }, [insight?.topPlayers?.fantasy, game]);

  const scoutAssignmentsByPlayer = useMemo(() => {
    const map = new Map<string, ScoutAssignment>();
    (scoutData?.assignments || []).forEach((assignment) => {
      map.set(assignment.playerId, assignment);
    });
    return map;
  }, [scoutData?.assignments]);

  const swapTargetPlayer = useMemo(
    () => scoutCandidates.find((player) => player.playerId === swapTargetPlayerId) || null,
    [scoutCandidates, swapTargetPlayerId],
  );

  const swapSourceAssignments = useMemo(() => {
    if (!scoutData?.assignments || !swapTargetPlayerId) return [] as ScoutAssignment[];

    return scoutData.assignments.filter(
      (assignment) => assignment.scoutCount > 0 && assignment.playerId !== swapTargetPlayerId,
    );
  }, [scoutData?.assignments, swapTargetPlayerId]);

  // Boost assignment mutation
  const assignBoostMutation = useMutation({
    mutationFn: async ({
      playerId,
      slotTier,
      sharesEntered,
    }: {
      playerId: string;
      slotTier: number;
      sharesEntered: number;
    }) => {
      const res = await apiRequest("POST", "/api/daily-boosts/assign", {
        playerId,
        slotTier,
        sharesEntered,
        sport,
        date,
      });
      return res.json();
    },
    onSuccess: () => {
      // Invalidate both the specific game insights and the dashboard list
      queryClient.invalidateQueries({ queryKey: ["/api/games", gameId, "insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-boosts"] });
      toast({
        title: "Boost Applied!",
        description: "Your player has been boosted for this game.",
      });
      setShowBoostSelector(false);
      setSelectedTier(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to apply boost",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const quickScoutMutation = useMutation({
    mutationFn: async ({ playerId, count }: { playerId: string; count: number }) => {
      const res = await apiRequest("POST", "/api/scouts/assign", { playerId, count });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games", gameId, "insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games/insights"] });
      toast({
        title: "Scout assigned",
        description: "1 scout started for this player.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to assign scout",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const swapScoutMutation = useMutation({
    mutationFn: async ({
      fromPlayerId,
      fromCount,
      toPlayerId,
      toCount,
    }: {
      fromPlayerId: string;
      fromCount: number;
      toPlayerId: string;
      toCount: number;
    }) => {
      await apiRequest("POST", "/api/scouts/assign", {
        playerId: fromPlayerId,
        count: Math.max(fromCount - 1, 0),
      });

      const res = await apiRequest("POST", "/api/scouts/assign", {
        playerId: toPlayerId,
        count: toCount,
      });

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games", gameId, "insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games/insights"] });
      setSwapTargetPlayerId(null);
      toast({
        title: "Scout swapped",
        description: "Moved 1 scout to your selected player.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Swap failed",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleQuickScout = (playerId: string) => {
    if (!isAuthenticated) {
      toast({
        title: "Sign in required",
        description: "Please sign in to assign scouts.",
        variant: "destructive",
      });
      return;
    }

    const currentCount = scoutAssignmentsByPlayer.get(playerId)?.scoutCount || 0;

    if (currentCount > 0) {
      toast({
        title: "Already scouting",
        description: "You already have scouts on this player.",
      });
      return;
    }

    if ((scoutData?.remaining || 0) > 0) {
      quickScoutMutation.mutate({ playerId, count: 1 });
      return;
    }

    setSwapTargetPlayerId(playerId);
  };

  const getPlayerLiveEarnings = (player: LivePlayerStats, team: string) => {
    if (player.playerId) {
      for (const candidateId of getPlayerIdVariants(player.playerId, liveSport)) {
        const match = liveEarningsByPlayerId.get(candidateId);
        if (match) return match.estimatedEarnings;
      }
    }

    const byName = liveEarningsByNameTeam.get(getPlayerNameTeamKey(player.name, team));
    if (byName) return byName.estimatedEarnings;

    return 0;
  };

  const resolveLivePlayerModalId = (player: LivePlayerStats, team: string) => {
    if (player.playerId) {
      for (const candidateId of getPlayerIdVariants(player.playerId, liveSport)) {
        if (ownedPlayerIds.has(candidateId) || liveEarningsByPlayerId.has(candidateId)) {
          return (
            resolveModalPlayerIdCandidate({
              playerId: candidateId,
              sport: liveSport,
              knownPlayerIds,
            }) || candidateId
          );
        }
      }

      const resolvedId = resolvePlayerModalId({
        playerId: player.playerId,
        name: player.name,
        team,
      });
      if (resolvedId) return resolvedId;
    }

    return (
      resolvePlayerModalId({
        name: player.name,
        team,
      }) ||
      liveOwnedPlayerIdByNameTeam.get(getPlayerNameTeamKey(player.name, team)) ||
      null
    );
  };
  const renderModalPlayerName = ({
    name,
    team,
    playerId,
    className = "",
    label,
  }: {
    name: string;
    team?: string | null;
    playerId?: string | null;
    className?: string;
    label?: string;
  }) => {
    const resolvedPlayerId = resolvePlayerModalId({ playerId, name, team });
    const displayName = label || name;
    if (!resolvedPlayerId) {
      return <span className={className}>{displayName}</span>;
    }

    return (
      <button
        type="button"
        onClick={() => setSelectedLivePlayerId(resolvedPlayerId)}
        className={`${className} text-left underline-offset-2 hover:underline focus-visible:underline`}
      >
        {displayName}
      </button>
    );
  };
  const renderLiveModalPlayerName = ({
    player,
    team,
    className = "",
    label,
  }: {
    player: LivePlayerStats;
    team: string;
    className?: string;
    label?: string;
  }) => {
    const resolvedPlayerId = resolveLivePlayerModalId(player, team);
    const displayName = label || player.name;
    if (!resolvedPlayerId) {
      return <span className={className}>{displayName}</span>;
    }

    return (
      <button
        type="button"
        onClick={() => setSelectedLivePlayerId(resolvedPlayerId)}
        className={`${className} text-left underline-offset-2 hover:underline focus-visible:underline`}
      >
        {displayName}
      </button>
    );
  };

  const startTimeLabel = game ? new Date(game.startTime).toLocaleString() : "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-0.75rem)] max-w-4xl max-h-[92svh] overflow-y-auto overflow-x-hidden sm:w-[calc(100vw-1rem)] sm:max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>
            {game ? `${game.awayTeam} @ ${game.homeTeam}` : "Game Command Center"}
          </DialogTitle>
          <DialogDescription>
            {activeTab === "pre"
              ? "Pregame setup with leaders, boosts, and key availability."
              : activeTab === "during"
                ? "Live game view with active score and top performers."
                : "Postgame recap with final leaders and fantasy output."}
          </DialogDescription>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {game && <span>{startTimeLabel}</span>}
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {activeTab === "pre" ? "Pregame" : activeTab === "during" ? "Live" : "Final"}
            </Badge>
            {activeTab !== "pre" && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-6 w-6"
                onClick={() => (liveSport === "MLB" ? refetchLive() : refetchStats())}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* MLB lifecycle card renders first (full baseball context) */}
        {liveSport === "MLB" && mlbPregame ? (
          <MlbLifecycleCard
            game={game}
            mlbPregame={mlbPregame}
            mlbSignals={game?.mlbSignals}
            activeTab={activeTab}
            liveStats={liveStats}
            userContext={userContext}
            isAuthenticated={isAuthenticated}
            isHydratingDetails={isHydratingMlbDetails}
            showMlbAdvanced={showMlbAdvanced}
            onToggleAdvanced={() => setShowMlbAdvanced((current) => !current)}
            resolvePlayerModalId={resolvePlayerModalId}
            onOpenPlayerModal={(playerId) => setSelectedLivePlayerId(playerId)}
          />
        ) : null}

        <Tabs value={activeTab} className="mt-4">
          <TabsContent value="pre" className="mt-4 space-y-4">
            {isLoading && !game ? (
              <div className="space-y-3">
                <Shimmer height="16px" width="60%" />
                <Shimmer height="120px" width="100%" />
              </div>
            ) : (
              <>
                {/* Compact Leaders Row */}
                <div className="flex items-center justify-between gap-2 rounded-sm border border-border/60 p-2 text-[11px]">
                  <div className="flex-1 text-center">
                    <div className="text-muted-foreground">FP Leader</div>
                    <div className="font-semibold truncate">{leaders?.fantasy?.name || "—"}</div>
                    <div className="text-muted-foreground">
                      {leaders?.fantasy?.avgFantasyPointsPerGame?.toFixed(1) ?? "—"}
                    </div>
                  </div>
                  <div className="w-px h-8 bg-border/60" />
                  <div className="flex-1 text-center">
                    <div className="text-muted-foreground">TSV Leader</div>
                    <div className="font-semibold truncate">{leaders?.shares?.name || "—"}</div>
                    <div className="text-muted-foreground">
                      {leaders?.shares?.totalShares ?? "—"}
                    </div>
                  </div>
                  <div className="w-px h-8 bg-border/60" />
                  <div className="flex-1 text-center">
                    <div className="text-muted-foreground">Scouts Leader</div>
                    <div className="font-semibold truncate">{leaders?.scouts?.name || "—"}</div>
                    <div className="text-muted-foreground">
                      {leaders?.scouts?.scoutCount ?? "—"}
                    </div>
                  </div>
                </div>

                {/* Team Rosters - Top 5 by Season Avg Fantasy Points */}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-sm border border-border/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold">{game?.awayTeam}</div>
                      <Badge variant="outline" className="text-[10px]">
                        Top 5 by FP
                      </Badge>
                    </div>
                    {awayTeamPlayers.length > 0 ? (
                      <div className="space-y-1.5">
                        {awayTeamPlayers.map((player, idx) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between text-xs"
                          >
                            {renderModalPlayerName({
                              name: player.name,
                              team: player.team,
                              playerId: player.playerId,
                              className: ownedPlayerIds.has(player.playerId)
                                ? "text-purple-400 font-medium"
                                : "",
                              label: `${idx + 1}. ${formatName(player.name)}`,
                            })}
                            <span className="font-mono text-muted-foreground">
                              {player.avgFantasyPointsPerGame.toFixed(1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No player data available</div>
                    )}
                  </div>

                  <div className="rounded-sm border border-border/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold">{game?.homeTeam}</div>
                      <Badge variant="outline" className="text-[10px]">
                        Top 5 by FP
                      </Badge>
                    </div>
                    {homeTeamPlayers.length > 0 ? (
                      <div className="space-y-1.5">
                        {homeTeamPlayers.map((player, idx) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between text-xs"
                          >
                            {renderModalPlayerName({
                              name: player.name,
                              team: player.team,
                              playerId: player.playerId,
                              className: ownedPlayerIds.has(player.playerId)
                                ? "text-purple-400 font-medium"
                                : "",
                              label: `${idx + 1}. ${formatName(player.name)}`,
                            })}
                            <span className="font-mono text-muted-foreground">
                              {player.avgFantasyPointsPerGame.toFixed(1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No player data available</div>
                    )}
                  </div>
                </div>

                {/* Your Multiplier Leaders - interactive quick-boost view */}
                <div className="rounded-sm border-2 border-purple-500/40 bg-purple-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-purple-500" />
                      <div className="text-sm font-semibold">Your Multiplier Leaders</div>
                      {userContext?.topMultiplierPlayers?.length ? (
                        <Badge variant="secondary" className="text-[10px] border-border/80">
                          {userContext.topMultiplierPlayers.length}
                        </Badge>
                      ) : null}
                    </div>

                    {boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
                      <Button
                        variant={showBoostSelector ? "default" : "outline"}
                        size="sm"
                        className={`h-7 px-3 text-[11px] font-medium border-2 ${
                          showBoostSelector
                            ? "bg-purple-600 border-purple-600 hover:bg-purple-700 hover:border-purple-700"
                            : "border-purple-500 text-purple-700 bg-purple-50 hover:bg-purple-100 hover:text-purple-800 hover:border-purple-600 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-500/60"
                        }`}
                        onClick={() => setShowBoostSelector(!showBoostSelector)}
                      >
                        {showBoostSelector ? (
                          <>
                            <X className="h-3 w-3 mr-1" />
                            Close
                          </>
                        ) : (
                          <>
                            <Zap className="h-3 w-3 mr-1" />
                            Slots: {boostSlotsRemaining}
                          </>
                        )}
                      </Button>
                    )}
                    {boostSlotsRemaining !== null && boostSlotsRemaining === 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-muted-foreground border-border/80 px-2 py-1"
                      >
                        Slots: 0
                      </Badge>
                    )}
                  </div>

                  {!showBoostSelector && userContext?.topMultiplierPlayers?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {userContext.topMultiplierPlayers.slice(0, 4).map((player, idx) => (
                        <Badge
                          key={`${player.playerId}-${idx}`}
                          variant="outline"
                          className="text-[10px] gap-1.5 border-border/80 px-2 py-1"
                        >
                          {renderModalPlayerName({
                            name: player.name,
                            team: player.team,
                            playerId: player.playerId,
                            className: "text-purple-500 font-medium",
                            label: formatName(player.name),
                          })}
                          <span className="text-purple-500 font-mono">
                            {player.multiplier.toFixed(1)}x
                          </span>
                        </Badge>
                      ))}
                      {userContext.topMultiplierPlayers.length > 4 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-muted-foreground border-border/80"
                        >
                          +{userContext.topMultiplierPlayers.length - 4}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    !showBoostSelector && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        No eligible holdings for this matchup
                      </div>
                    )
                  )}

                  {showBoostSelector && boostSlotsRemaining !== null && boostSlotsRemaining > 0 && (
                    <div className="mt-3 rounded-sm border-2 border-purple-400 bg-background/80 p-3">
                      <div className="mb-2 text-[11px] font-medium text-purple-700 dark:text-purple-400">
                        Select tier & player to boost:
                      </div>

                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground font-medium">Tier:</span>
                        <div className="flex gap-1">
                          {([5, 4, 3, 2] as const).map((tier) => (
                            <Button
                              key={tier}
                              variant={selectedTier === tier ? "default" : "outline"}
                              size="sm"
                              className={`h-7 px-2.5 text-[11px] font-semibold border-2 ${
                                selectedTier === tier
                                  ? "bg-purple-600 border-purple-600 hover:bg-purple-700 hover:border-purple-700"
                                  : "border-border hover:border-purple-400"
                              }`}
                              onClick={() => setSelectedTier(selectedTier === tier ? null : tier)}
                            >
                              {tier}x
                            </Button>
                          ))}
                        </div>
                      </div>

                      {userContext?.topMultiplierPlayers &&
                      userContext.topMultiplierPlayers.length > 0 ? (
                        <div className="space-y-1 max-h-40 overflow-y-auto border border-border/60 rounded-md p-1">
                          {userContext.topMultiplierPlayers.map((player, idx) => (
                            <div
                              key={`${player.playerId}-${idx}`}
                              className="flex items-center justify-between text-xs py-2 px-2 rounded bg-muted/30 hover:bg-purple-500/10 transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {renderModalPlayerName({
                                  name: player.name,
                                  team: player.team,
                                  playerId: player.playerId,
                                  className: "font-medium truncate",
                                  label: formatName(player.name),
                                })}
                                <span className="text-muted-foreground text-[10px]">
                                  {player.team}
                                </span>
                                <span className="text-purple-500 font-mono text-[10px]">
                                  {player.multiplier.toFixed(1)}x
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant={selectedTier ? "default" : "ghost"}
                                disabled={!selectedTier || assignBoostMutation.isPending}
                                className={`h-6 px-2 text-[10px] border-2 ${
                                  selectedTier
                                    ? "bg-purple-600 border-purple-600 hover:bg-purple-700 hover:border-purple-700"
                                    : "border-transparent"
                                }`}
                                onClick={() => {
                                  if (selectedTier) {
                                    assignBoostMutation.mutate({
                                      playerId: player.playerId,
                                      slotTier: selectedTier as number,
                                      sharesEntered: player.availableShares,
                                    });
                                  }
                                }}
                              >
                                {assignBoostMutation.isPending ? (
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                ) : (
                                  <>
                                    <Zap className="h-3 w-3 mr-1" />
                                    Boost
                                  </>
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border/60 rounded-md">
                          No eligible players to boost
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Quick Scout - mobile-first command center action */}
                <div className="rounded-sm border-2 border-amber-500/40 bg-amber-500/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Binoculars className="h-4 w-4 text-amber-600" />
                      <div className="text-sm font-semibold">Quick Scout</div>
                    </div>
                    {isAuthenticated && scoutData ? (
                      <Badge variant="outline" className="text-[10px] border-border/80">
                        {scoutData.remaining} open
                      </Badge>
                    ) : null}
                  </div>

                  {!isAuthenticated ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Sign in to assign scouts directly from dashboard.
                    </div>
                  ) : isLoadingScouts ? (
                    <div className="mt-2 space-y-2">
                      <Shimmer height="28px" width="100%" />
                      <Shimmer height="28px" width="100%" />
                    </div>
                  ) : scoutCandidates.length > 0 ? (
                    <>
                      <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                        {scoutCandidates.map((player, idx) => {
                          const assignment = scoutAssignmentsByPlayer.get(player.playerId);
                          const scoutCount = assignment?.scoutCount || 0;
                          const isScouting = scoutCount > 0;
                          const ownedData = ownedPlayerData.get(player.playerId);

                          return (
                            <div
                              key={player.playerId}
                              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                {renderModalPlayerName({
                                  name: player.name,
                                  team: player.team,
                                  playerId: player.playerId,
                                  className: `truncate text-xs font-medium ${ownedData ? "text-purple-500" : ""}`,
                                  label: `${idx + 1}. ${formatName(player.name)}`,
                                })}
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                  <span>{player.team}</span>
                                  <span>•</span>
                                  <span>{player.avgFantasyPointsPerGame.toFixed(1)} FP</span>
                                  {ownedData ? (
                                    <>
                                      <span>•</span>
                                      <span className="text-purple-500 font-medium">
                                        Own {ownedData.multiplier.toFixed(1)}x
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                              </div>

                              {isScouting ? (
                                <Badge variant="secondary" className="text-[10px] px-2">
                                  Scouting {scoutCount}
                                </Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[10px]"
                                  onClick={() => handleQuickScout(player.playerId)}
                                  disabled={
                                    !isAuthenticated ||
                                    quickScoutMutation.isPending ||
                                    swapScoutMutation.isPending
                                  }
                                >
                                  {quickScoutMutation.isPending || swapScoutMutation.isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : !isAuthenticated ? (
                                    "Sign In"
                                  ) : scoutData?.remaining ? (
                                    "Quick Scout"
                                  ) : (
                                    "Swap In"
                                  )}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {scoutData && scoutData.remaining === 0 && (
                        <div className="mt-2 text-[10px] text-muted-foreground">
                          Scouts are fully allocated. Tap{" "}
                          <span className="font-medium">Swap In</span> to move 1 scout.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">
                      No players available for scouting.
                    </div>
                  )}
                </div>

                {/* Injuries - Compact */}
                <div className="rounded-sm border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      <span className="text-xs text-muted-foreground">Injuries</span>
                      {insight?.injuries?.length ? (
                        <Badge variant="outline" className="text-[10px]">
                          {insight.injuries.length}
                        </Badge>
                      ) : null}
                    </div>
                    {insight?.injuries && insight.injuries.length > 2 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setShowAllInjuries(!showAllInjuries)}
                      >
                        {showAllInjuries ? (
                          <>
                            Less <ChevronUp className="ml-1 h-3 w-3" />
                          </>
                        ) : (
                          <>
                            More <ChevronDown className="ml-1 h-3 w-3" />
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  {insight?.injuries?.length ? (
                    <div className="mt-2 space-y-1.5">
                      {(showAllInjuries ? insight.injuries : insight.injuries.slice(0, 2)).map(
                        (player) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="truncate">
                              {renderModalPlayerName({
                                name: player.name,
                                team: player.team,
                                playerId: player.playerId,
                                className: "truncate",
                                label: formatName(player.name),
                              })}{" "}
                              <span className="text-muted-foreground">({player.team})</span>
                            </span>
                            <Badge
                              variant={player.status === "Out" ? "destructive" : "outline"}
                              className="text-[10px] ml-2 flex-shrink-0"
                            >
                              {player.status}
                            </Badge>
                          </div>
                        ),
                      )}
                      {!showAllInjuries && insight.injuries.length > 2 && (
                        <div className="text-[10px] text-muted-foreground text-center pt-1">
                          +{insight.injuries.length - 2} more
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">No reported injuries.</div>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="during" className="mt-4 space-y-4">
            {isLoadingLive ? (
              <Shimmer height="160px" width="100%" />
            ) : !liveStats ? (
              <div className="text-sm text-muted-foreground">{liveStatsErrorMessage}</div>
            ) : (
              <>
                <div className="space-y-3 rounded-sm border border-border/60 p-3">
                  {liveSport === "NASCAR" ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                        <span className="truncate">{liveStats.homeTeam}</span>
                        <Badge variant={liveStats.status === "inprogress" ? "default" : "outline"}>
                          {liveStats.status === "completed" ? "Final" : liveStats.status}
                        </Badge>
                      </div>
                      {liveStats.lapInfo ? (
                        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                          <div>
                            <div className="text-muted-foreground">Lap</div>
                            <div className="font-mono">
                              {liveStats.lapInfo.currentLap}/{liveStats.lapInfo.totalLaps}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">To Go</div>
                            <div className="font-mono">{liveStats.lapInfo.lapsToGo}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Flag</div>
                            <div>{liveStats.lapInfo.flagState}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Leaders</div>
                            <div className="font-mono">{liveStats.lapInfo.leaders ?? "--"}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {liveSport === "NHL" ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                      <span>
                        {liveStats.awayTeam} {liveStats.awayScore} @ {liveStats.homeTeam}{" "}
                        {liveStats.homeScore}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {liveStats.period ? (
                          <Badge variant="outline">
                            {liveStats.periodType === "OT"
                              ? "Overtime"
                              : `Period ${liveStats.period}`}
                          </Badge>
                        ) : null}
                        {liveStats.clock ? (
                          <Badge variant="outline" className="font-mono">
                            {liveStats.clock}
                          </Badge>
                        ) : null}
                        <Badge variant={liveStats.status === "inprogress" ? "default" : "outline"}>
                          {liveStats.status === "completed" ? "Final" : liveStats.status}
                        </Badge>
                      </div>
                    </div>
                  ) : null}

                  {liveStats.message ? (
                    <div className="text-xs text-muted-foreground">{liveStats.message}</div>
                  ) : null}

                  {(liveStats.awayTopPerformers?.length || liveStats.homeTopPerformers?.length) && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-sm border border-border/60 p-2">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-semibold">
                            {liveStats.awayTeam} Leaders
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {(liveStats.awayTopPerformers || []).length}
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          {(liveStats.awayTopPerformers || []).slice(0, 3).map((player) => (
                            <div
                              key={`${liveStats.awayTeam}-${player.name}`}
                              className="flex items-center justify-between text-[11px]"
                            >
                              <span className="truncate">
                                {renderModalPlayerName({
                                  name: player.name,
                                  team: liveStats.awayTeam,
                                  playerId: player.playerId,
                                  className: "truncate",
                                  label: formatName(player.name),
                                })}
                              </span>
                              <span className="ml-2 font-mono text-green-600">
                                {liveSport === "NHL"
                                  ? `${player.points ?? 0} pts · ${(player.fantasyPoints ?? 0).toFixed(1)} FP`
                                  : `${player.pts ?? 0}p`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-sm border border-border/60 p-2">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-semibold">
                            {liveStats.homeTeam} Leaders
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {(liveStats.homeTopPerformers || []).length}
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          {(liveStats.homeTopPerformers || []).slice(0, 3).map((player) => (
                            <div
                              key={`${liveStats.homeTeam}-${player.name}`}
                              className="flex items-center justify-between text-[11px]"
                            >
                              <span className="truncate">
                                {renderModalPlayerName({
                                  name: player.name,
                                  team: liveStats.homeTeam,
                                  playerId: player.playerId,
                                  className: "truncate",
                                  label: formatName(player.name),
                                })}
                              </span>
                              <span className="ml-2 font-mono text-green-600">
                                {liveSport === "NHL"
                                  ? `${player.points ?? 0} pts · ${(player.fantasyPoints ?? 0).toFixed(1)} FP`
                                  : `${player.pts ?? 0}p`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid min-w-0 gap-3 md:grid-cols-2">
                  {liveTeamSections.map((section) => (
                    <div
                      key={section.team}
                      className="min-w-0 rounded-sm border border-border/70 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">{section.team} Box</div>
                        <Badge variant="outline" className="text-[10px]">
                          {section.players.length} active
                        </Badge>
                      </div>

                      {section.players.length > 0 ? (
                        <>
                          <div className="mb-1 text-[10px] text-muted-foreground">
                            Player, FP, and $ stay fixed. Swipe for full box score →
                          </div>
                          <div className="max-w-full overflow-x-auto overscroll-x-contain">
                            {liveSport === "NFL" ? (
                              <table className="w-full min-w-[840px] border-separate border-spacing-0 text-[10px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="sticky left-0 z-30 w-20 border-b border-border/60 bg-background px-1 py-1 text-left font-medium">
                                      Player
                                    </th>
                                    <th className="sticky left-20 z-30 w-12 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      FP
                                    </th>
                                    <th className="sticky left-[8rem] z-30 w-14 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      $
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Pos
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Pass
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Rush
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Rec
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      TD
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      INT
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.players.map((player) => {
                                    const earnings = getPlayerLiveEarnings(player, section.team);
                                    const owned = earnings > 0;
                                    const stickyCellBg = owned ? "bg-purple-500/10" : "bg-card";
                                    const passLine = `${player.passingCompletions ?? 0}/${player.passingAttempts ?? 0}-${player.passingYards ?? 0}`;
                                    const rushLine = `${player.rushingAttempts ?? 0}/${player.rushingYards ?? 0}`;
                                    const recLine = `${player.receptions ?? 0}/${player.receivingTargets ?? 0}-${player.receivingYards ?? 0}`;
                                    const totalTD =
                                      (player.passingTDs ?? 0) +
                                      (player.rushingTDs ?? 0) +
                                      (player.receivingTDs ?? 0);

                                    return (
                                      <tr
                                        key={`${section.team}-${player.playerId || player.name}`}
                                        className={owned ? "bg-purple-500/5" : ""}
                                      >
                                        <td
                                          className={`sticky left-0 z-20 border-b border-border/40 px-1 py-1.5 ${stickyCellBg}`}
                                        >
                                          {renderLiveModalPlayerName({
                                            player,
                                            team: section.team,
                                            className: `truncate ${owned ? "font-medium text-purple-500" : ""}`,
                                            label: formatCompactName(player.name),
                                          })}
                                        </td>
                                        <td
                                          className={`sticky left-20 z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono ${stickyCellBg}`}
                                        >
                                          {(player.fantasyPoints || 0).toFixed(1)}
                                        </td>
                                        <td
                                          className={`sticky left-[8rem] z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 ${stickyCellBg}`}
                                        >
                                          ${earnings.toFixed(2)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.position || "—"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {passLine}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {rushLine}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {recLine}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {totalTD}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.passingInterceptions ?? 0}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : liveSport === "NASCAR" ? (
                              <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[10px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="sticky left-0 z-30 w-20 border-b border-border/60 bg-background px-1 py-1 text-left font-medium">
                                      Driver
                                    </th>
                                    <th className="sticky left-20 z-30 w-12 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      FP
                                    </th>
                                    <th className="sticky left-[8rem] z-30 w-14 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      $
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Run
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Start
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      +/-
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Laps
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Led
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Fast
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Best MPH
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Gap
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Car
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Status
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.players.map((player) => {
                                    const earnings = getPlayerLiveEarnings(player, section.team);
                                    const owned = earnings > 0;
                                    const stickyCellBg = owned ? "bg-purple-500/10" : "bg-card";
                                    const positionDiff = Number(player.positionDifferential || 0);

                                    return (
                                      <tr
                                        key={`${section.team}-${player.playerId || player.name}`}
                                        className={owned ? "bg-purple-500/5" : ""}
                                      >
                                        <td
                                          className={`sticky left-0 z-20 border-b border-border/40 px-1 py-1.5 ${stickyCellBg}`}
                                        >
                                          {renderLiveModalPlayerName({
                                            player,
                                            team: section.team,
                                            className: `truncate ${owned ? "font-medium text-purple-500" : ""}`,
                                            label: formatCompactName(player.name),
                                          })}
                                        </td>
                                        <td
                                          className={`sticky left-20 z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono ${stickyCellBg}`}
                                        >
                                          {(player.fantasyPoints || 0).toFixed(1)}
                                        </td>
                                        <td
                                          className={`sticky left-[8rem] z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 ${stickyCellBg}`}
                                        >
                                          ${earnings.toFixed(2)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.runningPosition || "--"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.startingPosition || "--"}
                                        </td>
                                        <td
                                          className={`border-b border-border/40 px-1 py-1.5 text-right font-mono ${
                                            positionDiff > 0
                                              ? "text-emerald-500"
                                              : positionDiff < 0
                                                ? "text-rose-500"
                                                : ""
                                          }`}
                                        >
                                          {positionDiff > 0 ? "+" : ""}
                                          {positionDiff}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.lapsCompleted ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.lapsLed ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.fastestLaps ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {typeof player.bestLapSpeed === "number"
                                            ? player.bestLapSpeed.toFixed(1)
                                            : "--"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {typeof player.delta === "number"
                                            ? player.delta.toFixed(1)
                                            : "--"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          #{player.carNumber || "--"} {player.manufacturer || ""}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right">
                                          {player.status ||
                                            (player.isOnTrack === false ? "Off" : "Run")}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : liveSport === "NHL" ? (
                              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[10px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="sticky left-0 z-30 w-24 border-b border-border/60 bg-background px-1 py-1 text-left font-medium">
                                      Player
                                    </th>
                                    <th className="sticky left-24 z-30 w-12 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      FP
                                    </th>
                                    <th className="sticky left-36 z-30 w-14 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      $
                                    </th>
                                    {[
                                      "Pos",
                                      "G",
                                      "A",
                                      "PTS",
                                      "SOG",
                                      "HIT",
                                      "BLK",
                                      "SV",
                                      "GA",
                                      "TOI",
                                      "DEC",
                                    ].map((label) => (
                                      <th
                                        key={label}
                                        className="border-b border-border/60 px-1 py-1 text-right font-medium"
                                      >
                                        {label}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.players.map((player) => {
                                    const earnings = getPlayerLiveEarnings(player, section.team);
                                    const owned = earnings > 0;
                                    const stickyCellBg = owned ? "bg-purple-500/10" : "bg-card";
                                    return (
                                      <tr
                                        key={`${section.team}-${player.playerId || player.name}`}
                                        className={owned ? "bg-purple-500/5" : ""}
                                      >
                                        <td
                                          className={`sticky left-0 z-20 border-b border-border/40 px-1 py-1.5 ${stickyCellBg}`}
                                        >
                                          {renderLiveModalPlayerName({
                                            player,
                                            team: section.team,
                                            className: `truncate ${owned ? "font-medium text-purple-500" : ""}`,
                                            label: formatCompactName(player.name),
                                          })}
                                        </td>
                                        <td
                                          className={`sticky left-24 z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono ${stickyCellBg}`}
                                        >
                                          {(player.fantasyPoints || 0).toFixed(1)}
                                        </td>
                                        <td
                                          className={`sticky left-36 z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 ${stickyCellBg}`}
                                        >
                                          ${earnings.toFixed(2)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.position || "—"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.goals ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.assists ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.points ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.shotsOnGoal ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.hits ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.blockedShots ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.saves ?? "—"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.goalsAgainst ?? "—"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.timeOnIce || "—"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.decision || "—"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : liveSport === "MLB" ? (
                              <table className="w-full min-w-[1020px] border-separate border-spacing-0 text-[10px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="sticky left-0 z-30 w-20 border-b border-border/60 bg-background px-1 py-1 text-left font-medium">
                                      Player
                                    </th>
                                    <th className="sticky left-20 z-30 w-12 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      FP
                                    </th>
                                    <th className="sticky left-[8rem] z-30 w-14 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      $
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Pos
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      H
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      R
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      RBI
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      HR
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      SB
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      BB
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      K
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      IP
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      P-K
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      ER
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      W
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      SV
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.players.map((player) => {
                                    const earnings = getPlayerLiveEarnings(player, section.team);
                                    const owned = earnings > 0;
                                    const stickyCellBg = owned ? "bg-purple-500/10" : "bg-card";

                                    return (
                                      <tr
                                        key={`${section.team}-${player.playerId || player.name}`}
                                        className={owned ? "bg-purple-500/5" : ""}
                                      >
                                        <td
                                          className={`sticky left-0 z-20 border-b border-border/40 px-1 py-1.5 ${stickyCellBg}`}
                                        >
                                          {renderLiveModalPlayerName({
                                            player,
                                            team: section.team,
                                            className: `truncate ${owned ? "font-medium text-purple-500" : ""}`,
                                            label: formatCompactName(player.name),
                                          })}
                                        </td>
                                        <td
                                          className={`sticky left-20 z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono ${stickyCellBg}`}
                                        >
                                          {(player.fantasyPoints || 0).toFixed(1)}
                                        </td>
                                        <td
                                          className={`sticky left-[8rem] z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 ${stickyCellBg}`}
                                        >
                                          ${earnings.toFixed(2)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.position || "-"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.hits ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.runs ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.runsBattedIn ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.homeRuns ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.stolenBases ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.walks ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.strikeoutsBatting ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {Number(player.inningsPitched ?? 0).toFixed(1)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.pitchingStrikeouts ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.earnedRuns ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.wins ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.saves ?? 0}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : (
                              <table className="w-full min-w-[940px] border-separate border-spacing-0 text-[10px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="sticky left-0 z-30 w-20 border-b border-border/60 bg-background px-1 py-1 text-left font-medium">
                                      Player
                                    </th>
                                    <th className="sticky left-20 z-30 w-12 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      FP
                                    </th>
                                    <th className="sticky left-[8rem] z-30 w-14 border-b border-border/60 bg-background px-1 py-1 text-right font-medium">
                                      $
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      Pos
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      MIN
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      PTS
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      REB
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      AST
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      STL
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      BLK
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      TO
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      3PM
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      FG
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      FT
                                    </th>
                                    <th className="border-b border-border/60 px-1 py-1 text-right font-medium">
                                      +/-
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.players.map((player) => {
                                    const earnings = getPlayerLiveEarnings(player, section.team);
                                    const owned = earnings > 0;
                                    const stickyCellBg = owned ? "bg-purple-500/10" : "bg-card";

                                    return (
                                      <tr
                                        key={`${section.team}-${player.playerId || player.name}`}
                                        className={owned ? "bg-purple-500/5" : ""}
                                      >
                                        <td
                                          className={`sticky left-0 z-20 border-b border-border/40 px-1 py-1.5 ${stickyCellBg}`}
                                        >
                                          {renderLiveModalPlayerName({
                                            player,
                                            team: section.team,
                                            className: `truncate ${owned ? "font-medium text-purple-500" : ""}`,
                                            label: formatCompactName(player.name),
                                          })}
                                        </td>
                                        <td
                                          className={`sticky left-20 z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono ${stickyCellBg}`}
                                        >
                                          {(player.fantasyPoints || 0).toFixed(1)}
                                        </td>
                                        <td
                                          className={`sticky left-[8rem] z-20 border-b border-border/40 px-1 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 ${stickyCellBg}`}
                                        >
                                          ${earnings.toFixed(2)}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.position || "—"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.min || "0"}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.pts ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.reb ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.ast ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.stl ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.blk ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.turnover ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.fg3m ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.fgm ?? 0}/{player.fga ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.ftm ?? 0}/{player.fta ?? 0}
                                        </td>
                                        <td className="border-b border-border/40 px-1 py-1.5 text-right font-mono">
                                          {player.plusMinus ?? 0}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          No player stat lines available yet.
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-sm border border-border/70 p-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    <span className="text-xs text-muted-foreground">Injuries</span>
                    {liveInjuries.length ? (
                      <Badge variant="outline" className="text-[10px]">
                        {liveInjuries.length}
                      </Badge>
                    ) : null}
                  </div>

                  {liveInjuries.length ? (
                    <>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {liveInjuries.map((injury) => (
                          <button
                            key={`live-injury-${injury.playerId}`}
                            type="button"
                            className={`h-8 truncate rounded-md border px-2 text-left text-[10px] transition-colors ${
                              injury.status === "Out"
                                ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                                : "border-border/70 bg-background/70 text-foreground hover:bg-muted"
                            }`}
                            onClick={() => setSelectedLiveInjury(injury)}
                          >
                            {formatName(injury.name)}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        Tap a name for details and player actions.
                      </div>
                    </>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">No reported injuries.</div>
                  )}
                </div>

                <div className="rounded-sm border-2 border-emerald-500/35 bg-emerald-500/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">Live Earnings</div>
                    {isAuthenticated ? (
                      <Badge variant="outline" className="text-[10px] border-border/80">
                        {liveOwnedPlayers.length} earning
                      </Badge>
                    ) : null}
                  </div>

                  {!isAuthenticated ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Sign in to view your live earnings breakdown.
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 flex items-center justify-between rounded-md border border-emerald-500/30 bg-background/70 px-2 py-1.5">
                        <span className="text-xs text-muted-foreground">Total Estimated</span>
                        <span className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                          ${totalLiveEarnings.toFixed(2)}
                        </span>
                      </div>

                      {liveOwnedPlayers.length > 0 ? (
                        <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                          {liveOwnedPlayers.map((player) => (
                            <div
                              key={player.playerId}
                              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                {renderModalPlayerName({
                                  name: player.name,
                                  team: player.team,
                                  playerId: player.playerId,
                                  className: "truncate text-xs font-medium text-purple-500",
                                  label: formatName(player.name),
                                })}
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                  <span>{player.team}</span>
                                  <span>•</span>
                                  <span>{player.fantasyPoints.toFixed(1)} FP</span>
                                  <span>•</span>
                                  <span>{player.effectiveShares.toFixed(1)} effective</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                  ${player.estimatedEarnings.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {player.quantity.toFixed(2)} shares
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-muted-foreground">
                          No stacked or boosted earning lines in this matchup yet.
                        </div>
                      )}

                      <div className="mt-2 text-[10px] text-muted-foreground">
                        Estimated earnings use stacked-share effective units only.
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="post" className="mt-4 space-y-4">
            {liveSport === "MLB" ? (
              isLoadingLive ? (
                <Shimmer height="120px" width="100%" />
              ) : mlbLiveFantasyLeaders.length > 0 || liveOwnedPlayers.length > 0 ? (
                <div className="space-y-4">
                  {mlbTopPerformers.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {mlbTopPerformers.map((player) => (
                        <div
                          key={`final-pulse-${player.team || "UNK"}-${player.name}`}
                          className="rounded-sm border border-border/60 p-3 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              {renderModalPlayerName({
                                name: player.name,
                                team: player.team || null,
                                playerId: player.playerId,
                                className: "truncate font-semibold",
                              })}
                              <div className="text-muted-foreground">{player.team || "MLB"}</div>
                            </div>
                            <div className="text-right font-mono">
                              <div>{(player.pts || 0).toFixed(1)} FP</div>
                              <div className="text-muted-foreground">Sportfolio</div>
                            </div>
                          </div>
                          <div className="mt-2 text-muted-foreground">
                            {player.hits ?? 0} H • {player.runs ?? 0} R • {player.rbi ?? 0} RBI
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="rounded-sm border border-border/60 p-3">
                    <div className="text-xs text-muted-foreground">Final Fantasy Leaders</div>
                    <div className="mt-2 space-y-2 text-xs">
                      {mlbLiveFantasyLeaders.map((player) => (
                        <div
                          key={`final-fantasy-${player.playerId || player.name}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            {renderModalPlayerName({
                              name: player.name,
                              team: player.team,
                              playerId: player.playerId,
                              className: "inline",
                              label: formatName(player.name),
                            })}{" "}
                            • {player.team}
                          </span>
                          <span className="font-mono">
                            {(player.fantasyPoints || 0).toFixed(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-sm border border-border/60 p-3">
                    <div className="text-xs text-muted-foreground">Final Share Check</div>
                    {liveOwnedPlayers.length > 0 ? (
                      <div className="mt-2 space-y-2 text-xs">
                        <div className="flex items-center justify-between rounded-sm border border-emerald-500/30 bg-background/70 px-2 py-1.5">
                          <span className="text-muted-foreground">Estimated outcome</span>
                          <span className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            ${totalLiveEarnings.toFixed(2)}
                          </span>
                        </div>
                        {liveOwnedPlayers.map((player) => (
                          <div
                            key={`final-owned-${player.playerId}`}
                            className="flex items-center justify-between gap-2 rounded-sm border border-border/60 bg-background/60 px-2 py-1.5"
                          >
                            <div className="min-w-0 flex-1">
                              {renderModalPlayerName({
                                name: player.name,
                                team: player.team,
                                playerId: player.playerId,
                                className: "truncate font-medium text-purple-500",
                                label: formatName(player.name),
                              })}
                              <div className="text-[10px] text-muted-foreground">
                                {player.team} • {player.fantasyPoints.toFixed(1)} FP
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                ${player.estimatedEarnings.toFixed(2)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {player.quantity.toFixed(2)} shares
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-muted-foreground">
                        No stacked or boosted earning lines were active in this matchup.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Final MLB stat lines are not available yet.
                </div>
              )
            ) : isLoadingStats ? (
              <Shimmer height="120px" width="100%" />
            ) : gameStats?.message ? (
              <div className="text-sm text-muted-foreground">{gameStats.message}</div>
            ) : gameStats ? (
              <div className="space-y-4">
                {gameStats.topPerformers && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-sm border border-border/60 p-3 text-xs">
                      <div className="text-muted-foreground">Top Scorer</div>
                      <div className="mt-1 font-semibold">
                        {renderModalPlayerName({
                          name: gameStats.topPerformers.topScorer.playerName,
                          className: "inline",
                        })}
                      </div>
                      <div className="mt-1">{gameStats.topPerformers.topScorer.points} pts</div>
                    </div>
                    <div className="rounded-sm border border-border/60 p-3 text-xs">
                      <div className="text-muted-foreground">Top Rebounder</div>
                      <div className="mt-1 font-semibold">
                        {renderModalPlayerName({
                          name: gameStats.topPerformers.topRebounder.playerName,
                          className: "inline",
                        })}
                      </div>
                      <div className="mt-1">
                        {gameStats.topPerformers.topRebounder.rebounds} reb
                      </div>
                    </div>
                    <div className="rounded-sm border border-border/60 p-3 text-xs">
                      <div className="text-muted-foreground">Top Assister</div>
                      <div className="mt-1 font-semibold">
                        {renderModalPlayerName({
                          name: gameStats.topPerformers.topAssister.playerName,
                          className: "inline",
                        })}
                      </div>
                      <div className="mt-1">{gameStats.topPerformers.topAssister.assists} ast</div>
                    </div>
                  </div>
                )}

                <div className="rounded-sm border border-border/60 p-3">
                  <div className="text-xs text-muted-foreground">Fantasy Points Leaders</div>
                  <div className="mt-2 space-y-2 text-xs">
                    {topFantasy.map((player) => (
                      <div key={player.playerId} className="flex items-center justify-between">
                        {renderModalPlayerName({
                          name: player.playerName,
                          playerId: player.playerId,
                          className: "inline",
                          label: formatName(player.playerName),
                        })}
                        <span className="font-mono">{player.fantasyPoints.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Final stats are not available yet.
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Dialog
          open={Boolean(selectedLiveInjury)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedLiveInjury(null);
            }
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {selectedLiveInjury ? formatName(selectedLiveInjury.name) : "Injury Details"}
              </DialogTitle>
              <DialogDescription>
                {selectedLiveInjury
                  ? `${selectedLiveInjury.team} • ${selectedLiveInjury.status}`
                  : "View live injury details."}
              </DialogDescription>
            </DialogHeader>

            {selectedLiveInjury ? (
              <div className="space-y-3 text-xs">
                <div className="rounded-md border border-border/70 bg-muted/40 p-2">
                  {selectedLiveInjury.description || "No additional injury description provided."}
                </div>
                {selectedLiveInjury.returnDate ? (
                  <div className="text-muted-foreground">
                    Expected return: {selectedLiveInjury.returnDate}
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!selectedLiveInjury.playerId}
                    onClick={() => {
                      if (!selectedLiveInjury.playerId) return;
                      setSelectedLiveInjury(null);
                      setSelectedLivePlayerId(selectedLiveInjury.playerId);
                    }}
                  >
                    Open Player Modal
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <PlayerModal
          playerId={selectedLivePlayerId}
          open={Boolean(selectedLivePlayerId)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedLivePlayerId(null);
            }
          }}
        />

        <AlertDialog
          open={Boolean(swapTargetPlayerId)}
          onOpenChange={(open) => {
            if (!open) {
              setSwapTargetPlayerId(null);
            }
          }}
        >
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Swap Scout Assignment</AlertDialogTitle>
              <AlertDialogDescription>
                {swapTargetPlayer
                  ? `Choose which active scout to move onto ${formatName(swapTargetPlayer.name)}.`
                  : "Choose which active scout to move onto your selected player."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-2">
              {swapTargetPlayer ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                  <span className="font-medium">Target:</span> {formatName(swapTargetPlayer.name)} •{" "}
                  {swapTargetPlayer.team}
                </div>
              ) : null}

              <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                {swapSourceAssignments.length > 0 ? (
                  swapSourceAssignments.map((assignment) => {
                    const sourceName = assignment.player
                      ? `${assignment.player.firstName} ${assignment.player.lastName}`
                      : assignment.playerId;
                    const targetCurrentCount = swapTargetPlayerId
                      ? scoutAssignmentsByPlayer.get(swapTargetPlayerId)?.scoutCount || 0
                      : 0;

                    return (
                      <div
                        key={assignment.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">
                            {formatName(sourceName)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Active scouts: {assignment.scoutCount}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          disabled={swapScoutMutation.isPending}
                          onClick={() => {
                            if (!swapTargetPlayerId) return;
                            swapScoutMutation.mutate({
                              fromPlayerId: assignment.playerId,
                              fromCount: assignment.scoutCount,
                              toPlayerId: swapTargetPlayerId,
                              toCount: targetCurrentCount + 1,
                            });
                          }}
                        >
                          {swapScoutMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Move 1"
                          )}
                        </Button>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                    No scout assignments available to swap.
                  </div>
                )}
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={swapScoutMutation.isPending}>Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { MlbSignalChips } from "@/components/mlb-gameplay-signals";
import type { GameInsightMlbSignal } from "@/types/game-insights";

export type MlbPlayerContext = {
  game: {
    gameId: string;
    opponentLabel: string;
    startTime: string;
    status: string;
    venue: string | null;
    isHome: boolean;
    scoreLabel: string | null;
  } | null;
  matchupSummary: string | null;
  weatherSummary: string | null;
  lineup: {
    lineupsPosted: boolean;
    slot: number | null;
    position: string | null;
    label: string | null;
  } | null;
  opposingProbablePitcher: {
    name: string | null;
    note: string | null;
    summary: string | null;
  } | null;
  hitterSpotlight: {
    summary: string;
    expectedWoba: number | null;
    expectedSlugging: number | null;
    expectedBattingAverage: number | null;
  } | null;
  playerSignals: GameInsightMlbSignal[];
  error?: string;
};

function formatStartTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Upcoming";
  return format(date, "MMM d, h:mm a");
}

function compactNumber(value: number | null | undefined, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value.toFixed(digits).replace(/^0(?=\.)/, "");
}

function statusLabel(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "inprogress") return "Live";
  if (normalized === "completed") return "Final";
  if (normalized === "postponed") return "Postponed";
  return "Scheduled";
}

export function MlbPlayerContextPanel({
  context,
  isLoading = false,
}: {
  context?: MlbPlayerContext | null;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <div
        className="border rounded-md p-2 bg-amber-500/5"
        data-testid="mlb-player-context-loading"
      >
        <div className="text-xs font-semibold mb-1.5">MLB Context</div>
        <div className="text-[11px] text-muted-foreground">Loading matchup context...</div>
      </div>
    );
  }

  if (!context?.game) return null;

  const pitcher = context.opposingProbablePitcher;
  const expectedMetrics = [
    ["xwOBA", compactNumber(context.hitterSpotlight?.expectedWoba)],
    ["xSLG", compactNumber(context.hitterSpotlight?.expectedSlugging)],
    ["xBA", compactNumber(context.hitterSpotlight?.expectedBattingAverage)],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="border rounded-md p-2 bg-amber-500/5" data-testid="mlb-player-context-panel">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            MLB context
          </div>
          <div className="mt-0.5 text-xs font-semibold" data-testid="mlb-player-context-matchup">
            {context.game.opponentLabel}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {formatStartTime(context.game.startTime)}
            {context.game.venue ? ` · ${context.game.venue}` : ""}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px] border-border/80">
          {statusLabel(context.game.status)}
        </Badge>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
        <div className="rounded-sm border bg-background/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Lineup</div>
          <div className="mt-0.5 font-medium" data-testid="mlb-player-context-lineup">
            {context.lineup?.label || "Lineup pending"}
          </div>
        </div>
        <div className="rounded-sm border bg-background/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Pitcher</div>
          <div className="mt-0.5 font-medium" data-testid="mlb-player-context-pitcher">
            {pitcher?.name ? `vs ${pitcher.name}` : "Pitcher pending"}
          </div>
          {pitcher?.summary ? (
            <div className="mt-0.5 text-muted-foreground">{pitcher.summary}</div>
          ) : null}
        </div>
      </div>

      {context.matchupSummary || context.weatherSummary ? (
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {context.matchupSummary ? <div>{context.matchupSummary}</div> : null}
          {context.weatherSummary ? <div>{context.weatherSummary}</div> : null}
        </div>
      ) : null}

      {context.hitterSpotlight ? (
        <div className="mt-2 rounded-sm border border-emerald-500/25 bg-emerald-500/5 p-2 text-[11px]">
          <div className="font-medium text-emerald-700 dark:text-emerald-300">Statcast note</div>
          <div className="mt-0.5 text-muted-foreground">{context.hitterSpotlight.summary}</div>
          {expectedMetrics.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {expectedMetrics.map(([label, value]) => (
                <Badge
                  key={label}
                  variant="outline"
                  className="text-[10px] border-border/70 bg-background/50"
                >
                  {label} {value}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <MlbSignalChips signals={context.playerSignals} limit={2} className="mt-2" />

      {context.game.scoreLabel ? (
        <div className="mt-2 text-[11px] text-muted-foreground">{context.game.scoreLabel}</div>
      ) : null}
    </div>
  );
}

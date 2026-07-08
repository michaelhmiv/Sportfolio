import { Badge } from "@/components/ui/badge";
import type { GameInsightMlbSignal } from "@/types/game-insights";

type SignalTone = {
  chipClassName: string;
  cardClassName: string;
  labelClassName: string;
};

const SIGNAL_TONES: Record<GameInsightMlbSignal["severity"], SignalTone> = {
  high: {
    chipClassName: "border-amber-500/55 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    cardClassName: "border-amber-500/35 bg-amber-500/5",
    labelClassName: "text-amber-700 dark:text-amber-300",
  },
  positive: {
    chipClassName: "border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    cardClassName: "border-emerald-500/30 bg-emerald-500/5",
    labelClassName: "text-emerald-700 dark:text-emerald-300",
  },
  warning: {
    chipClassName: "border-border/80 bg-muted/40 text-foreground",
    cardClassName: "border-border/70 bg-muted/30",
    labelClassName: "text-foreground",
  },
  info: {
    chipClassName: "border-border/80 bg-background/50 text-muted-foreground",
    cardClassName: "border-border/60 bg-background/50",
    labelClassName: "text-foreground",
  },
};

export function getMlbSignalTone(signal: Pick<GameInsightMlbSignal, "severity">): SignalTone {
  return SIGNAL_TONES[signal.severity] || SIGNAL_TONES.info;
}

export function getVisibleMlbSignals(
  signals: GameInsightMlbSignal[] | null | undefined,
  limit: number,
) {
  return (signals || []).filter(Boolean).slice(0, Math.max(0, limit));
}

function signalCategoryLabel(category: GameInsightMlbSignal["category"]) {
  return category.replace("_", " ");
}

export function MlbSignalChips({
  signals,
  limit = 3,
  className = "mt-3",
}: {
  signals?: GameInsightMlbSignal[] | null;
  limit?: number;
  className?: string;
}) {
  const visibleSignals = getVisibleMlbSignals(signals, limit);
  const remaining = Math.max(0, (signals?.length || 0) - visibleSignals.length);

  if (!visibleSignals.length) return null;

  return (
    <div className={`${className} flex flex-wrap gap-1.5`} aria-label="MLB gameplay signals">
      {visibleSignals.map((signal) => {
        const tone = getMlbSignalTone(signal);
        return (
          <Badge
            key={signal.id}
            variant="outline"
            className={`max-w-full text-[10px] font-medium ${tone.chipClassName}`}
            title={signal.detail}
          >
            <span className="truncate">{signal.label}</span>
          </Badge>
        );
      })}
      {remaining > 0 ? (
        <Badge variant="outline" className="text-[10px] border-border/80 text-muted-foreground">
          +{remaining} more
        </Badge>
      ) : null}
    </div>
  );
}

export function MlbSignalPanel({
  signals,
  limit = 6,
}: {
  signals?: GameInsightMlbSignal[] | null;
  limit?: number;
}) {
  const visibleSignals = getVisibleMlbSignals(signals, limit);
  const remaining = Math.max(0, (signals?.length || 0) - visibleSignals.length);

  if (!visibleSignals.length) return null;

  return (
    <div className="border-t border-border/60 px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Gameplay signals
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Compact MLB context for boost, scout, and holding decisions.
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px] border-border/80">
          {signals?.length || 0} total
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {visibleSignals.map((signal) => {
          const tone = getMlbSignalTone(signal);
          return (
            <div key={signal.id} className={`rounded-sm border p-2.5 ${tone.cardClassName}`}>
              <div className="flex items-start justify-between gap-2">
                <div className={`min-w-0 text-xs font-semibold ${tone.labelClassName}`}>
                  {signal.label}
                </div>
                <div className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {signalCategoryLabel(signal.category)}
                </div>
              </div>
              <div className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                {signal.detail}
              </div>
              {signal.team || typeof signal.scoreImpact === "number" ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {signal.team ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-border/70 bg-background/50"
                    >
                      {signal.team}
                    </Badge>
                  ) : null}
                  {typeof signal.scoreImpact === "number" ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-border/70 bg-background/50"
                    >
                      impact {signal.scoreImpact > 0 ? "+" : ""}
                      {signal.scoreImpact.toFixed(1)}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {remaining > 0 ? (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {remaining} additional signal{remaining === 1 ? "" : "s"} available in the API response.
        </div>
      ) : null}
    </div>
  );
}

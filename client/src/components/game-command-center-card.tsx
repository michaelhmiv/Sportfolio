import { Badge } from "@/components/ui/badge";
import type { GameInsight } from "@/types/game-insights";
import { Activity, Calendar, Trophy, Zap } from "lucide-react";

interface GameCommandCenterCardProps {
  game: GameInsight;
  effectiveStatus: "scheduled" | "inprogress" | "completed" | "postponed";
  boostSlotsRemaining: number | null;
  isAuthenticated: boolean;
  onOpen: () => void;
}

const statusConfig = {
  scheduled: { label: "Scheduled", icon: Calendar, variant: "outline" as const },
  inprogress: { label: "Live", icon: Activity, variant: "default" as const },
  completed: { label: "Final", icon: Trophy, variant: "secondary" as const },
  postponed: { label: "Postponed", icon: Calendar, variant: "outline" as const },
};

export function GameCommandCenterCard({
  game,
  effectiveStatus,
  boostSlotsRemaining,
  isAuthenticated,
  onOpen,
}: GameCommandCenterCardProps) {
  const status = statusConfig[effectiveStatus];
  const StatusIcon = status.icon;
  const startTime = new Date(game.startTime);
  const timeLabel = startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const powerLeader = game.userContext?.topPowerPlayers?.[0];

  const LeaderRow = ({
    label,
    leader,
    value,
  }: {
    label: string;
    leader: string;
    value: string | number;
  }) => (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground w-16 flex-shrink-0">{label}</span>
      <span className="truncate flex-1 text-right mr-2">{leader}</span>
      <span className="font-mono font-semibold text-right w-14">{value}</span>
    </div>
  );

  const formatLeader = (leader: GameInsight["leaders"]["fantasy"]) =>
    leader ? leader.name : "—";

  const formatNumber = (value: number | null | undefined, digits: number = 0) =>
    value === null || value === undefined ? "—" : value.toFixed(digits);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-lg border border-border bg-card p-3 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={status.variant} className="gap-1 text-[10px] uppercase">
            <StatusIcon className="h-3 w-3" />
            {status.label}
          </Badge>
          {effectiveStatus === "scheduled" && (
            <span className="text-xs text-muted-foreground">{timeLabel}</span>
          )}
        </div>
        {effectiveStatus === "inprogress" && (
          <span className="text-xs text-muted-foreground">{timeLabel}</span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-sm font-semibold">{game.awayTeam}</div>
          <div className="text-sm font-semibold">{game.homeTeam}</div>
        </div>
        <div className="text-right font-mono">
          <div className="text-base font-bold">{game.awayScore ?? "-"}</div>
          <div className="text-base font-bold">{game.homeScore ?? "-"}</div>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <LeaderRow
          label="FP Avg"
          leader={formatLeader(game.leaders.fantasy)}
          value={formatNumber(game.leaders.fantasy?.avgFantasyPointsPerGame, 1)}
        />
        <LeaderRow
          label="Shares"
          leader={formatLeader(game.leaders.shares)}
          value={game.leaders.shares ? game.leaders.shares.totalShares : "—"}
        />
        <LeaderRow
          label="Scouts"
          leader={formatLeader(game.leaders.scouts)}
          value={game.leaders.scouts ? game.leaders.scouts.scoutCount : "—"}
        />
      </div>

      {isAuthenticated && game.userContext && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              Eligible: {game.userContext.eligibleCount}
            </Badge>
            {boostSlotsRemaining !== null && (
              <Badge variant="outline" className="text-[10px]">
                Slots: {boostSlotsRemaining}
              </Badge>
            )}
            {powerLeader && powerLeader.powerLevel > 0 && (
              <Badge variant="secondary" className="gap-1 text-[10px] text-purple-500">
                <Zap className="h-3 w-3" />
                Power {powerLeader.powerLevel.toFixed(2)}
              </Badge>
            )}
          </div>

          {game.userContext.topPowerPlayers.length > 0 && (
            <div className="mt-2 space-y-1 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Your Power</div>
              {game.userContext.topPowerPlayers.map(player => (
                <div key={player.playerId} className="flex items-center justify-between">
                  <span className="truncate">{player.name}</span>
                  <span className="font-mono text-purple-400">{player.powerLevel.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

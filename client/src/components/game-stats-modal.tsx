import { useQuery } from "@tanstack/react-query";
import { X, RefreshCw, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveApiUrl } from "@/lib/native-runtime";
import { openPlayerModal } from "@/lib/player-modal-events";

// Types
export interface NBAPlayerStats {
  id: number;
  name: string;
  position: string;
  min: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg_pct: number;
}

export interface NBALiveStats {
  gameId: string;
  status: string;
  homeTeam: string;
  homeScore: number;
  awayTeam: string;
  awayScore: number;
  homePlayers: NBAPlayerStats[];
  awayPlayers: NBAPlayerStats[];
  homeTopPerformers: Array<{ name: string; pts: number; reb: number; ast: number }>;
  awayTopPerformers: Array<{ name: string; pts: number; reb: number; ast: number }>;
  message?: string;
}

export interface NFLPlayerStats {
  id: number;
  name: string;
  position: string;
  passingYards?: number;
  passingTDs?: number;
  rushingYards?: number;
  rushingTDs?: number;
  receivingYards?: number;
  receivingTDs?: number;
  receptions?: number;
}

export interface NFLLiveStats {
  gameId: string;
  status: string;
  homeTeam: string;
  homeScore: number;
  awayTeam: string;
  awayScore: number;
  homePlayers: NFLPlayerStats[];
  awayPlayers: NFLPlayerStats[];
  homeTopPerformers: never[];
  awayTopPerformers: never[];
  message?: string;
}

export interface MLBPlayerStats {
  id: number;
  name: string;
  position: string;
  hits?: number;
  runs?: number;
  runsBattedIn?: number;
  homeRuns?: number;
  stolenBases?: number;
  inningsPitched?: number;
  pitchingStrikeouts?: number;
  earnedRuns?: number;
  fantasyPoints?: number;
}

export interface MLBLiveStats {
  gameId: string;
  status: string;
  homeTeam: string;
  homeScore: number;
  awayTeam: string;
  awayScore: number;
  homePlayers: MLBPlayerStats[];
  awayPlayers: MLBPlayerStats[];
  homeTopPerformers: Array<{
    name: string;
    pts?: number;
    hits?: number;
    runs?: number;
    rbi?: number;
  }>;
  awayTopPerformers: Array<{
    name: string;
    pts?: number;
    hits?: number;
    runs?: number;
    rbi?: number;
  }>;
  message?: string;
}

type LiveStats = NBALiveStats | NFLLiveStats | MLBLiveStats;

interface GameStatsModalProps {
  gameId: string;
  sport: string;
  onClose: () => void;
}

export function GameStatsModal({ gameId, sport, onClose }: GameStatsModalProps) {
  const {
    data: liveStats,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<LiveStats>({
    queryKey: [`/api/games/${gameId}/live-stats`],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl(`/api/games/${gameId}/live-stats`));
      if (!res.ok) throw new Error("Failed to fetch live stats");
      return res.json();
    },
    refetchInterval: 30000,
  });

  return (
    <Dialog open={!!gameId} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b">
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="text-base">
              {liveStats ? `${liveStats.awayTeam} @ ${liveStats.homeTeam}` : "Game Stats"}
            </DialogTitle>
            <button
              onClick={onClose}
              className="rounded-sm p-1 transition-colors hover:bg-secondary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : error || liveStats?.message ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <p>{liveStats?.message || "Stats unavailable"}</p>
              <button
                onClick={() => refetch()}
                className="mt-2 text-primary hover:underline flex items-center justify-center gap-1 mx-auto"
                disabled={isFetching}
              >
                {isFetching && <RefreshCw className="w-3 h-3 animate-spin" />}
                Retry
              </button>
            </div>
          ) : liveStats ? (
            <div className="space-y-4">
              {/* Score Header */}
              <div className="flex items-center justify-center gap-6 rounded-sm border border-border/60 bg-muted/50 py-2">
                <div className="text-center">
                  <div className="text-sm font-medium">{liveStats.awayTeam}</div>
                  <div className="text-xl font-mono font-bold">{liveStats.awayScore}</div>
                </div>
                <div className="text-muted-foreground text-xs">@</div>
                <div className="text-center">
                  <div className="text-sm font-medium">{liveStats.homeTeam}</div>
                  <div className="text-xl font-mono font-bold">{liveStats.homeScore}</div>
                </div>
              </div>

              {/* NBA Stats */}
              {sport === "NBA" && isNBALiveStats(liveStats) && (
                <NBAStatsTable liveStats={liveStats} />
              )}

              {/* NFL Stats */}
              {sport === "NFL" && isNFLLiveStats(liveStats) && (
                <NFLStatsTable liveStats={liveStats} />
              )}

              {/* MLB Stats */}
              {sport === "MLB" && isMLBLiveStats(liveStats) && (
                <MLBStatsTable liveStats={liveStats} />
              )}
            </div>
          ) : null}
        </div>

        {/* Footer with refresh */}
        <div className="px-4 py-2 border-t bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
          <span>{liveStats?.status || ""}</span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 hover:text-foreground"
            disabled={isFetching}
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModalPlayerName({ playerId, name }: { playerId: string; name: string }) {
  const handleActivate = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openPlayerModal(playerId);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          handleActivate(event);
        }
      }}
      className="truncate cursor-pointer underline-offset-2 hover:underline focus-visible:underline"
    >
      {name}
    </span>
  );
}

// NBA Stats Table
function NBAStatsTable({ liveStats }: { liveStats: NBALiveStats }) {
  const PlayerTable = ({
    players,
    teamName,
    isHome,
  }: {
    players: NBAPlayerStats[];
    teamName: string;
    isHome: boolean;
  }) => (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground mb-1">{teamName}</h4>
      <div className="overflow-hidden rounded-sm border">
        {/* Header */}
        <div className="grid grid-cols-8 gap-1 px-2 py-1.5 bg-muted/50 text-[10px] font-medium text-muted-foreground">
          <div className="col-span-3">PLAYER</div>
          <div className="text-center">MIN</div>
          <div className="text-center">PTS</div>
          <div className="text-center">REB</div>
          <div className="text-center">AST</div>
          <div className="text-center">FG%</div>
        </div>
        {/* Rows */}
        {players.map((player) => (
          <div
            key={player.id}
            className="grid grid-cols-8 gap-1 px-2 py-1.5 border-t text-xs hover:bg-muted/30"
          >
            <div className="col-span-3 flex items-center gap-1 min-w-0">
              <span className="text-[9px] bg-secondary px-1 rounded w-5 text-center flex-shrink-0">
                {player.position}
              </span>
              <ModalPlayerName playerId={`nba_${player.id}`} name={player.name} />
            </div>
            <div className="text-center font-mono text-[10px]">{player.min}</div>
            <div className="text-center font-mono font-semibold">{player.pts}</div>
            <div className="text-center font-mono text-[10px]">{player.reb}</div>
            <div className="text-center font-mono text-[10px]">{player.ast}</div>
            <div className="text-center font-mono text-[10px]">
              {player.fg_pct ? (player.fg_pct * 100).toFixed(0) + "%" : "-"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Away Team */}
      <PlayerTable players={liveStats.awayPlayers} teamName={liveStats.awayTeam} isHome={false} />

      {/* Home Team */}
      <PlayerTable players={liveStats.homePlayers} teamName={liveStats.homeTeam} isHome={true} />
    </div>
  );
}

// NFL Stats Table
function NFLStatsTable({ liveStats }: { liveStats: NFLLiveStats }) {
  const PlayerTable = ({ players, teamName }: { players: NFLPlayerStats[]; teamName: string }) => (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground mb-1">{teamName}</h4>
      <div className="overflow-hidden rounded-sm border">
        {/* Header */}
        <div className="grid grid-cols-7 gap-1 px-2 py-1.5 bg-muted/50 text-[10px] font-medium text-muted-foreground">
          <div className="col-span-2">PLAYER</div>
          <div className="text-center">C/A</div>
          <div className="text-center">PASS</div>
          <div className="text-center">RUSH</div>
          <div className="text-center">REC</div>
          <div className="text-center">TD</div>
        </div>
        {/* Rows */}
        {players.map((player) => (
          <div
            key={player.id}
            className="grid grid-cols-7 gap-1 px-2 py-1.5 border-t text-xs hover:bg-muted/30"
          >
            <div className="col-span-2 flex items-center gap-1 min-w-0">
              <span className="text-[9px] bg-secondary px-1 rounded w-5 text-center flex-shrink-0">
                {player.position}
              </span>
              <ModalPlayerName playerId={`nfl_${player.id}`} name={player.name} />
            </div>
            {/* Passing */}
            <div className="text-center font-mono text-[10px]">
              {player.passingYards !== null && player.passingYards !== undefined
                ? `${player.passingYards} yd`
                : "-"}
            </div>
            <div className="text-center font-mono text-[10px]">
              {player.passingYards !== null && player.passingYards !== undefined
                ? `${player.passingTDs} TD`
                : "-"}
            </div>
            {/* Rushing */}
            <div className="text-center font-mono text-[10px]">
              {player.rushingYards !== null && player.rushingYards !== undefined
                ? `${player.rushingYards} yd`
                : "-"}
            </div>
            {/* Receiving */}
            <div className="text-center font-mono text-[10px]">
              {player.receivingYards !== null && player.receivingYards !== undefined
                ? `${player.receptions}-${player.receivingYards}`
                : "-"}
            </div>
            <div className="text-center font-mono text-[10px]">
              {player.passingTDs !== undefined
                ? player.passingTDs + (player.rushingTDs || 0) + (player.receivingTDs || 0)
                : "-"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Away Team */}
      <PlayerTable players={liveStats.awayPlayers} teamName={liveStats.awayTeam} />

      {/* Home Team */}
      <PlayerTable players={liveStats.homePlayers} teamName={liveStats.homeTeam} />
    </div>
  );
}

// MLB Stats Table
function MLBStatsTable({ liveStats }: { liveStats: MLBLiveStats }) {
  const PlayerTable = ({ players, teamName }: { players: MLBPlayerStats[]; teamName: string }) => (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground mb-1">{teamName}</h4>
      <div className="overflow-hidden rounded-sm border">
        <div className="grid grid-cols-10 gap-1 px-2 py-1.5 bg-muted/50 text-[10px] font-medium text-muted-foreground">
          <div className="col-span-2">PLAYER</div>
          <div className="text-center">H</div>
          <div className="text-center">R</div>
          <div className="text-center">RBI</div>
          <div className="text-center">HR</div>
          <div className="text-center">SB</div>
          <div className="text-center">IP</div>
          <div className="text-center">K</div>
          <div className="text-center">ER</div>
          <div className="text-center">FP</div>
        </div>
        {players.map((player) => (
          <div
            key={player.id}
            className="grid grid-cols-10 gap-1 px-2 py-1.5 border-t text-xs hover:bg-muted/30"
          >
            <div className="col-span-2 flex items-center gap-1 min-w-0">
              <span className="text-[9px] bg-secondary px-1 rounded w-6 text-center flex-shrink-0">
                {player.position || "-"}
              </span>
              <ModalPlayerName playerId={`mlb_${player.id}`} name={player.name} />
            </div>
            <div className="text-center font-mono text-[10px]">{player.hits ?? 0}</div>
            <div className="text-center font-mono text-[10px]">{player.runs ?? 0}</div>
            <div className="text-center font-mono text-[10px]">{player.runsBattedIn ?? 0}</div>
            <div className="text-center font-mono text-[10px]">{player.homeRuns ?? 0}</div>
            <div className="text-center font-mono text-[10px]">{player.stolenBases ?? 0}</div>
            <div className="text-center font-mono text-[10px]">
              {Number(player.inningsPitched ?? 0).toFixed(1)}
            </div>
            <div className="text-center font-mono text-[10px]">
              {player.pitchingStrikeouts ?? 0}
            </div>
            <div className="text-center font-mono text-[10px]">{player.earnedRuns ?? 0}</div>
            <div className="text-center font-mono font-semibold">
              {(player.fantasyPoints ?? 0).toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <PlayerTable players={liveStats.awayPlayers} teamName={liveStats.awayTeam} />
      <PlayerTable players={liveStats.homePlayers} teamName={liveStats.homeTeam} />
    </div>
  );
}

// Type guards
function isNBALiveStats(stats: LiveStats): stats is NBALiveStats {
  return "homePlayers" in stats && stats.homePlayers.length > 0 && "pts" in stats.homePlayers[0];
}

function isNFLLiveStats(stats: LiveStats): stats is NFLLiveStats {
  return (
    "homePlayers" in stats && stats.homePlayers.length > 0 && "passingYards" in stats.homePlayers[0]
  );
}

function isMLBLiveStats(stats: LiveStats): stats is MLBLiveStats {
  return (
    "homePlayers" in stats &&
    stats.homePlayers.length > 0 &&
    ("hits" in stats.homePlayers[0] ||
      "runsBattedIn" in stats.homePlayers[0] ||
      "inningsPitched" in stats.homePlayers[0])
  );
}

export default GameStatsModal;

import { useQuery } from "@tanstack/react-query";
import { X, RefreshCw, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSport } from "@/lib/sport-context";

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

type LiveStats = NBALiveStats | NFLLiveStats;

interface GameStatsModalProps {
  gameId: string;
  sport: string;
  onClose: () => void;
}

export function GameStatsModal({ gameId, sport, onClose }: GameStatsModalProps) {
  const { data: liveStats, isLoading, error, refetch, isFetching } = useQuery<LiveStats>({
    queryKey: [`/api/games/${gameId}/live-stats`],
    queryFn: async () => {
      const res = await fetch(`/api/games/${gameId}/live-stats`);
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
              className="p-1 hover:bg-secondary rounded-full transition-colors"
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
              <div className="flex items-center justify-center gap-6 py-2 bg-muted/50 rounded-lg">
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

// NBA Stats Table
function NBAStatsTable({ liveStats }: { liveStats: NBALiveStats }) {
  const PlayerTable = ({ players, teamName, isHome }: { players: NBAPlayerStats[]; teamName: string; isHome: boolean }) => (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground mb-1">{teamName}</h4>
      <div className="border rounded-lg overflow-hidden">
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
          <div key={player.id} className="grid grid-cols-8 gap-1 px-2 py-1.5 border-t text-xs hover:bg-muted/30">
            <div className="col-span-3 flex items-center gap-1 min-w-0">
              <span className="text-[9px] bg-secondary px-1 rounded w-5 text-center flex-shrink-0">{player.position}</span>
              <span className="truncate">{player.name}</span>
            </div>
            <div className="text-center font-mono text-[10px]">{player.min}</div>
            <div className="text-center font-mono font-semibold">{player.pts}</div>
            <div className="text-center font-mono text-[10px]">{player.reb}</div>
            <div className="text-center font-mono text-[10px]">{player.ast}</div>
            <div className="text-center font-mono text-[10px]">{player.fg_pct ? (player.fg_pct * 100).toFixed(0) + "%" : "-"}</div>
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
      <div className="border rounded-lg overflow-hidden">
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
          <div key={player.id} className="grid grid-cols-7 gap-1 px-2 py-1.5 border-t text-xs hover:bg-muted/30">
            <div className="col-span-2 flex items-center gap-1 min-w-0">
              <span className="text-[9px] bg-secondary px-1 rounded w-5 text-center flex-shrink-0">{player.position}</span>
              <span className="truncate">{player.name}</span>
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

// Type guards
function isNBALiveStats(stats: LiveStats): stats is NBALiveStats {
  return "homePlayers" in stats && stats.homePlayers.length > 0 && "pts" in stats.homePlayers[0];
}

function isNFLLiveStats(stats: LiveStats): stats is NFLLiveStats {
  return "homePlayers" in stats && stats.homePlayers.length > 0 && "passingYards" in stats.homePlayers[0];
}

export default GameStatsModal;

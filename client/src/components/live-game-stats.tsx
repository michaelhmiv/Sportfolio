import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, RefreshCw, X } from "lucide-react";
import { Shimmer } from "@/components/ui/animations";
import { Badge } from "@/components/ui/badge";

// NBA Player Stats
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

// NFL Player Stats
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

// MLB Player Stats
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

interface LiveGameStatsProps {
  gameId: string;
  sport: string;
  teams: { home: string; away: string };
  scores: { home: number; away: number };
  status: string;
}

export function LiveGameStats({ gameId, sport, teams, scores, status }: LiveGameStatsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const {
    data: liveStats,
    isLoading,
    error,
    refetch,
  } = useQuery<LiveStats>({
    queryKey: [`/api/games/${gameId}/live-stats`],
    queryFn: async () => {
      const res = await fetch(`/api/games/${gameId}/live-stats`);
      if (!res.ok) throw new Error("Failed to fetch live stats");
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: isExpanded, // Only fetch when expanded
  });

  // Update teams and scores from API data if available
  const displayTeams = liveStats ? { home: liveStats.homeTeam, away: liveStats.awayTeam } : teams;
  const displayScores = liveStats
    ? { home: liveStats.homeScore, away: liveStats.awayScore }
    : scores;

  return (
    <div className="w-full">
      {/* Clickable header - shows score, expands on click */}
      <div
        className="flex items-center justify-between p-2 bg-muted hover:bg-muted/80 rounded-md cursor-pointer transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-xs">{displayTeams.away}</span>
          <span className="font-mono font-bold text-sm">{displayScores.away}</span>
          <span className="text-muted-foreground text-xs">@</span>
          <span className="font-medium text-xs">{displayTeams.home}</span>
          <span className="font-mono font-bold text-sm">{displayScores.home}</span>
        </div>
        <div className="flex items-center gap-1">
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Expanded player stats */}
      {isExpanded && (
        <div className="mt-1 p-2 bg-muted/30 rounded-md">
          {isLoading ? (
            <div className="space-y-2">
              <Shimmer height="12px" width="100%" />
              <Shimmer height="12px" width="90%" />
              <Shimmer height="12px" width="80%" />
            </div>
          ) : error || liveStats?.message ? (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {liveStats?.message || "Stats unavailable"}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  refetch();
                }}
                className="text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : liveStats ? (
            <div className="space-y-3">
              {/* NBA Stats */}
              {sport === "NBA" && isNBALiveStats(liveStats) && (
                <NBAStatsPanel liveStats={liveStats} />
              )}

              {/* NFL Stats */}
              {sport === "NFL" && isNFLLiveStats(liveStats) && (
                <NFLStatsPanel liveStats={liveStats} />
              )}

              {/* MLB Stats */}
              {sport === "MLB" && isMLBLiveStats(liveStats) && (
                <MLBStatsPanel liveStats={liveStats} />
              )}
            </div>
          ) : null}

          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(false);
            }}
            className="absolute top-1 right-1 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// NBA Stats Panel
function NBAStatsPanel({ liveStats }: { liveStats: NBALiveStats }) {
  const [showAllHome, setShowAllHome] = useState(false);
  const [showAllAway, setShowAllAway] = useState(false);

  const displayHomePlayers = showAllHome
    ? liveStats.homePlayers
    : liveStats.homePlayers.slice(0, 5);
  const displayAwayPlayers = showAllAway
    ? liveStats.awayPlayers
    : liveStats.awayPlayers.slice(0, 5);

  const PlayerRow = ({ player }: { player: NBAPlayerStats }) => (
    <div className="flex items-center justify-between py-1 px-1 hover:bg-muted/50 rounded text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-[9px] bg-secondary px-1 rounded w-5 text-center flex-shrink-0">
          {player.position}
        </span>
        <span className="truncate">{player.name}</span>
      </div>
      <div className="flex gap-3 text-mono text-[10px]">
        <span className="w-6 text-center">{player.min}</span>
        <span className="w-6 text-center">{player.pts}</span>
        <span className="w-5 text-center">{player.reb}</span>
        <span className="w-5 text-center">{player.ast}</span>
      </div>
    </div>
  );

  return (
    <div>
      {/* Top Performers Summary */}
      <div className="flex gap-2 mb-2">
        <div className="flex-1">
          <div className="text-[10px] font-semibold text-muted-foreground mb-1">
            {liveStats.awayTeam}
          </div>
          <div className="flex flex-wrap gap-1">
            {liveStats.awayTopPerformers.slice(0, 2).map((p, i) => (
              <Badge key={i} variant="outline" className="text-[9px] px-1 py-0">
                {p.name.split(" ").pop()}: {p.pts}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex-1">
          <div className="text-[10px] font-semibold text-muted-foreground mb-1">
            {liveStats.homeTeam}
          </div>
          <div className="flex flex-wrap gap-1">
            {liveStats.homeTopPerformers.slice(0, 2).map((p, i) => (
              <Badge key={i} variant="outline" className="text-[9px] px-1 py-0">
                {p.name.split(" ").pop()}: {p.pts}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Player Stats Header */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1 pb-1 border-b border-border/50">
        <span className="flex-1">Player</span>
        <div className="flex gap-3">
          <span className="w-6 text-center">MIN</span>
          <span className="w-6 text-center">PTS</span>
          <span className="w-5 text-center">REB</span>
          <span className="w-5 text-center">AST</span>
        </div>
      </div>

      {/* Away Team Players */}
      <div className="mt-2">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1">
          {liveStats.awayTeam}
        </div>
        {displayAwayPlayers.map((player) => (
          <PlayerRow key={player.id} player={player} />
        ))}
        {liveStats.awayPlayers.length > 5 && (
          <button
            onClick={() => setShowAllAway(!showAllAway)}
            className="w-full text-[10px] text-center text-muted-foreground hover:text-foreground py-1"
          >
            {showAllAway ? "Show less" : `+${liveStats.awayPlayers.length - 5} more`}
          </button>
        )}
      </div>

      {/* Home Team Players */}
      <div className="mt-2">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1">
          {liveStats.homeTeam}
        </div>
        {displayHomePlayers.map((player) => (
          <PlayerRow key={player.id} player={player} />
        ))}
        {liveStats.homePlayers.length > 5 && (
          <button
            onClick={() => setShowAllHome(!showAllHome)}
            className="w-full text-[10px] text-center text-muted-foreground hover:text-foreground py-1"
          >
            {showAllHome ? "Show less" : `+${liveStats.homePlayers.length - 5} more`}
          </button>
        )}
      </div>
    </div>
  );
}

// NFL Stats Panel
function NFLStatsPanel({ liveStats }: { liveStats: NFLLiveStats }) {
  const [showAllHome, setShowAllHome] = useState(false);
  const [showAllAway, setShowAllAway] = useState(false);

  const displayHomePlayers = showAllHome
    ? liveStats.homePlayers
    : liveStats.homePlayers.slice(0, 5);
  const displayAwayPlayers = showAllAway
    ? liveStats.awayPlayers
    : liveStats.awayPlayers.slice(0, 5);

  const PlayerRow = ({ player }: { player: NFLPlayerStats }) => (
    <div className="flex items-center justify-between py-1 px-1 hover:bg-muted/50 rounded text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-[9px] bg-secondary px-1 rounded w-5 text-center flex-shrink-0">
          {player.position}
        </span>
        <span className="truncate">{player.name}</span>
      </div>
      <div className="flex gap-2 text-mono text-[10px]">
        {player.passingYards !== null && player.passingYards !== undefined && (
          <>
            <span className="w-12 text-right">{player.passingYards}yd</span>
            <span className="w-4 text-center">{player.passingTDs}TD</span>
          </>
        )}
        {player.rushingYards !== null && player.rushingYards !== undefined && (
          <>
            <span className="w-12 text-right">{player.rushingYards}yd</span>
            <span className="w-4 text-center">{player.rushingTDs}TD</span>
          </>
        )}
        {player.receivingYards !== null && player.receivingYards !== undefined && (
          <>
            <span className="w-5 text-center">
              {player.receptions}-{player.receivingYards}
            </span>
            <span className="w-4 text-center">{player.receivingTDs}TD</span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div>
      {/* Player Stats Header */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1 pb-1 border-b border-border/50">
        <span className="flex-1">Player</span>
        <div className="flex gap-2">
          <span className="w-12 text-center">YARDS</span>
          <span className="w-4 text-center">TD</span>
        </div>
      </div>

      {/* Away Team Players */}
      <div className="mt-2">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1">
          {liveStats.awayTeam}
        </div>
        {displayAwayPlayers.map((player) => (
          <PlayerRow key={player.id} player={player} />
        ))}
        {liveStats.awayPlayers.length > 5 && (
          <button
            onClick={() => setShowAllAway(!showAllAway)}
            className="w-full text-[10px] text-center text-muted-foreground hover:text-foreground py-1"
          >
            {showAllAway ? "Show less" : `+${liveStats.awayPlayers.length - 5} more`}
          </button>
        )}
      </div>

      {/* Home Team Players */}
      <div className="mt-2">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1">
          {liveStats.homeTeam}
        </div>
        {displayHomePlayers.map((player) => (
          <PlayerRow key={player.id} player={player} />
        ))}
        {liveStats.homePlayers.length > 5 && (
          <button
            onClick={() => setShowAllHome(!showAllHome)}
            className="w-full text-[10px] text-center text-muted-foreground hover:text-foreground py-1"
          >
            {showAllHome ? "Show less" : `+${liveStats.homePlayers.length - 5} more`}
          </button>
        )}
      </div>
    </div>
  );
}

// MLB Stats Panel
function MLBStatsPanel({ liveStats }: { liveStats: MLBLiveStats }) {
  const [showAllHome, setShowAllHome] = useState(false);
  const [showAllAway, setShowAllAway] = useState(false);

  const displayHomePlayers = showAllHome
    ? liveStats.homePlayers
    : liveStats.homePlayers.slice(0, 5);
  const displayAwayPlayers = showAllAway
    ? liveStats.awayPlayers
    : liveStats.awayPlayers.slice(0, 5);

  const PlayerRow = ({ player }: { player: MLBPlayerStats }) => (
    <div className="flex items-center justify-between py-1 px-1 hover:bg-muted/50 rounded text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-[9px] bg-secondary px-1 rounded w-6 text-center flex-shrink-0">
          {player.position || "-"}
        </span>
        <span className="truncate">{player.name}</span>
      </div>
      <div className="flex gap-2 text-mono text-[10px]">
        <span className="w-4 text-center">{player.hits ?? 0}</span>
        <span className="w-4 text-center">{player.runs ?? 0}</span>
        <span className="w-6 text-center">{player.runsBattedIn ?? 0}</span>
        <span className="w-4 text-center">{player.homeRuns ?? 0}</span>
        <span className="w-4 text-center">{player.stolenBases ?? 0}</span>
        <span className="w-6 text-center">{Number(player.inningsPitched ?? 0).toFixed(1)}</span>
        <span className="w-4 text-center">{player.pitchingStrikeouts ?? 0}</span>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1 pb-1 border-b border-border/50">
        <span className="flex-1">Player</span>
        <div className="flex gap-2">
          <span className="w-4 text-center">H</span>
          <span className="w-4 text-center">R</span>
          <span className="w-6 text-center">RBI</span>
          <span className="w-4 text-center">HR</span>
          <span className="w-4 text-center">SB</span>
          <span className="w-6 text-center">IP</span>
          <span className="w-4 text-center">K</span>
        </div>
      </div>

      <div className="mt-2">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1">
          {liveStats.awayTeam}
        </div>
        {displayAwayPlayers.map((player) => (
          <PlayerRow key={player.id} player={player} />
        ))}
        {liveStats.awayPlayers.length > 5 && (
          <button
            onClick={() => setShowAllAway(!showAllAway)}
            className="w-full text-[10px] text-center text-muted-foreground hover:text-foreground py-1"
          >
            {showAllAway ? "Show less" : `+${liveStats.awayPlayers.length - 5} more`}
          </button>
        )}
      </div>

      <div className="mt-2">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1">
          {liveStats.homeTeam}
        </div>
        {displayHomePlayers.map((player) => (
          <PlayerRow key={player.id} player={player} />
        ))}
        {liveStats.homePlayers.length > 5 && (
          <button
            onClick={() => setShowAllHome(!showAllHome)}
            className="w-full text-[10px] text-center text-muted-foreground hover:text-foreground py-1"
          >
            {showAllHome ? "Show less" : `+${liveStats.homePlayers.length - 5} more`}
          </button>
        )}
      </div>
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

export default LiveGameStats;

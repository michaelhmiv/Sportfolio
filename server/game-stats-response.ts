type GameStatsPlayerRow = {
  playerId: string;
  playerName: string;
  team: string | null | undefined;
  sport: string | null | undefined;
  statsJson: Record<string, any> | null | undefined;
  minutes: number;
  points: number;
  threePointersMade: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fantasyPoints: number;
  homeAway: string | null | undefined;
};

const numberValue = (value: unknown): number => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundOne = (value: number): number => Number(value.toFixed(1));

const sortByDesc = <T>(items: T[], scorer: (item: T) => number): T | null =>
  items.length > 0 ? [...items].sort((left, right) => scorer(right) - scorer(left))[0] : null;

const getMlbStats = (row: GameStatsPlayerRow) => row.statsJson || {};

const mapMlbPlayer = (row: GameStatsPlayerRow) => {
  const stats = getMlbStats(row);
  return {
    playerId: row.playerId,
    playerName: row.playerName,
    team: row.team,
    fantasyPoints: row.fantasyPoints,
    homeAway: row.homeAway,
    atBats: numberValue(stats.atBats),
    hits: numberValue(stats.hits),
    doubles: numberValue(stats.doubles),
    triples: numberValue(stats.triples),
    homeRuns: numberValue(stats.homeRuns),
    runs: numberValue(stats.runs),
    runsBattedIn: numberValue(stats.runsBattedIn),
    walks: numberValue(stats.walks),
    stolenBases: numberValue(stats.stolenBases),
    strikeoutsBatting: numberValue(stats.strikeoutsBatting),
    inningsPitched: numberValue(stats.inningsPitched),
    pitchingStrikeouts: numberValue(stats.pitchingStrikeouts),
    earnedRuns: numberValue(stats.earnedRuns),
    wins: numberValue(stats.wins),
    saves: numberValue(stats.saves),
  };
};

type MlbMappedPlayer = ReturnType<typeof mapMlbPlayer>;

const calculateMlbTeamTotals = (players: MlbMappedPlayer[]) => ({
  fantasyPoints: roundOne(players.reduce((sum, player) => sum + player.fantasyPoints, 0)),
  atBats: players.reduce((sum, player) => sum + player.atBats, 0),
  hits: players.reduce((sum, player) => sum + player.hits, 0),
  runs: players.reduce((sum, player) => sum + player.runs, 0),
  runsBattedIn: players.reduce((sum, player) => sum + player.runsBattedIn, 0),
  homeRuns: players.reduce((sum, player) => sum + player.homeRuns, 0),
  stolenBases: players.reduce((sum, player) => sum + player.stolenBases, 0),
  walks: players.reduce((sum, player) => sum + player.walks, 0),
  strikeoutsBatting: players.reduce((sum, player) => sum + player.strikeoutsBatting, 0),
  inningsPitched: roundOne(players.reduce((sum, player) => sum + player.inningsPitched, 0)),
  pitchingStrikeouts: players.reduce((sum, player) => sum + player.pitchingStrikeouts, 0),
  earnedRuns: players.reduce((sum, player) => sum + player.earnedRuns, 0),
});

const summarizeMlbPerformer = (player: MlbMappedPlayer | null) =>
  player
    ? {
        playerId: player.playerId,
        playerName: player.playerName,
        team: player.team,
        fantasyPoints: roundOne(player.fantasyPoints),
        hits: player.hits,
        runs: player.runs,
        runsBattedIn: player.runsBattedIn,
        homeRuns: player.homeRuns,
        stolenBases: player.stolenBases,
        inningsPitched: player.inningsPitched,
        pitchingStrikeouts: player.pitchingStrikeouts,
        earnedRuns: player.earnedRuns,
        wins: player.wins,
        saves: player.saves,
      }
    : null;

const buildMlbGameStatsPayload = (gameId: string, rows: GameStatsPlayerRow[]) => {
  const mappedPlayers = rows.map(mapMlbPlayer);
  const homeStats = mappedPlayers.filter((player) => player.homeAway === "home");
  const awayStats = mappedPlayers.filter((player) => player.homeAway === "away");
  const allStats = [...homeStats, ...awayStats];

  const topFantasy = sortByDesc(allStats, (player) => player.fantasyPoints);
  const topHitter = sortByDesc(
    allStats,
    (player) => player.hits * 4 + player.homeRuns * 3 + player.runsBattedIn + player.runs,
  );
  const topPitcher = sortByDesc(
    allStats,
    (player) => player.inningsPitched * 3 + player.pitchingStrikeouts * 2 - player.earnedRuns,
  );
  const topRunProducer = sortByDesc(allStats, (player) => player.runsBattedIn);
  const topPowerBat = sortByDesc(allStats, (player) => player.homeRuns);

  return {
    gameId,
    sport: "MLB",
    homeTeam: {
      players: homeStats,
      totals: homeStats.length > 0 ? calculateMlbTeamTotals(homeStats) : null,
    },
    awayTeam: {
      players: awayStats,
      totals: awayStats.length > 0 ? calculateMlbTeamTotals(awayStats) : null,
    },
    topPerformers:
      allStats.length > 0
        ? {
            topFantasy: summarizeMlbPerformer(topFantasy),
            topHitter: summarizeMlbPerformer(topHitter),
            topPitcher: summarizeMlbPerformer(topPitcher),
            topRunProducer: summarizeMlbPerformer(topRunProducer),
            topPowerBat: summarizeMlbPerformer(topPowerBat),
          }
        : null,
  };
};

const buildBasketballGameStatsPayload = (gameId: string, rows: GameStatsPlayerRow[]) => {
  const homeStats = rows.filter((row) => row.homeAway === "home");
  const awayStats = rows.filter((row) => row.homeAway === "away");

  const calculateTeamTotals = (teamStats: GameStatsPlayerRow[]) => ({
    points: teamStats.reduce((sum, stat) => sum + stat.points, 0),
    rebounds: teamStats.reduce((sum, stat) => sum + stat.rebounds, 0),
    assists: teamStats.reduce((sum, stat) => sum + stat.assists, 0),
    steals: teamStats.reduce((sum, stat) => sum + stat.steals, 0),
    blocks: teamStats.reduce((sum, stat) => sum + stat.blocks, 0),
    turnovers: teamStats.reduce((sum, stat) => sum + stat.turnovers, 0),
  });

  const allStats = [...homeStats, ...awayStats];
  const topScorer = sortByDesc(allStats, (stat) => stat.points);
  const topRebounder = sortByDesc(allStats, (stat) => stat.rebounds);
  const topAssister = sortByDesc(allStats, (stat) => stat.assists);

  return {
    gameId,
    sport: rows[0]?.sport || "NBA",
    homeTeam: {
      players: homeStats,
      totals: homeStats.length > 0 ? calculateTeamTotals(homeStats) : null,
    },
    awayTeam: {
      players: awayStats,
      totals: awayStats.length > 0 ? calculateTeamTotals(awayStats) : null,
    },
    topPerformers:
      allStats.length > 0
        ? {
            topScorer,
            topRebounder,
            topAssister,
          }
        : null,
  };
};

export function buildGameStatsPayload(gameId: string, rows: GameStatsPlayerRow[]) {
  const isMlb =
    rows.some((row) => String(row.sport || "").toUpperCase() === "MLB") ||
    gameId.startsWith("mlb_");
  return isMlb
    ? buildMlbGameStatsPayload(gameId, rows)
    : buildBasketballGameStatsPayload(gameId, rows);
}

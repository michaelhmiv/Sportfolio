export interface GameInsightLeader {
  playerId: string;
  name: string;
  team: string;
  avgFantasyPointsPerGame: number;
  totalShares: number;
  scoutCount: number;
}

export interface GameInsightSlatePlayer {
  playerId: string;
  name: string;
  team: string;
  gameId: string;
  startTime: string;
  status: "scheduled" | "inprogress" | "completed" | "postponed";
  contextLabel: string;
  pregameValue: number | null;
  liveValue: number | null;
  finalValue: number | null;
}

export interface GameInsightUserContextPlayer {
  playerId: string;
  name: string;
  team: string;
  availableShares: number;
  totalShares: number;
  isBoosted: boolean;
}

export interface GameInsightUserContext {
  eligibleCount: number;
  ownedPlayers: GameInsightUserContextPlayer[];
  liveEarned?: number | null;
  earningsStatus?: "scheduled" | "inprogress" | "completed" | "postponed";
}

export interface GameInsightMlbProbablePitcher {
  name: string;
  note: string | null;
  team: string;
}

export interface GameInsightMlbPitcherStats {
  name: string;
  statYear: number;
  plateAppearances: number | null;
  era: number | null;
  xera: number | null;
  woba: number | null;
  expectedWoba: number | null;
  battingAverage: number | null;
  expectedBattingAverage: number | null;
  slugging: number | null;
  expectedSlugging: number | null;
  summary: string;
}

export interface GameInsightMlbHitterSpotlight {
  slot: number;
  name: string;
  team: string;
  position: string | null;
  statYear: number;
  plateAppearances: number | null;
  woba: number | null;
  expectedWoba: number | null;
  battingAverage: number | null;
  expectedBattingAverage: number | null;
  slugging: number | null;
  expectedSlugging: number | null;
  summary: string;
}

export interface GameInsightMlbGameState {
  detailedStatus: string | null;
  inningState: string | null;
  inningLabel: string | null;
  countSummary: string | null;
  weatherSummary: string | null;
  attendance: number | null;
  decisions: {
    winner: string | null;
    loser: string | null;
    save: string | null;
  } | null;
  linescore: {
    innings: Array<{
      num: number;
      away: number | null;
      home: number | null;
    }>;
    totals: {
      awayRuns: number | null;
      homeRuns: number | null;
      awayHits: number | null;
      homeHits: number | null;
      awayErrors: number | null;
      homeErrors: number | null;
    };
  } | null;
}

export interface GameInsightMlbScoringPlay {
  inningLabel: string | null;
  battingTeam: string | null;
  event: string | null;
  description: string;
  scoreLabel: string | null;
}

export interface GameInsightMlbLineupEntry {
  slot: number;
  playerId: string | null;
  name: string;
  position: string | null;
  jerseyNumber: string | null;
}

export interface GameInsightMlbTeamContext {
  record: string | null;
  lastGameSummary: string | null;
  nextGameSummary: string | null;
}

export interface GameInsightMlbEnrichment {
  state: "available" | "pending" | "unavailable";
  message: string | null;
}

export type GameInsightMlbSignalCategory =
  | "lineup"
  | "pitcher"
  | "statcast"
  | "market"
  | "weather"
  | "team"
  | "scoring"
  | "game_state";

export type GameInsightMlbSignalSeverity = "info" | "positive" | "warning" | "high";

export interface GameInsightMlbSignal {
  id: string;
  gameId: string;
  playerId?: string;
  team?: string;
  category: GameInsightMlbSignalCategory;
  severity: GameInsightMlbSignalSeverity;
  label: string;
  detail: string;
  scoreImpact?: number;
}

export interface GameInsightMlbPregame {
  matchupSummary: string | null;
  venue: string | null;
  gameNumber: number | null;
  broadcasts: string[];
  weatherSummary: string | null;
  attendance: number | null;
  probablePitchers: {
    away: GameInsightMlbProbablePitcher | null;
    home: GameInsightMlbProbablePitcher | null;
  };
  probablePitcherStats: {
    away: GameInsightMlbPitcherStats | null;
    home: GameInsightMlbPitcherStats | null;
  };
  advancedStatsAvailable: boolean;
  statYear: number | null;
  doubleheader: boolean;
  lineupsPosted: boolean;
  startingLineups: {
    away: GameInsightMlbLineupEntry[];
    home: GameInsightMlbLineupEntry[];
  };
  hitterSpotlights: {
    away: GameInsightMlbHitterSpotlight[];
    home: GameInsightMlbHitterSpotlight[];
  };
  hitterMatchupNotes: {
    away: string | null;
    home: string | null;
  };
  lineupSignals: {
    away: string | null;
    home: string | null;
  };
  teamContexts: {
    away: GameInsightMlbTeamContext | null;
    home: GameInsightMlbTeamContext | null;
  };
  scoringPlays: GameInsightMlbScoringPlay[];
  gameState: GameInsightMlbGameState | null;
}

export interface GameInsight {
  gameId: string;
  sport: string;
  gameDay: string;
  status: string;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  leaders: {
    fantasy: GameInsightLeader | null;
    shares: GameInsightLeader | null;
    scouts: GameInsightLeader | null;
  };
  userContext: GameInsightUserContext | null;
  liveMarketStatus?: string | null;
  mlbEnrichment?: GameInsightMlbEnrichment | null;
  mlbPregame?: GameInsightMlbPregame | null;
  mlbSignals?: GameInsightMlbSignal[];
}

export interface GameInsightsResponse {
  date: string;
  sport: string;
  boostSlotsRemaining: number | null;
  games: GameInsight[];
  slatePlayers: GameInsightSlatePlayer[];
}

export interface GameInsightDetailResponse {
  date: string;
  sport: string;
  boostSlotsRemaining: number | null;
  game: GameInsight;
  leaders: GameInsight["leaders"];
  topPlayers: {
    fantasy: GameInsightLeader[];
    shares: GameInsightLeader[];
    scouts: GameInsightLeader[];
  };
  injuries: Array<{
    playerId: string;
    name: string;
    team: string;
    status: string;
    description: string | null;
    returnDate: string | null;
  }>;
  userContext: GameInsightUserContext | null;
}

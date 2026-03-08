export interface GameInsightLeader {
  playerId: string;
  name: string;
  team: string;
  avgFantasyPointsPerGame: number;
  totalShares: number;
  scoutCount: number;
}

export interface GameInsightUserContextPlayer {
  playerId: string;
  name: string;
  team: string;
  multiplier: number;
  availableShares: number;
  totalShares: number;
  isBoosted: boolean;
}

export interface GameInsightUserContext {
  eligibleCount: number;
  topMultiplierPlayers: GameInsightUserContextPlayer[];
  ownedPlayers: GameInsightUserContextPlayer[];
  liveEarned?: number | null;
  earningsStatus?: "scheduled" | "inprogress" | "completed" | "postponed";
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
}

export interface GameInsightsResponse {
  date: string;
  sport: string;
  boostSlotsRemaining: number | null;
  games: GameInsight[];
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

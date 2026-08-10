export const ANALYTICS_TIME_RANGES = ["1d", "7d", "30d", "90d"] as const;
export type AnalyticsTimeRange = (typeof ANALYTICS_TIME_RANGES)[number];

export type MarketSnapshotHealth = {
  latestSnapshot: string | null;
  expectedSnapshot: string;
  snapshotCount: number;
  missingDates: string[];
  isPartial: boolean;
  valuationVersion: string | null;
  dataThrough: string;
};

export type MarketBreadth = {
  risers: number;
  fallers: number;
  flat: number;
  advancingPercent: number;
};

export type MarketSupplyFlow = {
  scope: "ALL";
  sharesScouted: number;
  sharesVested: number;
  sharesBurned: number;
  netIssuance: number;
  netIssuanceRate: number | null;
};

export type MarketOverviewSport = {
  sport: string;
  marketCap: number;
  tvl: number;
  volume: number;
  trades: number;
  pricedMarkets: number;
  periodReturnPct: number;
  turnover: number;
  netFlow: number;
};

export type MarketOverview = {
  summary: string;
  scope: {
    sport: string;
    timeRange: AnalyticsTimeRange;
    startDate: string;
    endDate: string;
  };
  valuationVersion: string;
  marketCap: number;
  tvl: number;
  volume: number;
  trades: number;
  activeTradedMarkets: number;
  pricedMarkets: number;
  unpricedMarkets: number;
  periodReturnPct: number;
  turnover: number;
  liquidityUtilization: number;
  buyNotional: number;
  sellNotional: number;
  peerNotional: number;
  netFlow: number;
  averageTradeSize: number;
  medianTradeSize: number;
  whaleVolume: number;
  thinPoolPercent: number;
  top10MarketCapShare: number;
  breadth: MarketBreadth;
  supply: MarketSupplyFlow | null;
  sports: MarketOverviewSport[];
  snapshotHealth: MarketSnapshotHealth;
  generatedAt: string;
};

export type MarketScreenerRow = {
  playerId: string;
  playerName: string;
  sport: string;
  team: string;
  position: string;
  marketStatus: "priced" | "unpriced";
  price: number | null;
  marketCap: number | null;
  tvl: number | null;
  shareReserve: number | null;
  cashReserve: number | null;
  volume: number;
  trades: number;
  buyNotional: number;
  sellNotional: number;
  peerNotional: number;
  whaleVolume: number;
  netFlow: number;
  turnover: number | null;
  liquidityUtilization: number | null;
  return1d: number | null;
  return7d: number | null;
  return30d: number | null;
  periodReturnPct: number | null;
  buyDepth5Pct: number | null;
  sellDepth5Pct: number | null;
  thinPool: boolean;
};

export type MarketSeriesPoint = {
  date: string;
  indexValue: number;
  dailyReturnPct: number;
  volume: number;
  trades: number;
  activeMarkets: number;
  buyNotional: number;
  sellNotional: number;
  netFlow: number;
};

export type MarketSeries = {
  summary: string;
  sport: string;
  timeRange: AnalyticsTimeRange;
  methodology: "equal_weight_traded_markets_v1";
  baseValue: 100;
  points: MarketSeriesPoint[];
  generatedAt: string;
};

export type MarketCorrelation = {
  player1Id: string;
  player1Name: string;
  player2Id: string;
  player2Name: string;
  correlation: number;
  sampleCount: number;
};

export type MarketTapeItem = {
  id: string;
  timestamp: string;
  playerId: string;
  playerName: string;
  sport: string;
  team: string;
  side: "buy" | "sell" | "peer";
  quantity: number;
  price: number;
  notional: number;
  currentPrice: number | null;
  spotMovePct: number | null;
  isWhale: boolean;
};

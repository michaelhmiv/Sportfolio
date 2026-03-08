export interface CompareRadarPlayer {
  id: string;
  price: number;
  shares: number;
  marketCap: number;
  ammVolume: number;
  poolLiquidity: number;
  boostUsagePercent: number;
}

export interface CompareRadarDatum {
  key: string;
  label: string;
  fullMark: number;
  [playerId: string]: string | number;
}

export interface CorrelationPair {
  correlation: number;
  player1: string;
  player1Id: string;
  player2: string;
  player2Id: string;
}

export interface AnalyticsPlayerSport {
  sport?: string | null;
}

const COMPARE_RADAR_METRICS: Array<{
  key: string;
  label: string;
  getValue: (player: CompareRadarPlayer) => number;
}> = [
  { key: "price", label: "Price", getValue: (player) => player.price },
  { key: "shares", label: "Shares", getValue: (player) => player.shares },
  { key: "marketCap", label: "Market Cap", getValue: (player) => player.marketCap },
  { key: "ammVolume", label: "AMM Vol", getValue: (player) => player.ammVolume },
  { key: "poolLiquidity", label: "Liquidity", getValue: (player) => player.poolLiquidity },
  { key: "boostUsagePercent", label: "Boost %", getValue: (player) => player.boostUsagePercent },
];

export function buildCompareRadarData(players: CompareRadarPlayer[]): CompareRadarDatum[] {
  return COMPARE_RADAR_METRICS.map((metric) => {
    const values = players.map((player) => metric.getValue(player));
    const maxValue = Math.max(...values, 0);
    const datum: CompareRadarDatum = {
      key: metric.key,
      label: metric.label,
      fullMark: 100,
    };

    for (const player of players) {
      const rawValue = metric.getValue(player);
      datum[player.id] = maxValue > 0 ? Math.round((rawValue / maxValue) * 100) : 0;
    }

    return datum;
  });
}

export function getCorrelationPairKey(pair: Pick<CorrelationPair, "player1Id" | "player2Id">) {
  return [pair.player1Id, pair.player2Id].sort().join(":");
}

export function filterCorrelationsBySport(
  pairs: CorrelationPair[],
  playerById: Record<string, AnalyticsPlayerSport | undefined>,
  selectedSport: string,
) {
  if (selectedSport === "ALL") {
    return pairs;
  }

  return pairs.filter((pair) => {
    const player1Sport = playerById[pair.player1Id]?.sport?.toUpperCase();
    const player2Sport = playerById[pair.player2Id]?.sport?.toUpperCase();

    if (!player1Sport || !player2Sport) {
      return false;
    }

    return player1Sport === selectedSport && player2Sport === selectedSport;
  });
}

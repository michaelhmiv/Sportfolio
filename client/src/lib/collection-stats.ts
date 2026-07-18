/** Map raw stat keys to human-readable display labels. */
const STAT_LABELS: Record<string, string> = {
  homeRuns: "HR",
  rbi: "RBI",
  ops: "OPS",
  onBasePlusSlugging: "OPS",
  strikeOuts: "K",
  strikeouts: "K",
  earnedRunAverage: "ERA",
  era: "ERA",
  saves: "SV",
  stolenBases: "SB",
  battingAverage: "AVG",
  hits: "H",
  runs: "R",
  walks: "BB",
  runsBattedIn: "RBI",
  inningsPitched: "IP",
  pitchingStrikeouts: "K",
  wins: "W",
  onBasePercentage: "OBP",
  sluggingPercentage: "SLG",
  whip: "WHIP",
};

export function formatStatLabel(statKey: string | null): string | null {
  if (!statKey) return null;
  return STAT_LABELS[statKey] ?? statKey;
}

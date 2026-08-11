import {
  ECONOMY_VERSION,
  type EconomyClass,
  type EconomySeasonPhase,
  getFantasyPointBenchmark,
  getSeasonTargetSb,
} from "./config";

export interface GameEarningsMathInput {
  fantasyPoints: number;
  eligibleSingles: number;
  economyClass: EconomyClass;
  seasonPhase: EconomySeasonPhase;
}

export interface GameEarningsMathResult {
  economyVersion: typeof ECONOMY_VERSION;
  fantasyPoints: number;
  positiveFantasyPoints: number;
  eligibleSingles: number;
  seasonTargetSb: number;
  benchmarkFantasyPoints: number;
  sbPerFantasyPoint: number;
  gameBasePoolSb: number;
  gameEpsSb: number;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateGameEarnings(input: GameEarningsMathInput): GameEarningsMathResult {
  const positiveFantasyPoints = finiteNonNegative(input.fantasyPoints);
  const eligibleSingles = finiteNonNegative(input.eligibleSingles);
  const seasonTargetSb = getSeasonTargetSb(input.seasonPhase);
  const benchmarkFantasyPoints = getFantasyPointBenchmark(input.economyClass, input.seasonPhase);
  const sbPerFantasyPoint =
    seasonTargetSb > 0 && Number.isFinite(benchmarkFantasyPoints) && benchmarkFantasyPoints > 0
      ? seasonTargetSb / benchmarkFantasyPoints
      : 0;
  const gameBasePoolSb = positiveFantasyPoints * sbPerFantasyPoint;
  const gameEpsSb = eligibleSingles > 0 ? gameBasePoolSb / eligibleSingles : 0;

  return {
    economyVersion: ECONOMY_VERSION,
    fantasyPoints: Number.isFinite(input.fantasyPoints) ? input.fantasyPoints : 0,
    positiveFantasyPoints,
    eligibleSingles,
    seasonTargetSb,
    benchmarkFantasyPoints,
    sbPerFantasyPoint,
    gameBasePoolSb: eligibleSingles > 0 ? gameBasePoolSb : 0,
    gameEpsSb: eligibleSingles > 0 ? gameEpsSb : 0,
  };
}

export function calculateBaseSharePayout(eligibleShares: number, gameEpsSb: number): number {
  return finiteNonNegative(eligibleShares) * finiteNonNegative(gameEpsSb);
}

export interface BoostPayoutMathInput {
  sharesBurned: number;
  gameEpsSb: number;
  effectiveMultiplier: number;
}

export interface BoostPayoutMathResult {
  sharesBurned: number;
  gameEpsSb: number;
  effectiveMultiplier: number;
  baseComponentSb: number;
  boostBonusSb: number;
  totalEconomicEarningsSb: number;
}

export function calculateBoostPayout(input: BoostPayoutMathInput): BoostPayoutMathResult {
  const sharesBurned = finiteNonNegative(input.sharesBurned);
  const gameEpsSb = finiteNonNegative(input.gameEpsSb);
  const effectiveMultiplier = Math.max(
    1,
    Number.isFinite(input.effectiveMultiplier) ? input.effectiveMultiplier : 1,
  );
  const baseComponentSb = sharesBurned * gameEpsSb;
  const boostBonusSb = baseComponentSb * (effectiveMultiplier - 1);

  return {
    sharesBurned,
    gameEpsSb,
    effectiveMultiplier,
    baseComponentSb,
    boostBonusSb,
    totalEconomicEarningsSb: baseComponentSb + boostBonusSb,
  };
}

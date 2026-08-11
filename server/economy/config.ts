// Economy V2 intentionally keeps monetary policy centralized: the two season targets below are
// the primary payout controls; sport/position differences are calibration data, not extra faucets.
export const ECONOMY_VERSION = "economy-v2" as const;
export const REGULAR_SEASON_TARGET_SB = 10_000;
export const POSTSEASON_TARGET_SB = 10_000;
export const BOOST_SLOT_MULTIPLIERS = [2, 3, 5, 7, 10] as const;

export type BoostSlotMultiplier = (typeof BOOST_SLOT_MULTIPLIERS)[number];
export type EconomySeasonPhase = "preseason" | "regular" | "postseason";

export type EconomyClass =
  | "MLB_HITTER"
  | "MLB_STARTING_PITCHER"
  | "MLB_RELIEVER"
  | "NFL_QB"
  | "NFL_RB"
  | "NFL_WR"
  | "NFL_TE"
  | "NFL_K"
  | "NHL_SKATER"
  | "NHL_GOALIE"
  | "NASCAR_CUP"
  | "NASCAR_XFINITY"
  | "NASCAR_TRUCKS";

export const REGULAR_SEASON_FP_BENCHMARKS: Readonly<Record<EconomyClass, number>> = {
  MLB_HITTER: 1000,
  MLB_STARTING_PITCHER: 750,
  MLB_RELIEVER: 350,
  NFL_QB: 350,
  NFL_RB: 250,
  NFL_WR: 250,
  NFL_TE: 180,
  NFL_K: 150,
  NHL_SKATER: 600,
  NHL_GOALIE: 500,
  NASCAR_CUP: 2500,
  NASCAR_XFINITY: 2200,
  NASCAR_TRUCKS: 2000,
};

export const POSTSEASON_FP_BENCHMARKS: Readonly<Record<EconomyClass, number>> = {
  MLB_HITTER: 140,
  MLB_STARTING_PITCHER: 100,
  MLB_RELIEVER: 60,
  NFL_QB: 100,
  NFL_RB: 70,
  NFL_WR: 70,
  NFL_TE: 50,
  NFL_K: 45,
  NHL_SKATER: 125,
  NHL_GOALIE: 100,
  NASCAR_CUP: 700,
  NASCAR_XFINITY: 600,
  NASCAR_TRUCKS: 550,
};

export interface EconomyClassInput {
  sport: string | null | undefined;
  position?: string | null;
  statsJson?: unknown;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function statsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveEconomyClass(input: EconomyClassInput): EconomyClass | null {
  const sport = normalized(input.sport);
  const position = normalized(input.position);

  if (sport === "MLB") {
    if (["RP", "CP", "CL", "RELIEF", "RELIEVER"].includes(position)) return "MLB_RELIEVER";
    if (["P", "SP", "PITCHER", "STARTER", "STARTING PITCHER"].includes(position)) {
      return "MLB_STARTING_PITCHER";
    }
    return "MLB_HITTER";
  }

  if (sport === "NFL") {
    if (position === "QB") return "NFL_QB";
    if (position === "RB" || position === "FB") return "NFL_RB";
    if (position === "WR") return "NFL_WR";
    if (position === "TE") return "NFL_TE";
    if (position === "K" || position === "PK") return "NFL_K";
    return null;
  }

  if (sport === "NHL") {
    return position === "G" || position === "GOALIE" ? "NHL_GOALIE" : "NHL_SKATER";
  }

  if (sport === "NASCAR") {
    const stats = statsRecord(input.statsJson);
    const seriesRaw = stats.seriesId ?? stats.series_id ?? stats.series ?? stats.seriesName;
    const seriesNumber = Number(seriesRaw);
    const seriesText = normalized(seriesRaw);
    if (seriesNumber === 3 || seriesText.includes("TRUCK")) return "NASCAR_TRUCKS";
    if (seriesNumber === 2 || seriesText.includes("XFINITY")) return "NASCAR_XFINITY";
    return "NASCAR_CUP";
  }

  return null;
}

export interface SeasonPhaseInput {
  seasonType?: string | null;
  statsSeason?: string | null;
  gameType?: string | null;
}

export function resolveEconomySeasonPhase(input: SeasonPhaseInput): EconomySeasonPhase {
  const combined = [input.seasonType, input.statsSeason, input.gameType]
    .map((value) => normalized(value))
    .filter(Boolean)
    .join(" ");

  if (/PRESEASON|PRE-SEASON|EXHIBITION|SPRING TRAINING|SPRING_TRAINING/.test(combined)) {
    return "preseason";
  }
  if (
    /POSTSEASON|POST-SEASON|PLAYOFF|WILD CARD|DIVISION|CHAMPIONSHIP|WORLD SERIES|SUPER BOWL/.test(
      combined,
    )
  ) {
    return "postseason";
  }
  return "regular";
}

export function getSeasonTargetSb(phase: EconomySeasonPhase): number {
  if (phase === "preseason") return 0;
  return phase === "postseason" ? POSTSEASON_TARGET_SB : REGULAR_SEASON_TARGET_SB;
}

export function getFantasyPointBenchmark(
  economyClass: EconomyClass,
  phase: EconomySeasonPhase,
): number {
  if (phase === "preseason") return Number.POSITIVE_INFINITY;
  return phase === "postseason"
    ? POSTSEASON_FP_BENCHMARKS[economyClass]
    : REGULAR_SEASON_FP_BENCHMARKS[economyClass];
}

export function isBoostSlotMultiplier(value: number): value is BoostSlotMultiplier {
  return BOOST_SLOT_MULTIPLIERS.includes(value as BoostSlotMultiplier);
}

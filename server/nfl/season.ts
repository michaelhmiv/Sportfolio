export type NflSeasonType = "preseason" | "regular" | "postseason";

export const NFL_SEASON_TYPE_CODE: Record<NflSeasonType, number> = {
  preseason: 1,
  regular: 2,
  postseason: 3,
};

export function normalizeNflSeasonType(value: unknown): NflSeasonType {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "1" || raw === "pre" || raw === "preseason") return "preseason";
  if (raw === "3" || raw === "post" || raw === "postseason" || raw === "playoffs") {
    return "postseason";
  }
  return "regular";
}

/**
 * Client/server fallback only. ESPN season metadata is authoritative when available.
 * The NFL season begins before regular-season kickoff, so July-December belongs to
 * the current season and January-June belongs to the prior season.
 */
export function getNflSeasonYear(date = new Date()): number {
  return date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}

export function isNflGameplayEligibleSeasonType(value: unknown): boolean {
  return normalizeNflSeasonType(value) !== "preseason";
}

export function isNflPreseasonGame(game: { sport?: unknown; seasonType?: unknown }): boolean {
  return (
    String(game.sport ?? "")
      .trim()
      .toUpperCase() === "NFL" && normalizeNflSeasonType(game.seasonType) === "preseason"
  );
}

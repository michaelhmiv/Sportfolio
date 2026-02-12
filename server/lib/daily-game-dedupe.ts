export interface DailyGameLike {
  gameId: string;
  sport?: string | null;
  status?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  lastFetchedAt?: Date | string | null;
}

function normalizeSport(sport: unknown): string {
  return String(sport || "").toUpperCase();
}

function normalizeStatus(status: unknown): string {
  return String(status || "").toLowerCase();
}

function toEpochMs(value: unknown): number {
  if (!value) return 0;
  const d = value instanceof Date ? value : new Date(String(value));
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isLegacyMySportsFeedsNbaGameId(gameId: unknown): boolean {
  return String(gameId || "").startsWith("18447");
}

function legacyScore(game: DailyGameLike): number {
  // Only treat 18447* as legacy for NBA.
  // (Other sports use different ID schemes and should not be affected.)
  if (normalizeSport(game.sport) !== "NBA") return 1;
  return isLegacyMySportsFeedsNbaGameId(game.gameId) ? 0 : 1;
}

function statusScore(game: DailyGameLike): number {
  const s = normalizeStatus(game.status);
  if (s === "completed" || s === "ended" || s === "final") return 3;
  if (s === "inprogress" || s === "in_progress" || s === "live") return 2;
  if (s === "scheduled" || s === "unplayed") return 1;
  if (s === "postponed" || s === "cancelled" || s === "canceled") return 0;
  return 1;
}

function scoresPresentScore(game: DailyGameLike): number {
  // Any non-null score indicates a live/completed feed.
  return game.homeScore != null || game.awayScore != null ? 1 : 0;
}

/**
 * Choose the preferred game record when duplicates exist for the same matchup/time.
 * Primary goal: prefer canonical (non-legacy) NBA game IDs so downstream joins to stats/settlement work.
 */
export function choosePreferredDailyGame<T extends DailyGameLike>(a: T, b: T): T {
  const aLegacy = legacyScore(a);
  const bLegacy = legacyScore(b);
  if (aLegacy !== bLegacy) return aLegacy > bLegacy ? a : b;

  const aStatus = statusScore(a);
  const bStatus = statusScore(b);
  if (aStatus !== bStatus) return aStatus > bStatus ? a : b;

  const aScores = scoresPresentScore(a);
  const bScores = scoresPresentScore(b);
  if (aScores !== bScores) return aScores > bScores ? a : b;

  const aFetched = toEpochMs(a.lastFetchedAt);
  const bFetched = toEpochMs(b.lastFetchedAt);
  if (aFetched !== bFetched) return aFetched > bFetched ? a : b;

  // Stable tie-breakers
  const aLen = String(a.gameId || "").length;
  const bLen = String(b.gameId || "").length;
  if (aLen !== bLen) return aLen < bLen ? a : b;

  return String(a.gameId || "") <= String(b.gameId || "") ? a : b;
}

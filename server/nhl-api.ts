/** Official NHL JSON API client. Server-side only; no credential or Python runtime required. */
export const NHL_API_BASE = "https://api-web.nhle.com/v1";
export const NHL_STATS_API_BASE = "https://api.nhle.com/stats/rest";
export const NHL_TIMEZONE = "America/New_York";

export type NhlDailyStatus = "scheduled" | "inprogress" | "completed" | "postponed";
export interface NhlSeason {
  id: number;
  startDate?: string;
  endDate?: string;
  standingsStart?: string;
  standingsEnd?: string;
}
export interface NhlTeam {
  id: number;
  abbrev: string;
  commonName?: { default?: string };
  placeName?: { default?: string };
  logo?: string;
}
export interface NhlRosterPlayer {
  id: number;
  firstName?: { default?: string };
  lastName?: { default?: string };
  positionCode?: string;
  headshot?: string;
  sweaterNumber?: number;
}
export interface NhlGame {
  id: number;
  gameState?: string;
  gameScheduleState?: string;
  startTimeUTC?: string;
  homeTeam?: { abbrev?: string; score?: number; logo?: string };
  awayTeam?: { abbrev?: string; score?: number; logo?: string };
  venue?: { default?: string };
  periodDescriptor?: { number?: number; periodType?: string };
  clock?: { timeRemaining?: string; inIntermission?: boolean };
}
export interface NhlBoxscore {
  id?: number;
  gameState?: string;
  gameScheduleState?: string;
  homeTeam?: Record<string, unknown>;
  awayTeam?: Record<string, unknown>;
  playerByGameStats?: {
    homeTeam?: {
      forwards?: NhlBoxscorePlayer[];
      defense?: NhlBoxscorePlayer[];
      goalies?: NhlBoxscorePlayer[];
    };
    awayTeam?: {
      forwards?: NhlBoxscorePlayer[];
      defense?: NhlBoxscorePlayer[];
      goalies?: NhlBoxscorePlayer[];
    };
  };
}
export interface NhlBoxscorePlayer {
  playerId: number;
  name?: { default?: string };
  position?: string;
  sweaterNumber?: number;
  goals?: number;
  assists?: number;
  points?: number;
  plusMinus?: number;
  pim?: number;
  hits?: number;
  powerPlayGoals?: number;
  sog?: number;
  faceoffWinningPctg?: number;
  toi?: string;
  blockedShots?: number;
  shifts?: number;
  giveaways?: number;
  takeaways?: number;
  saves?: number;
  shotsAgainst?: number;
  goalsAgainst?: number;
  savePctg?: number;
  starter?: boolean;
  decision?: string;
}

export class NhlApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number | null,
    message: string,
  ) {
    super(`[nhl-api] ${endpoint}: ${message}`);
    this.name = "NhlApiError";
  }
}
type FetchFn = typeof fetch;
type ClientOptions = {
  fetch?: FetchFn;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
  /** Injectable for deterministic retry tests. */
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};
type CacheEntry = { expiresAt: number; value: unknown };

export const createNhlPlayerId = (id: number | string) => `nhl_${id}`;
export const createNhlGameId = (id: number | string) => `nhl_${id}`;
export function formatNhlGameDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NHL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function selectNhlSeason(seasons: NhlSeason[], now = new Date()): string {
  if (!seasons.length) throw new Error("NHL season metadata was empty");
  const today = now.toISOString().slice(0, 10);
  const dates = (season: NhlSeason) => ({
    start: season.startDate || season.standingsStart,
    end: season.endDate || season.standingsEnd,
  });
  const active = seasons.find((season) => {
    const { start, end } = dates(season);
    return start && end && start <= today && end >= today;
  });
  const dated = seasons
    .filter((season) => dates(season).end)
    .sort((a, b) => String(dates(b).end).localeCompare(String(dates(a).end)));
  return String(
    active?.id ??
      dated.find((season) => String(dates(season).end) <= today)?.id ??
      dated[0]?.id ??
      seasons[0].id,
  );
}
export function normalizeNhlGameState(
  state: string | null | undefined,
  existing?: string | null,
): NhlDailyStatus {
  if (existing === "completed") return "completed";
  const value = String(state || "").toUpperCase();
  if (["OFF", "FINAL", "OVER"].includes(value)) return "completed";
  if (["LIVE", "CRIT", "IN_PROGRESS", "INPROGRESS"].includes(value)) return "inprogress";
  if (["PPD", "SUSP", "CANC", "POSTPONED", "SUSPENDED", "CANCELLED"].includes(value))
    return "postponed";
  if (!["FUT", "PRE", "SCHEDULED", ""].includes(value))
    console.warn(`[nhl-api] Unknown game state ${value}; treating conservatively as scheduled`);
  return "scheduled";
}
export function normalizeNhlGame(game: NhlGame, existingStatus?: string | null) {
  if (
    !Number.isSafeInteger(game.id) ||
    !game.startTimeUTC ||
    !game.homeTeam?.abbrev ||
    !game.awayTeam?.abbrev
  )
    throw new Error("NHL game payload is missing identity, teams, or start time");
  return {
    gameId: createNhlGameId(game.id),
    sport: "NHL",
    date: new Date(game.startTimeUTC),
    startTime: new Date(game.startTimeUTC),
    homeTeam: String(game.homeTeam.abbrev).toUpperCase(),
    awayTeam: String(game.awayTeam.abbrev).toUpperCase(),
    homeScore: Number.isFinite(game.homeTeam.score) ? game.homeTeam.score! : null,
    awayScore: Number.isFinite(game.awayTeam.score) ? game.awayTeam.score! : null,
    venue: game.venue?.default || null,
    status: normalizeNhlGameState(game.gameState || game.gameScheduleState, existingStatus),
  } as const;
}

export class NhlApiClient {
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly cacheTtlMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(options: ClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 150;
    this.cacheTtlMs = options.cacheTtlMs ?? 15_000;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }
  private retryDelay(response: Response | null, attempt: number) {
    const retryAfter = response?.headers.get("retry-after");
    const seconds = retryAfter == null || retryAfter.trim() === "" ? Number.NaN : Number(retryAfter);
    const retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
    // Bound provider hints and exponential delays; add at most 25% jitter.
    const base = Math.min(30_000, retryAfterMs ?? this.retryDelayMs * 2 ** attempt);
    return Math.min(30_000, Math.round(base + base * 0.25 * this.random()));
  }
  private async request<T>(path: string, valid: (payload: unknown) => payload is T): Promise<T> {
    const url = `${NHL_API_BASE}${path}`;
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    const inFlight = this.pending.get(url);
    if (inFlight) return inFlight as Promise<T>;
    const operation = (async () => {
      let last: unknown;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await this.fetchFn(url, {
            signal: controller.signal,
            headers: { accept: "application/json", "user-agent": "Sportfolio/1.0" },
          });
          if (!response.ok) {
            const message = `HTTP ${response.status}`;
            const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
            if (!retryable || attempt === this.maxRetries)
              throw new NhlApiError(path, response.status, message);
            last = new NhlApiError(path, response.status, message);
            await this.sleep(this.retryDelay(response, attempt));
            continue;
          } else {
            const payload: unknown = await response.json();
            if (!valid(payload)) throw new NhlApiError(path, response.status, "malformed response");
            this.cache.set(url, { value: payload, expiresAt: Date.now() + this.cacheTtlMs });
            return payload;
          }
        } catch (error) {
          if (
            error instanceof NhlApiError &&
            error.status !== null &&
            ![408, 429, 500, 502, 503, 504].includes(error.status)
          )
            throw error;
          last = error;
          if (attempt === this.maxRetries) break;
          await this.sleep(this.retryDelay(null, attempt));
        } finally {
          clearTimeout(timer);
        }
      }
      throw last instanceof NhlApiError
        ? last
        : new NhlApiError(path, null, last instanceof Error ? last.message : "request failed");
    })();
    this.pending.set(url, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(url);
    }
  }
  getSeasons() {
    return this.request<{ seasons: NhlSeason[] }>(
      "/standings-season",
      (value): value is { seasons: NhlSeason[] } =>
        !!value && typeof value === "object" && Array.isArray((value as any).seasons),
    ).then((payload) => payload.seasons);
  }
  getStandings(date = "now") {
    return this.request<{ standings: NhlTeam[] }>(
      `/standings/${date}`,
      (value): value is { standings: NhlTeam[] } =>
        !!value && typeof value === "object" && Array.isArray((value as any).standings),
    );
  }
  getRoster(team: string, season: string) {
    return this.request<{
      forwards: NhlRosterPlayer[];
      defensemen: NhlRosterPlayer[];
      goalies: NhlRosterPlayer[];
    }>(
      `/roster/${encodeURIComponent(team)}/${encodeURIComponent(season)}`,
      (value): value is any =>
        !!value &&
        typeof value === "object" &&
        Array.isArray((value as any).forwards) &&
        Array.isArray((value as any).defensemen) &&
        Array.isArray((value as any).goalies),
    );
  }
  getSchedule(date: string) {
    return this.request<{ gameWeek: Array<{ games: NhlGame[] }> }>(
      `/schedule/${date}`,
      (value): value is any =>
        !!value && typeof value === "object" && Array.isArray((value as any).gameWeek),
    );
  }
  getScore(date = "now") {
    return this.request<{ games: NhlGame[] }>(
      `/score/${date}`,
      (value): value is any =>
        !!value && typeof value === "object" && Array.isArray((value as any).games),
    );
  }
  getBoxscore(gameId: number | string) {
    return this.request<NhlBoxscore>(
      `/gamecenter/${encodeURIComponent(String(gameId))}/boxscore`,
      (value): value is NhlBoxscore =>
        !!value && typeof value === "object" && !!(value as any).playerByGameStats,
    );
  }
  getPlayByPlay(gameId: number | string) {
    return this.request<{ plays: unknown[] }>(
      `/gamecenter/${encodeURIComponent(String(gameId))}/play-by-play`,
      (value): value is any =>
        !!value && typeof value === "object" && Array.isArray((value as any).plays),
    );
  }
}
export const nhlApi = new NhlApiClient();

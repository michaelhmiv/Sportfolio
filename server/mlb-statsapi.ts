/**
 * MLB StatsAPI Client
 *
 * No-auth public client for the official MLB StatsAPI (https://statsapi.mlb.com).
 * Replaces Ball Don't Lie MLB ingestion entirely.
 *
 * MLB StatsAPI is a public REST API requiring no API key.
 * Rate limiting is generous; we apply a simple inter-request delay as courtesy.
 *
 * Player ID identity: MLBAM ID (the numeric ID used throughout statsapi.mlb.com).
 * Canonical player ID format: mlb_<MLBAM_ID> (e.g. "mlb_660271" for Shohei Ohtani).
 *
 * Key endpoints:
 *   /api/v1/sports/1/players?season={year}       — All MLB players for a season
 *   /api/v1/schedule?season={year}&sportId=1      — Game schedule/scoreboard
 *   /api/v1/game/{gamePk}/boxscore                — Boxscore (per-game player stats)
 *   /api/v1/game/{gamePk}/linescore               — Current game state
 *   /api/v1/teams?sportIds=1                      — All MLB teams
 *   /api/v1/teams/{teamId}/roster?season={year}   — Team roster
 *   /api/v1/people/{playerId}/stats?stats=season  — Season stats for a player
 */

// ─── Rate Limiting ───────────────────────────────────────────────────────────
const MIN_REQUEST_INTERVAL_MS = 200; // 5 req/s courtesy throttle
let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

// ─── Base URL ────────────────────────────────────────────────────────────────
const API_BASE = "https://statsapi.mlb.com/api/v1";

// ─── Generic Fetch ───────────────────────────────────────────────────────────
export class MlbStatsApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "MlbStatsApiError";
  }
}

async function apiFetch<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  await rateLimit();

  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new MlbStatsApiError(
      `MLB StatsAPI returned ${response.status} for ${path}`,
      response.status,
      path,
    );
  }

  return (await response.json()) as T;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MlbTeam {
  id: number;
  name: string;
  teamName: string;
  locationName: string;
  abbreviation: string;
  league?: { id: number; name: string };
  division?: { id: number; name: string };
  shortName?: string;
  franchiseName?: string;
}

export interface MlbPlayer {
  id: number; // MLBAM ID
  fullName: string;
  firstName: string;
  lastName: string;
  primaryNumber?: string;
  primaryPosition?: {
    code: string;
    name: string;
    type: string;
    abbreviation: string;
  };
  primaryStat?: string;
  batSide?: { code: string; description: string };
  pitchHand?: { code: string; description: string };
  useName?: string;
  boxscoreName?: string;
  nickName?: string;
  mlbDebutDate?: string;
  birthDate?: string;
  birthCity?: string;
  birthStateProvince?: string;
  birthCountry?: string;
  height?: string;
  weight?: number;
  active?: boolean;
  currentTeam?: {
    id: number;
    name: string;
    abbreviation: string;
  };
}

export interface MlbRosterEntry {
  person: { id: number; fullName: string };
  jerseyNumber: string;
  position: {
    code: string;
    name: string;
    type: string;
    abbreviation: string;
  };
  status?: {
    code: string;
    description: string;
  };
}

export interface MlbGame {
  gamePk: number;
  gameDate: string;
  status: {
    abstractGameState: string;
    codedGameState: string;
    detailedState: string;
    statusCode: string;
    startTimeTBD: boolean;
    reason?: string;
  };
  teams: {
    away: {
      team: { id: number; name: string; abbreviation: string };
      score: number | null;
      isWinner: boolean;
      leagueRecord?: { wins: number; losses: number };
    };
    home: {
      team: { id: number; name: string; abbreviation: string };
      score: number | null;
      isWinner: boolean;
      leagueRecord?: { wins: number; losses: number };
    };
  };
  venue?: {
    id: number;
    name: string;
  };
  content?: {
    link: string;
  };
  seriesDescription?: string;
  doubleHeader?: string;
}

export interface MlbBoxscoreTeam {
  team: {
    id: number;
    name: string;
    abbreviation: string;
  };
  teamStats: {
    batting: Record<string, number>;
    pitching: Record<string, number>;
    fielding: Record<string, number>;
  };
  players: Record<string, MlbBoxscorePlayer>;
}

export interface MlbBoxscorePlayer {
  person: { id: number; fullName: string };
  jerseyNumber: string;
  position: {
    code: string;
    name: string;
    type: string;
    abbreviation: string;
  };
  stats: {
    batting?: Record<string, number | null>;
    pitching?: Record<string, number | null>;
    fielding?: Record<string, number | null>;
  };
  seasonStats?: {
    batting?: Record<string, number | null>;
    pitching?: Record<string, number | null>;
  };
  gameStatus?: {
    isCurrentBatter: boolean;
    isCurrentPitcher: boolean;
    isOnBench: boolean;
    isSubstitute: boolean;
  };
  batOrder?: string;
}

export interface MlbBoxscore {
  teams: {
    away: MlbBoxscoreTeam;
    home: MlbBoxscoreTeam;
  };
  linescore: MlbLinescore;
}

export interface MlbLinescore {
  currentInning?: number;
  currentInningOrdinal?: string;
  inningState?: string;
  inningHalf?: string;
  isTopInning?: boolean;
  scheduledInnings?: number;
  innings?: Array<{
    num: number;
    ordinalNum: string;
    home: { runs: number; hits: number; errors: number };
    away: { runs: number; hits: number; errors: number };
  }>;
  teams: {
    home: { runs: number; hits: number; errors: number };
    away: { runs: number; hits: number; errors: number };
  };
  defense?: {
    pitcher?: { id: number; fullName: string };
    catcher?: { id: number; fullName: string };
    first?: { id: number; fullName: string };
    second?: { id: number; fullName: string };
    third?: { id: number; fullName: string };
    shortstop?: { id: number; fullName: string };
    left?: { id: number; fullName: string };
    center?: { id: number; fullName: string };
    right?: { id: number; fullName: string };
  };
  offense?: {
    batter?: { id: number; fullName: string };
    onDeck?: { id: number; fullName: string };
    inHole?: { id: number; fullName: string };
  };
}

export interface MlbScheduleResponse {
  totalGames: number;
  dates: Array<{
    date: string;
    totalGames: number;
    games: MlbGame[];
  }>;
}

export interface MlbPlayersResponse {
  roster: MlbRosterEntry[];
  link: string;
  teamId?: number;
}

export interface MlbPeopleResponse {
  people: MlbPlayer[];
}

export interface MlbTeamsResponse {
  teams: MlbTeam[];
}

// ─── Fantasy Scoring Helpers ─────────────────────────────────────────────────

export interface FantasyScore {
  points: number;
  breakdown: {
    singles: number;
    doubles: number;
    triples: number;
    homeRuns: number;
    runs: number;
    rbi: number;
    walks: number;
    hitByPitch: number;
    stolenBases: number;
    strikeoutsBatting: number;
    inningsPitched: number;
    pitchingStrikeouts: number;
    wins: number;
    saves: number;
    earnedRuns: number;
    runsAllowed: number;
    hitsAllowed: number;
    walksAllowed: number;
  };
}

function statValue(stats: Record<string, number | string | null> | undefined, key: string): number {
  if (!stats) return 0;
  const v = stats[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    if (key === "inningsPitched") {
      const [wholeRaw, outsRaw = "0"] = v.split(".");
      const whole = Number(wholeRaw);
      const outs = Number(outsRaw);
      if (Number.isFinite(whole) && Number.isFinite(outs)) {
        return whole + Math.min(Math.max(outs, 0), 2) / 3;
      }
    }
    const numeric = Number(v);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
}

/**
 * Calculate fantasy points from MLB StatsAPI boxscore player stats.
 * Scoring mirrors the standard MLB fantasy points calculation.
 */
export function calculateFantasyPoints(stats: {
  batting?: Record<string, number | string | null>;
  pitching?: Record<string, number | string | null>;
}): FantasyScore {
  const batting = stats.batting || {};
  const pitching = stats.pitching || {};

  const hits = statValue(batting, "hits");
  const doubles = statValue(batting, "doubles");
  const triples = statValue(batting, "triples");
  const homeRuns = statValue(batting, "homeRuns");
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const runs = statValue(batting, "runs");
  const rbi = statValue(batting, "rbi");
  const walks = statValue(batting, "baseOnBalls");
  const hitByPitch = statValue(batting, "hitByPitch");
  const stolenBases = statValue(batting, "stolenBases");
  const strikeouts = statValue(batting, "strikeOuts");

  const ip = statValue(pitching, "inningsPitched");
  const pitchingStrikeouts = statValue(pitching, "strikeOuts");
  const wins = statValue(pitching, "wins");
  const saves = statValue(pitching, "saves");
  const earnedRuns = statValue(pitching, "earnedRuns");
  const hitsAllowed = statValue(pitching, "hits");
  const walksAllowed = statValue(pitching, "baseOnBalls");
  const runsAllowed = statValue(pitching, "runs");

  let points = 0;
  points += singles * 3;
  points += doubles * 5;
  points += triples * 8;
  points += homeRuns * 10;
  points += runs * 2;
  points += rbi * 2;
  points += walks * 2;
  points += hitByPitch * 2;
  points += stolenBases * 5;
  points += strikeouts * -0.5;

  points += ip * 2.25;
  points += pitchingStrikeouts * 2;
  points += wins * 4;
  points += saves * 5;
  points += earnedRuns * -2;
  points += runsAllowed * -0.5;
  points += hitsAllowed * -0.6;
  points += walksAllowed * -0.6;

  return {
    points: parseFloat(points.toFixed(2)),
    breakdown: {
      singles,
      doubles,
      triples,
      homeRuns,
      runs,
      rbi,
      walks,
      hitByPitch,
      stolenBases,
      strikeoutsBatting: strikeouts,
      inningsPitched: ip,
      pitchingStrikeouts,
      wins,
      saves,
      earnedRuns,
      runsAllowed,
      hitsAllowed,
      walksAllowed,
    },
  };
}

// ─── API Functions ───────────────────────────────────────────────────────────

/**
 * Normalize the MLB StatsAPI game status into a standard status string.
 */
export function normalizeGameStatus(gameOrStatus: MlbGame | string): string {
  const state =
    typeof gameOrStatus === "string"
      ? gameOrStatus.toLowerCase()
      : gameOrStatus.status.abstractGameState?.toLowerCase() || "";
  const detail =
    typeof gameOrStatus === "string"
      ? gameOrStatus.toLowerCase()
      : gameOrStatus.status.detailedState?.toLowerCase() || "";

  if (
    detail.includes("postponed") ||
    detail.includes("delayed") ||
    detail.includes("suspended") ||
    detail.includes("cancel")
  ) {
    return "postponed";
  }

  if (state === "final" || state === "complete") {
    return "completed";
  }

  if (state === "live" || detail.includes("in progress")) {
    return "inprogress";
  }

  // "Preview" / "Scheduled" / "Pre-Game" etc.
  return "scheduled";
}

/**
 * Normalize an MLB position abbreviation into a fantasy-friendly position.
 */
export function normalizePosition(abbreviation: string | undefined): string {
  const map: Record<string, string> = {
    // Standard abbreviations
    P: "P",
    SP: "P",
    RP: "P",
    C: "C",
    "1B": "1B",
    "2B": "2B",
    "3B": "3B",
    SS: "SS",
    OF: "OF",
    LF: "OF",
    CF: "OF",
    RF: "OF",
    DH: "DH",
    // Full names
    "STARTING PITCHER": "P",
    "RELIEF PITCHER": "P",
    PITCHER: "P",
    CATCHER: "C",
    "FIRST BASE": "1B",
    "SECOND BASE": "2B",
    "THIRD BASE": "3B",
    SHORTSTOP: "SS",
    OUTFIELDER: "OF",
    "LEFT FIELD": "OF",
    "CENTER FIELD": "OF",
    "RIGHT FIELD": "OF",
    "DESIGNATED HITTER": "DH",
    "TWO-WAY PLAYER": "DH",
  };
  const key = (abbreviation || "UTIL").toUpperCase().trim();
  return map[key] || "UTIL";
}

/**
 * Create the canonical player ID string: mlb_<MLBAM_ID>.
 */
export function createPlayerId(mlbamId: number): string {
  return `mlb_${mlbamId}`;
}

export const createMLBPlayerId = createPlayerId;

/**
 * Extract MLBAM ID from a canonical player ID string.
 */
export function parsePlayerId(playerId: string): number | null {
  if (!playerId.startsWith("mlb_")) return null;
  const num = Number.parseInt(playerId.slice(4), 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * Get the current MLB season year (calendar year).
 */
export function getCurrentSeason(): number {
  return new Date().getFullYear();
}

/**
 * Fetch all MLB teams for a given season.
 */
export async function fetchTeams(season?: number): Promise<MlbTeam[]> {
  const response = await apiFetch<MlbTeamsResponse>("/teams", {
    sportIds: 1,
    season: season ?? getCurrentSeason(),
  });
  return response.teams;
}

/**
 * Fetch all active MLB players via the /sports/1/players endpoint.
 * This returns all players who played or are rostered in the given season.
 */
export async function fetchAllPlayers(season?: number): Promise<MlbPlayer[]> {
  const year = season ?? getCurrentSeason();
  const response = await apiFetch<{ people: MlbPlayer[] }>(`/sports/1/players`, { season: year });
  return response.people;
}

/**
 * Fetch a specific player's profile by MLBAM ID.
 */
export async function fetchPlayer(playerId: number): Promise<MlbPlayer> {
  const response = await apiFetch<MlbPeopleResponse>(`/people/${playerId}`);
  return response.people[0];
}

/**
 * Fetch team roster for a given team and season.
 */
export async function fetchTeamRoster(teamId: number, season?: number): Promise<MlbRosterEntry[]> {
  const year = season ?? getCurrentSeason();
  const response = await apiFetch<{
    roster: MlbRosterEntry[];
    link: string;
  }>(`/teams/${teamId}/roster`, { season: year });
  return response.roster;
}

/**
 * Fetch the game schedule for a date range (or specific dates).
 * Dates should be in "YYYY-MM-DD" format.
 */
export async function fetchSchedule(options: {
  date?: string;
  startDate?: string;
  endDate?: string;
  season?: number;
  teamId?: number;
}): Promise<MlbGame[]> {
  const params: Record<string, string | number | undefined> = {
    sportId: 1,
    season: options.season ?? getCurrentSeason(),
    hydrate: "probablePitcher(note),linescore,team",
  };
  if (options.date) params.date = options.date;
  if (options.startDate) params.startDate = options.startDate;
  if (options.endDate) params.endDate = options.endDate;
  if (options.teamId) params.teamId = options.teamId;

  const response = await apiFetch<MlbScheduleResponse>("/schedule", params);
  if (!response.dates || response.dates.length === 0) return [];

  const games: MlbGame[] = [];
  for (const date of response.dates) {
    if (date.games) games.push(...date.games);
  }
  return games;
}

/**
 * Fetch a single game's boxscore by gamePk.
 * The boxscore includes per-player batting/pitching/fielding stats.
 */
export async function fetchBoxscore(gamePk: number): Promise<MlbBoxscore> {
  return apiFetch<MlbBoxscore>(`/game/${gamePk}/boxscore`);
}

/**
 * Fetch the linescore (current game state) for a game.
 */
export async function fetchLinescore(gamePk: number): Promise<MlbLinescore> {
  return apiFetch<MlbLinescore>(`/game/${gamePk}/linescore`);
}

/**
 * Fetch the schedule for a specific date, returning all games that day.
 */
export async function fetchGamesByDate(date: string): Promise<MlbGame[]> {
  return fetchSchedule({ date });
}

/**
 * Fetch games across a date range.
 * Dates are inclusive, "YYYY-MM-DD" format.
 */
export async function fetchGamesByDateRange(
  startDate: string,
  endDate: string,
): Promise<MlbGame[]> {
  return fetchSchedule({ startDate, endDate });
}

/**
 * Extract boxscore player stats for a single game, keyed by player ID.
 * Returns a map of playerId → batting/pitching stats.
 */
export type MlbStatRecord = Record<string, number | string | null>;

export function extractBoxscorePlayerStats(
  boxscore: MlbBoxscore,
): Map<number, { batting: MlbStatRecord; pitching: MlbStatRecord }> {
  const playerStats = new Map<number, { batting: MlbStatRecord; pitching: MlbStatRecord }>();

  for (const side of ["away", "home"] as const) {
    const teamData = boxscore.teams[side];
    if (!teamData?.players) continue;

    for (const player of Object.values(teamData.players)) {
      const mlbamId = player.person.id;
      const batting = (player.stats?.batting as MlbStatRecord | undefined) || {};
      const pitching = (player.stats?.pitching as MlbStatRecord | undefined) || {};
      playerStats.set(mlbamId, { batting, pitching });
    }
  }

  return playerStats;
}

/**
 * Determine the game side (home/away) for a player in a boxscore.
 */
export function resolvePlayerGameSide(
  boxscore: MlbBoxscore,
  playerId: number,
): "home" | "away" | null {
  for (const side of ["away", "home"] as const) {
    const teamData = boxscore.teams[side];
    if (!teamData?.players) continue;
    for (const key of Object.keys(teamData.players)) {
      if (teamData.players[key].person.id === playerId) {
        return side;
      }
    }
  }
  return null;
}

/**
 * Get opponent team abbreviation for a player in a game.
 */
export function getOpponentTeam(boxscore: MlbBoxscore, playerId: number): string | null {
  const side = resolvePlayerGameSide(boxscore, playerId);
  if (!side) return null;
  const opponentSide = side === "home" ? "away" : "home";
  return boxscore.teams[opponentSide]?.team?.abbreviation || null;
}

/**
 * Parse boxscore player stats into a flat normalized stats record (mirrors parseStatsToJson).
 */
export function parseStatsToJson(stats: {
  batting?: MlbStatRecord;
  pitching?: MlbStatRecord;
}): Record<string, number> {
  const batting = stats.batting || {};
  const pitching = stats.pitching || {};

  return {
    atBats: statValue(batting, "atBats"),
    hits: statValue(batting, "hits"),
    doubles: statValue(batting, "doubles"),
    triples: statValue(batting, "triples"),
    homeRuns: statValue(batting, "homeRuns"),
    runs: statValue(batting, "runs"),
    runsBattedIn: statValue(batting, "rbi"),
    walks: statValue(batting, "baseOnBalls"),
    hitByPitch: statValue(batting, "hitByPitch"),
    stolenBases: statValue(batting, "stolenBases"),
    strikeoutsBatting: statValue(batting, "strikeOuts"),
    inningsPitched: statValue(pitching, "inningsPitched"),
    pitchingStrikeouts: statValue(pitching, "strikeOuts"),
    earnedRuns: statValue(pitching, "earnedRuns"),
    runsAllowed: statValue(pitching, "runs"),
    hitsAllowed: statValue(pitching, "hits"),
    walksAllowed: statValue(pitching, "baseOnBalls"),
    wins: statValue(pitching, "wins"),
    saves: statValue(pitching, "saves"),
  };
}

/**
 * Check if MLB StatsAPI is reachable.
 * The API is public and requires no key, so this just does a health ping.
 */
export async function isApiReachable(): Promise<boolean> {
  try {
    await apiFetch<{ people: MlbPlayer[] }>("/sports/1/players", {
      season: getCurrentSeason(),
      limit: 1,
    });
    return true;
  } catch {
    return false;
  }
}

export type CompatMlbTeam = {
  id: number;
  abbreviation: string;
  name?: string;
  display_name?: string;
  full_name?: string;
  short_display_name?: string;
};

export type CompatMlbGame = {
  id: number;
  gamePk: number;
  date: string;
  status: string;
  home_team: CompatMlbTeam;
  away_team: CompatMlbTeam;
  visitor_team: CompatMlbTeam;
  home_team_score: number | null;
  away_team_score: number | null;
  visitor_team_score: number | null;
  period?: number;
};

export type CompatMlbGameStats = {
  player: { id: number; first_name: string; last_name: string };
  game: { id: number };
  game_id: number;
  team: CompatMlbTeam;
  batting?: MlbStatRecord;
  pitching?: MlbStatRecord;
};

function toCompatTeam(team: { id: number; name: string; abbreviation: string }): CompatMlbTeam {
  return {
    id: team.id,
    abbreviation: String(team.abbreviation || team.name || "").toUpperCase(),
    name: team.name,
    display_name: team.name,
    full_name: team.name,
    short_display_name: team.name,
  };
}

function toCompatGame(game: MlbGame): CompatMlbGame {
  const home = toCompatTeam(game.teams.home.team);
  const away = toCompatTeam(game.teams.away.team);
  return {
    id: game.gamePk,
    gamePk: game.gamePk,
    date: game.gameDate,
    status: game.status.detailedState || game.status.abstractGameState || "Scheduled",
    home_team: home,
    away_team: away,
    visitor_team: away,
    home_team_score: game.teams.home.score,
    away_team_score: game.teams.away.score,
    visitor_team_score: game.teams.away.score,
  };
}

export async function fetchGames(options?: { dates?: string[] }): Promise<CompatMlbGame[]> {
  const dates = options?.dates?.length ? options.dates : [new Date().toISOString().slice(0, 10)];
  const nested = await Promise.all(dates.map((date) => fetchGamesByDate(date)));
  return nested.flat().map(toCompatGame);
}

function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
}

export async function fetchGameStats(gameIds: number[]): Promise<CompatMlbGameStats[]> {
  const rows: CompatMlbGameStats[] = [];
  for (const gamePk of gameIds) {
    const boxscore = await fetchBoxscore(gamePk);
    for (const side of ["away", "home"] as const) {
      const teamData = boxscore.teams[side];
      const team = toCompatTeam(teamData.team);
      for (const player of Object.values(teamData.players || {})) {
        const name = splitName(player.person.fullName);
        rows.push({
          player: { id: player.person.id, ...name },
          game: { id: gamePk },
          game_id: gamePk,
          team,
          batting: (player.stats?.batting as MlbStatRecord | undefined) || {},
          pitching: (player.stats?.pitching as MlbStatRecord | undefined) || {},
        });
      }
    }
  }
  return rows;
}

export function calculateMLBFantasyPoints(stats: CompatMlbGameStats): number {
  return calculateFantasyPoints({ batting: stats.batting, pitching: stats.pitching }).points;
}

export function getMLBAwayTeam(
  game: Pick<CompatMlbGame, "visitor_team" | "away_team">,
): CompatMlbTeam | null {
  return game.visitor_team ?? game.away_team ?? null;
}

export function getMLBTeamDisplayName(team: CompatMlbTeam | null | undefined): string | null {
  if (!team) return null;
  return team.full_name || team.display_name || team.name || null;
}

export function getMLBHomeTeamName(game: Pick<CompatMlbGame, "home_team">): string | null {
  return getMLBTeamDisplayName(game.home_team);
}

export function getMLBAwayTeamName(
  game: Pick<CompatMlbGame, "visitor_team" | "away_team">,
): string | null {
  return getMLBTeamDisplayName(getMLBAwayTeam(game));
}

export function getMLBHomeScore(game: Pick<CompatMlbGame, "home_team_score">): number | null {
  return game.home_team_score ?? null;
}

export function getMLBAwayScore(
  game: Pick<CompatMlbGame, "visitor_team_score" | "away_team_score">,
): number | null {
  return game.visitor_team_score ?? game.away_team_score ?? null;
}

export function getMLBStatGameId(
  stats: Pick<CompatMlbGameStats, "game_id" | "game">,
): number | null {
  const id = Number(stats.game_id ?? stats.game?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function getMLBStatTeamAbbreviation(stats: Pick<CompatMlbGameStats, "team">): string | null {
  return (
    String(stats.team?.abbreviation || "")
      .trim()
      .toUpperCase() || null
  );
}

export function getMLBStatTeamName(stats: Pick<CompatMlbGameStats, "team">): string | null {
  return getMLBTeamDisplayName(stats.team);
}

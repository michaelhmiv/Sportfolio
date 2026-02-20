/**
 * Ball Don't Lie MLB API Service
 *
 * Handles all interactions with the Ball Don't Lie MLB API.
 * Documentation: https://www.balldontlie.io/openapi.yml
 *
 * Endpoints used:
 * - GET /players/active - Active MLB players
 * - GET /games - Game schedules and scores
 * - GET /stats - Per-game player statistics
 * - GET /season_stats - Season aggregate statistics
 * - GET /player_injuries - Current injury status
 */

import axios, { AxiosInstance } from "axios";
import { balldontlieRateLimiter } from "./jobs/rate-limiter";

const API_BASE = "https://api.balldontlie.io/mlb/v1";

function createApiClient(): AxiosInstance {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    console.warn("[MLB API] BALLDONTLIE_API_KEY not set - MLB features disabled");
  }

  return axios.create({
    baseURL: API_BASE,
    headers: {
      Authorization: apiKey || "",
    },
    timeout: 30000,
  });
}

const apiClient = createApiClient();

// ============================================================================
// Types
// ============================================================================

export interface MLBTeam {
  id: number;
  name: string;
  full_name?: string;
  abbreviation: string;
  city?: string;
  league?: string;
  division?: string;
}

export interface MLBPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  position_abbreviation?: string;
  jersey_number?: string;
  batting_hand?: string;
  throwing_hand?: string;
  team?: MLBTeam;
}

export interface MLBGame {
  id: number;
  date: string;
  season: number;
  status: string;
  home_team: MLBTeam;
  visitor_team: MLBTeam;
  home_team_score: number | null;
  visitor_team_score: number | null;
  venue?: string;
}

export interface MLBGameStats {
  id: number;
  player: MLBPlayer;
  game: MLBGame;
  team: MLBTeam;
  [key: string]: any;
}

export interface MLBInjury {
  id: number;
  player: MLBPlayer;
  status: string;
  injury?: string;
  description?: string;
  return_date?: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    next_cursor?: number;
    per_page: number;
  };
}

// ============================================================================
// API Functions
// ============================================================================

export async function fetchActivePlayers(): Promise<MLBPlayer[]> {
  const allPlayers: MLBPlayer[] = [];
  let cursor: number | null = null;
  let pageCount = 0;

  console.log("[MLB API] Fetching active players...");

  do {
    const params: Record<string, any> = { per_page: 100 };
    if (cursor) params.cursor = cursor;

    try {
      const response = await balldontlieRateLimiter.executeWithRetry(() =>
        apiClient.get<PaginatedResponse<MLBPlayer>>("/players/active", { params }),
      );
      const players = response.data.data || [];
      allPlayers.push(...players);
      cursor = response.data.meta?.next_cursor || null;
      pageCount++;

      console.log(
        `[MLB API] Fetched page ${pageCount}: ${players.length} players (total: ${allPlayers.length})`,
      );
    } catch (error: any) {
      console.error(`[MLB API] Error fetching players page ${pageCount + 1}:`, error.message);
      throw error;
    }
  } while (cursor);

  console.log(`[MLB API] Completed: ${allPlayers.length} active players fetched`);
  return allPlayers;
}

export async function fetchGames(options: {
  dates?: string[];
  seasons?: number[];
  teamIds?: number[];
  status?: string;
}): Promise<MLBGame[]> {
  const allGames: MLBGame[] = [];
  let cursor: number | null = null;

  const params: Record<string, any> = { per_page: 100 };
  if (options.dates) params["dates[]"] = options.dates;
  if (options.seasons) params["seasons[]"] = options.seasons;
  if (options.teamIds) params["team_ids[]"] = options.teamIds;
  if (options.status) params.status = options.status;

  console.log("[MLB API] Fetching games with params:", params);

  do {
    if (cursor) params.cursor = cursor;

    try {
      const response = await balldontlieRateLimiter.executeWithRetry(() =>
        apiClient.get<PaginatedResponse<MLBGame>>("/games", { params }),
      );
      const games = response.data.data || [];
      allGames.push(...games);
      cursor = response.data.meta?.next_cursor || null;
    } catch (error: any) {
      console.error("[MLB API] Error fetching games:", error.message);
      throw error;
    }
  } while (cursor);

  console.log(`[MLB API] Fetched ${allGames.length} games`);
  return allGames;
}

export async function fetchGamesByDateRange(startDate: Date, endDate: Date): Promise<MLBGame[]> {
  const dates: string[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  return fetchGames({ dates });
}

export async function fetchGameStats(gameIds: number[]): Promise<MLBGameStats[]> {
  const allStats: MLBGameStats[] = [];

  console.log(`[MLB API] Fetching stats for ${gameIds.length} games...`);

  for (const gameId of gameIds) {
    let cursor: number | null = null;

    do {
      const params: Record<string, any> = {
        "game_ids[]": gameId,
        per_page: 100,
      };
      if (cursor) params.cursor = cursor;

      try {
        const response = await balldontlieRateLimiter.executeWithRetry(() =>
          apiClient.get<PaginatedResponse<MLBGameStats>>("/stats", { params }),
        );
        const stats = response.data.data || [];
        allStats.push(...stats);
        cursor = response.data.meta?.next_cursor || null;
      } catch (error: any) {
        console.error(`[MLB API] Error fetching stats for game ${gameId}:`, error.message);
      }
    } while (cursor);
  }

  console.log(`[MLB API] Fetched ${allStats.length} player stat lines`);
  return allStats;
}

export async function fetchInjuries(options?: {
  teamIds?: number[];
  playerIds?: number[];
}): Promise<MLBInjury[]> {
  const allInjuries: MLBInjury[] = [];
  let cursor: number | null = null;

  const params: Record<string, any> = { per_page: 100 };
  if (options?.teamIds) params["team_ids[]"] = options.teamIds;
  if (options?.playerIds) params["player_ids[]"] = options.playerIds;

  do {
    if (cursor) params.cursor = cursor;

    try {
      const response = await balldontlieRateLimiter.executeWithRetry(() =>
        apiClient.get<PaginatedResponse<MLBInjury>>("/player_injuries", { params }),
      );
      const injuries = response.data.data || [];
      allInjuries.push(...injuries);
      cursor = response.data.meta?.next_cursor || null;
    } catch (error: any) {
      console.error("[MLB API] Error fetching injuries:", error.message);
      throw error;
    }
  } while (cursor);

  return allInjuries;
}

// ============================================================================
// Helpers
// ============================================================================

function readNumericStat(source: Record<string, any>, paths: string[]): number {
  for (const path of paths) {
    const segments = path.split(".");
    let current: any = source;

    for (const segment of segments) {
      current = current?.[segment];
      if (current === undefined || current === null) break;
    }

    const numeric = Number(current);
    if (Number.isFinite(numeric)) return numeric;
  }

  return 0;
}

function extractNormalizedStats(stats: MLBGameStats) {
  const source = stats as Record<string, any>;

  const atBats = readNumericStat(source, ["at_bats", "ab", "batting.at_bats", "batting.ab"]);
  const hits = readNumericStat(source, ["hits", "h", "batting.hits", "batting.h"]);
  const doubles = readNumericStat(source, ["doubles", "2b", "batting.doubles"]);
  const triples = readNumericStat(source, ["triples", "3b", "batting.triples"]);
  const homeRuns = readNumericStat(source, ["home_runs", "hr", "batting.home_runs"]);
  const runs = readNumericStat(source, ["runs", "r", "batting.runs"]);
  const rbi = readNumericStat(source, ["runs_batted_in", "rbi", "batting.rbi"]);
  const walks = readNumericStat(source, ["walks", "bb", "batting.walks"]);
  const hitByPitch = readNumericStat(source, ["hit_by_pitch", "hbp", "batting.hit_by_pitch"]);
  const stolenBases = readNumericStat(source, ["stolen_bases", "sb", "batting.stolen_bases"]);
  const strikeoutsBatting = readNumericStat(source, [
    "batting_strikeouts",
    "strikeouts_batting",
    "batting.strikeouts",
  ]);

  const inningsPitched = readNumericStat(source, [
    "innings_pitched",
    "ip",
    "pitching.innings_pitched",
    "pitching.ip",
  ]);
  const pitchingStrikeouts = readNumericStat(source, [
    "pitching_strikeouts",
    "strikeouts_pitched",
    "pitching.strikeouts",
    "pitching.so",
  ]);
  const earnedRuns = readNumericStat(source, ["earned_runs", "er", "pitching.earned_runs"]);
  const runsAllowed = readNumericStat(source, ["runs_allowed", "ra", "pitching.runs_allowed"]);
  const hitsAllowed = readNumericStat(source, ["hits_allowed", "pitching.hits_allowed"]);
  const walksAllowed = readNumericStat(source, ["walks_allowed", "pitching.walks_allowed"]);
  const wins = readNumericStat(source, ["wins", "w", "pitching.wins"]);
  const saves = readNumericStat(source, ["saves", "sv", "pitching.saves"]);

  return {
    at_bats: atBats,
    hits,
    doubles,
    triples,
    home_runs: homeRuns,
    runs,
    runs_batted_in: rbi,
    walks,
    hit_by_pitch: hitByPitch,
    stolen_bases: stolenBases,
    strikeouts_batting: strikeoutsBatting,
    innings_pitched: inningsPitched,
    pitching_strikeouts: pitchingStrikeouts,
    earned_runs: earnedRuns,
    runs_allowed: runsAllowed,
    hits_allowed: hitsAllowed,
    walks_allowed: walksAllowed,
    wins,
    saves,
  };
}

export function parseStatsToJson(stats: MLBGameStats): Record<string, any> {
  return extractNormalizedStats(stats);
}

export function calculateMLBFantasyPoints(stats: MLBGameStats): number {
  const normalized = extractNormalizedStats(stats);

  const singles = Math.max(
    normalized.hits - normalized.doubles - normalized.triples - normalized.home_runs,
    0,
  );

  let points = 0;

  // Batting
  points += singles * 3;
  points += normalized.doubles * 5;
  points += normalized.triples * 8;
  points += normalized.home_runs * 10;
  points += normalized.runs * 2;
  points += normalized.runs_batted_in * 2;
  points += normalized.walks * 2;
  points += normalized.hit_by_pitch * 2;
  points += normalized.stolen_bases * 5;
  points += normalized.strikeouts_batting * -0.5;

  // Pitching
  points += normalized.innings_pitched * 2.25;
  points += normalized.pitching_strikeouts * 2;
  points += normalized.wins * 4;
  points += normalized.saves * 5;
  points += normalized.earned_runs * -2;
  points += normalized.runs_allowed * -0.5;
  points += normalized.hits_allowed * -0.6;
  points += normalized.walks_allowed * -0.6;

  return parseFloat(points.toFixed(2));
}

export function normalizeGameStatus(apiStatus: string): string {
  const status = (apiStatus || "").toLowerCase();

  if (
    status.includes("postponed") ||
    status.includes("delayed") ||
    status.includes("suspended") ||
    status.includes("cancel")
  ) {
    return "postponed";
  }

  if (
    status === "final" ||
    status.includes("final") ||
    status.includes("completed") ||
    status.includes("game over")
  ) {
    return "completed";
  }

  if (
    status === "in progress" ||
    status.includes("in progress") ||
    status.includes("top") ||
    status.includes("bottom") ||
    status.includes("inning") ||
    status.includes("mid")
  ) {
    return "inprogress";
  }

  return "scheduled";
}

export function normalizePosition(position: string): string {
  const normalized = (position || "").toUpperCase().trim();
  const positionMap: Record<string, string> = {
    // Abbreviations
    SP: "P",
    RP: "P",
    P: "P",
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
    // Full names returned by BallDontLie API
    "STARTING PITCHER": "P",
    "RELIEF PITCHER": "P",
    PITCHER: "P",
    CATCHER: "C",
    "FIRST BASEMAN": "1B",
    "SECOND BASEMAN": "2B",
    "THIRD BASEMAN": "3B",
    SHORTSTOP: "SS",
    OUTFIELDER: "OF",
    "LEFT FIELDER": "OF",
    "CENTER FIELDER": "OF",
    "RIGHT FIELDER": "OF",
    "DESIGNATED HITTER": "DH",
  };

  return positionMap[normalized] || normalized || "UTIL";
}

export function getCurrentMLBSeason(): number {
  return new Date().getFullYear();
}

export function createMLBPlayerId(apiPlayerId: number): string {
  return `mlb_${apiPlayerId}`;
}

export function isMLBApiConfigured(): boolean {
  return !!process.env.BALLDONTLIE_API_KEY;
}

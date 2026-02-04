/**
 * Ball Don't Lie NBA API Service
 * 
 * Handles all interactions with the Ball Don't Lie NBA API.
 * Documentation: https://docs.balldontlie.io/#nba-api
 * 
 * Endpoints used:
 * - GET /players/active - Active NBA players
 * - GET /games - Game schedules and scores
 * - GET /stats - Per-game player statistics
 * - GET /season_averages - Season aggregate statistics
 * - GET /box_scores/live - Live game box scores
 */

import axios, { AxiosInstance } from "axios";
import { balldontlieRateLimiter } from "./jobs/rate-limiter";

const API_BASE = "https://api.balldontlie.io/v1";

// Create axios instance with auth header
function createApiClient(): AxiosInstance {
    const apiKey = process.env.BALLDONTLIE_API_KEY;
    if (!apiKey) {
        console.warn("[NBA API] BALLDONTLIE_API_KEY not set - NBA features disabled");
    }

    return axios.create({
        baseURL: API_BASE,
        headers: {
            "Authorization": apiKey || "",
        },
        timeout: 30000, // 30 second timeout
    });
}

const apiClient = createApiClient();

// ============================================================================
// Types
// ============================================================================

export interface NBATeam {
    id: number;
    name: string;
    full_name: string;
    abbreviation: string;
    city: string;
    conference: string;
    division: string;
}

export interface NBAPlayer {
    id: number;
    first_name: string;
    last_name: string;
    position: string;
    height: string;
    weight: string;
    jersey_number: string;
    college: string;
    country: string;
    draft_year: number | null;
    draft_round: number | null;
    draft_number: number | null;
    team: NBATeam;
}

export interface NBAGame {
    id: number;
    date: string; // YYYY-MM-DD format
    season: number;
    status: string; // "Final", "Scheduled", "In Progress", etc.
    period: number;
    time: string;
    postseason: boolean;
    home_team_score: number | null;
    visitor_team_score: number | null;
    datetime: string; // ISO datetime with timezone
    home_team: NBATeam;
    visitor_team: NBATeam;
    postponed?: boolean; // Optional field for postponed games
}

export interface NBAGameStats {
    id: number;
    min: string; // Minutes as string "38"
    fgm: number;
    fga: number;
    fg_pct: number;
    fg3m: number;
    fg3a: number;
    fg3_pct: number;
    ftm: number;
    fta: number;
    ft_pct: number;
    oreb: number;
    dreb: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    turnover: number;
    pf: number;
    pts: number;
    plus_minus: number;
    player: NBAPlayer;
    team: NBATeam;
    game: {
        id: number;
        date: string;
        season: number;
        status: string;
        period: number;
        time: string;
        postseason: boolean;
        home_team_score: number;
        visitor_team_score: number;
        home_team_id: number;
        visitor_team_id: number;
    };
}

export interface NBABoxScore {
    date: string;
    season: number;
    status: string;
    period: number;
    time: string;
    postseason: boolean;
    home_team_score: number;
    visitor_team_score: number;
    home_team: NBATeam & {
        players: NBAGameStats[];
    };
    visitor_team: NBATeam & {
        players: NBAGameStats[];
    };
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

/**
 * Fetch all active NBA players using cursor pagination
 */
export async function fetchActivePlayers(): Promise<NBAPlayer[]> {
    const allPlayers: NBAPlayer[] = [];
    let cursor: number | null = null;
    let pageCount = 0;

    console.log("[NBA API] Fetching active players...");

    do {
        const params: Record<string, any> = { per_page: 100 };
        if (cursor) params.cursor = cursor;

        try {
            const response = await balldontlieRateLimiter.executeWithRetry(
                () => apiClient.get<PaginatedResponse<NBAPlayer>>("/players/active", { params })
            );
            const players = response.data.data || [];
            allPlayers.push(...players);
            cursor = response.data.meta?.next_cursor || null;
            pageCount++;

            console.log(`[NBA API] Fetched page ${pageCount}: ${players.length} players (total: ${allPlayers.length})`);
        } catch (error: any) {
            console.error(`[NBA API] Error fetching players page ${pageCount + 1}:`, error.message);
            throw error;
        }
    } while (cursor);

    console.log(`[NBA API] Completed: ${allPlayers.length} active players fetched`);
    return allPlayers;
}

/**
 * Fetch NBA games by date
 */
export async function fetchDailyGames(date: string): Promise<NBAGame[]> {
    const allGames: NBAGame[] = [];
    let cursor: number | null = null;

    // date should be in YYYY-MM-DD format
    const params: Record<string, any> = {
        per_page: 100,
        "dates[]": date,
    };

    console.log(`[NBA API] Fetching games for ${date}...`);

    do {
        if (cursor) params.cursor = cursor;

        try {
            const response = await balldontlieRateLimiter.executeWithRetry(
                () => apiClient.get<PaginatedResponse<NBAGame>>("/games", { params })
            );
            const games = response.data.data || [];
            allGames.push(...games);
            cursor = response.data.meta?.next_cursor || null;
        } catch (error: any) {
            console.error(`[NBA API] Error fetching games for ${date}:`, error.message);
            throw error;
        }
    } while (cursor);

    console.log(`[NBA API] Fetched ${allGames.length} games for ${date}`);
    return allGames;
}

/**
 * Fetch games by date range
 */
export async function fetchGamesByDateRange(startDate: Date, endDate: Date): Promise<NBAGame[]> {
    const allGames: NBAGame[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
        const dateStr = current.toISOString().split("T")[0];
        const games = await fetchDailyGames(dateStr);
        allGames.push(...games);
        current.setDate(current.getDate() + 1);
    }

    return allGames;
}

/**
 * Fetch player game stats for a specific game
 */
export async function fetchPlayerGameStats(gameId: string | number): Promise<NBAGameStats[]> {
    const allStats: NBAGameStats[] = [];
    let cursor: number | null = null;

    const params: Record<string, any> = {
        "game_ids[]": Number(gameId),
        per_page: 100,
    };

    console.log(`[NBA API] Fetching stats for game ${gameId}...`);

    do {
        if (cursor) params.cursor = cursor;

        try {
            const response = await balldontlieRateLimiter.executeWithRetry(
                () => apiClient.get<PaginatedResponse<NBAGameStats>>("/stats", { params })
            );
            const stats = response.data.data || [];
            allStats.push(...stats);
            cursor = response.data.meta?.next_cursor || null;
        } catch (error: any) {
            console.error(`[NBA API] Error fetching stats for game ${gameId}:`, error.message);
            throw error;
        }
    } while (cursor);

    console.log(`[NBA API] Fetched ${allStats.length} stat lines for game ${gameId}`);
    return allStats;
}

/**
 * Fetch all player stats for a specific date (all games on that date)
 */
export async function fetchDailyPlayerGameLogs(date: Date): Promise<NBAGameStats[]> {
    const allStats: NBAGameStats[] = [];
    let cursor: number | null = null;

    const dateStr = date.toISOString().split("T")[0];
    const params: Record<string, any> = {
        "dates[]": dateStr,
        per_page: 100,
    };

    console.log(`[NBA API] Fetching all player stats for ${dateStr}...`);

    do {
        if (cursor) params.cursor = cursor;

        try {
            const response = await balldontlieRateLimiter.executeWithRetry(
                () => apiClient.get<PaginatedResponse<NBAGameStats>>("/stats", { params })
            );
            const stats = response.data.data || [];
            allStats.push(...stats);
            cursor = response.data.meta?.next_cursor || null;
        } catch (error: any) {
            console.error(`[NBA API] Error fetching daily stats for ${dateStr}:`, error.message);
            throw error;
        }
    } while (cursor);

    console.log(`[NBA API] Fetched ${allStats.length} stat lines for ${dateStr}`);
    return allStats;
}

/**
 * Fetch live box scores for currently active games
 */
export async function fetchLiveBoxScores(): Promise<NBABoxScore[]> {
    try {
        console.log("[NBA API] Fetching live box scores...");
        const response = await balldontlieRateLimiter.executeWithRetry(
            () => apiClient.get<{ data: NBABoxScore[] }>("/box_scores/live")
        );
        const boxScores = response.data.data || [];
        console.log(`[NBA API] Fetched ${boxScores.length} live box scores`);
        return boxScores;
    } catch (error: any) {
        console.error("[NBA API] Error fetching live box scores:", error.message);
        throw error;
    }
}

/**
 * Top performer data for display on game card
 */
export interface NBATopPerformer {
    name: string;
    team: string;
    pts: number;
    reb: number;
    ast: number;
}

export interface NBALiveBoxScore {
    gameId: string;
    status: string;
    period: number;
    time: string;
    homeTeam: string;
    homeScore: number;
    awayTeam: string;
    awayScore: number;
    homeTopPerformers: NBATopPerformer[];
    awayTopPerformers: NBATopPerformer[];
}

/**
 * Transform box score to simplified format for frontend display
 */
export function transformBoxScoreToLiveStats(gameId: string, boxScore: NBABoxScore): NBALiveBoxScore {
    const getTopPerformers = (players: NBAGameStats[]): NBATopPerformer[] => {
        // Get top 3 scorers for quick reference
        const sorted = [...players].sort((a, b) => (b.pts || 0) - (a.pts || 0)).slice(0, 3);
        return sorted.map(p => ({
            name: `${p.player.first_name.charAt(0)}. ${p.player.last_name}`,
            team: p.team.abbreviation,
            pts: p.pts || 0,
            reb: p.reb || 0,
            ast: p.ast || 0,
        }));
    };

    return {
        gameId,
        status: boxScore.status,
        period: boxScore.period,
        time: boxScore.time,
        homeTeam: boxScore.home_team.abbreviation,
        homeScore: boxScore.home_team_score,
        awayTeam: boxScore.visitor_team.abbreviation,
        awayScore: boxScore.visitor_team_score,
        homeTopPerformers: getTopPerformers(boxScore.home_team.players || []),
        awayTopPerformers: getTopPerformers(boxScore.visitor_team.players || []),
    };
}

/**
 * Fetch a specific game by ID
 */
export async function fetchGame(gameId: number): Promise<NBAGame | null> {
    try {
        const response = await balldontlieRateLimiter.executeWithRetry(
            () => apiClient.get<{ data: NBAGame }>(`/games/${gameId}`)
        );
        return response.data.data || null;
    } catch (error: any) {
        console.error(`[NBA API] Error fetching game ${gameId}:`, error.message);
        return null;
    }
}

// ============================================================================
// Status Normalization
// ============================================================================

/**
 * Normalize BallDontLie game status to internal enum
 * BDL returns: "Final", "Scheduled", "In Progress", "1st Qtr", "2nd Qtr", "Halftime", etc.
 * Internal: "scheduled", "inprogress", "completed"
 */
export function normalizeGameStatus(apiStatus: string): string {
    const status = apiStatus.toLowerCase();

    // Check for final states
    if (status === "final" || status.includes("final")) {
        return "completed";
    }

    // Check for in-progress states
    if (
        status === "in progress" ||
        status.includes("qtr") ||
        status.includes("quarter") ||
        status === "halftime" ||
        status.includes("ot") ||
        status.includes("overtime")
    ) {
        return "inprogress";
    }

    // Everything else (Scheduled, etc.) is scheduled
    return "scheduled";
}

// ============================================================================
// Fantasy Points Calculation
// ============================================================================

export interface GameStats {
    points: number;
    threePointersMade: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
}

/**
 * Calculate fantasy points using DFS scoring rules:
 * - Points: 1.0 per point
 * - 3PM: 0.5 per three-pointer made
 * - Rebounds: 1.25 per rebound
 * - Assists: 1.5 per assist
 * - Steals: 2.0 per steal
 * - Blocks: 2.0 per block
 * - Turnovers: -0.5 per turnover
 * - Double-double: +1.5 bonus (10+ in 2 categories)
 * - Triple-double: +3.0 bonus (10+ in 3 categories) - REPLACES double-double bonus
 */
export function calculateFantasyPoints(stats: GameStats): number {
    let points = 0;

    // Basic stats
    points += stats.points * 1.0;
    points += stats.threePointersMade * 0.5;
    points += stats.rebounds * 1.25;
    points += stats.assists * 1.5;
    points += stats.steals * 2.0;
    points += stats.blocks * 2.0;
    points += stats.turnovers * -0.5;

    // Double-double/Triple-double bonuses (non-stacking)
    const categories = [stats.points, stats.rebounds, stats.assists, stats.steals, stats.blocks];
    const doubleDigitCategories = categories.filter(c => c >= 10).length;

    if (doubleDigitCategories >= 3) {
        points += 3.0; // Triple-double bonus (exclusive, no double-double stacking)
    } else if (doubleDigitCategories >= 2) {
        points += 1.5; // Double-double bonus
    }

    return parseFloat(points.toFixed(2));
}

/**
 * Convert BDL stats to GameStats format for fantasy calculation
 */
export function convertToGameStats(bdlStats: NBAGameStats): GameStats {
    return {
        points: bdlStats.pts || 0,
        threePointersMade: bdlStats.fg3m || 0,
        rebounds: bdlStats.reb || 0,
        assists: bdlStats.ast || 0,
        steals: bdlStats.stl || 0,
        blocks: bdlStats.blk || 0,
        turnovers: bdlStats.turnover || 0,
    };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get current NBA season year
 * NBA season runs October to June
 * - July-December: use current year (e.g., Nov 2024 → 2024)
 * - January-June: use previous year (e.g., Feb 2025 → 2024)
 */
export function getCurrentNBASeason(): number {
    const now = new Date();
    const month = now.getMonth(); // 0-11
    return month >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Get NBA season string (e.g., "2024-2025-regular")
 */
export function getCurrentNBASeasonString(): string {
    const seasonYear = getCurrentNBASeason();
    return `${seasonYear}-${seasonYear + 1}-regular`;
}

/**
 * Create prefixed player ID for database
 */
export function createNBAPlayerId(apiPlayerId: number): string {
    return `nba_${apiPlayerId}`;
}

/**
 * Check if API key is configured
 */
export function isNBAApiConfigured(): boolean {
    return !!process.env.BALLDONTLIE_API_KEY;
}

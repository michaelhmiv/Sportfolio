/**
 * Enhanced caching layer for Sportfolio
 * 
 * This module provides aggressive caching to reduce Supabase egress costs.
 * Use for all read-heavy operations that don't need real-time data.
 */

import { getOrCompute, invalidate, invalidatePattern, CACHE_KEYS } from './cache';
import { storage } from './storage';

// Extended cache key constants
export const EXTENDED_CACHE_KEYS = {
  ...CACHE_KEYS,
  PLAYERS_ACTIVE: 'players:active',
  PLAYERS_BY_SPORT: (sport: string) => `players:sport:${sport}`,
  PLAYERS_BY_TEAM: (team: string) => `players:team:${team}`,
  PLAYER_DETAILS: (id: string) => `player:${id}`,
  MARKET_SNAPSHOT: 'market:snapshot',
  PRICE_HISTORY: (playerId: string, days: number) => `price:${playerId}:${days}`,
  TOP_MOVERS: 'market:top_movers',
  TOP_PERFORMERS: 'market:top_performers',
  CONTESTS_ACTIVE: 'contests:active',
  LEADERBOARD_OVERALL: 'leaderboard:overall',
  NEWS_RECENT: 'news:recent',
  DAILY_GAMES: 'games:daily',
} as const;

// Cache TTL configurations (in milliseconds)
const CACHE_TTL = {
  PLAYERS_LIST: 60 * 1000,        // 1 minute
  PLAYER_DETAILS: 5 * 60 * 1000,  // 5 minutes
  MARKET_DATA: 30 * 1000,         // 30 seconds
  PRICE_HISTORY: 5 * 60 * 1000,   // 5 minutes
  LEADERBOARDS: 60 * 1000,        // 1 minute
  CONTESTS: 2 * 60 * 1000,        // 2 minutes
  NEWS: 5 * 60 * 1000,            // 5 minutes
  GAMES: 60 * 1000,               // 1 minute
} as const;

/**
 * Get active players with caching
 * Reduces DB queries from ~50/minute to ~1/minute per user
 */
export async function getCachedActivePlayers() {
  return getOrCompute(
    EXTENDED_CACHE_KEYS.PLAYERS_ACTIVE,
    () => storage.getActivePlayers(),
    CACHE_TTL.PLAYERS_LIST
  );
}

/**
 * Get player details with caching
 * Reduces DB queries when users view player profiles repeatedly
 */
export async function getCachedPlayer(playerId: string) {
  return getOrCompute(
    EXTENDED_CACHE_KEYS.PLAYER_DETAILS(playerId),
    () => storage.getPlayer(playerId),
    CACHE_TTL.PLAYER_DETAILS
  );
}

/**
 * Batch get players by IDs with caching
 * Critical for fixing N+1 queries in contest scoring
 */
export async function getCachedPlayersByIds(playerIds: string[]) {
  // Check cache for each player
  const cacheKey = EXTENDED_CACHE_KEYS.PLAYERS_BY_IDS(playerIds.sort().join(','));
  
  return getOrCompute(
    cacheKey,
    () => storage.getPlayersByIds(playerIds),
    CACHE_TTL.PLAYERS_LIST
  );
}

/**
 * Get market snapshot with short cache
 * Reduces DB load from repeated market data requests
 */
export async function getCachedMarketSnapshot() {
  return getOrCompute(
    EXTENDED_CACHE_KEYS.MARKET_SNAPSHOT,
    () => storage.getLatestMarketSnapshot(),
    CACHE_TTL.MARKET_DATA
  );
}

/**
 * Get top price movers with caching
 */
export async function getCachedTopMovers(limit: number = 5) {
  return getOrCompute(
    EXTENDED_CACHE_KEYS.TOP_MOVERS,
    () => storage.getTopPriceMovers(limit),
    CACHE_TTL.MARKET_DATA
  );
}

/**
 * Get top performers with caching
 */
export async function getCachedTopPerformers(limit: number = 5) {
  return getOrCompute(
    EXTENDED_CACHE_KEYS.TOP_PERFORMERS,
    () => storage.getTopPerformers(limit),
    CACHE_TTL.MARKET_DATA
  );
}

/**
 * Invalidate all player-related caches
 * Call this when player data changes
 */
export function invalidatePlayerCaches(playerId?: string) {
  if (playerId) {
    invalidate(EXTENDED_CACHE_KEYS.PLAYER_DETAILS(playerId));
  }
  invalidate(EXTENDED_CACHE_KEYS.PLAYERS_ACTIVE);
  invalidatePattern(/^players:/);
}

/**
 * Invalidate all market-related caches
 * Call this after market updates
 */
export function invalidateMarketCaches() {
  invalidate(EXTENDED_CACHE_KEYS.MARKET_SNAPSHOT);
  invalidate(EXTENDED_CACHE_KEYS.TOP_MOVERS);
  invalidate(EXTENDED_CACHE_KEYS.TOP_PERFORMERS);
  invalidate(CACHE_KEYS.MARKET_HEALTH);
}

// Re-export base cache functions
export { getOrCompute, invalidate, invalidatePattern, CACHE_KEYS };

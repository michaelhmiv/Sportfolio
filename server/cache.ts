/**
 * Simple in-memory cache with TTL support for slow-changing data.
 *
 * Use this for aggregates and rankings that don't need real-time accuracy.
 * DO NOT use for trade/order data which must always be fresh.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();
const inFlight = new Map<string, Promise<any>>();

// Default TTL of 60 seconds
const DEFAULT_TTL_MS = 60 * 1000;

/**
 * Get a cached value or compute it if missing/expired.
 *
 * @param key - Unique cache key
 * @param fetcher - Async function to compute the value if not cached
 * @param ttlMs - Time-to-live in milliseconds (default: 60s)
 */
export async function getOrCompute<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key);

  if (entry && entry.expiresAt > now) {
    return entry.data;
  }

  const existingInFlight = inFlight.get(key);
  if (existingInFlight) {
    return existingInFlight;
  }

  const pending = (async () => {
    const data = await fetcher();

    cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });

    return data;
  })();

  inFlight.set(key, pending);

  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) {
      inFlight.delete(key);
    }
  }
}

/**
 * Invalidate a specific cache key.
 */
export function invalidate(key: string): void {
  cache.delete(key);
}

/**
 * Invalidate all keys matching a pattern.
 */
export function invalidatePattern(pattern: RegExp): void {
  const keys = Array.from(cache.keys());
  for (const key of keys) {
    if (pattern.test(key)) {
      cache.delete(key);
    }
  }
}

/**
 * Clear all cached data.
 */
export function clearAll(): void {
  cache.clear();
  inFlight.clear();
}

// Cache key constants
export const CACHE_KEYS = {
  MARKET_HEALTH: "market_health",
  POWER_RANKINGS: "power_rankings",
  LEADERBOARD_NET_WORTH: "leaderboard:net_worth",
  LEADERBOARD_PORTFOLIO: "leaderboard:portfolio",
  LEADERBOARD_CASH: "leaderboard:cash",
  LEADERBOARD_MARKET_ORDERS: "leaderboard:market_orders",
} as const;

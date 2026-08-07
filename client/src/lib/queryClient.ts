import { QueryClient, QueryFunction, dehydrate, hydrate } from "@tanstack/react-query";
import { getNativeAuthToken } from "./native-auth";
import { resolveApiUrl } from "./native-runtime";
import { getClientPlatform } from "./native-platform";

const IS_DEV = import.meta.env.DEV;

function debugLog(stage: string, message: string, data?: any) {
  if (!IS_DEV) return;
  const elapsed = performance.now().toFixed(0);
  console.log(`[QUERY ${elapsed}ms] ${stage}: ${message}`, data || "");
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function getClientMetadataHeaders(): HeadersInit {
  const platform = getClientPlatform();
  return {
    "x-sportfolio-client-platform": platform,
    "x-sportfolio-client-runtime": platform === "web" ? "web" : "native",
  };
}

export async function getAuthHeaders(): Promise<HeadersInit> {
  if (getClientPlatform() === "web") return {};

  try {
    const accessToken = getNativeAuthToken();
    if (accessToken) {
      return { Authorization: `Bearer ${accessToken}` };
    }
  } catch (error) {
    debugLog("AUTH_HEADERS", "Failed to get native auth headers", {
      error: (error as Error).message,
    });
  }
  return {};
}

export async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const clientHeaders = getClientMetadataHeaders();
  return fetch(resolveApiUrl(url), {
    ...options,
    headers: {
      ...authHeaders,
      ...clientHeaders,
      ...options.headers,
    },
    credentials: "include",
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const clientHeaders = getClientMetadataHeaders();
  const res = await fetch(resolveApiUrl(url), {
    method,
    headers: {
      ...authHeaders,
      ...clientHeaders,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const queryPath = queryKey.join("/") as string;
    const url = resolveApiUrl(queryPath);
    const startTime = performance.now();
    debugLog("FETCH", `Starting request: ${queryPath}`);

    try {
      const authHeaders = await getAuthHeaders();
      const clientHeaders = getClientMetadataHeaders();

      if (unauthorizedBehavior === "returnNull") {
        const maxRetries = 3;
        const retryDelays = [500, 1000, 1500];

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            debugLog("FETCH", `TIMEOUT on attempt ${attempt + 1}: ${queryPath}`);
            controller.abort();
          }, 15000);

          try {
            const res = await fetch(url, {
              credentials: "include",
              headers: {
                ...authHeaders,
                ...clientHeaders,
              },
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            const elapsed = (performance.now() - startTime).toFixed(0);

            if (res.status === 401) {
              debugLog(
                "FETCH",
                `Got 401 on attempt ${attempt + 1}, ${attempt < maxRetries ? "retrying..." : "giving up"}`,
              );
              if (attempt < maxRetries) {
                await sleep(retryDelays[attempt]);
                continue;
              }
              return null;
            }

            debugLog("FETCH", `Completed in ${elapsed}ms: ${queryPath}`, { status: res.status });
            await throwIfResNotOk(res);
            return await res.json();
          } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
              debugLog(
                "FETCH",
                `Request aborted (timeout) on attempt ${attempt + 1}: ${queryPath}`,
              );
              if (attempt < maxRetries) {
                await sleep(retryDelays[attempt]);
                continue;
              }
            }
            throw error;
          }
        }
        return null;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        debugLog("FETCH", `TIMEOUT: ${queryPath}`);
        controller.abort();
      }, 15000);

      const res = await fetch(url, {
        credentials: "include",
        headers: {
          ...authHeaders,
          ...clientHeaders,
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const elapsed = (performance.now() - startTime).toFixed(0);
      debugLog("FETCH", `Completed in ${elapsed}ms: ${queryPath}`, { status: res.status });

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      const elapsed = (performance.now() - startTime).toFixed(0);
      debugLog("FETCH", `FAILED after ${elapsed}ms: ${queryPath}`, {
        error: error instanceof Error ? error.message : "Unknown error",
        isAbort: error instanceof Error && error.name === "AbortError",
      });
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 10000,
      retry: (failureCount, error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return failureCount < 2;
        }
        return false;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Query cache persistence via localStorage.
 *
 * Persists public/display queries so that the app shows content instantly
 * on cold start — no spinner on the first open after the initial load.
 * The native WebView localStorage survives app restarts.
 *
 * Only public display-layer queries are persisted. User financial data
 * (holdings, balance, auth) is intentionally excluded so it is always fresh.
 *
 * Cache is invalidated after 24 hours to prevent stale data.
 */
const CACHE_KEY = "sf-query-cache-v1";
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 hours

/** Query key prefixes that are safe to persist across restarts. */
const PERSISTABLE_PREFIXES = [
  "/api/players",
  "/api/leaderboard",
  "/api/news",
  "/api/sports",
  "/api/games",
  "/api/market/mobile-overview",
];

function isCacheable(queryKey: readonly unknown[]): boolean {
  if (!queryKey.length) return false;
  const key = queryKey[0];
  return typeof key === "string" && PERSISTABLE_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Tears down the query cache persistence subscription set up at module load.
 * No-op before persistence is initialized (e.g. in SSR or non-browser envs).
 */
export let cleanupQueryPersistence: () => void = () => undefined;

if (typeof window !== "undefined" && window.localStorage) {
  // Restore on startup
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const { timestamp, state } = JSON.parse(raw) as { timestamp: number; state: unknown };
      if (Date.now() - timestamp < CACHE_MAX_AGE_MS) {
        hydrate(queryClient, state);
      } else {
        localStorage.removeItem(CACHE_KEY);
      }
    }
  } catch {
    // Corrupted cache — ignore and start fresh
    localStorage.removeItem(CACHE_KEY);
  }

  // Persist on cache changes (debounced to avoid excessive writes).
  // The unsubscribe handle is retained at module scope so the subscription is
  // not garbage-collected until cleanupQueryPersistence() is called.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribePersist = queryClient.getQueryCache().subscribe(() => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        const dehydrated = dehydrate(queryClient, {
          shouldDehydrateQuery: (query) =>
            isCacheable(query.queryKey) && query.state.status === "success",
        });
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ timestamp: Date.now(), state: dehydrated }),
        );
      } catch {
        // QuotaExceededError or serialization failure — silently skip
      }
    }, 2000);
  });

  /**
   * Tears down the cache persistence subscription and clears any pending
   * debounce timer. Call this in tests that create a fresh QueryClient to
   * prevent subscription accumulation across test runs.
   */
  cleanupQueryPersistence = () => {
    unsubscribePersist();
    if (persistTimer) clearTimeout(persistTimer);
    cleanupQueryPersistence = () => undefined; // idempotent
  };
}

import { QueryClient, QueryFunction, dehydrate, hydrate } from "@tanstack/react-query";
import { getSupabase } from "./supabase";

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

export async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const supabase = await getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
  } catch (error) {
    debugLog("AUTH_HEADERS", "Failed to get auth headers", { error: (error as Error).message });
  }
  return {};
}

export async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
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
  const res = await fetch(url, {
    method,
    headers: {
      ...authHeaders,
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
    const url = queryKey.join("/") as string;
    const startTime = performance.now();
    debugLog("FETCH", `Starting request: ${url}`);

    try {
      const authHeaders = await getAuthHeaders();

      if (unauthorizedBehavior === "returnNull") {
        const maxRetries = 3;
        const retryDelays = [500, 1000, 1500];

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            debugLog("FETCH", `TIMEOUT on attempt ${attempt + 1}: ${url}`);
            controller.abort();
          }, 15000);

          try {
            const res = await fetch(url, {
              credentials: "include",
              headers: authHeaders,
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

            debugLog("FETCH", `Completed in ${elapsed}ms: ${url}`, { status: res.status });
            await throwIfResNotOk(res);
            return await res.json();
          } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
              debugLog("FETCH", `Request aborted (timeout) on attempt ${attempt + 1}: ${url}`);
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
        debugLog("FETCH", `TIMEOUT: ${url}`);
        controller.abort();
      }, 15000);

      const res = await fetch(url, {
        credentials: "include",
        headers: authHeaders,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const elapsed = (performance.now() - startTime).toFixed(0);
      debugLog("FETCH", `Completed in ${elapsed}ms: ${url}`, { status: res.status });

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      const elapsed = (performance.now() - startTime).toFixed(0);
      debugLog("FETCH", `FAILED after ${elapsed}ms: ${url}`, {
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
];

function isCacheable(queryKey: readonly unknown[]): boolean {
  if (!queryKey.length) return false;
  const key = queryKey[0];
  return typeof key === "string" && PERSISTABLE_PREFIXES.some((p) => key.startsWith(p));
}

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
  // The unsubscribe handle is intentionally retained at module scope so the
  // subscription is not garbage-collected, and to allow cleanup in tests.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const _unsubscribePersist = queryClient.getQueryCache().subscribe(() => {
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
  // Exported for tests that need to clean up the subscription.
  (queryClient as QueryClient & { _cleanupPersist?: () => void })._cleanupPersist = () => {
    _unsubscribePersist();
    if (persistTimer) clearTimeout(persistTimer);
  };
}

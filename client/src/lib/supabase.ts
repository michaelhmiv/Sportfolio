import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseInstance: SupabaseClient | null = null;
let initializationPromise: Promise<SupabaseClient> | null = null;

const CONFIG_CACHE_KEY = "supabase_config_v2";
const LEGACY_CONFIG_CACHE_KEY = "supabase_config";
const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// IMPORTANT: Supabase client defaults to a specific storage key; using a custom key can break
// session persistence across contexts (e.g., installed PWA vs browser tab) and across upgrades.
// Prefer the default key unless there's a strong reason to customize.
const AUTH_STORAGE_KEY = "sb-auth-token";

interface SupabaseConfigResponse {
  url: string;
  anonKey: string;
  configVersion?: string;
}

interface CachedConfig extends SupabaseConfigResponse {
  cachedAt: number;
  origin: string;
}

// Custom storage adapter that uses both localStorage and sessionStorage as fallback
// This helps with PWA session persistence on Android
const customStorageAdapter = {
  getItem: (key: string): string | null => {
    try {
      // Try localStorage first
      const value = localStorage.getItem(key);
      if (value) return value;

      // Fallback to sessionStorage (for PWA edge cases)
      return sessionStorage.getItem(key);
    } catch (e) {
      console.warn("[SUPABASE] Storage read failed:", e);
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      // Store in both for redundancy
      localStorage.setItem(key, value);
      sessionStorage.setItem(key, value);
    } catch (e) {
      console.warn("[SUPABASE] Storage write failed:", e);
      // Try sessionStorage only as fallback
      try {
        sessionStorage.setItem(key, value);
      } catch (e2) {
        console.error("[SUPABASE] All storage failed:", e2);
      }
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch (e) {
      console.warn("[SUPABASE] Storage remove failed:", e);
    }
  },
};

function debugLog(stage: string, message: string, data?: any) {
  const elapsed = performance.now().toFixed(0);
  console.log(`[SUPABASE ${elapsed}ms] ${stage}: ${message}`, data || "");
}

function getCachedConfigFromV2(): CachedConfig | null {
  try {
    const cached = localStorage.getItem(CONFIG_CACHE_KEY);
    if (!cached) return null;

    const config = JSON.parse(cached) as CachedConfig;
    const age = Date.now() - config.cachedAt;

    if (!config.url || !config.anonKey || !config.origin) {
      localStorage.removeItem(CONFIG_CACHE_KEY);
      return null;
    }

    if (config.origin !== window.location.origin || age > CONFIG_CACHE_TTL_MS) {
      localStorage.removeItem(CONFIG_CACHE_KEY);
      return null;
    }

    return config;
  } catch {
    localStorage.removeItem(CONFIG_CACHE_KEY);
    return null;
  }
}

function getCachedConfigFromLegacy(): CachedConfig | null {
  try {
    const cached = localStorage.getItem(LEGACY_CONFIG_CACHE_KEY);
    if (!cached) return null;

    const config = JSON.parse(cached) as Partial<CachedConfig>;
    if (typeof config.url !== "string" || typeof config.anonKey !== "string") {
      localStorage.removeItem(LEGACY_CONFIG_CACHE_KEY);
      return null;
    }

    if (typeof config.cachedAt === "number") {
      const age = Date.now() - config.cachedAt;
      if (age > CONFIG_CACHE_TTL_MS) {
        localStorage.removeItem(LEGACY_CONFIG_CACHE_KEY);
        return null;
      }
    }

    const migratedConfig: CachedConfig = {
      url: config.url,
      anonKey: config.anonKey,
      configVersion: typeof config.configVersion === "string" ? config.configVersion : undefined,
      cachedAt: typeof config.cachedAt === "number" ? config.cachedAt : Date.now(),
      origin: window.location.origin,
    };
    localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(migratedConfig));
    localStorage.removeItem(LEGACY_CONFIG_CACHE_KEY);
    debugLog("CONFIG", "Using legacy Supabase config cache fallback");
    return migratedConfig;
  } catch {
    localStorage.removeItem(LEGACY_CONFIG_CACHE_KEY);
    return null;
  }
}

function getCachedConfig(): CachedConfig | null {
  return getCachedConfigFromV2() ?? getCachedConfigFromLegacy();
}

function setCachedConfig(config: SupabaseConfigResponse): void {
  try {
    const cachedConfig: CachedConfig = {
      ...config,
      cachedAt: Date.now(),
      origin: window.location.origin,
    };
    localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(cachedConfig));
    // Ensure legacy key does not keep stale project data around.
    localStorage.removeItem(LEGACY_CONFIG_CACHE_KEY);
  } catch {
    // Ignore localStorage errors
  }
}

function createSupabaseFromConfig(config: SupabaseConfigResponse): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      // Use default storage key for compatibility with Supabase session management.
      storageKey: AUTH_STORAGE_KEY,
      storage: customStorageAdapter,
      flowType: "pkce",
    },
  });
}

async function fetchSupabaseConfig(): Promise<SupabaseConfigResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    debugLog("CONFIG", "TIMEOUT - Aborting after 5 seconds");
    controller.abort();
  }, 5000);

  const startTime = performance.now();
  let response: Response;
  try {
    response = await fetch("/api/auth/config", {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const elapsed = (performance.now() - startTime).toFixed(0);
  debugLog("CONFIG", `Response received in ${elapsed}ms, status: ${response.status}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch Supabase config: ${response.status}`);
  }

  const config = (await response.json()) as SupabaseConfigResponse;
  if (!config.url || !config.anonKey) {
    throw new Error("Invalid Supabase config response");
  }

  return config;
}

function isSameConfig(cached: CachedConfig | null, fresh: SupabaseConfigResponse): boolean {
  if (!cached) return false;
  return cached.url === fresh.url && cached.anonKey === fresh.anonKey;
}

async function initializeSupabase(): Promise<SupabaseClient> {
  debugLog("INIT", "Starting Supabase initialization");

  if (supabaseInstance) {
    debugLog("INIT", "Returning cached Supabase instance");
    return supabaseInstance;
  }

  const cachedConfig = getCachedConfig();

  try {
    debugLog("CONFIG", "Fetching fresh /api/auth/config...");
    const freshConfig = await fetchSupabaseConfig();

    if (cachedConfig && !isSameConfig(cachedConfig, freshConfig)) {
      debugLog("CONFIG", "Supabase config changed, replacing stale cached config", {
        previousVersion: cachedConfig.configVersion || "unknown",
        freshVersion: freshConfig.configVersion || "unknown",
      });
    }

    setCachedConfig(freshConfig);
    supabaseInstance = createSupabaseFromConfig(freshConfig);
    debugLog("CLIENT", "Supabase client created from fresh config", {
      configVersion: freshConfig.configVersion || "unknown",
    });
    return supabaseInstance;
  } catch (error) {
    if (cachedConfig) {
      debugLog("CONFIG", "Fresh config unavailable; using cached fallback", {
        error: (error as Error).message,
        configVersion: cachedConfig.configVersion || "unknown",
      });
      supabaseInstance = createSupabaseFromConfig(cachedConfig);
      debugLog("CLIENT", "Supabase client created from cached fallback");
      return supabaseInstance;
    }

    if (error instanceof Error && error.name === "AbortError") {
      debugLog("ERROR", "Config fetch timed out after 5 seconds");
    } else {
      debugLog("ERROR", "Failed to initialize Supabase", { error: (error as Error).message });
    }
    throw error;
  }
}

export function getSupabase(): Promise<SupabaseClient> {
  debugLog("GET", "getSupabase() called", { hasPromise: !!initializationPromise });

  if (!initializationPromise) {
    debugLog("GET", "Creating new initialization promise");
    initializationPromise = initializeSupabase().catch((error) => {
      debugLog("GET", "Initialization failed, clearing promise for retry");
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

export function resetSupabase() {
  debugLog("RESET", "Resetting Supabase instance for retry");
  supabaseInstance = null;
  initializationPromise = null;
}

export { supabaseInstance as supabase };

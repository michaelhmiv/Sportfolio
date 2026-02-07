import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;
let initializationPromise: Promise<SupabaseClient> | null = null;

const CONFIG_CACHE_KEY = 'supabase_config';
const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// IMPORTANT: Supabase client defaults to a specific storage key; using a custom key can break
// session persistence across contexts (e.g., installed PWA vs browser tab) and across upgrades.
// Prefer the default key unless there's a strong reason to customize.
const AUTH_STORAGE_KEY = 'sb-auth-token';

interface CachedConfig {
  url: string;
  anonKey: string;
  cachedAt: number;
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
      console.warn('[SUPABASE] Storage read failed:', e);
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      // Store in both for redundancy
      localStorage.setItem(key, value);
      sessionStorage.setItem(key, value);
    } catch (e) {
      console.warn('[SUPABASE] Storage write failed:', e);
      // Try sessionStorage only as fallback
      try {
        sessionStorage.setItem(key, value);
      } catch (e2) {
        console.error('[SUPABASE] All storage failed:', e2);
      }
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch (e) {
      console.warn('[SUPABASE] Storage remove failed:', e);
    }
  },
};

function debugLog(stage: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const elapsed = performance.now().toFixed(0);
  console.log(`[SUPABASE ${elapsed}ms] ${stage}: ${message}`, data || '');
}

function getCachedConfig(): CachedConfig | null {
  try {
    const cached = localStorage.getItem(CONFIG_CACHE_KEY);
    if (!cached) return null;

    const config: CachedConfig = JSON.parse(cached);
    const age = Date.now() - config.cachedAt;

    if (age > CONFIG_CACHE_TTL_MS) {
      localStorage.removeItem(CONFIG_CACHE_KEY);
      return null;
    }

    return config;
  } catch {
    return null;
  }
}

function setCachedConfig(url: string, anonKey: string): void {
  try {
    const config: CachedConfig = { url, anonKey, cachedAt: Date.now() };
    localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
  } catch {
    // Ignore localStorage errors
  }
}

async function initializeSupabase(): Promise<SupabaseClient> {
  debugLog('INIT', 'Starting Supabase initialization');

  if (supabaseInstance) {
    debugLog('INIT', 'Returning cached Supabase instance');
    return supabaseInstance;
  }

  // Try localStorage cache first for instant initialization
  const cachedConfig = getCachedConfig();
  if (cachedConfig) {
    debugLog('CONFIG', 'Using cached config from localStorage');
    supabaseInstance = createClient(cachedConfig.url, cachedConfig.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // Use default storage key for compatibility with Supabase session management.
        storageKey: AUTH_STORAGE_KEY,
        storage: customStorageAdapter,
        flowType: 'pkce',
      },
    });
    debugLog('CLIENT', 'Supabase client created from cache');
    return supabaseInstance;
  }

  try {
    debugLog('CONFIG', 'Fetching /api/auth/config...');
    const startTime = performance.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      debugLog('CONFIG', 'TIMEOUT - Aborting after 5 seconds');
      controller.abort();
    }, 5000);

    const response = await fetch('/api/auth/config', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const elapsed = (performance.now() - startTime).toFixed(0);
    debugLog('CONFIG', `Response received in ${elapsed}ms, status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch Supabase config: ${response.status}`);
    }

    const config = await response.json();
    debugLog('CONFIG', 'Config parsed successfully', { url: config.url?.substring(0, 30) + '...' });

    // Cache config for future visits
    setCachedConfig(config.url, config.anonKey);

    debugLog('CLIENT', 'Creating Supabase client...');
    supabaseInstance = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // Use default storage key for compatibility with Supabase session management.
        storageKey: AUTH_STORAGE_KEY,
        storage: customStorageAdapter,
        flowType: 'pkce',
      },
    });
    debugLog('CLIENT', 'Supabase client created successfully');

    return supabaseInstance;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      debugLog('ERROR', 'Config fetch TIMED OUT after 5 seconds - server may be down');
    } else {
      debugLog('ERROR', 'Failed to initialize Supabase', { error: (error as Error).message });
    }
    throw error;
  }
}

export function getSupabase(): Promise<SupabaseClient> {
  debugLog('GET', 'getSupabase() called', { hasPromise: !!initializationPromise });

  if (!initializationPromise) {
    debugLog('GET', 'Creating new initialization promise');
    initializationPromise = initializeSupabase().catch((error) => {
      debugLog('GET', 'Initialization failed, clearing promise for retry');
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

export function resetSupabase() {
  debugLog('RESET', 'Resetting Supabase instance for retry');
  supabaseInstance = null;
  initializationPromise = null;
}

export { supabaseInstance as supabase };

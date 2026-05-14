import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  ReactNode,
} from "react";
import type { User } from "@shared/schema";
import {
  getAuthSession,
  getSupabase,
  resetSupabase,
  updateNativeAuthRefreshState,
} from "@/lib/supabase";
import { isValidEmail, normalizeEmail } from "@/lib/auth-input";
import { useToast } from "@/hooks/use-toast";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { normalizeSiteUrl } from "@shared/seo";
import { unregisterPushTokenOnLogout } from "@/lib/mobile-push";
import { resolveApiUrl, resolvePublicAppUrl } from "@/lib/native-runtime";

const MOBILE_AUTH_REDIRECT_URL = "sportfolio://auth/callback";
const IS_DEV = import.meta.env.DEV;

function getWebAuthRedirectUrl(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const configuredSiteUrl = normalizeSiteUrl(
    import.meta.env.VITE_PUBLIC_SITE_URL ||
      import.meta.env.PUBLIC_SITE_URL ||
      resolvePublicAppUrl("/"),
  );

  return `${configuredSiteUrl}/auth/callback`;
}

function normalizePostAuthRedirect(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }

  if (!path.startsWith("/") || path.startsWith("//")) {
    return null;
  }

  return path;
}

function debugLog(stage: string, message: string, data?: any) {
  if (!IS_DEV) return;
  const elapsed = performance.now().toFixed(0);
  console.log(`[AUTH ${elapsed}ms] ${stage}: ${message}`, data || "");
}

function trackAuthEvent(event: string, data?: Record<string, unknown>) {
  console.info(`[AUTH_EVENT] ${event}`, data || {});
  const payload = {
    event,
    code: typeof data?.code === "string" ? data.code : undefined,
  };

  void fetch(resolveApiUrl("/api/auth/telemetry"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

type AuthErrorCode =
  | "invalid_email"
  | "email_exists"
  | "invalid_credentials"
  | "email_unconfirmed"
  | "rate_limited"
  | "service_unavailable"
  | "signup_disabled"
  | "unknown";

interface AuthFailureResult {
  success: false;
  error: string;
  code: AuthErrorCode;
}

interface AuthSuccessResult {
  success: true;
}

type AuthResult = AuthSuccessResult | AuthFailureResult;

function mapAuthError(
  error: unknown,
  context: "login" | "signup" | "resend" | "oauth",
): AuthFailureResult {
  const rawMessage = error instanceof Error ? error.message : String(error || "Unknown error");
  const message = rawMessage.toLowerCase();

  if (message.includes("invalid email")) {
    return { success: false, code: "invalid_email", error: "Please enter a valid email address." };
  }

  if (message.includes("already registered") || message.includes("already exists")) {
    return {
      success: false,
      code: "email_exists",
      error: "An account with this email already exists. Try signing in instead.",
    };
  }

  if (message.includes("invalid login credentials")) {
    return {
      success: false,
      code: "invalid_credentials",
      error: "Invalid email or password.",
    };
  }

  if (message.includes("email not confirmed")) {
    return {
      success: false,
      code: "email_unconfirmed",
      error: "Please verify your email before signing in.",
    };
  }

  if (
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("for security purposes")
  ) {
    return {
      success: false,
      code: "rate_limited",
      error: "Too many attempts right now. Please wait a minute and try again.",
    };
  }

  if (message.includes("signups not allowed") || message.includes("signup is disabled")) {
    return {
      success: false,
      code: "signup_disabled",
      error: "Sign up is temporarily unavailable. Please try again shortly.",
    };
  }

  if (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("service unavailable")
  ) {
    return {
      success: false,
      code: "service_unavailable",
      error: "Unable to reach authentication service. Please try again.",
    };
  }

  if (context === "oauth") {
    return {
      success: false,
      code: "unknown",
      error: "Could not complete OAuth sign in. Please try again.",
    };
  }

  return {
    success: false,
    code: "unknown",
    error: rawMessage || "Authentication request failed.",
  };
}

interface AuthUserResponse extends User {
  whopSync?: {
    credited: number;
    revoked: number;
    synced: number;
  };
  premiumActive?: boolean;
  rewardedScoutBoostActive?: boolean;
  rewardedScoutBoostExpiresAt?: string | null;
  maxScouts?: number;
}

interface AuthContextValue {
  session: Session | null;
  isInitialized: boolean;
  supabaseClient: SupabaseClient | null;
  initError: string | null;
  retryInit: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  isInitialized: false,
  supabaseClient: null,
  initError: null,
  retryInit: () => {},
});

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const initializingRef = useRef(false);
  const initAttemptRef = useRef(0);

  const initializeAuth = useCallback(async () => {
    const attempt = ++initAttemptRef.current;
    debugLog("PROVIDER", `Starting auth initialization (attempt ${attempt})`);

    try {
      debugLog("PROVIDER", "Calling getSupabase()...");
      const startTime = performance.now();
      const client = await getSupabase();
      debugLog(
        "PROVIDER",
        `getSupabase() completed in ${(performance.now() - startTime).toFixed(0)}ms`,
      );

      setSupabaseClient(client);
      setInitError(null);

      debugLog("SESSION", "Calling client.auth.getSession()...");
      const sessionStart = performance.now();

      let initialSession: Session | null = null;
      let sessionError: Error | null = null;
      try {
        initialSession = await getAuthSession(client);
      } catch (error) {
        sessionError = error instanceof Error ? error : new Error(String(error));
      }

      try {
        await updateNativeAuthRefreshState(true, client);
      } catch (error) {
        debugLog("SESSION", "Native auto refresh setup failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      debugLog(
        "SESSION",
        `getSession() completed in ${(performance.now() - sessionStart).toFixed(0)}ms`,
        {
          hasSession: !!initialSession,
          error: sessionError?.message,
        },
      );

      if (sessionError) {
        debugLog("SESSION", "Session error:", sessionError.message);
      }

      setSession(initialSession);
      setIsInitialized(true);
      debugLog("PROVIDER", "Auth initialized successfully", { hasSession: !!initialSession });

      debugLog("LISTENER", "Setting up onAuthStateChange listener...");
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange(async (event, newSession) => {
        debugLog("STATE_CHANGE", `Auth state changed: ${event}`, { hasSession: !!newSession });
        setSession(newSession);

        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        } else if (event === "SIGNED_OUT") {
          queryClient.setQueryData(["/api/auth/user"], null);
        }
      });

      subscriptionRef.current = subscription;
      debugLog("LISTENER", "Auth state listener registered");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      debugLog("ERROR", `Auth initialization FAILED (attempt ${attempt})`, { error: errorMessage });
      setInitError(errorMessage);
      setIsInitialized(true);
    }
  }, [queryClient]);

  const retryInit = useCallback(() => {
    debugLog("RETRY", "User triggered auth retry");
    // Clean up existing subscription before retry
    if (subscriptionRef.current) {
      debugLog("RETRY", "Cleaning up existing auth listener");
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }
    setInitError(null);
    setIsInitialized(false);
    setSupabaseClient(null);
    setSession(null);
    initializingRef.current = false;
    resetSupabase();
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (initializingRef.current) {
      debugLog("PROVIDER", "Skipping duplicate initialization");
      return;
    }
    initializingRef.current = true;

    debugLog("PROVIDER", "AuthProvider mounted, starting initialization");
    initializeAuth();

    return () => {
      debugLog("PROVIDER", "AuthProvider unmounting, cleaning up");
      subscriptionRef.current?.unsubscribe();
    };
  }, [initializeAuth]);

  return (
    <AuthContext.Provider value={{ session, isInitialized, supabaseClient, initError, retryInit }}>
      {children}
    </AuthContext.Provider>
  );
}

// Dev mode bypass - automatically authenticate with mock user
const DEV_BYPASS_ENABLED = import.meta.env.DEV;

// DEV_MOCK_USER removed - we now fetch the actual dev user from the backend

export function useAuth() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session, isInitialized, supabaseClient, initError, retryInit } = useContext(AuthContext);

  // In dev mode, return mock user immediately
  const fetchUserWithToken = useCallback(async (): Promise<AuthUserResponse | null> => {
    // In dev mode, we might not have a session, but backend allows bypass.
    // So we should try fetching user even without a token if we're in dev mode.
    if (!session?.access_token && !DEV_BYPASS_ENABLED) {
      debugLog("FETCH_USER", "No session or access token, returning null");
      return null;
    }

    debugLog("FETCH_USER", "fetchUserWithToken called", {
      hasSession: !!session,
      hasClient: !!supabaseClient,
      hasToken: !!session?.access_token,
      isDev: DEV_BYPASS_ENABLED,
    });

    try {
      debugLog("FETCH_USER", "Fetching /api/auth/user...");
      const startTime = performance.now();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        debugLog("FETCH_USER", "TIMEOUT - Aborting after 10 seconds");
        controller.abort();
      }, 10000);

      const headers: HeadersInit = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      } else if (DEV_BYPASS_ENABLED) {
        // In dev mode without token, backend will auto-authenticate as mock user
        debugLog("FETCH_USER", "Dev mode: Fetching without token to trigger backend bypass");
      }

      const clientPlatform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
      const syncWhopOnAuth = clientPlatform !== "ios";
      headers["x-sportfolio-client-platform"] = clientPlatform;
      headers["x-sportfolio-client-runtime"] = clientPlatform === "web" ? "web" : "native";

      const response = await fetch(
        resolveApiUrl(`/api/auth/user?sync=${syncWhopOnAuth ? "true" : "false"}`),
        {
          headers,
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);
      const elapsed = (performance.now() - startTime).toFixed(0);
      debugLog("FETCH_USER", `Response received in ${elapsed}ms, status: ${response.status}`);

      if (!response.ok) {
        if (response.status === 401) {
          debugLog("FETCH_USER", "Got 401, returning null");
          return null;
        }
        throw new Error(`Failed to fetch user: ${response.status}`);
      }

      const userData = await response.json();
      debugLog("FETCH_USER", "User data received", { username: userData?.username });
      return userData;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        debugLog("FETCH_USER", "ERROR - Request timed out after 10 seconds");
      } else {
        debugLog("FETCH_USER", "ERROR - Fetch failed", { error: (error as Error).message });
      }
      return null;
    }
  }, [session, supabaseClient]);

  const { data: user, isLoading: isQueryLoading } = useQuery<AuthUserResponse | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUserWithToken,
    // In dev mode, always enable the query; in production, require session
    enabled: DEV_BYPASS_ENABLED || (isInitialized && !!supabaseClient && !!session),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
  });

  useEffect(() => {
    if (user?.whopSync?.credited && user.whopSync.credited > 0) {
      toast({
        title: "Premium Shares Credited!",
        description: `${user.whopSync.credited} Premium Share${user.whopSync.credited > 1 ? "s" : ""} from your Whop purchase${user.whopSync.credited > 1 ? "s" : ""} ${user.whopSync.credited > 1 ? "have" : "has"} been added to your account.`,
        duration: 8000,
      });
    }
  }, [user?.whopSync?.credited, toast]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const normalizedEmail = normalizeEmail(email);
      debugLog("LOGIN", "Login attempt", { email: normalizedEmail });
      trackAuthEvent("login_submit", { emailDomain: normalizedEmail.split("@")[1] || "unknown" });
      try {
        if (!supabaseClient) {
          throw new Error("Auth not initialized");
        }

        if (!isValidEmail(normalizedEmail)) {
          return {
            success: false,
            code: "invalid_email" as const,
            error: "Please enter a valid email address.",
          };
        }

        const { error } = await supabaseClient.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) throw error;
        debugLog("LOGIN", "Login successful");
        trackAuthEvent("login_success");
        return { success: true };
      } catch (error: unknown) {
        const mapped = mapAuthError(error, "login");
        debugLog("LOGIN", "Login failed", { error: mapped.error, code: mapped.code });
        trackAuthEvent("login_failure", { code: mapped.code });
        return mapped;
      }
    },
    [supabaseClient],
  );

  const signup = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const normalizedEmail = normalizeEmail(email);
      debugLog("SIGNUP", "Signup attempt", { email: normalizedEmail });
      trackAuthEvent("signup_submit", { emailDomain: normalizedEmail.split("@")[1] || "unknown" });
      try {
        if (!supabaseClient) {
          throw new Error("Auth not initialized");
        }

        if (!isValidEmail(normalizedEmail)) {
          return {
            success: false,
            code: "invalid_email" as const,
            error: "Please enter a valid email address.",
          };
        }

        const { error } = await supabaseClient.auth.signUp({
          email: normalizedEmail,
          password,
        });

        if (error) throw error;
        debugLog("SIGNUP", "Signup successful");
        trackAuthEvent("signup_success");
        return { success: true };
      } catch (error: unknown) {
        const mapped = mapAuthError(error, "signup");
        debugLog("SIGNUP", "Signup failed", { error: mapped.error, code: mapped.code });
        trackAuthEvent("signup_failure", { code: mapped.code });
        return mapped;
      }
    },
    [supabaseClient],
  );

  const resendVerification = useCallback(
    async (email: string): Promise<AuthResult> => {
      const normalizedEmail = normalizeEmail(email);
      debugLog("RESEND", "Verification resend requested", { email: normalizedEmail });
      trackAuthEvent("signup_resend_clicked", {
        emailDomain: normalizedEmail.split("@")[1] || "unknown",
      });

      try {
        if (!supabaseClient) {
          throw new Error("Auth not initialized");
        }

        if (!isValidEmail(normalizedEmail)) {
          return {
            success: false,
            code: "invalid_email" as const,
            error: "Please enter a valid email address.",
          };
        }

        const emailRedirectTo = getWebAuthRedirectUrl();

        const { error } = await supabaseClient.auth.resend({
          type: "signup",
          email: normalizedEmail,
          options: {
            emailRedirectTo,
          },
        });

        if (error) throw error;
        debugLog("RESEND", "Verification resend successful");
        trackAuthEvent("signup_resend_success");
        return { success: true };
      } catch (error: unknown) {
        const mapped = mapAuthError(error, "resend");
        debugLog("RESEND", "Verification resend failed", {
          error: mapped.error,
          code: mapped.code,
        });
        trackAuthEvent("signup_resend_failure", { code: mapped.code });
        return mapped;
      }
    },
    [supabaseClient],
  );

  const logout = useCallback(async () => {
    debugLog("LOGOUT", "Logout attempt");
    try {
      if (!supabaseClient) {
        throw new Error("Auth not initialized");
      }

      await unregisterPushTokenOnLogout();
      await supabaseClient.auth.signOut();

      queryClient.removeQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          if (typeof key !== "string") return false;
          const userScopedPaths = [
            "/api/auth",
            "/api/dashboard",
            "/api/holdings",
            "/api/portfolio",
            "/api/admin",
            "/api/whop",
          ];
          return userScopedPaths.some((path) => key.startsWith(path));
        },
      });

      debugLog("LOGOUT", "Logout successful");
      return { success: true };
    } catch (error: any) {
      debugLog("LOGOUT", "Logout failed", { error: error.message });
      return { success: false, error: error.message };
    }
  }, [supabaseClient, queryClient]);

  const loginWithGoogle = useCallback(
    async (postAuthRedirectPath?: string): Promise<AuthResult> => {
      debugLog("GOOGLE_LOGIN", "Google login attempt");
      try {
        if (!supabaseClient) {
          throw new Error("Auth not initialized");
        }

        const normalizedRedirect = normalizePostAuthRedirect(postAuthRedirectPath);

        if (Capacitor.isNativePlatform()) {
          const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo: MOBILE_AUTH_REDIRECT_URL,
              skipBrowserRedirect: true,
            },
          });

          if (error) throw error;
          if (!data?.url) {
            throw new Error("Could not start mobile OAuth flow");
          }

          await Browser.open({
            url: data.url,
            windowName: "_self",
          });
        } else {
          if (normalizedRedirect && typeof window !== "undefined") {
            window.sessionStorage.setItem("auth_post_redirect", normalizedRedirect);
          }

          const redirectTo = getWebAuthRedirectUrl();
          const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo,
            },
          });

          if (error) throw error;
        }

        debugLog("GOOGLE_LOGIN", "Google OAuth initiated");
        trackAuthEvent("google_oauth_started");
        return { success: true };
      } catch (error: unknown) {
        const mapped = mapAuthError(error, "oauth");
        debugLog("GOOGLE_LOGIN", "Google login failed", { error: mapped.error, code: mapped.code });
        trackAuthEvent("google_oauth_failure", { code: mapped.code });
        return mapped;
      }
    },
    [supabaseClient],
  );

  const loginWithDiscord = useCallback(
    async (postAuthRedirectPath?: string): Promise<AuthResult> => {
      debugLog("DISCORD_LOGIN", "Discord login attempt");
      try {
        if (!supabaseClient) {
          throw new Error("Auth not initialized");
        }

        const normalizedRedirect = normalizePostAuthRedirect(postAuthRedirectPath);

        if (Capacitor.isNativePlatform()) {
          const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: "discord",
            options: {
              redirectTo: MOBILE_AUTH_REDIRECT_URL,
              skipBrowserRedirect: true,
            },
          });

          if (error) throw error;
          if (!data?.url) {
            throw new Error("Could not start mobile OAuth flow");
          }

          await Browser.open({
            url: data.url,
            windowName: "_self",
          });
        } else {
          if (normalizedRedirect && typeof window !== "undefined") {
            window.sessionStorage.setItem("auth_post_redirect", normalizedRedirect);
          }

          const redirectTo = getWebAuthRedirectUrl();
          const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: "discord",
            options: {
              redirectTo,
            },
          });

          if (error) throw error;
        }

        debugLog("DISCORD_LOGIN", "Discord OAuth initiated");
        trackAuthEvent("discord_oauth_started");
        return { success: true };
      } catch (error: unknown) {
        const mapped = mapAuthError(error, "oauth");
        debugLog("DISCORD_LOGIN", "Discord login failed", {
          error: mapped.error,
          code: mapped.code,
        });
        trackAuthEvent("discord_oauth_failure", { code: mapped.code });
        return mapped;
      }
    },
    [supabaseClient],
  );

  // In dev mode, we're never loading and always authenticated
  const isLoading = DEV_BYPASS_ENABLED ? false : !isInitialized || isQueryLoading;

  return {
    user: user || undefined,
    session,
    isLoading,
    // In dev mode, authenticated once user query returns; in production, require session
    isAuthenticated: DEV_BYPASS_ENABLED ? !!user : !!session && !!user,
    login,
    signup,
    resendVerification,
    logout,
    loginWithGoogle,
    loginWithDiscord,
    initError,
    retryInit,
  };
}

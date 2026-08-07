import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { User } from "@shared/schema";
import { isValidEmail, normalizeEmail } from "@/lib/auth-input";
import {
  clearNativeAuthSession,
  getNativeAuthSession,
  NATIVE_AUTH_EVENT,
  requestNativeMagicLink,
  type NativeAuthSession,
} from "@/lib/native-auth";
import {
  broadcastWebAuthChange,
  requestPasswordlessEmail,
  WEB_AUTH_CHANNEL,
} from "@/lib/passwordless-auth";
import { resolveApiUrl } from "@/lib/native-runtime";
import { unregisterPushTokenOnLogout } from "@/lib/mobile-push";
import { useToast } from "@/hooks/use-toast";

const DEV_BYPASS_ENABLED = import.meta.env.DEV;

function debugLog(stage: string, message: string, data?: unknown) {
  if (!DEV_BYPASS_ENABLED) return;
  const elapsed = typeof performance !== "undefined" ? performance.now().toFixed(0) : "0";
  console.log(`[AUTH ${elapsed}ms] ${stage}: ${message}`, data || "");
}

function trackAuthEvent(event: string, data?: Record<string, unknown>) {
  const payload = {
    event,
    code: typeof data?.code === "string" ? data.code : undefined,
  };
  void fetch(resolveApiUrl("/api/auth/telemetry"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

type AuthErrorCode =
  | "invalid_email"
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

interface AuthUserResponse extends User {
  whopSync?: { credited: number; revoked: number; synced: number };
  premiumActive?: boolean;
  rewardedScoutBoostActive?: boolean;
  rewardedScoutBoostExpiresAt?: string | null;
  maxScouts?: number;
}

interface AuthContextValue {
  session: NativeAuthSession | null;
  isInitialized: boolean;
  initError: string | null;
  retryInit: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  isInitialized: false,
  initError: null,
  retryInit: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<NativeAuthSession | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const initializeAuth = useCallback(() => {
    try {
      setSession(Capacitor.isNativePlatform() ? getNativeAuthSession() : null);
      setInitError(null);
    } catch (error) {
      setInitError(error instanceof Error ? error.message : "Authentication could not initialize.");
    } finally {
      setIsInitialized(true);
    }
  }, []);

  const retryInit = useCallback(() => {
    setIsInitialized(false);
    initializeAuth();
    void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  }, [initializeAuth, queryClient]);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      if (Capacitor.isNativePlatform()) setSession(getNativeAuthSession());
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    };
    window.addEventListener(NATIVE_AUTH_EVENT, refresh);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(WEB_AUTH_CHANNEL);
      channel.onmessage = refresh;
    } catch {
      channel = null;
    }
    const storageListener = (event: StorageEvent) => {
      if (event.key === WEB_AUTH_CHANNEL) refresh();
    };
    window.addEventListener("storage", storageListener);
    return () => {
      window.removeEventListener(NATIVE_AUTH_EVENT, refresh);
      window.removeEventListener("storage", storageListener);
      channel?.close();
    };
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ session, isInitialized, initError, retryInit }}>
      {children}
    </AuthContext.Provider>
  );
}

function mapPasswordlessError(error: unknown): AuthFailureResult {
  const message =
    error instanceof Error ? error.message : String(error || "Authentication failed.");
  const normalized = message.toLowerCase();
  if (normalized.includes("valid email")) {
    return { success: false, code: "invalid_email", error: "Please enter a valid email address." };
  }
  if (normalized.includes("rate")) {
    return {
      success: false,
      code: "rate_limited",
      error: "Too many attempts right now. Please wait a minute and try again.",
    };
  }
  if (normalized.includes("registration") || normalized.includes("signup")) {
    return {
      success: false,
      code: "signup_disabled",
      error: "New account registration is temporarily unavailable.",
    };
  }
  return {
    success: false,
    code: "service_unavailable",
    error: message || "Authentication is temporarily unavailable.",
  };
}

export function useAuth() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session, isInitialized, initError, retryInit } = useContext(AuthContext);

  const fetchUser = useCallback(async (): Promise<AuthUserResponse | null> => {
    try {
      const headers: HeadersInit = {};
      if (Capacitor.isNativePlatform()) {
        const token = session?.accessToken;
        if (!token && !DEV_BYPASS_ENABLED) return null;
        if (token) headers.Authorization = `Bearer ${token}`;
      }

      const clientPlatform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
      headers["x-sportfolio-client-platform"] = clientPlatform;
      headers["x-sportfolio-client-runtime"] = clientPlatform === "web" ? "web" : "native";
      const response = await fetch(
        resolveApiUrl(`/api/auth/user?sync=${clientPlatform === "ios" ? "false" : "true"}`),
        { headers, credentials: "include" },
      );
      if (response.status === 401) return null;
      if (!response.ok) throw new Error(`Failed to fetch user: ${response.status}`);
      return (await response.json()) as AuthUserResponse;
    } catch (error) {
      debugLog("FETCH_USER", "User fetch failed", error);
      return null;
    }
  }, [session?.accessToken]);

  const { data: user, isLoading: isQueryLoading } = useQuery<AuthUserResponse | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    enabled: isInitialized,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (user?.whopSync?.credited && user.whopSync.credited > 0) {
      toast({
        title: "Premium Shares Credited!",
        description: `${user.whopSync.credited} Premium Share${user.whopSync.credited > 1 ? "s" : ""} added to your account.`,
        duration: 8000,
      });
    }
  }, [user?.whopSync?.credited, toast]);

  const requestMagicLink = useCallback(
    async (email: string, returnTo = "/"): Promise<AuthResult> => {
      const normalizedEmail = normalizeEmail(email);
      if (!isValidEmail(normalizedEmail)) {
        return {
          success: false,
          code: "invalid_email",
          error: "Please enter a valid email address.",
        };
      }
      try {
        if (Capacitor.isNativePlatform()) await requestNativeMagicLink(normalizedEmail);
        else await requestPasswordlessEmail(normalizedEmail, returnTo);
        trackAuthEvent("magic_link_requested");
        return { success: true };
      } catch (error) {
        const mapped = mapPasswordlessError(error);
        trackAuthEvent("magic_link_request_failure", { code: mapped.code });
        return mapped;
      }
    },
    [],
  );

  // Compatibility aliases while old callers are removed. Passwords are intentionally ignored:
  // passwordless email is the only public authentication method.
  const login = useCallback(
    async (email: string, _password?: string) => requestMagicLink(email),
    [requestMagicLink],
  );
  const signup = useCallback(
    async (email: string, _password?: string) => requestMagicLink(email),
    [requestMagicLink],
  );
  const resendVerification = useCallback(
    async (email: string) => requestMagicLink(email),
    [requestMagicLink],
  );

  const passwordlessOnly = useCallback(
    async (): Promise<AuthResult> => ({
      success: false,
      code: "unknown",
      error: "Sportfolio uses passwordless email sign-in.",
    }),
    [],
  );

  const logout = useCallback(async () => {
    try {
      await unregisterPushTokenOnLogout();
      if (Capacitor.isNativePlatform()) {
        await clearNativeAuthSession();
      } else {
        await fetch("/api/auth/better/sign-out", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: "{}",
        }).catch(() => undefined);
        broadcastWebAuthChange("signed-out");
      }
      queryClient.removeQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return (
            typeof key === "string" &&
            [
              "/api/auth",
              "/api/dashboard",
              "/api/holdings",
              "/api/portfolio",
              "/api/admin",
              "/api/whop",
              "/api/me/collections",
              "/api/me/trophy-case",
              "/api/user",
            ].some((path) => key.startsWith(path))
          );
        },
      });
      queryClient.setQueryData(["/api/auth/user"], null);
      return { success: true } as const;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Could not sign out.",
      } as const;
    }
  }, [queryClient]);

  return {
    user: user || undefined,
    session,
    isLoading: !isInitialized || isQueryLoading,
    isAuthenticated: !!user,
    requestMagicLink,
    login,
    signup,
    resendVerification,
    logout,
    loginWithGoogle: passwordlessOnly,
    loginWithDiscord: passwordlessOnly,
    loginWithApple: passwordlessOnly,
    initError,
    retryInit,
  };
}

import { Switch, Route, Link, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { BottomNav, NAV_ITEMS } from "@/components/bottom-nav";
import { HelpDialog } from "@/components/help-dialog";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WebSocketProvider, useWebSocket } from "@/lib/websocket";
import { ConnectionStatus } from "@/components/connection-status";
import { OfflineBanner } from "@/components/offline-banner";
import { NotificationProvider } from "@/lib/notification-context";
import { useAuth, AuthProvider } from "@/hooks/useAuth";
import { OnboardingModal } from "@/components/onboarding-modal";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import logoUrl from "@assets/Sportfolio png_1763227952318.png";
import { BookOpen, LogOut, Newspaper, User } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { SchemaOrg, schemas } from "@/components/schema-org";
import { ScoutWidget } from "@/components/scout-widget";
import {
  ScoutLiveSharePopupEngine,
  ScoutLiveSharePopupHost,
} from "@/components/scout-live-share-popup-host";
import { ScoutProvider, useScout } from "@/lib/scout-context";
import { SportProvider } from "@/lib/sport-context";
import { NewsNotificationProvider, useNewsNotifications } from "@/lib/news-notification-context";
import { InjuryProvider } from "@/lib/injury-context";
import { useScoutCeremony } from "@/hooks/use-scout-ceremony";
import { useBoostSettleCeremony } from "@/hooks/use-boost-settle-ceremony";
import { OPEN_PLAYER_MODAL_EVENT } from "@/lib/player-modal-events";
import { ErrorBoundary } from "@/components/error-boundary";
import { Capacitor } from "@capacitor/core";
import { getAuthSession, getSupabase, updateNativeAuthRefreshState } from "@/lib/supabase";
import { initNetworkMonitor } from "@/lib/native-network";
import { resolvePublicAppUrl } from "@/lib/native-runtime";
import { preloadRoute } from "@/lib/route-preload";
import {
  normalizeInternalNotificationRoute,
  PUSH_NOTIFICATION_APP_LINK_HOSTS,
} from "@shared/push-notifications";
import {
  getRouteSeoMeta,
  normalizeSiteUrl,
  toCanonicalUrl as toAbsoluteCanonicalUrl,
} from "@shared/seo";

const CANONICAL_SITE_URL = normalizeSiteUrl(
  import.meta.env.VITE_PUBLIC_SITE_URL ||
    import.meta.env.PUBLIC_SITE_URL ||
    resolvePublicAppUrl("/"),
);

const loadPlayerPoolsPage = () => import("@/pages/marketplace");
const loadDashboardPage = () => import("@/pages/dashboard");
const loadPlayerPage = () => import("@/pages/player");
const loadPortfolioPage = () => import("@/pages/portfolio");
const loadUserProfilePage = () => import("@/pages/user-profile");
const loadLeaderboardsPage = () => import("@/pages/leaderboards");
const loadAdminPage = () => import("@/pages/admin");
const loadAuthErrorPage = () => import("@/pages/auth-error");
const loadNotFoundPage = () => import("@/pages/not-found");
const loadBlogPage = () => import("@/pages/blog");
const loadBlogPostPage = () => import("@/pages/blog-post");
const loadPrivacyPage = () => import("@/pages/privacy");
const loadTermsPage = () => import("@/pages/terms");
const loadAccountDeletionPage = () => import("@/pages/account-deletion");
const loadAboutPage = () => import("@/pages/about");
const loadContactPage = () => import("@/pages/contact");
const loadHowItWorksPage = () => import("@/pages/how-it-works");
const loadWikiPage = () => import("@/pages/wiki");
const loadWikiArticlePage = () => import("@/pages/wiki-article");
const loadSmsLinkPage = () => import("@/pages/sms-link");
const loadDiscordLinkPage = () => import("@/pages/discord-link");
const loadAnalyticsPage = () => import("@/pages/analytics");
const loadNewsPage = () => import("@/pages/news");
const loadAgentPage = () => import("@/pages/agent");
const loadPremiumPage = () => import("@/pages/premium");
const loadWatchlistsPage = () => import("@/pages/watchlists");
const loadBoostsPage = () => import("@/pages/boosts");
const loadLoginPage = () => import("@/pages/Login");
const loadAuthCallbackPage = () => import("@/pages/AuthCallback");
const loadCheckoutSuccessPage = () => import("@/pages/checkout-success");
const loadOnboardingPage = () => import("@/pages/onboarding");
const loadScoutDashboardModal = () =>
  import("@/components/scout-dashboard-modal").then((m) => ({ default: m.ScoutDashboardModal }));
const loadPlayerModal = () =>
  import("@/components/player-modal").then((m) => ({ default: m.PlayerModal }));
const loadMobilePushManager = () =>
  import("@/components/mobile-push-manager").then((m) => ({ default: m.MobilePushManager }));
const loadWhaleAlertBanner = () =>
  import("@/components/market/whale-alert-banner").then((m) => ({
    default: m.WhaleAlertBanner,
  }));
const loadBoostCeremonyOverlay = () =>
  import("@/components/ceremonies/boost-ceremony-overlay").then((m) => ({
    default: m.BoostCeremonyOverlay,
  }));
const loadScoutCeremonyOverlay = () =>
  import("@/components/ceremonies/scout-ceremony-overlay").then((m) => ({
    default: m.ScoutCeremonyOverlay,
  }));
const loadScoutReadyBanner = () =>
  import("@/components/ceremonies/scout-ready-banner").then((m) => ({
    default: m.ScoutReadyBanner,
  }));

const Dashboard = lazy(loadDashboardPage);
const PlayerPools = lazy(loadPlayerPoolsPage);
const PlayerPage = lazy(loadPlayerPage);
const Portfolio = lazy(loadPortfolioPage);
const UserProfile = lazy(loadUserProfilePage);
const Leaderboards = lazy(loadLeaderboardsPage);
const Admin = lazy(loadAdminPage);
const AuthError = lazy(loadAuthErrorPage);
const NotFound = lazy(loadNotFoundPage);
const Blog = lazy(loadBlogPage);
const BlogPost = lazy(loadBlogPostPage);
const Privacy = lazy(loadPrivacyPage);
const Terms = lazy(loadTermsPage);
const AccountDeletion = lazy(loadAccountDeletionPage);
const About = lazy(loadAboutPage);
const Contact = lazy(loadContactPage);
const HowItWorks = lazy(loadHowItWorksPage);
const Wiki = lazy(loadWikiPage);
const WikiArticle = lazy(loadWikiArticlePage);
const SmsLink = lazy(loadSmsLinkPage);
const DiscordLink = lazy(loadDiscordLinkPage);
const Analytics = lazy(loadAnalyticsPage);
const News = lazy(loadNewsPage);
const Agent = lazy(loadAgentPage);
const Premium = lazy(loadPremiumPage);
const Watchlists = lazy(loadWatchlistsPage);
const Boosts = lazy(loadBoostsPage);
const Login = lazy(loadLoginPage);
const AuthCallback = lazy(loadAuthCallbackPage);
const CheckoutSuccess = lazy(loadCheckoutSuccessPage);
const OnboardingPage = lazy(loadOnboardingPage);
const ScoutDashboardModal = lazy(loadScoutDashboardModal);
const PlayerModal = lazy(loadPlayerModal);
const MobilePushManager = lazy(loadMobilePushManager);
const WhaleAlertBanner = lazy(loadWhaleAlertBanner);
const BoostCeremonyOverlay = lazy(loadBoostCeremonyOverlay);
const ScoutCeremonyOverlay = lazy(loadScoutCeremonyOverlay);
const ScoutReadyBanner = lazy(loadScoutReadyBanner);

function upsertMetaTag(attribute: "name" | "property", value: string): HTMLMetaElement {
  let tag = document.head.querySelector(`meta[${attribute}="${value}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, value);
    document.head.appendChild(tag);
  }
  return tag;
}

function resolveNativeAppUrlToRoute(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      PUSH_NOTIFICATION_APP_LINK_HOSTS.includes(
        parsed.host as (typeof PUSH_NOTIFICATION_APP_LINK_HOSTS)[number],
      )
    ) {
      const route = normalizeInternalNotificationRoute(`${parsed.pathname}${parsed.search}`);
      return route;
    }

    const routeMap: Record<string, string> = {
      portfolio: "/portfolio",
      boosts: "/boosts",
      pools: "/pools",
      leaderboards: "/leaderboards",
    };

    if (
      parsed.protocol === "sportfolio:" &&
      parsed.host === "player" &&
      parsed.pathname.length > 1
    ) {
      return normalizeInternalNotificationRoute(`/player/${parsed.pathname.replace(/^\//, "")}`);
    }

    if (parsed.protocol === "sportfolio:" && routeMap[parsed.host]) {
      return routeMap[parsed.host];
    }
  } catch {
    return null;
  }

  return null;
}

function upsertCanonicalLink(): HTMLLinkElement {
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  return link;
}

function toCanonicalUrl(path: string): string {
  return toAbsoluteCanonicalUrl(CANONICAL_SITE_URL, path);
}

function LegacyMarketplaceRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const search = window.location.search || "";
    setLocation(`/pools${search}`, { replace: true });
  }, [setLocation]);

  return null;
}

const ONBOARDING_SUPPRESS_AFTER_ERROR_KEY = "onboarding_suppress_after_error_v1";

function OnboardingCheck() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setShowOnboarding(false);
      return;
    }

    if (user.hasSeenOnboarding !== false) {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(ONBOARDING_SUPPRESS_AFTER_ERROR_KEY);
      }
      setShowOnboarding(false);
      return;
    }

    const suppressedForSession =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(ONBOARDING_SUPPRESS_AFTER_ERROR_KEY) === "1";
    if (suppressedForSession) {
      setShowOnboarding(false);
      return;
    }

    if (Capacitor.isNativePlatform()) {
      // Native: use the dedicated full-screen onboarding route.
      navigate("/onboarding", { replace: false });
    } else {
      // Web / Playwright: keep the existing modal behaviour.
      setShowOnboarding(true);
    }
  }, [isAuthenticated, user, navigate]);

  const handleComplete = () => {
    setShowOnboarding(false);
  };

  // On native the onboarding route handles everything; nothing to render here.
  if (Capacitor.isNativePlatform()) return null;
  return <OnboardingModal open={showOnboarding} onComplete={handleComplete} />;
}

const pageTransitionVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const pageTransitionSettings = {
  duration: 0.2,
  ease: "easeOut" as const,
};

function DashboardRouteSkeleton() {
  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="terminal-shell overflow-hidden p-4 md:p-6">
          <div className="terminal-strip mb-3 h-5 w-40 animate-pulse bg-muted/70" />
          <div className="h-8 w-56 animate-pulse rounded-sm bg-muted" />
          <div className="mt-3 h-4 w-72 max-w-full animate-pulse rounded-sm bg-muted/70" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="terminal-shell h-28 animate-pulse bg-muted/35" />
          ))}
        </div>
        <div className="terminal-shell h-72 animate-pulse bg-muted/25" />
      </div>
    </div>
  );
}

function RouteLoadingState({ location }: { location: string }) {
  if (location === "/") {
    return <DashboardRouteSkeleton />;
  }

  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="terminal-shell p-4">
          <div className="h-5 w-32 animate-pulse rounded-sm bg-muted/70" />
          <div className="mt-3 h-8 w-52 animate-pulse rounded-sm bg-muted" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="terminal-shell h-32 animate-pulse bg-muted/30" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Map URL roots to a tab index so transitions can slide left/right (P2 — 7.3) */
const TAB_ORDER: Record<string, number> = {};
NAV_ITEMS.forEach((item, i) => {
  TAB_ORDER[item.url] = i;
});

function getTabIndex(path: string): number | null {
  const exact = TAB_ORDER[path];
  if (exact !== undefined) return exact;
  // Partial match for nested routes under a tab root
  for (const [url, idx] of Object.entries(TAB_ORDER)) {
    if (url !== "/" && path.startsWith(url)) return idx;
  }
  return null;
}

/**
 * Determine the slide direction for page transitions.
 * Tab-level routes slide horizontally; drill-down routes slide right-to-left.
 */
function getTransitionVariants(
  currentPath: string,
  previousPath: string,
): { x: string; opacity: number }[] {
  const currentIdx = getTabIndex(currentPath);
  const previousIdx = getTabIndex(previousPath);

  if (currentIdx !== null && previousIdx !== null) {
    // Horizontal slide between tabs
    const direction = currentIdx > previousIdx ? 1 : -1;
    return [
      { x: `${direction * 100}%`, opacity: 0 },
      { x: "0%", opacity: 1 },
      { x: `${-direction * 100}%`, opacity: 0 },
    ];
  }

  // Drill-down: slide in from right, exit to left
  return [
    { x: "100%", opacity: 0 },
    { x: "0%", opacity: 1 },
    { x: "-100%", opacity: 0 },
  ];
}

const AUTH_BOOTSTRAP_REQUIRED_PREFIXES = [
  "/login",
  "/onboarding",
  "/auth/callback",
  "/power",
  "/boosts",
  "/player/",
  "/portfolio",
  "/admin",
  "/premium",
  "/watchlists",
  "/profile",
];

function routeRequiresAuthBootstrap(path: string) {
  if (
    AUTH_BOOTSTRAP_REQUIRED_PREFIXES.some(
      (prefix) => path === prefix || (prefix.endsWith("/") ? path.startsWith(prefix) : false),
    )
  ) {
    return true;
  }

  return false;
}

function hasInlineAuthCallbackPayload() {
  if (typeof window === "undefined") {
    return false;
  }

  const queryParams = new URLSearchParams(window.location.search);
  return queryParams.has("code") || window.location.hash.includes("access_token=");
}

function ProfileRedirect({ userId }: { userId: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(`/user/${userId}`, { replace: true });
  }, [userId, navigate]);
  return null;
}

function Router() {
  const { user, isAuthenticated, isLoading, initError, retryInit } = useAuth();
  const [location, navigate] = useLocation();
  const [loadingTime, setLoadingTime] = useState(0);
  const previousLocationRef = useRef(location);
  const nativePlatform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
  const isNativePlatform = nativePlatform !== "web";
  const isNativeIOS = nativePlatform === "ios";
  const isNativeAndroid = nativePlatform === "android";
  const isLoopbackHost =
    typeof window !== "undefined" &&
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
  const authRouteBypass =
    isLoopbackHost &&
    Boolean((window as Window & { __PLAYWRIGHT_AGENT_E2E__?: boolean }).__PLAYWRIGHT_AGENT_E2E__);
  const canAccessProtectedRoutes = isAuthenticated || authRouteBypass;
  const requiresAuthBootstrap =
    routeRequiresAuthBootstrap(location) ||
    (location !== "/auth/callback" && hasInlineAuthCallbackPayload());
  const shouldShowAuthBootstrapLoading = isLoading && requiresAuthBootstrap && !authRouteBypass;
  const shouldShowAuthBootstrapError =
    Boolean(initError) && requiresAuthBootstrap && !authRouteBypass;

  // Compute directional transition for the current route change (P2 — 7.3)
  const prefersReducedMotion = useReducedMotion();
  const [initial, , exit] = getTransitionVariants(location, previousLocationRef.current);
  useEffect(() => {
    previousLocationRef.current = location;
  }, [location]);

  // Keep canonical + robots metadata aligned with the active route.
  useEffect(() => {
    const seoMeta = getRouteSeoMeta(location);
    const canonicalUrl = toCanonicalUrl(seoMeta.canonicalPath);

    document.title = seoMeta.title;

    const descriptionTag = upsertMetaTag("name", "description");
    descriptionTag.setAttribute("content", seoMeta.description);

    const robotsTag = upsertMetaTag("name", "robots");
    robotsTag.setAttribute("content", seoMeta.robots);

    const canonicalLink = upsertCanonicalLink();
    canonicalLink.setAttribute("href", canonicalUrl);

    const ogUrlTag = upsertMetaTag("property", "og:url");
    ogUrlTag.setAttribute("content", canonicalUrl);
  }, [location]);

  // Some providers fall back to `/` and attach auth params there; route those into the callback handler.
  useEffect(() => {
    const hash = window.location.hash;
    const search = window.location.search;
    const pathname = window.location.pathname;
    const queryParams = new URLSearchParams(search);
    const hasPkceCode = queryParams.has("code");
    const hasTokenHash = hash.includes("access_token=");

    if (pathname === "/auth/callback") return;
    if (!hasPkceCode && !hasTokenHash) return;

    navigate(`/auth/callback${search}${hash}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!isNativePlatform) {
      return;
    }

    let listener: { remove: () => Promise<void> } | null = null;

    const register = async () => {
      const { App: CapacitorApp } = await import("@capacitor/app");
      listener = await CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
        if (!url) return;

        // Handle auth callback — close the in-app browser first, then hand the
        // code/tokens to the AuthCallback page so it is the single PKCE exchange
        // point (avoids the race condition where App.tsx consumes the one-time
        // code before AuthCallback can see it).
        if (url.startsWith("sportfolio://auth/callback")) {
          try {
            const callbackUrl = new URL(url);
            const code = callbackUrl.searchParams.get("code");
            const hashParams = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
            const accessToken = hashParams.get("access_token");
            const refreshToken = hashParams.get("refresh_token");

            if (code) {
              navigate(`/auth/callback?code=${encodeURIComponent(code)}`, { replace: true });
            } else if (accessToken && refreshToken) {
              // Implicit/hash flow — forward as hash fragment so AuthCallback can read it.
              navigate(
                `/auth/callback#access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`,
                { replace: true },
              );
            } else {
              // No recognisable payload — let AuthCallback attempt a session lookup.
              navigate("/auth/callback", { replace: true });
            }
          } catch (error) {
            // URL parsing or navigation failed; navigate to the callback page
            // which will attempt a getSession() recovery.
            console.error("[MOBILE_AUTH] Callback handling failed:", error);
            navigate("/auth/callback", { replace: true });
          } finally {
            // Always close the in-app browser for auth callback deep links —
            // even if URL parsing throws before reaching the normal close call.
            const { Browser } = await import("@capacitor/browser");
            await Browser.close().catch(() => undefined);
          }
          return;
        }

        const route = resolveNativeAppUrlToRoute(url);
        if (route) {
          navigate(route);
        }
      });
    };

    register();

    return () => {
      void listener?.remove();
    };
  }, [isNativePlatform, navigate]);

  useEffect(() => {
    if (!isNativePlatform) {
      return;
    }

    let listener: { remove: () => Promise<void> } | null = null;

    const register = async () => {
      const { App: CapacitorApp } = await import("@capacitor/app");
      listener = await CapacitorApp.addListener("appStateChange", async ({ isActive }) => {
        if (!isActive) {
          try {
            const supabase = await getSupabase();
            await updateNativeAuthRefreshState(false, supabase);
          } catch (error) {
            console.error("[MOBILE_AUTH] Failed to pause native refresh state:", error);
          }
          return;
        }

        // Fire mobile analytics event on resume (P3 — 7.6)
        try {
          const gtag = (window as any).gtag;
          if (typeof gtag === "function") {
            gtag("event", "app_open", { source: "resume" });
          }
        } catch {
          // ignore
        }

        try {
          const supabase = await getSupabase();
          await getAuthSession(supabase);
          await updateNativeAuthRefreshState(true, supabase);
        } catch (error) {
          console.error("[MOBILE_AUTH] Session refresh on resume failed:", error);
        }
      });
    };

    register();

    return () => {
      void listener?.remove();
    };
  }, [isNativePlatform]);

  // P0 — 1.2: Android back button handling (prevents Play Store rejection)
  useEffect(() => {
    if (!isNativeAndroid) return;

    let listener: { remove: () => Promise<void> } | null = null;

    // Derive root routes from NAV_ITEMS — single source of truth
    const rootRoutes = new Set(NAV_ITEMS.map((item) => item.url));

    const register = async () => {
      const { App: CapacitorApp } = await import("@capacitor/app");
      listener = await CapacitorApp.addListener("backButton", ({ canGoBack: browserCanGoBack }) => {
        // The onboarding page registers its own backButton listener to manage
        // slide-level navigation.  Yield here so we don't double-navigate.
        if (location === "/onboarding") return;

        // If the browser history has entries, go back
        if (browserCanGoBack) {
          history.back();
          return;
        }
        // If on a root tab, minimize the app instead of exiting
        if (rootRoutes.has(location)) {
          void CapacitorApp.minimizeApp();
          return;
        }
        // A deep link can have no WebView history. Fall back to the app home instead of no-oping.
        navigate("/");
      });
    };

    register();
    return () => {
      void listener?.remove();
    };
  }, [isNativeAndroid, location, navigate]);

  // Keep native system chrome readable as the web theme changes.
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true,
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!isNativePlatform) return;
    void import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
      void StatusBar.setStyle({
        // Dark canvases need light system icons; light canvases need dark icons.
        style: isDark ? Style.Light : Style.Dark,
      }).catch(() => undefined);
      if (isNativeAndroid) {
        void StatusBar.setBackgroundColor({
          color: isDark ? "#0f1420" : "#ffffff",
        }).catch(() => undefined);
        void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
      }
    });
  }, [isDark, isNativeAndroid, isNativePlatform]);

  // Keep iOS keyboard appearance and resize behavior aligned with the active theme.
  useEffect(() => {
    if (!isNativeIOS) return;

    void import("@capacitor/keyboard").then(({ Keyboard, KeyboardResize, KeyboardStyle }) => {
      void Keyboard.setResizeMode({ mode: KeyboardResize.Body }).catch(() => undefined);
      void Keyboard.setStyle({
        style: isDark ? KeyboardStyle.Dark : KeyboardStyle.Light,
      }).catch(() => undefined);
    });
  }, [isDark, isNativeIOS]);

  // P3 — 7.1: Splash screen — hide after auth resolves
  useEffect(() => {
    if (!isNativePlatform) return;
    if (isLoading) return;

    // Auth bootstrap complete — hide the splash with a fade
    void import("@capacitor/splash-screen").then(({ SplashScreen }) => {
      void SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => undefined);
    });
  }, [isLoading, isNativePlatform]);

  // Warm likely next-route chunks during idle time to improve transition latency.
  useEffect(() => {
    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    };
    const connection = nav.connection;
    const isMobileViewport = window.innerWidth < 768;
    const shouldSkipPreload =
      isMobileViewport ||
      connection?.saveData === true ||
      connection?.effectiveType === "slow-2g" ||
      connection?.effectiveType === "2g";

    if (shouldSkipPreload) {
      return;
    }

    const preload = () => {
      void loadPlayerPoolsPage();
      void loadBlogPage();
    };

    const globalObject = globalThis as any;
    if (typeof globalObject.requestIdleCallback === "function") {
      const id = globalObject.requestIdleCallback(preload, { timeout: 2000 });
      return () => globalObject.cancelIdleCallback?.(id);
    }

    const timer = globalThis.setTimeout(preload, 1200);
    return () => globalThis.clearTimeout(timer);
  }, []);

  // Track how long we've been loading
  useEffect(() => {
    if (shouldShowAuthBootstrapLoading) {
      const startTime = Date.now();
      const interval = setInterval(() => {
        setLoadingTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setLoadingTime(0);
    }
  }, [shouldShowAuthBootstrapLoading]);

  // Show error state with retry option
  if (shouldShowAuthBootstrapError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md px-4">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-bold mb-2">Connection Issue</h2>
          <p className="text-muted-foreground mb-4">
            Unable to connect to the server. This may happen after a site update.
          </p>
          <p className="text-sm text-muted-foreground mb-4 font-mono bg-muted p-2 rounded">
            {initError}
          </p>
          <Button onClick={retryInit} data-testid="button-retry-connection">
            Retry Connection
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            If this persists, try refreshing the page or clearing your browser cache.
          </p>
        </div>
      </div>
    );
  }

  if (shouldShowAuthBootstrapLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
          {loadingTime > 3 && (
            <p className="text-xs text-muted-foreground mt-2">
              Taking longer than usual... ({loadingTime}s)
            </p>
          )}
          {loadingTime > 10 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => window.location.reload()}
              data-testid="button-refresh-page"
            >
              Refresh Page
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Public routes (accessible without authentication)
  return (
    /*
     * AnimatePresence mode="popLayout" — chosen for directional page transitions.
     * Unlike "wait" (which waits for exit to finish before entering), "popLayout"
     * removes the exiting element from the layout flow immediately, allowing the
     * entering element to take its place and slide in concurrently. This creates
     * the native horizontal-tab and drill-down slide feel with no layout jump.
     */
    <AnimatePresence mode="popLayout">
      <motion.div
        key={location}
        initial={{ opacity: 0, x: prefersReducedMotion ? 0 : initial.x, y: 0 }}
        animate={{ opacity: 1, x: "0%", y: 0 }}
        exit={{ opacity: 0, x: prefersReducedMotion ? 0 : exit.x, y: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: "easeOut" }}
        className="w-full"
        style={{ position: "relative", overflow: "hidden" }}
      >
        {/*
         * ErrorBoundary wraps Suspense so that lazy-chunk load failures
         * (bad network, CDN error, code bug) show a recoverable UI instead
         * of crashing the entire app — critical on Android where there is
         * no browser reload option and a crash is logged by Play Store.
         */}
        <ErrorBoundary>
          <Suspense fallback={<RouteLoadingState location={location} />}>
            <Switch>
              {/* Auth routes */}
              <Route path="/login" component={Login} />
              <Route path="/auth/callback" component={AuthCallback} />
              <Route path="/checkout/success" component={CheckoutSuccess} />
              {/* Native full-screen onboarding — replaces the modal on Android/iOS */}
              <Route path="/onboarding" component={OnboardingPage} />

              {/* Dashboard is now public - shows live data with login CTAs for non-authenticated users */}
              <Route path="/" component={Dashboard} />

              {/* Public routes */}
              <Route path="/leaderboards" component={Leaderboards} />
              <Route path="/user/:id" component={UserProfile} />
              <Route path="/pools" component={PlayerPools} />
              <Route path="/marketplace" component={LegacyMarketplaceRedirect} />
              <Route path="/blog" component={Blog} />
              <Route path="/blog/:slug" component={BlogPost} />
              <Route path="/privacy" component={Privacy} />
              <Route path="/terms" component={Terms} />
              <Route path="/account-deletion" component={AccountDeletion} />
              <Route path="/about" component={About} />
              <Route path="/contact" component={Contact} />
              <Route path="/how-it-works" component={HowItWorks} />
              <Route path="/wiki" component={Wiki} />
              <Route path="/wiki/:section" component={Wiki} />
              <Route path="/wiki/:section/:slug" component={WikiArticle} />
              <Route path="/sms/link" component={SmsLink} />
              <Route path="/discord/link" component={DiscordLink} />
              <Route path="/analytics" component={Analytics} />
              <Route path="/news" component={News} />

              {/* Hermes workspace - requires authentication */}
              <Route path="/agent">{canAccessProtectedRoutes ? <Agent /> : <Dashboard />}</Route>

              {/* Boosts - requires authentication */}
              <Route path="/power">{canAccessProtectedRoutes ? <Boosts /> : <Dashboard />}</Route>
              <Route path="/boosts">{canAccessProtectedRoutes ? <Boosts /> : <Dashboard />}</Route>

              {/* Protected routes - require authentication, redirect to dashboard if not logged in */}
              <Route path="/player/:id">
                {canAccessProtectedRoutes ? <PlayerPage /> : <Dashboard />}
              </Route>

              {/* Canonical player route used across the app (some data uses prefixed ids like nba_123) */}
              <Route path="/player/nba_:id">
                {canAccessProtectedRoutes ? <PlayerPage /> : <Dashboard />}
              </Route>
              <Route path="/player/nfl_:id">
                {canAccessProtectedRoutes ? <PlayerPage /> : <Dashboard />}
              </Route>
              <Route path="/player/mlb_:id">
                {canAccessProtectedRoutes ? <PlayerPage /> : <Dashboard />}
              </Route>
              <Route path="/portfolio">
                {canAccessProtectedRoutes ? <Portfolio /> : <Dashboard />}
              </Route>
              <Route path="/admin">{canAccessProtectedRoutes ? <Admin /> : <Dashboard />}</Route>
              <Route path="/premium">
                {canAccessProtectedRoutes ? <Premium /> : <Dashboard />}
              </Route>
              {/* Premium share trading removed; premium shares are redeemed for premium access */}
              <Route path="/watchlists">
                {canAccessProtectedRoutes ? <Watchlists /> : <Dashboard />}
              </Route>
              <Route path="/profile">
                {canAccessProtectedRoutes && user ? (
                  <ProfileRedirect userId={user.id} />
                ) : (
                  <Dashboard />
                )}
              </Route>

              {/* Auth error page - public, always accessible */}
              <Route path="/auth/error" component={AuthError} />

              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}

function Header() {
  const { user, isAuthenticated, logout } = useAuth();
  const [location, navigate] = useLocation();
  const { subscribe } = useWebSocket();
  const { unreadNewsCount, hasUnreadDigest } = useNewsNotifications();
  const { data: dashboardData } = useQuery<{ user: { balance: string; portfolioValue: string } }>({
    queryKey: ["/api/dashboard"],
    enabled: isAuthenticated,
  });

  // Detect if we're on a user profile page
  const isProfilePage = location.startsWith("/user/");

  // WebSocket listener for real-time balance updates in header
  useEffect(() => {
    // Portfolio events will auto-invalidate dashboard queries via WebSocket provider
    // The header balance will update automatically
    const unsubPortfolio = subscribe("portfolio", () => {
      // Balance updates will be handled by the global WebSocket provider
    });

    return () => {
      unsubPortfolio();
    };
  }, [subscribe]);

  const userName = user?.username || user?.email || "User";
  const isPremium = user?.isPremium || false;

  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex items-center justify-between border-b border-border-subtle bg-sidebar/95 px-3 backdrop-blur sm:px-4",
        isPremium && "border-b-premium/30",
      )}
      data-testid="application-header"
      style={{
        height: "calc(3.5rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="hidden sm:block">
          <SidebarTrigger data-testid="button-sidebar-toggle" aria-label="Toggle sidebar" />
        </div>
        <div className="flex items-center gap-2">
          <img
            src={logoUrl}
            alt="Sportfolio"
            width={40}
            height={40}
            decoding="async"
            className="h-8 w-8 sm:h-9 sm:w-9"
          />
          {isAuthenticated ? (
            <>
              <ScoutWidget className="hidden sm:flex" />
              <ScoutWidget compact className="flex sm:hidden" />
            </>
          ) : (
            <span className="text-lg font-extrabold tracking-tight text-brand">Sportfolio</span>
          )}
        </div>
        <div className="hidden items-baseline gap-2 rounded-control border border-border-subtle bg-surface-raised px-2.5 py-1 sm:flex">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">
            Balance
          </span>
          <span
            className="font-mono text-sm font-bold tabular-nums text-brand"
            data-testid="text-balance"
          >
            ${dashboardData?.user?.balance || "0.00"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-0.5 sm:gap-1">
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="relative min-h-[44px] min-w-[44px]"
          data-testid="button-news-header"
          aria-label="News"
        >
          <Link
            href="/news"
            onMouseEnter={() => preloadRoute("/news")}
            onFocus={() => preloadRoute("/news")}
          >
            <Newspaper className="h-4 w-4" aria-hidden="true" />
            {(hasUnreadDigest || unreadNewsCount > 0) && (
              <span
                className="absolute right-2.5 top-2.5 h-2 w-2 rounded-circle bg-status-live ring-2 ring-sidebar"
                aria-label="Unread news"
              />
            )}
          </Link>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          asChild
          className="sm:hidden min-h-[44px] min-w-[44px]"
          data-testid="button-wiki-header-mobile"
          aria-label="Wiki"
        >
          <Link
            href="/wiki"
            onMouseEnter={() => preloadRoute("/wiki")}
            onFocus={() => preloadRoute("/wiki")}
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        {isAuthenticated ? (
          <>
            <Link
              href={user?.id ? `/user/${user.id}` : "/profile"}
              className="hidden sm:block"
              data-testid="link-username"
            >
              <div className="flex items-center gap-2 rounded-control px-3 py-1.5 text-sm text-content-muted transition-colors hover:bg-action-hover hover:text-content">
                <span data-testid="text-username">{userName}</span>
              </div>
            </Link>
            <Button
              size="icon"
              variant="ghost"
              asChild
              data-testid="button-profile"
              aria-label="Profile"
              className="flex min-h-[44px] min-w-[44px]"
            >
              <Link
                href={user?.id ? `/user/${user.id}` : "/profile"}
                onMouseEnter={loadUserProfilePage}
                onFocus={loadUserProfilePage}
              >
                <User className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            {isProfilePage && (
              <Button
                size="icon"
                variant="ghost"
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
                data-testid="button-logout"
                aria-label="Logout"
                className="min-h-[44px] min-w-[44px]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </>
        ) : (
          <Button asChild data-testid="button-header-login">
            <Link href="/login">Sign In</Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.open("https://discord.gg/r8MsduNvXG", "_blank")}
          data-testid="button-discord"
          aria-label="Join our Discord"
          className="min-h-[44px] min-w-[44px] hover:bg-action-hover"
        >
          <SiDiscord className="w-5 h-5" aria-hidden="true" />
        </Button>
        {isProfilePage && <HelpDialog />}
      </div>
    </header>
  );
}

function GlobalBoostCeremonyManager() {
  const { isShowing, data, handleBoostSettled, closeCeremony } = useBoostSettleCeremony();
  const { subscribe } = useWebSocket();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const unsub = subscribe("boost_settled", (payload: any) => {
      // Only show ceremony for the current user's boosts
      if (payload.userId && payload.userId !== user.id) return;
      handleBoostSettled(payload);
    });
    return unsub;
  }, [subscribe, user, handleBoostSettled]);

  if (!data) return null;

  // BoostCeremonyOverlay expects BoostCeremonyData shape
  const ceremonyData = {
    playerName: data.playerName,
    playerTeam: data.playerTeam,
    slotTier: data.slotTier,
    shareMultiplier: data.shareMultiplier,
    totalMultiplier: data.totalMultiplier,
    sharesBurned: data.sharesBurned,
  };

  return (
    <Suspense fallback={null}>
      <BoostCeremonyOverlay isOpen={isShowing} data={ceremonyData} onClose={closeCeremony} />
    </Suspense>
  );
}

function ScoutCeremonyManager() {
  const { isReady, isShowing, data, handleScoutReady, showCeremony, closeCeremony, dismissReady } =
    useScoutCeremony();
  const [, navigate] = useLocation();

  useEffect(() => {
    const handleEvent = (event: CustomEvent) => {
      handleScoutReady(event.detail);
    };

    window.addEventListener("scout-ceremony-ready", handleEvent as EventListener);
    return () => window.removeEventListener("scout-ceremony-ready", handleEvent as EventListener);
  }, [handleScoutReady]);

  const handleViewPortfolio = () => {
    navigate("/portfolio");
    dismissReady();
  };

  return (
    <>
      {isReady && (
        <Suspense fallback={null}>
          <ScoutReadyBanner
            isVisible={isReady}
            totalShares={data?.totalShares || 0}
            playerCount={data?.totalPlayers || 0}
            onView={showCeremony}
            onDismiss={dismissReady}
            onViewPortfolio={handleViewPortfolio}
          />
        </Suspense>
      )}
      {isShowing && (
        <Suspense fallback={null}>
          <ScoutCeremonyOverlay isOpen={isShowing} data={data} onClose={closeCeremony} />
        </Suspense>
      )}
    </>
  );
}

function GlobalPlayerModalHost() {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ playerId?: string }>;
      const playerId = String(customEvent.detail?.playerId || "").trim();
      if (!playerId) {
        return;
      }

      setSelectedPlayerId(playerId);
      setOpen(true);
    };

    window.addEventListener(OPEN_PLAYER_MODAL_EVENT, handleOpen as EventListener);
    return () => {
      window.removeEventListener(OPEN_PLAYER_MODAL_EVENT, handleOpen as EventListener);
    };
  }, []);

  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <PlayerModal
        playerId={selectedPlayerId}
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setSelectedPlayerId(null);
          }
        }}
      />
    </Suspense>
  );
}

function ScoutDashboardModalHost() {
  const { isScoutDashboardOpen } = useScout();

  if (!isScoutDashboardOpen) return null;

  return (
    <Suspense fallback={null}>
      <ScoutDashboardModal />
    </Suspense>
  );
}

function MobilePushManagerHost() {
  if (!Capacitor.isNativePlatform()) return null;

  return (
    <Suspense fallback={null}>
      <MobilePushManager />
    </Suspense>
  );
}

function WhaleAlertBannerHost() {
  const { subscribe } = useWebSocket();
  const [initialMessage, setInitialMessage] = useState<any>(null);

  useEffect(() => {
    if (initialMessage) return;

    const unsubscribe = subscribe("whale_alert", (message) => {
      setInitialMessage(message);
    });

    return unsubscribe;
  }, [initialMessage, subscribe]);

  if (!initialMessage) return null;

  return (
    <Suspense fallback={null}>
      <WhaleAlertBanner initialMessage={initialMessage} />
    </Suspense>
  );
}

function AppContent() {
  const nativeShellHeightClass = Capacitor.isNativePlatform()
    ? "h-[100dvh] min-h-[100dvh]"
    : "h-screen";
  const style = useMemo(
    () => ({
      "--sidebar-width": "16rem",
      "--sidebar-width-icon": "3rem",
    }),
    [],
  );

  // Initialize native network monitor (P3 — 6.1)
  useEffect(() => {
    initNetworkMonitor();
  }, []);

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      {/* Offline banner lives above everything — shown when network is lost (P3 — 6.1) */}
      <OfflineBanner />
      <div className={cn("flex w-full overflow-x-hidden", nativeShellHeightClass)}>
        <div className="hidden sm:flex">
          <AppSidebar />
        </div>
        <div className="flex flex-col flex-1 overflow-x-hidden">
          <Header />
          <main className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto pb-0 sm:pb-0">
            <div className="flex-1 pb-20 sm:pb-0">
              <Router />
            </div>
            <Footer />
          </main>
        </div>
      </div>
      <BottomNav />
      <OnboardingCheck />
      <ScoutDashboardModalHost />
      <MobilePushManagerHost />
      <ScoutCeremonyManager />
      <GlobalBoostCeremonyManager />
      <WhaleAlertBannerHost />
      <ScoutLiveSharePopupEngine />
      <ScoutLiveSharePopupHost />
      <GlobalPlayerModalHost />
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SchemaOrg schema={[schemas.organization, schemas.website, schemas.webApplication]} />
        <WebSocketProvider>
          <ConnectionStatus />
          <NotificationProvider>
            <TooltipProvider>
              <ScoutProvider>
                <SportProvider>
                  <InjuryProvider>
                    <NewsNotificationProvider>
                      <AppContent />
                    </NewsNotificationProvider>
                  </InjuryProvider>
                </SportProvider>
                <Toaster />
              </ScoutProvider>
            </TooltipProvider>
          </NotificationProvider>
        </WebSocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

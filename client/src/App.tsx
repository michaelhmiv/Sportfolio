import { Switch, Route, Link, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import Dashboard from "@/pages/dashboard";
import { AnimatePresence, motion } from "framer-motion";
import logoUrl from "@assets/Sportfolio png_1763227952318.png";
import { BookOpen, LogOut, Newspaper, User } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { SchemaOrg, schemas } from "@/components/schema-org";
import { ScoutWidget } from "@/components/scout-widget";
import { ScoutDashboardModal } from "@/components/scout-dashboard-modal";
import { ScoutProvider } from "@/lib/scout-context";
import { SportProvider } from "@/lib/sport-context";
import { NewsNotificationProvider, useNewsNotifications } from "@/lib/news-notification-context";
import { InjuryProvider } from "@/lib/injury-context";
import { ScoutCeremonyOverlay } from "@/components/ceremonies/scout-ceremony-overlay";
import { ScoutReadyBanner } from "@/components/ceremonies/scout-ready-banner";
import { useScoutCeremony } from "@/hooks/use-scout-ceremony";
import { useBoostSettleCeremony } from "@/hooks/use-boost-settle-ceremony";
import { BoostCeremonyOverlay } from "@/components/ceremonies/boost-ceremony-overlay";
import { WhaleAlertBanner } from "@/components/market/whale-alert-banner";
import { PlayerModal } from "@/components/player-modal";
import { OPEN_PLAYER_MODAL_EVENT } from "@/lib/player-modal-events";
import { MobilePushManager } from "@/components/mobile-push-manager";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { StatusBar, Style as StatusBarStyle } from "@capacitor/status-bar";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { getSupabase } from "@/lib/supabase";
import { initNetworkMonitor } from "@/lib/native-network";
import {
  getRouteSeoMeta,
  normalizeSiteUrl,
  toCanonicalUrl as toAbsoluteCanonicalUrl,
} from "@shared/seo";

const CANONICAL_SITE_URL = normalizeSiteUrl(
  import.meta.env.VITE_PUBLIC_SITE_URL || import.meta.env.PUBLIC_SITE_URL,
);

const loadPlayerPoolsPage = () => import("@/pages/marketplace");
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
const loadAgentPage = () => import("@/pages/agent");
const loadAgentPublicPreview = () =>
  import("@/features/agent/components/agent-public-preview").then((m) => ({
    default: m.AgentPublicPreview,
  }));
const loadNewsPage = () => import("@/pages/news");
const loadPremiumPage = () => import("@/pages/premium");
const loadWatchlistsPage = () => import("@/pages/watchlists");
const loadBoostsPage = () => import("@/pages/boosts");
const loadLoginPage = () => import("@/pages/Login");
const loadAuthCallbackPage = () => import("@/pages/AuthCallback");
const loadCheckoutSuccessPage = () => import("@/pages/checkout-success");

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
const Agent = lazy(loadAgentPage);
const AgentPreview = lazy(loadAgentPublicPreview);
const News = lazy(loadNewsPage);
const Premium = lazy(loadPremiumPage);
const Watchlists = lazy(loadWatchlistsPage);
const Boosts = lazy(loadBoostsPage);
const Login = lazy(loadLoginPage);
const AuthCallback = lazy(loadAuthCallbackPage);
const CheckoutSuccess = lazy(loadCheckoutSuccessPage);

function upsertMetaTag(attribute: "name" | "property", value: string): HTMLMetaElement {
  let tag = document.head.querySelector(`meta[${attribute}="${value}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, value);
    document.head.appendChild(tag);
  }
  return tag;
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

function OnboardingCheck() {
  const { user, isAuthenticated } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (isAuthenticated && user && user.hasSeenOnboarding === false) {
      setShowOnboarding(true);
    }
  }, [isAuthenticated, user]);

  const handleComplete = () => {
    setShowOnboarding(false);
  };

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

function RouteLoadingState() {
  return (
    <div className="flex items-center justify-center h-[40vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Loading page...</p>
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
  "/auth/callback",
  "/agent",
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
  const [initial, animate, exit] = getTransitionVariants(location, previousLocationRef.current);
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
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let listener: { remove: () => Promise<void> } | null = null;

    const register = async () => {
      listener = await CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
        if (!url) return;

        // Handle auth callback
        if (url.startsWith("sportfolio://auth/callback")) {
          try {
            const callbackUrl = new URL(url);
            const code = callbackUrl.searchParams.get("code");
            const hashParams = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
            const accessToken = hashParams.get("access_token");
            const refreshToken = hashParams.get("refresh_token");

            const supabase = await getSupabase();
            if (code) {
              const { error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) {
                console.error("[MOBILE_AUTH] Code exchange failed:", error);
              }
            } else if (accessToken && refreshToken) {
              const { error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
              if (error) {
                console.error("[MOBILE_AUTH] Session set failed:", error);
              }
            }
          } catch (error) {
            console.error("[MOBILE_AUTH] Callback handling failed:", error);
          } finally {
            await Browser.close().catch(() => undefined);
            navigate("/auth/callback", { replace: true });
          }
          return;
        }

        // Handle other deep links (P1 — 4.3)
        try {
          const parsed = new URL(url);
          const host = parsed.host; // e.g. "player", "portfolio", "boosts", "pools", "leaderboards"
          const pathname = parsed.pathname; // e.g. "/123" for player/{id}

          const routeMap: Record<string, string> = {
            portfolio: "/portfolio",
            boosts: "/boosts",
            pools: "/pools",
            leaderboards: "/leaderboards",
          };

          if (host === "player" && pathname && pathname.length > 1) {
            const playerId = pathname.replace(/^\//, "");
            navigate(`/player/${playerId}`);
          } else if (routeMap[host]) {
            navigate(routeMap[host]);
          }
        } catch {
          // ignore malformed deep links
        }
      });
    };

    register();

    return () => {
      void listener?.remove();
    };
  }, [navigate]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let listener: { remove: () => Promise<void> } | null = null;

    const register = async () => {
      listener = await CapacitorApp.addListener("appStateChange", async ({ isActive }) => {
        if (!isActive) {
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
          await supabase.auth.getSession();
        } catch (error) {
          console.error("[MOBILE_AUTH] Session refresh on resume failed:", error);
        }
      });
    };

    register();

    return () => {
      void listener?.remove();
    };
  }, []);

  // P0 — 1.2: Android back button handling (prevents Play Store rejection)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listener: { remove: () => Promise<void> } | null = null;

    // Derive root routes from NAV_ITEMS — single source of truth
    const rootRoutes = new Set(NAV_ITEMS.map((item) => item.url));

    const register = async () => {
      listener = await CapacitorApp.addListener("backButton", ({ canGoBack }) => {
        // If the browser history has entries, go back
        if (canGoBack) {
          history.back();
          return;
        }
        // If on a root tab, minimize the app instead of exiting
        if (rootRoutes.has(location)) {
          void CapacitorApp.minimizeApp();
          return;
        }
        // Otherwise navigate back
        history.back();
      });
    };

    register();
    return () => {
      void listener?.remove();
    };
  }, [location]);

  // P1 — 1.1: StatusBar — set to match app's dark theme, enable edge-to-edge
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    void StatusBar.setStyle({ style: StatusBarStyle.Dark }).catch(() => undefined);
    void StatusBar.setBackgroundColor({ color: "#0f1420" }).catch(() => undefined);
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
  }, []);

  // P3 — 5.2: Update StatusBar when theme changes (dark/light)
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
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.setStyle({
      style: isDark ? StatusBarStyle.Dark : StatusBarStyle.Light,
    }).catch(() => undefined);
    void StatusBar.setBackgroundColor({
      color: isDark ? "#0f1420" : "#ffffff",
    }).catch(() => undefined);
  }, [isDark]);

  // P1 — 1.1: Keyboard — resize body instead of overlapping content
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    void Keyboard.setResizeMode({ mode: KeyboardResize.Body }).catch(() => undefined);
  }, []);

  // P3 — 7.1: Splash screen — hide after auth resolves
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (isLoading) return;

    // Auth bootstrap complete — hide the splash with a fade
    void SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => undefined);
  }, [isLoading]);

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
        initial={{ opacity: 0, x: initial.x, y: 0 }}
        animate={{ opacity: 1, x: "0%", y: 0 }}
        exit={{ opacity: 0, x: exit.x, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className={cn("w-full", location.startsWith("/agent") && "h-full min-h-0")}
        style={{ position: "relative", overflow: "hidden" }}
      >
        <Suspense fallback={<RouteLoadingState />}>
          <Switch>
            {/* Auth routes */}
            <Route path="/login" component={Login} />
            <Route path="/auth/callback" component={AuthCallback} />
            <Route path="/checkout/success" component={CheckoutSuccess} />

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
            <Route path="/agent">{canAccessProtectedRoutes ? <Agent /> : <AgentPreview />}</Route>

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
            <Route path="/premium">{canAccessProtectedRoutes ? <Premium /> : <Dashboard />}</Route>
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
        "flex items-center justify-between px-4 border-b bg-sidebar sticky top-0 z-10",
        isPremium && "border-b-yellow-500/30",
      )}
      style={{
        height: "calc(4rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex items-center gap-4">
        <div className="hidden sm:block">
          <SidebarTrigger data-testid="button-sidebar-toggle" aria-label="Toggle sidebar" />
        </div>
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="Sportfolio" className="w-10 h-10" />
          {isAuthenticated ? (
            <>
              <ScoutWidget className="hidden sm:flex" />
              <ScoutWidget compact className="flex sm:hidden" />
            </>
          ) : (
            <span className="text-xl font-extrabold tracking-tight text-primary">Sportfolio</span>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-2 text-sm">
          <span className="font-medium">Balance:</span>
          <span className="font-mono font-bold text-primary" data-testid="text-balance">
            ${dashboardData?.user?.balance || "0.00"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="relative min-h-[44px] min-w-[44px]"
          data-testid="button-news-header"
          aria-label="News"
        >
          <Link href="/news">
            <Newspaper className="h-4 w-4" aria-hidden="true" />
            {(hasUnreadDigest || unreadNewsCount > 0) && (
              <span
                className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-red-500"
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
          <Link href="/wiki">
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground hover-elevate active-elevate-2 px-3 py-1.5 rounded-md transition-colors">
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
              <Link href={user?.id ? `/user/${user.id}` : "/profile"}>
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
          className="hover-elevate active-elevate-2 min-h-[44px] min-w-[44px]"
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

  return <BoostCeremonyOverlay isOpen={isShowing} data={ceremonyData} onClose={closeCeremony} />;
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
      <ScoutReadyBanner
        isVisible={isReady}
        totalShares={data?.totalShares || 0}
        playerCount={data?.totalPlayers || 0}
        onView={showCeremony}
        onDismiss={dismissReady}
        onViewPortfolio={handleViewPortfolio}
      />
      <ScoutCeremonyOverlay isOpen={isShowing} data={data} onClose={closeCeremony} />
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

  return (
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
  );
}

function AppContent() {
  const [location] = useLocation();
  const isAgentRoute = location === "/agent" || location.startsWith("/agent/");
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  // Initialize native network monitor (P3 — 6.1)
  useEffect(() => {
    initNetworkMonitor();
  }, []);

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      {/* Offline banner lives above everything — shown when network is lost (P3 — 6.1) */}
      <OfflineBanner />
      {isAgentRoute ? (
        <div className="flex h-[100dvh] w-full min-h-0 flex-col overflow-hidden overscroll-none bg-[#0a0e1a] pb-16 sm:pb-0">
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none">
            <Router />
          </main>
        </div>
      ) : (
        <div className="flex h-screen w-full overflow-x-hidden">
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
      )}
      <BottomNav />
      <OnboardingCheck />
      <ScoutDashboardModal />
      <MobilePushManager />
      <ScoutCeremonyManager />
      <GlobalBoostCeremonyManager />
      <WhaleAlertBanner />
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

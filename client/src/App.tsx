import { Switch, Route, Link, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useState } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { HelpDialog } from "@/components/help-dialog";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WebSocketProvider, useWebSocket } from "@/lib/websocket";
import { ConnectionStatus } from "@/components/connection-status";
import { NotificationProvider } from "@/lib/notification-context";
import { useAuth, AuthProvider } from "@/hooks/useAuth";
import { OnboardingModal } from "@/components/onboarding-modal";
import { AnimatePresence, motion } from "framer-motion";
import logoUrl from "@assets/Sportfolio png_1763227952318.png";
import { Bot, LogOut, Newspaper, User } from "lucide-react";
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
import { WhaleAlertBanner } from "@/components/market/whale-alert-banner";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { getSupabase } from "@/lib/supabase";
import {
  getRouteSeoMeta,
  normalizeSiteUrl,
  toCanonicalUrl as toAbsoluteCanonicalUrl,
} from "@shared/seo";

const CANONICAL_SITE_URL = normalizeSiteUrl(
  import.meta.env.VITE_PUBLIC_SITE_URL || import.meta.env.PUBLIC_SITE_URL,
);

const loadDashboardPage = () => import("@/pages/dashboard");
const loadPlayerPoolsPage = () => import("@/pages/marketplace");
const loadPlayerPage = () => import("@/pages/player");
const loadContestsPage = () => import("@/pages/contests");
const loadContestEntryPage = () => import("@/pages/contest-entry");
const loadContestLeaderboardPage = () => import("@/pages/contest-leaderboard");
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
const loadAboutPage = () => import("@/pages/about");
const loadContactPage = () => import("@/pages/contact");
const loadHowItWorksPage = () => import("@/pages/how-it-works");
const loadWikiPage = () => import("@/pages/wiki");
const loadWikiArticlePage = () => import("@/pages/wiki-article");
const loadSmsLinkPage = () => import("@/pages/sms-link");
const loadAnalyticsPage = () => import("@/pages/analytics");
const loadAgentPage = () => import("@/pages/agent");
const loadNewsPage = () => import("@/pages/news");
const loadPremiumPage = () => import("@/pages/premium");
const loadWatchlistsPage = () => import("@/pages/watchlists");
const loadPowerPage = () => import("@/pages/power");
const loadLoginPage = () => import("@/pages/Login");
const loadAuthCallbackPage = () => import("@/pages/AuthCallback");
const loadCheckoutSuccessPage = () => import("@/pages/checkout-success");

const Dashboard = lazy(loadDashboardPage);
const PlayerPools = lazy(loadPlayerPoolsPage);
const PlayerPage = lazy(loadPlayerPage);
const Contests = lazy(loadContestsPage);
const ContestEntry = lazy(loadContestEntryPage);
const ContestLeaderboard = lazy(loadContestLeaderboardPage);
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
const About = lazy(loadAboutPage);
const Contact = lazy(loadContactPage);
const HowItWorks = lazy(loadHowItWorksPage);
const Wiki = lazy(loadWikiPage);
const WikiArticle = lazy(loadWikiArticlePage);
const SmsLink = lazy(loadSmsLinkPage);
const Analytics = lazy(loadAnalyticsPage);
const Agent = lazy(loadAgentPage);
const News = lazy(loadNewsPage);
const Premium = lazy(loadPremiumPage);
const Watchlists = lazy(loadWatchlistsPage);
const Power = lazy(loadPowerPage);
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

  // Handle OAuth redirect hash tokens - redirect to /auth/callback if access_token is in hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes("access_token=")) {
      // Preserve the hash and redirect to auth callback
      navigate(`/auth/callback${hash}`, { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let listener: { remove: () => Promise<void> } | null = null;

    const register = async () => {
      listener = await CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
        if (!url?.startsWith("sportfolio://auth/callback")) {
          return;
        }

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

  // Warm likely next-route chunks during idle time to improve transition latency.
  useEffect(() => {
    const preload = () => {
      void loadPlayerPoolsPage();
      void loadContestsPage();
      void loadBlogPage();
      void loadLeaderboardsPage();
      void loadAgentPage();
      void loadNewsPage();
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
    if (isLoading) {
      const startTime = Date.now();
      const interval = setInterval(() => {
        setLoadingTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setLoadingTime(0);
    }
  }, [isLoading]);

  // Ensure viewport is properly set after OAuth redirect on mobile
  useEffect(() => {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute(
        "content",
        "width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=yes",
      );
    }
  }, [isAuthenticated]);

  // Also restore viewport on mount to catch initial load
  useEffect(() => {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute(
        "content",
        "width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=yes",
      );
    }
  }, []);

  // Show error state with retry option
  if (initError) {
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

  if (isLoading) {
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
    <AnimatePresence mode="wait">
      <motion.div
        key={location}
        initial="initial"
        animate="animate"
        exit="exit"
        variants={pageTransitionVariants}
        transition={pageTransitionSettings}
        className="w-full"
      >
        <Suspense fallback={<RouteLoadingState />}>
          <Switch>
            {/* Auth routes */}
            <Route path="/login" component={Login} />
            <Route path="/auth/callback" component={AuthCallback} />
            <Route path="/checkout/success" component={CheckoutSuccess} />

            {/* Dashboard is now public - shows live data with login CTAs for non-authenticated users */}
            <Route path="/" component={Dashboard} />

            {/* Public routes - contests and leaderboards */}
            <Route path="/contests" component={Contests} />
            <Route path="/contest/:id/leaderboard" component={ContestLeaderboard} />
            <Route path="/leaderboards" component={Leaderboards} />
            <Route path="/user/:id" component={UserProfile} />
            <Route path="/pools" component={PlayerPools} />
            <Route path="/marketplace" component={LegacyMarketplaceRedirect} />
            <Route path="/blog" component={Blog} />
            <Route path="/blog/:slug" component={BlogPost} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/terms" component={Terms} />
            <Route path="/about" component={About} />
            <Route path="/contact" component={Contact} />
            <Route path="/how-it-works" component={HowItWorks} />
            <Route path="/wiki" component={Wiki} />
            <Route path="/wiki/:section" component={Wiki} />
            <Route path="/wiki/:section/:slug" component={WikiArticle} />
            <Route path="/sms/link" component={SmsLink} />
            <Route path="/analytics" component={Analytics} />
            <Route path="/news" component={News} />
            <Route path="/agent">{isAuthenticated ? <Agent /> : <Dashboard />}</Route>

            {/* Power / Boosts - requires authentication */}
            <Route path="/power">{isAuthenticated ? <Power /> : <Dashboard />}</Route>

            {/* Legacy route for backwards compatibility */}
            <Route path="/boosts">{isAuthenticated ? <Power /> : <Dashboard />}</Route>

            {/* Protected routes - require authentication, redirect to dashboard if not logged in */}
            <Route path="/player/:id">{isAuthenticated ? <PlayerPage /> : <Dashboard />}</Route>

            {/* Canonical player route used across the app (some data uses prefixed ids like nba_123) */}
            <Route path="/player/nba_:id">{isAuthenticated ? <PlayerPage /> : <Dashboard />}</Route>
            <Route path="/player/nfl_:id">{isAuthenticated ? <PlayerPage /> : <Dashboard />}</Route>
            <Route path="/player/mlb_:id">{isAuthenticated ? <PlayerPage /> : <Dashboard />}</Route>
            <Route path="/contest/:id/entry">
              {isAuthenticated ? <ContestEntry /> : <Dashboard />}
            </Route>
            <Route path="/contest/:id/entry/:entryId">
              {isAuthenticated ? <ContestEntry /> : <Dashboard />}
            </Route>
            <Route path="/portfolio">{isAuthenticated ? <Portfolio /> : <Dashboard />}</Route>
            <Route path="/admin">{isAuthenticated ? <Admin /> : <Dashboard />}</Route>
            <Route path="/premium">{isAuthenticated ? <Premium /> : <Dashboard />}</Route>
            {/* Premium share trading removed; premium shares are redeemed for premium access */}
            <Route path="/watchlists">{isAuthenticated ? <Watchlists /> : <Dashboard />}</Route>
            <Route path="/profile">
              {isAuthenticated && user ? <ProfileRedirect userId={user.id} /> : <Dashboard />}
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
        "flex items-center justify-between h-16 px-4 border-b bg-sidebar sticky top-0 z-10",
        isPremium && "border-b-yellow-500/30",
      )}
    >
      <div className="flex items-center gap-4">
        <div className="hidden sm:block">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
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
          className="relative"
          data-testid="button-news-header"
        >
          <Link href="/news">
            <Newspaper className="h-4 w-4" />
            {hasUnreadDigest && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
            )}
            {unreadNewsCount > 0 && (
              <Badge className="absolute -right-1 -top-1 h-5 min-w-5 px-1 text-[10px] bg-blue-600 hover:bg-blue-600">
                {unreadNewsCount}
              </Badge>
            )}
          </Link>
        </Button>
        {isAuthenticated ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              asChild
              data-testid="button-agent-header"
              title="Agent"
            >
              <Link href="/agent">
                <Bot className="h-4 w-4" />
              </Link>
            </Button>
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
              title="Profile"
              className="flex"
            >
              <Link href={user?.id ? `/user/${user.id}` : "/profile"}>
                <User className="h-4 w-4" />
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
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
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
          title="Join our Discord"
          className="hover-elevate active-elevate-2"
        >
          <SiDiscord className="w-5 h-5" />
        </Button>
        {isProfilePage && <HelpDialog />}
      </div>
    </header>
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

function AppContent() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  // Scout context - managed via ScoutDashboardModal

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-x-hidden">
        <div className="hidden sm:flex">
          <AppSidebar />
        </div>
        <div className="flex flex-col flex-1 overflow-x-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto overflow-x-hidden pb-0 sm:pb-0 flex flex-col">
            <div className="pb-20 sm:pb-0 flex-1">
              <Router />
            </div>
            <Footer />
          </main>
        </div>
      </div>
      <BottomNav />
      <OnboardingCheck />
      <ScoutDashboardModal />
      <ScoutCeremonyManager />
      <WhaleAlertBanner />
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

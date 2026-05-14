/**
 * Native-first full-screen onboarding flow (Android/iOS).
 *
 * This page is shown instead of the OnboardingModal when the app is running
 * as a Capacitor native app.  It provides a dedicated, swipeable slide
 * experience with:
 *   1. Welcome — brand / value prop overview
 *   2. Trade — AMM / player pools feature
 *   3. Scout — time-weighted share earning
 *   4. Boost — daily boost lifecycle
 *   5. Notifications — in-context push permission ask
 *
 * On completion it calls /api/user/onboarding/complete and navigates to the
 * dashboard, mirroring OnboardingModal behaviour so the same server endpoint
 * is the source of truth.
 *
 * Back-button handling: the onboarding component registers its own Capacitor
 * backButton listener while mounted.  App.tsx's global listener is configured
 * to yield (no-op) when the current route is /onboarding.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Activity, Bell, Eye, TrendingUp, Trophy } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { StatusBar, Style as StatusBarStyle } from "@capacitor/status-bar";
import { hapticLight, hapticHeavy, hapticMedium, hapticSuccess } from "@/lib/haptics";
import {
  getAndroidPushPermissionSnapshot,
  isAndroidNativePushSupported,
  registerForAndroidPushes,
} from "@/lib/mobile-push";
import { openAndroidNotificationSettings } from "@/lib/android-notification-settings";

// ---------------------------------------------------------------------------
// Slide definitions
// ---------------------------------------------------------------------------

interface OnboardingSlide {
  id: string;
  icon: typeof Activity;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  body: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    id: "welcome",
    icon: TrendingUp,
    iconColor: "text-primary",
    iconBg: "bg-primary/10",
    title: "Welcome to Sportfolio",
    subtitle: "The sports trading game",
    body: "Build your portfolio of player shares, trade against live AMM pools, and let game performance do the rest. Sportfolio uses virtual currency and does not support real-money wagering or cash-out.",
  },
  {
    id: "trade",
    icon: Activity,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-400/10",
    title: "Trade Player Shares",
    subtitle: "Instant AMM pricing — no order book needed",
    body: "Buy or sell instantly once a player pool is initialized. Add opening liquidity to start a new pool, then trade, LP, or scout over time.",
  },
  {
    id: "scout",
    icon: Eye,
    iconColor: "text-violet-400",
    iconBg: "bg-violet-400/10",
    title: "Earn with Scouts",
    subtitle: "Time-weighted share rewards — no luck required",
    body: "Assign up to 5 scouts to players you believe in. Every hour you earn shares proportional to your share of scout-minutes across the pool.",
  },
  {
    id: "boost",
    icon: Trophy,
    iconColor: "text-amber-400",
    iconBg: "bg-amber-400/10",
    title: "Boost Game Outcomes",
    subtitle: "Turn strong performances into portfolio upside",
    body: "Assign shares to daily boost slots before tip-off. Post-game settlement multiplies your virtual payout based on your player's performance.",
  },
  {
    id: "notifications",
    icon: Bell,
    iconColor: "text-sky-400",
    iconBg: "bg-sky-400/10",
    title: "Stay in the Game",
    subtitle: "Get alerts when it matters",
    body: "Score updates, boost settlements, and scout rewards — delivered right when they happen so you never miss a move.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requestPushPermission() {
  return registerForAndroidPushes({
    allowPrompt: true,
    promptSource: "explicit",
    logLabel: "onboarding",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const [, navigate] = useLocation();
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [notificationState, setNotificationState] = useState<
    "idle" | "requesting" | "granted" | "denied"
  >("idle");
  const hasPromptedOnNotificationSlideRef = useRef(false);

  const isLastSlide = current === SLIDES.length - 1;
  const isNotificationSlide = SLIDES[current]?.id === "notifications";

  // Keep a ref to the back-button listener so we can clean it up.
  const backButtonListenerRef = useRef<{ remove: () => Promise<void> } | null>(null);

  // Refs so the back-button handler (registered once) can always read the
  // latest carousel state without causing the effect to re-run.
  const currentRef = useRef(current);
  const apiRef = useRef(api);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  // ---------------------------------------------------------------------------
  // Back-button: go to previous slide, or minimise on first slide.
  // Registered once on mount; current/api are read from refs to avoid
  // re-registration (which can leave duplicate listeners) on each slide change.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;

    const register = async () => {
      const handle = await CapacitorApp.addListener("backButton", () => {
        if (currentRef.current > 0) {
          void hapticLight();
          apiRef.current?.scrollPrev();
        } else {
          void CapacitorApp.minimizeApp();
        }
      });
      if (cancelled) {
        // Component unmounted before the promise resolved — drop the handle.
        void handle.remove();
      } else {
        backButtonListenerRef.current = handle;
      }
    };

    void register();

    return () => {
      cancelled = true;
      void backButtonListenerRef.current?.remove();
      backButtonListenerRef.current = null;
    };
  }, []); // ← empty: register once, never re-register

  // Status bar — Dark style to match the onboarding dark background.
  // App.tsx's global status bar effect restores the correct state on route change,
  // so no explicit cleanup is needed here.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.setStyle({ style: StatusBarStyle.Dark }).catch(() => undefined);
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
  }, []);

  // ---------------------------------------------------------------------------
  // Carousel: track current slide index and persist position across interruptions.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!api) return;

    // Restore saved slide position (e.g. after Android destroys the WebView).
    let saved = 0;
    try {
      saved = parseInt(localStorage.getItem("onboarding_slide") ?? "0", 10);
    } catch {
      // Storage unavailable — start from the first slide.
    }
    if (saved > 0 && saved < SLIDES.length) {
      api.scrollTo(saved, true);
    }

    const handleSelect = () => {
      const idx = api.selectedScrollSnap();
      setCurrent(idx);
      try {
        localStorage.setItem("onboarding_slide", String(idx));
      } catch {
        // Ignore storage errors — non-critical.
      }
    };

    setCurrent(api.selectedScrollSnap());
    api.on("select", handleSelect);
    return () => {
      api.off("select", handleSelect);
    };
  }, [api]);

  // ---------------------------------------------------------------------------
  // Complete onboarding mutation.
  // ---------------------------------------------------------------------------
  const completeOnboarding = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/user/onboarding/complete");
    },
    onSuccess: () => {
      try {
        localStorage.removeItem("onboarding_slide");
      } catch {
        // non-critical
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      void hapticHeavy();
      void hapticSuccess();
      navigate("/", { replace: true });
    },
    onError: () => {
      // Navigate anyway — don't block the user on a non-critical API failure.
      navigate("/", { replace: true });
    },
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleNext = useCallback(async () => {
    if (isLastSlide) {
      completeOnboarding.mutate();
      return;
    }
    void hapticLight();
    api?.scrollNext();
  }, [isLastSlide, api, completeOnboarding]);

  const handleSkip = useCallback(() => {
    void hapticMedium();
    completeOnboarding.mutate();
  }, [completeOnboarding]);

  const handleEnableNotifications = useCallback(async () => {
    setNotificationState("requesting");
    void hapticMedium();
    const result = await requestPushPermission().catch(() => null);
    const granted = Boolean(result?.registered);
    setNotificationState(granted ? "granted" : "denied");
    void (granted ? hapticSuccess() : hapticMedium());
  }, []);

  const handleOpenNotificationSettings = useCallback(async () => {
    setNotificationState("requesting");
    try {
      await openAndroidNotificationSettings();
      setNotificationState("denied");
    } catch {
      setNotificationState("denied");
    }
  }, []);

  useEffect(() => {
    if (!isAndroidNativePushSupported()) {
      return;
    }

    if (!isNotificationSlide) {
      return;
    }

    const sync = async () => {
      const snapshot = await getAndroidPushPermissionSnapshot();
      if (snapshot.state === "granted") {
        setNotificationState("granted");
        return;
      }

      if (snapshot.state === "denied") {
        setNotificationState("denied");
        return;
      }

      if (!hasPromptedOnNotificationSlideRef.current) {
        hasPromptedOnNotificationSlideRef.current = true;
        await handleEnableNotifications();
        return;
      }

      setNotificationState("idle");
    };

    void sync();
  }, [handleEnableNotifications, isNotificationSlide]);

  useEffect(() => {
    if (!isAndroidNativePushSupported() || !isNotificationSlide) {
      return;
    }

    let handle: { remove: () => Promise<void> } | null = null;
    const attach = async () => {
      handle = await CapacitorApp.addListener("appStateChange", async ({ isActive }) => {
        if (!isActive) return;
        const snapshot = await getAndroidPushPermissionSnapshot();
        setNotificationState(
          snapshot.state === "granted"
            ? "granted"
            : snapshot.state === "denied"
              ? "denied"
              : "idle",
        );
      });
    };

    void attach();
    return () => {
      void handle?.remove();
    };
  }, [isNotificationSlide]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" data-testid="onboarding-native">
      {/* Top bar with skip */}
      <div
        className="flex items-center justify-end px-5 pt-12 pb-3"
        style={{ paddingTop: "calc(3rem + env(safe-area-inset-top))" }}
      >
        <button
          onClick={handleSkip}
          disabled={completeOnboarding.isPending}
          className="font-mono text-[11px] text-muted-foreground active:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-end"
          data-testid="button-skip-onboarding"
        >
          Skip
        </button>
      </div>

      {/* Carousel */}
      <div className="flex-1 overflow-hidden">
        <Carousel
          setApi={setApi}
          className="h-full w-full"
          opts={{ align: "start", containScroll: "trimSnaps" }}
        >
          <CarouselContent className="-ml-0 h-full">
            {SLIDES.map((slide) => {
              const Icon = slide.icon;
              return (
                <CarouselItem key={slide.id} className="pl-0 basis-full h-full">
                  <div className="flex h-full flex-col items-center justify-center px-8 py-6 text-center">
                    <div
                      className={`mb-8 flex h-24 w-24 items-center justify-center rounded-2xl ${slide.iconBg}`}
                    >
                      <Icon className={`h-12 w-12 ${slide.iconColor}`} />
                    </div>
                    <h1 className="mb-3 text-2xl font-bold leading-tight tracking-tight">
                      {slide.title}
                    </h1>
                    <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                      {slide.subtitle}
                    </p>
                    <p className="max-w-[300px] text-base leading-relaxed text-foreground/75">
                      {slide.body}
                    </p>

                    {/* Notification CTA — shown only on the last slide */}
                    {isNotificationSlide && isAndroidNativePushSupported() && (
                      <div className="mt-8 w-full max-w-[280px]">
                        {notificationState === "idle" && (
                          <Button
                            variant="terminal"
                            className="w-full"
                            onClick={handleEnableNotifications}
                            data-testid="button-enable-notifications"
                          >
                            <Bell className="mr-2 h-4 w-4" />
                            Enable Notifications
                          </Button>
                        )}
                        {notificationState === "requesting" && (
                          <p className="font-mono text-[11px] text-muted-foreground">
                            Requesting permission…
                          </p>
                        )}
                        {notificationState === "granted" && (
                          <p className="font-mono text-[11px] text-emerald-400">
                            ✓ Notifications enabled
                          </p>
                        )}
                        {notificationState === "denied" && (
                          <div className="space-y-3">
                            <p className="font-mono text-[11px] text-muted-foreground">
                              Notifications are off right now. You can retry or open Android
                              settings.
                            </p>
                            <div className="flex flex-col gap-2">
                              <Button
                                variant="terminal"
                                className="w-full"
                                onClick={handleEnableNotifications}
                              >
                                Retry Permission
                              </Button>
                              <Button
                                variant="terminalOutline"
                                className="w-full"
                                onClick={handleOpenNotificationSettings}
                              >
                                Open Android Settings
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CarouselItem>
              );
            })}
          </CarouselContent>
        </Carousel>
      </div>

      {/* Bottom controls */}
      <div
        className="flex flex-col gap-4 border-t border-border bg-card/60 px-6 py-6 backdrop-blur-sm"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        {/* Dot indicators */}
        <div className="flex items-center justify-center gap-2">
          {SLIDES.map((_, index) => (
            <button
              key={index}
              onClick={() => {
                void hapticLight();
                api?.scrollTo(index);
              }}
              className={`h-2 rounded-full transition-all duration-300 ${
                index === current ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30"
              }`}
              aria-label={`Go to slide ${index + 1}`}
              data-testid={`dot-slide-${index}`}
            />
          ))}
        </div>

        {/* Next / Finish */}
        <Button
          variant="terminal"
          size="lg"
          className="w-full"
          onClick={handleNext}
          disabled={completeOnboarding.isPending}
          data-testid="button-next-onboarding"
        >
          {completeOnboarding.isPending ? "Setting up…" : isLastSlide ? "Start Trading" : "Next"}
        </Button>

        {/* Community link on welcome slide */}
        {current === 0 && (
          <a
            href="https://discord.gg/r8MsduNvXG"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 font-mono text-[11px] text-muted-foreground"
            data-testid="link-discord-onboarding"
          >
            <SiDiscord className="h-3.5 w-3.5" />
            Join the community
          </a>
        )}
      </div>
    </div>
  );
}

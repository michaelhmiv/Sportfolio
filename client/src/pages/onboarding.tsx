/**
 * Native-first full-screen onboarding flow (Android/iOS).
 *
 * This page is shown instead of the OnboardingModal when the app is running
 * as a Capacitor native app.  It provides a dedicated, swipeable slide
 * experience with:
 *   1. Welcome — brand / value prop overview
 *   2. Trade — AMM / player pools feature
 *   3. Boost — daily boost lifecycle
 *   4. Notifications — in-context push permission ask
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
import { Activity, Bell, TrendingUp, Trophy } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { StatusBar, Style as StatusBarStyle } from "@capacitor/status-bar";
import { hapticLight, hapticMedium, hapticSuccess } from "@/lib/haptics";
import {
  hasPromptedForPushPermission,
  isAndroidNativePushSupported,
  markPushPermissionPrompted,
} from "@/lib/mobile-push";

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
    body: "Build your portfolio of player shares, trade against live AMM pools, and let game performance do the rest.",
  },
  {
    id: "trade",
    icon: Activity,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-400/10",
    title: "Trade Player Shares",
    subtitle: "Instant AMM pricing — no order book needed",
    body: "Buy or sell any player instantly at the pool price.  Add liquidity to capture fee flow, or scout players to earn shares over time.",
  },
  {
    id: "boost",
    icon: Trophy,
    iconColor: "text-amber-400",
    iconBg: "bg-amber-400/10",
    title: "Boost Game Outcomes",
    subtitle: "Turn strong performances into portfolio upside",
    body: "Assign shares to daily boost slots before tip-off.  Post-game settlement multiplies your payout based on your player's performance.",
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

async function requestPushPermission(): Promise<boolean> {
  if (!isAndroidNativePushSupported()) return false;

  try {
    const status = await PushNotifications.checkPermissions();
    let receive = status.receive;

    if (receive === "prompt" && !hasPromptedForPushPermission()) {
      markPushPermissionPrompted();
      const requested = await PushNotifications.requestPermissions();
      receive = requested.receive;
    }

    if (receive === "granted") {
      await PushNotifications.register();
      return true;
    }
  } catch {
    // Ignore — non-critical
  }
  return false;
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

  const isLastSlide = current === SLIDES.length - 1;
  const isNotificationSlide = SLIDES[current]?.id === "notifications";

  // Keep a ref to the back-button listener so we can clean it up.
  const backButtonListenerRef = useRef<{ remove: () => Promise<void> } | null>(null);

  // ---------------------------------------------------------------------------
  // Back-button: go to previous slide, or minimise on first slide.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const register = async () => {
      backButtonListenerRef.current = await CapacitorApp.addListener(
        "backButton",
        ({ canGoBack: _canGoBack }) => {
          if (current > 0) {
            void hapticLight();
            api?.scrollPrev();
          } else {
            void CapacitorApp.minimizeApp();
          }
        },
      );
    };

    void register();

    return () => {
      void backButtonListenerRef.current?.remove();
      backButtonListenerRef.current = null;
    };
  }, [current, api]);

  // Status bar — Dark style to match the onboarding dark background.
  // App.tsx's global status bar effect restores the correct state on route change,
  // so no explicit cleanup is needed here.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.setStyle({ style: StatusBarStyle.Dark }).catch(() => undefined);
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
  }, []);

  // ---------------------------------------------------------------------------
  // Carousel: track current slide index.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!api) return;

    const handleSelect = () => {
      setCurrent(api.selectedScrollSnap());
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
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
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
    const granted = await requestPushPermission();
    setNotificationState(granted ? "granted" : "denied");
    void (granted ? hapticSuccess() : hapticMedium());
  }, []);

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
                          <p className="font-mono text-[11px] text-muted-foreground">
                            You can enable them later in Settings.
                          </p>
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

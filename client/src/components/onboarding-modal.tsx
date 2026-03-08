import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Activity, Trophy, TrendingUp } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
}

interface OnboardingSlide {
  id: string;
  icon: typeof Activity;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  ctaLabel: string;
  ctaPath: string;
}

const slides: OnboardingSlide[] = [
  {
    id: "scouts",
    icon: Activity,
    title: "EARN WITH SCOUTS",
    subtitle: "Scout-minutes generate hourly shares",
    description:
      "Assign up to 5 scouts (10 premium) and earn shares every hour based on your share of scout-minutes.",
    color: "text-amber-500",
    ctaLabel: "Open Scouts",
    ctaPath: "/pools",
  },
  {
    id: "pools",
    icon: TrendingUp,
    title: "TRADE PLAYER POOLS",
    subtitle: "Instant AMM pricing with live quotes",
    description:
      "Buy and sell against constant-product pools instantly, or add liquidity to capture fee flow over time.",
    color: "text-emerald-500",
    ctaLabel: "Go to Pools",
    ctaPath: "/pools",
  },
  {
    id: "boosts",
    icon: Trophy,
    title: "BOOST GAME OUTCOMES",
    subtitle: "Use boost slots with intent",
    description:
      "Deploy one share per daily boost slot, manage multipliers carefully, and turn strong game outcomes into portfolio upside.",
    color: "text-sky-500",
    ctaLabel: "Open Boosts",
    ctaPath: "/boosts",
  },
];

function trackOnboardingEvent(event: string, data?: Record<string, unknown>) {
  console.info(`[ONBOARDING_EVENT] ${event}`, data || {});
}

export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const [, navigate] = useLocation();
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  const completeOnboarding = useMutation({
    mutationFn: async (nextPath?: string) => {
      await apiRequest("POST", "/api/user/onboarding/complete");
      return nextPath;
    },
    onSuccess: (nextPath) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      onComplete();
      trackOnboardingEvent("completed", { nextPath: nextPath || "none" });
      if (nextPath) {
        navigate(nextPath);
      }
    },
    onError: (_error, nextPath) => {
      onComplete();
      trackOnboardingEvent("completion_failed", { nextPath: nextPath || "none" });
      if (nextPath) {
        navigate(nextPath);
      }
    },
  });

  useEffect(() => {
    if (!api) return;

    const handleSelect = () => {
      const index = api.selectedScrollSnap();
      setCurrent(index);
      trackOnboardingEvent("slide_viewed", { slide: slides[index]?.id || "unknown", index });
    };

    setCurrent(api.selectedScrollSnap());
    api.on("select", handleSelect);

    return () => {
      api.off("select", handleSelect);
    };
  }, [api]);

  useEffect(() => {
    if (!open) return;
    trackOnboardingEvent("opened");
  }, [open]);

  const handleNext = useCallback(() => {
    if (current === slides.length - 1) {
      completeOnboarding.mutate(undefined);
    } else {
      api?.scrollNext();
    }
  }, [api, current, completeOnboarding]);

  const handleSkip = useCallback(() => {
    trackOnboardingEvent("skipped", { atSlide: slides[current]?.id || "unknown" });
    completeOnboarding.mutate(undefined);
  }, [completeOnboarding, current]);

  const handleSlideAction = useCallback(
    (slide: OnboardingSlide) => {
      trackOnboardingEvent("slide_cta_clicked", { slide: slide.id, path: slide.ctaPath });
      completeOnboarding.mutate(slide.ctaPath);
    },
    [completeOnboarding],
  );

  const isLastSlide = current === slides.length - 1;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="w-[92vw] max-w-[430px] overflow-hidden rounded-sm border border-border p-0 shadow-2xl sm:max-w-[460px]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="onboarding-modal"
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>Welcome to Sportfolio</DialogTitle>
        </VisuallyHidden>

        <div className="h-1 bg-primary" />

        <div className="w-full overflow-hidden bg-card">
          <Carousel
            setApi={setApi}
            className="w-full"
            opts={{ align: "start", containScroll: "trimSnaps" }}
          >
            <CarouselContent className="-ml-0">
              {slides.map((slide) => {
                const Icon = slide.icon;
                return (
                  <CarouselItem key={slide.id} className="pl-0 basis-full">
                    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-8 text-center sm:px-8">
                      <div className={`terminal-avatar mb-5 h-16 w-16 ${slide.color} bg-muted/40`}>
                        <Icon className="w-8 h-8" />
                      </div>
                      <h2 className="terminal-heading mb-2 text-lg">{slide.title}</h2>
                      <p className="terminal-label mb-4 text-[10px]">{slide.subtitle}</p>
                      <p className="max-w-[320px] text-sm leading-relaxed text-foreground/80">
                        {slide.description}
                      </p>
                      <Button
                        variant="terminal"
                        className="mt-6 w-full sm:w-auto"
                        onClick={() => handleSlideAction(slide)}
                        disabled={completeOnboarding.isPending}
                        data-testid={`button-onboarding-cta-${slide.id}`}
                      >
                        {slide.ctaLabel}
                      </Button>
                    </div>
                  </CarouselItem>
                );
              })}
            </CarouselContent>
          </Carousel>
        </div>

        <div className="flex flex-col gap-3 border-t border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <a
              href="https://discord.gg/r8MsduNvXG"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              data-testid="link-discord"
            >
              <SiDiscord className="w-3.5 h-3.5" />
              Join the community
            </a>
            <div className="flex justify-center gap-2">
              {slides.map((_, index) => (
                <button
                  key={index}
                  onClick={() => api?.scrollTo(index)}
                  className={`h-2.5 w-2.5 rounded-sm transition-colors ${
                    index === current ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                  aria-label={`Go to slide ${index + 1}`}
                  data-testid={`dot-slide-${index}`}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="terminalOutline"
              size="sm"
              onClick={handleSkip}
              className="text-muted-foreground"
              data-testid="button-skip-onboarding"
            >
              Skip
            </Button>
            <Button
              variant="terminal"
              size="sm"
              onClick={handleNext}
              disabled={completeOnboarding.isPending}
              data-testid="button-next-onboarding"
            >
              {isLastSlide ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

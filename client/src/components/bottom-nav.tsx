import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { SportIcon } from "@/components/sport-icon";
import { useAuth } from "@/hooks/useAuth";
import { MOBILE_NAV_ITEM_IDS, getAppNavItem, isAppRouteActive } from "@/lib/app-navigation";
import { hapticLight } from "@/lib/haptics";
import { useNotifications } from "@/lib/notification-context";
import { preloadRoute } from "@/lib/route-preload";
import { SPORTS, useSport, type Sport } from "@/lib/sport-context";
import { cn } from "@/lib/utils";

/** Retains the established App.tsx transition contract while sharing route metadata. */
export const NAV_ITEMS = MOBILE_NAV_ITEM_IDS.map((id) => {
  const item = getAppNavItem(id);
  return {
    id: item.id,
    title: item.label,
    shortLabel: item.shortLabel ?? item.label,
    url: item.href,
    icon: item.icon,
  };
});

const getSportLabel = (sport: Sport) => (sport === "ALL" ? "All Sports" : sport);

export function BottomNav() {
  const [location] = useLocation();
  const { unreadCount } = useNotifications();
  const { user } = useAuth();
  const isPremium = user?.isPremium || false;
  const [previousLocation, setPreviousLocation] = useState(location);
  const [justActivated, setJustActivated] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const { sport, setSport } = useSport();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Reuse dashboard cache data; this does not create an additional fetch contract.
  const { data: dashData } = useQuery<any>({ queryKey: ["/api/dashboard"] });
  const slotsRemaining = (dashData?.boosts?.slotsRemaining ?? 0) as number;

  const handleClick = (event: React.MouseEvent, url: string) => {
    if (url === "/" && location === "/") {
      event.preventDefault();
      setIsDrawerOpen(true);
    }
    void hapticLight();
  };

  useEffect(() => {
    if (location !== previousLocation) {
      setJustActivated(location);
      setPreviousLocation(location);
      const timer = setTimeout(() => setJustActivated(null), 260);
      return () => clearTimeout(timer);
    }
  }, [location, previousLocation]);

  return (
    <>
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent>
          <div className="mx-auto w-full max-w-sm">
            <DrawerHeader>
              <DrawerTitle>Select market</DrawerTitle>
              <DrawerDescription>Set the sport used across exchange surfaces.</DrawerDescription>
            </DrawerHeader>
            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
              {SPORTS.map((marketSport) => {
                const isSelected = sport === marketSport;
                const label = getSportLabel(marketSport);
                return (
                  <Button
                    key={marketSport}
                    variant={isSelected ? "default" : "outline"}
                    className="relative h-14 justify-start gap-3 px-4 touch-manipulation"
                    aria-label={`${label}${isSelected ? ", selected" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSport(marketSport);
                      setIsDrawerOpen(false);
                      void hapticLight();
                    }}
                  >
                    <SportIcon sport={marketSport} className="h-5 w-5" aria-hidden="true" />
                    <span className="font-semibold">{label}</span>
                    {isSelected ? <Check className="ml-auto h-4 w-4" aria-hidden="true" /> : null}
                  </Button>
                );
              })}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <nav
        aria-label="Main navigation"
        data-testid="bottom-navigation"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 select-none border-t border-border-subtle bg-sidebar/95 backdrop-blur sm:hidden",
          isPremium && "border-t-premium/30",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5">
          {NAV_ITEMS.map((item) => {
            const isActive = isAppRouteActive(location, item.url);
            const wasJustActivated = justActivated === item.url;
            return (
              <Link
                key={item.id}
                href={item.url}
                aria-label={item.title}
                aria-current={isActive ? "page" : undefined}
                className="relative flex min-h-11 w-full touch-manipulation items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                onClick={(event) => handleClick(event, item.url)}
                onFocus={() => preloadRoute(item.url)}
                onMouseEnter={() => preloadRoute(item.url)}
                data-testid={`button-nav-${item.id}`}
              >
                <motion.span
                  className={cn(
                    "relative flex h-[52px] w-[calc(100%-4px)] flex-col items-center justify-center gap-1 rounded-control text-content-muted transition-colors duration-fast",
                    isActive &&
                      "bg-brand-subtle text-brand before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-pill before:bg-brand",
                  )}
                  animate={
                    wasJustActivated && !prefersReducedMotion ? { y: [0, -2, 0] } : undefined
                  }
                  transition={{ duration: 0.22, ease: "easeOut" }}
                >
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                  <span className="max-w-full truncate px-1 text-[10px] font-semibold tracking-tight">
                    {item.shortLabel}
                  </span>

                  {item.id === "portfolio" && unreadCount > 0 ? (
                    <Badge
                      variant="notification"
                      className="absolute right-1 top-1 h-5"
                      aria-label={`${unreadCount} unread portfolio notifications`}
                      data-testid="badge-notification-count-mobile"
                    >
                      {unreadCount}
                    </Badge>
                  ) : null}

                  {item.id === "boosts" && slotsRemaining > 0 ? (
                    <Badge
                      variant="boost"
                      className="absolute right-1 top-1 h-5 min-w-5 justify-center bg-boost px-1.5 text-boost-foreground"
                      aria-label={`${slotsRemaining} boost slots remaining`}
                      data-testid="badge-boost-slots-remaining"
                    >
                      {slotsRemaining}
                    </Badge>
                  ) : null}
                </motion.span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

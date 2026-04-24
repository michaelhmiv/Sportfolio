import { BarChart3, Briefcase, Home, TrendingUp, Zap } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/lib/notification-context";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSport, SPORTS, Sport } from "@/lib/sport-context";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { hapticLight } from "@/lib/haptics";

const navItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Player Pools",
    url: "/pools",
    icon: TrendingUp,
  },
  {
    title: "Boosts",
    url: "/boosts",
    icon: Zap,
  },
  {
    title: "Portfolio",
    url: "/portfolio",
    icon: Briefcase,
  },
  {
    title: "Analytics",
    url: "/analytics",
    icon: BarChart3,
  },
];

/** Exported so App.tsx can read the active tab index for directional transitions */
export const NAV_ITEMS = navItems;

export function BottomNav() {
  const [location] = useLocation();
  const { unreadCount } = useNotifications();
  const { user } = useAuth();
  const isPremium = user?.isPremium || false;
  const [previousLocation, setPreviousLocation] = useState(location);
  const [justActivated, setJustActivated] = useState<string | null>(null);

  // Sport Context & Filter
  const { sport, setSport } = useSport();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleClick = (e: React.MouseEvent, url: string) => {
    // If clicking Dashboard while already on Dashboard, open filter
    if (url === "/" && location === "/") {
      e.preventDefault();
      setIsDrawerOpen(true);
      void hapticLight();
    } else {
      void hapticLight();
    }
  };

  useEffect(() => {
    if (location !== previousLocation) {
      setJustActivated(location);
      setPreviousLocation(location);
      const timer = setTimeout(() => setJustActivated(null), 400);
      return () => clearTimeout(timer);
    }
  }, [location, previousLocation]);

  const getSportIcon = (s: Sport) => {
    switch (s) {
      case "NBA":
        return "🏀";
      case "NFL":
        return "🏈";
      case "MLB":
        return "⚾";
      case "NASCAR":
        return "🏎️";
      case "ALL":
        return "🌎";
    }
  };

  const getSportLabel = (s: Sport) => {
    switch (s) {
      case "NBA":
        return "NBA";
      case "NFL":
        return "NFL";
      case "MLB":
        return "MLB";
      case "NASCAR":
        return "NASCAR";
      case "ALL":
        return "All Sports";
    }
  };

  return (
    <>
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent>
          <div className="mx-auto w-full max-w-sm">
            <DrawerHeader>
              <DrawerTitle>Select Market</DrawerTitle>
              <DrawerDescription>Filter the entire app by sport.</DrawerDescription>
            </DrawerHeader>
            <div className="p-4 pb-8 grid grid-cols-1 gap-3">
              {SPORTS.map((s) => (
                <Button
                  key={s}
                  variant={sport === s ? "default" : "outline"}
                  className="h-14 text-lg justify-start gap-4 px-6 relative overflow-hidden touch-manipulation"
                  onClick={() => {
                    setSport(s);
                    setIsDrawerOpen(false);
                    void hapticLight();
                  }}
                >
                  <span className="text-2xl">{getSportIcon(s)}</span>
                  <span className="font-bold">{getSportLabel(s)}</span>
                  {sport === s && (
                    <div className="absolute right-4 h-3 w-3 rounded-sm bg-primary-foreground animate-pulse" />
                  )}
                </Button>
              ))}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <nav
        aria-label="Main navigation"
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t sm:hidden select-none",
          isPremium && "border-t-yellow-500/30",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-5 h-16 max-w-md mx-auto">
          {navItems.map((item) => {
            const isActive = location === item.url;
            const wasJustActivated = justActivated === item.url;
            return (
              <div key={item.title} className="flex items-center justify-center">
                <Link
                  href={item.url}
                  aria-label={item.title}
                  aria-current={isActive ? "page" : undefined}
                  className="flex items-center justify-center w-full h-full min-h-[48px] touch-manipulation"
                  onClick={(e) => handleClick(e, item.url)}
                >
                  <motion.div
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 py-1 rounded-none transition-colors w-full h-full relative",
                      isActive ? "text-primary" : "text-muted-foreground",
                    )}
                    data-testid={`button - nav - ${item.title.toLowerCase()} `}
                    animate={
                      wasJustActivated
                        ? {
                            scale: [1, 1.15, 0.95, 1.05, 1],
                            y: [0, -6, 0, -2, 0],
                          }
                        : {}
                    }
                    transition={{
                      duration: 0.4,
                      ease: "easeOut",
                    }}
                  >
                    <motion.div
                      animate={
                        wasJustActivated
                          ? {
                              scale: [1, 1.3, 1],
                              rotate: [0, -10, 10, 0],
                            }
                          : {}
                      }
                      transition={{ duration: 0.3 }}
                    >
                      <item.icon className="w-5 h-5" aria-hidden="true" />
                    </motion.div>
                    <span className="text-[10px] font-medium">{item.title}</span>

                    {/* Active Overlay Background with Sport Watermark */}
                    <AnimatePresence>
                      {isActive && (
                        <motion.div
                          layoutId="activeTab"
                          className="absolute inset-x-1 inset-y-1 -z-10 flex items-center justify-center overflow-hidden rounded-sm bg-primary/10"
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ duration: 0.2 }}
                        >
                          <span className="text-3xl opacity-20 select-none grayscale cursor-default">
                            {getSportIcon(sport)}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {item.title === "Portfolio" && unreadCount > 0 && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 25 }}
                        className="absolute top-1 right-2 z-[51]"
                      >
                        <Badge
                          variant="default"
                          className="min-w-5 h-5 flex items-center justify-center px-1.5 text-xs"
                          data-testid="badge-notification-count-mobile"
                        >
                          {unreadCount}
                        </Badge>
                      </motion.div>
                    )}
                  </motion.div>
                </Link>
              </div>
            );
          })}
        </div>
      </nav>
    </>
  );
}

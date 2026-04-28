import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Star,
  Activity,
  Search,
  ShoppingCart,
  Zap,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface ScoutData {
  assignments: Array<{ playerId: string; scoutCount: number }>;
  totalScouts: number;
}

interface DailyBoostsData {
  boosts: Array<{ id: string }>;
}

interface BoostHistoryData {
  totalBoosts: number;
}

export function OnboardingMissions() {
  const { user, isLoading: userLoading } = useAuth();
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(true);

  const shouldShowMissions = !!user && user.hasSeenOnboarding === false;

  const skipMissionsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/user/onboarding/complete");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  if (!shouldShowMissions) return null;
  if (skipMissionsMutation.isSuccess) return null;

  // Mission tracking queries
  const { data: trades, isLoading: tradesLoading } = useQuery<any[]>({
    queryKey: ["/api/trades/history"],
    enabled: shouldShowMissions,
  });

  const { data: scoutsData, isLoading: scoutsLoading } = useQuery<ScoutData>({
    queryKey: ["/api/scouts"],
    enabled: shouldShowMissions,
  });

  const { data: boostsData, isLoading: boostsLoading } = useQuery<DailyBoostsData>({
    queryKey: ["/api/daily-boosts/all"],
    enabled: shouldShowMissions,
  });

  const { data: boostHistory, isLoading: boostHistoryLoading } = useQuery<BoostHistoryData>({
    queryKey: ["/api/daily-boosts/history"],
    enabled: shouldShowMissions,
  });

  const { data: watchList, isLoading: watchlistLoading } = useQuery<string[]>({
    queryKey: ["/api/watchlist"],
    enabled: shouldShowMissions,
  });

  const missions = [
    {
      id: "scout",
      title: "Assign a Scout",
      description: "Deploy your first scout to start earning hourly scout-share payouts.",
      icon: <Activity className="w-4 h-4" />,
      completed: (scoutsData?.totalScouts || 0) > 0,
      link: "/pools",
    },
    {
      id: "watchlist",
      title: "Track a Player",
      description: "Add at least one player to your watchlist for quick monitoring.",
      icon: <Search className="w-4 h-4" />,
      completed: (watchList?.length || 0) > 0,
      link: "/pools",
    },
    {
      id: "trade",
      title: "Trade a Pool",
      description: "Buy your first shares from a player pool.",
      icon: <ShoppingCart className="w-4 h-4" />,
      completed: (trades?.filter((t: any) => t.activityType === "trade")?.length || 0) > 0,
      link: "/pools",
    },
    {
      id: "boost",
      title: "Use Daily Boosts",
      description: "Place one share into a Daily Boost slot.",
      icon: <Zap className="w-4 h-4" />,
      completed: (boostsData?.boosts?.length || 0) > 0 || (boostHistory?.totalBoosts || 0) > 0,
      link: "/boosts",
    },
  ];

  // Check loading states
  const isLoading =
    userLoading === undefined || // user object is available from context immediately if auth is done, but let's be safe
    tradesLoading ||
    scoutsLoading ||
    boostsLoading ||
    boostHistoryLoading ||
    watchlistLoading ||
    skipMissionsMutation.isPending;

  if (isLoading)
    return (
      <Card variant="terminal" className="relative overflow-hidden border-primary/20">
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-5 w-10" />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 flex flex-col gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );

  const completedCount = missions.filter((m) => m.completed).length;
  const progress = (completedCount / missions.length) * 100;

  if (completedCount === missions.length) return null;

  return (
    <Card
      variant="terminal"
      className="relative overflow-hidden border-primary/20 shadow-[0_10px_30px_rgba(2,6,23,0.22)]"
    >
      <CardHeader
        className="py-3 px-4 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="terminal-avatar h-7 w-7 border-primary/20 bg-primary/10 text-primary">
              <Star className="w-4 h-4 fill-primary" />
            </div>
            <CardTitle className="terminal-heading text-sm">Rookie Missions</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="terminalOutline"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={(event) => {
                event.stopPropagation();
                skipMissionsMutation.mutate();
              }}
              disabled={skipMissionsMutation.isPending}
              data-testid="button-skip-rookie-missions"
            >
              Skip
            </Button>
            <Badge
              variant="outline"
              className="h-5 px-1.5 font-mono text-[10px] text-primary border-primary/30 bg-primary/5"
            >
              {completedCount}/{missions.length}
            </Badge>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Compact progress bar visible when collapsed */}
        {!isExpanded && (
          <div className="mt-2">
            <Progress value={progress} className="h-1 bg-muted/50">
              <div
                className="h-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </Progress>
          </div>
        )}
      </CardHeader>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  <span>Career Progress</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-1.5 bg-muted/50">
                  <div
                    className="h-full bg-primary transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </Progress>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {missions.map((mission, idx) => (
                  <motion.div
                    key={mission.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <Link href={mission.link}>
                      <div
                        className={`terminal-shell group flex cursor-pointer items-center justify-between p-2.5 transition-all ${
                          mission.completed
                            ? "bg-primary/5 border-primary/10 opacity-70"
                            : "bg-muted/20 border-white/5 hover:border-primary/30 hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-sm border ${
                              mission.completed
                                ? "border-primary/15 bg-primary/15 text-primary"
                                : "border-white/5 bg-card text-muted-foreground group-hover:text-primary transition-colors"
                            }`}
                          >
                            {mission.icon}
                          </div>
                          <div className="flex flex-col">
                            <h4 className="text-[13px] font-semibold leading-none">
                              {mission.title}
                            </h4>
                            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">
                              {mission.description}
                            </p>
                          </div>
                        </div>
                        {mission.completed ? (
                          <CheckCircle2 className="w-4 h-4 text-primary" />
                        ) : (
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        )}
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

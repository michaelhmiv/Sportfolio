import { motion, AnimatePresence } from "framer-motion";
import { Waves, TrendingUp, TrendingDown, X, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/lib/websocket";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface WhaleAlert {
  id: string;
  playerId: string;
  playerName: string;
  traderUsername: string;
  tradeValue: number;
  type: "buy" | "sell";
  timestamp: number;
}

interface WhaleAlertBannerProps {
  className?: string;
}

function maskUsername(username: string): string {
  if (username.length <= 3) return "***";
  return username.slice(0, 2) + "***" + username.slice(-1);
}

export function WhaleAlertBanner({ className }: WhaleAlertBannerProps) {
  const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
  const [currentAlert, setCurrentAlert] = useState<WhaleAlert | null>(null);
  const { subscribe } = useWebSocket();
  const [, navigate] = useLocation();

  useEffect(() => {
    const unsubscribe = subscribe("whale_alert", (message) => {
      const newAlert: WhaleAlert = {
        id: `${Date.now()}-${Math.random()}`,
        playerId: message.playerId,
        playerName: message.playerName,
        traderUsername: message.traderUsername,
        tradeValue: message.tradeValue,
        type: message.tradeType,
        timestamp: Date.now(),
      };

      setAlerts((prev) => [...prev, newAlert]);
    });

    return () => unsubscribe();
  }, [subscribe]);

  useEffect(() => {
    if (alerts.length > 0 && !currentAlert) {
      // Show next alert
      const nextAlert = alerts[0];
      setCurrentAlert(nextAlert);
      setAlerts((prev) => prev.slice(1));

      // Auto-dismiss after 5 seconds
      const timer = setTimeout(() => {
        setCurrentAlert(null);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [alerts, currentAlert]);

  const dismissAlert = () => {
    setCurrentAlert(null);
  };

  const handleViewPlayer = () => {
    if (currentAlert) {
      navigate(`/player/${currentAlert.playerId}`);
      dismissAlert();
    }
  };

  if (!currentAlert) return null;

  const isBuy = currentAlert.type === "buy";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentAlert.id}
        initial={{ opacity: 0, y: -50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className={cn(
          "fixed top-4 left-1/2 -translate-x-1/2 z-50",
          "w-full max-w-lg px-4",
          className,
        )}
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-xl border p-4",
            "bg-gradient-to-r from-slate-900/95 to-slate-800/95",
            "backdrop-blur-sm shadow-2xl",
            isBuy
              ? "border-emerald-500/50 shadow-emerald-500/20"
              : "border-red-500/50 shadow-red-500/20",
          )}
        >
          {/* Animated background wave */}
          <motion.div
            className={cn("absolute inset-0 opacity-10", isBuy ? "bg-emerald-500" : "bg-red-500")}
            animate={{
              x: ["-100%", "100%"],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "linear",
            }}
            style={{
              background: `linear-gradient(90deg, transparent, ${
                isBuy ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"
              }, transparent)`,
            }}
          />

          {/* Content */}
          <div className="relative flex items-center gap-4">
            {/* Icon */}
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.1 }}
              className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
                isBuy ? "bg-emerald-500/20" : "bg-red-500/20",
              )}
            >
              <Waves className={cn("w-6 h-6", isBuy ? "text-emerald-500" : "text-red-500")} />
            </motion.div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 }}
                className="flex items-center gap-2"
              >
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Whale Alert
                </span>
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1, repeat: 3 }}
                  className={cn("w-2 h-2 rounded-full", isBuy ? "bg-emerald-500" : "bg-red-500")}
                />
              </motion.div>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-sm font-medium mt-1"
              >
                <span className="text-muted-foreground">
                  {maskUsername(currentAlert.traderUsername)}
                </span>
                <span className="mx-1">{isBuy ? "bought" : "sold"}</span>
                <span className="font-bold">{currentAlert.playerName}</span>
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="flex items-center gap-2 mt-1"
              >
                <span
                  className={cn(
                    "text-lg font-bold font-mono",
                    isBuy ? "text-emerald-500" : "text-red-500",
                  )}
                >
                  ${currentAlert.tradeValue.toLocaleString()}
                </span>
                {isBuy ? (
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                )}
              </motion.div>
            </div>

            {/* View Player Button */}
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 }}
              className="shrink-0"
            >
              <Button
                size="sm"
                variant="outline"
                onClick={handleViewPlayer}
                className={cn(
                  "h-8 text-xs gap-1",
                  isBuy
                    ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                    : "border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300",
                )}
              >
                View
                <ExternalLink className="w-3 h-3" />
              </Button>
            </motion.div>

            {/* Close button */}
            <motion.button
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
              onClick={dismissAlert}
              className="p-1.5 rounded-full hover:bg-white/10 transition-colors shrink-0"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </motion.button>
          </div>

          {/* Progress bar */}
          <motion.div
            className={cn(
              "absolute bottom-0 left-0 h-0.5",
              isBuy ? "bg-emerald-500" : "bg-red-500",
            )}
            initial={{ width: "100%" }}
            animate={{ width: "0%" }}
            transition={{ duration: 5, ease: "linear" }}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Hook to use whale alerts
export function useWhaleAlerts() {
  const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribe("whale_alert", (message) => {
      const newAlert: WhaleAlert = {
        id: `${Date.now()}-${Math.random()}`,
        playerId: message.playerId,
        playerName: message.playerName,
        traderUsername: message.traderUsername,
        tradeValue: message.tradeValue,
        type: message.tradeType,
        timestamp: Date.now(),
      };

      setAlerts((prev) => [...prev.slice(-4), newAlert]); // Keep last 5 alerts
    });

    return () => unsubscribe();
  }, [subscribe]);

  return alerts;
}

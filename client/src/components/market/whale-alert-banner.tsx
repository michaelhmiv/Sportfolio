import { motion, AnimatePresence } from "framer-motion";
import { Waves, TrendingUp, TrendingDown, X, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { formatAdaptiveCurrency } from "@/lib/currency";
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

interface WhaleAlertMessage {
  playerId: string;
  playerName: string;
  traderUsername: string;
  tradeValue: number;
  tradeType: "buy" | "sell";
}

interface WhaleAlertBannerProps {
  className?: string;
  initialMessage?: WhaleAlertMessage;
}

const WHALE_ALERT_DURATION_MS = 3000;
const SWIPE_DISMISS_THRESHOLD = 60;

function maskUsername(username: string): string {
  if (username.length <= 3) return "***";
  return username.slice(0, 2) + "***" + username.slice(-1);
}

function toWhaleAlert(message: WhaleAlertMessage): WhaleAlert {
  return {
    id: `${Date.now()}-${Math.random()}`,
    playerId: message.playerId,
    playerName: message.playerName,
    traderUsername: message.traderUsername,
    tradeValue: message.tradeValue,
    type: message.tradeType,
    timestamp: Date.now(),
  };
}

export function WhaleAlertBanner({ className, initialMessage }: WhaleAlertBannerProps) {
  const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
  const [currentAlert, setCurrentAlert] = useState<WhaleAlert | null>(() =>
    initialMessage ? toWhaleAlert(initialMessage) : null,
  );
  const { subscribe } = useWebSocket();
  const [, navigate] = useLocation();

  useEffect(() => {
    const unsubscribe = subscribe("whale_alert", (message) => {
      setAlerts((prev) => [...prev, toWhaleAlert(message)]);
    });

    return () => unsubscribe();
  }, [subscribe]);

  useEffect(() => {
    if (alerts.length > 0 && !currentAlert) {
      const nextAlert = alerts[0];
      setCurrentAlert(nextAlert);
      setAlerts((prev) => prev.slice(1));
    }
  }, [alerts, currentAlert]);

  useEffect(() => {
    if (!currentAlert) return;

    const timer = setTimeout(() => {
      setCurrentAlert(null);
    }, WHALE_ALERT_DURATION_MS);

    return () => clearTimeout(timer);
  }, [currentAlert]);

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
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => {
          if (Math.abs(info.offset.x) >= SWIPE_DISMISS_THRESHOLD) {
            dismissAlert();
          }
        }}
        className={cn(
          "fixed inset-x-2 z-50 px-0 sm:left-1/2 sm:right-auto sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2",
          className,
        )}
        style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div
          className={cn(
            "terminal-shell relative overflow-hidden p-4",
            "bg-[linear-gradient(90deg,rgba(15,23,42,0.98),rgba(30,41,59,0.94))]",
            "backdrop-blur-sm shadow-2xl",
            "cursor-pointer",
            isBuy
              ? "border-emerald-500/50 shadow-emerald-500/20"
              : "border-red-500/50 shadow-red-500/20",
          )}
          role="button"
          tabIndex={0}
          aria-label="Dismiss whale alert"
          onClick={dismissAlert}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              dismissAlert();
            }
          }}
          style={{ touchAction: "pan-y" }}
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
          <div className="relative flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-2 sm:gap-4">
              {/* Icon */}
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.1 }}
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border sm:h-12 sm:w-12",
                  isBuy ? "bg-emerald-500/20" : "bg-red-500/20",
                )}
              >
                <Waves
                  className={cn(
                    "h-5 w-5 sm:h-6 sm:w-6",
                    isBuy ? "text-emerald-500" : "text-red-500",
                  )}
                />
              </motion.div>

              {/* Text */}
              <div className="min-w-0 flex-1 overflow-hidden">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 }}
                  className="flex items-center gap-2"
                >
                  <span className="terminal-label">Whale Alert</span>
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1, repeat: 3 }}
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-sm",
                      isBuy ? "bg-emerald-500" : "bg-red-500",
                    )}
                  />
                </motion.div>

                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="mt-1 break-words text-sm font-medium leading-tight"
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
                  className="mt-1 flex flex-wrap items-center gap-2"
                >
                  <span
                    className={cn(
                      "font-mono text-base font-bold sm:text-lg",
                      isBuy ? "text-emerald-500" : "text-red-500",
                    )}
                  >
                    {formatAdaptiveCurrency(currentAlert.tradeValue)}
                  </span>
                  {isBuy ? (
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  )}
                </motion.div>
              </div>
            </div>

            {/* Actions: View Button + Close */}
            <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto sm:gap-2">
              {/* View Player Button */}
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.25 }}
                className="shrink-0"
              >
                <Button
                  size="sm"
                  variant="terminalOutline"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleViewPlayer();
                  }}
                  className={cn(
                    "h-7 sm:h-8 text-xs gap-1 px-2 sm:px-3",
                    isBuy
                      ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                      : "border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300",
                  )}
                >
                  <span className="hidden sm:inline">View</span>
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </motion.div>

              {/* Close button */}
              <motion.button
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
                onClick={(event) => {
                  event.stopPropagation();
                  dismissAlert();
                }}
                className="shrink-0 border border-border p-1 transition-colors hover:bg-white/10 sm:p-1.5"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </motion.button>
            </div>
          </div>

          {/* Progress bar */}
          <motion.div
            className={cn(
              "absolute bottom-0 left-0 h-0.5",
              isBuy ? "bg-emerald-500" : "bg-red-500",
            )}
            initial={{ width: "100%" }}
            animate={{ width: "0%" }}
            transition={{ duration: WHALE_ALERT_DURATION_MS / 1000, ease: "linear" }}
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

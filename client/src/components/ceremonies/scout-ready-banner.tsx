import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { Binoculars, X, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ScoutReadyBannerProps {
  isVisible: boolean;
  totalShares: number;
  playerCount: number;
  onView: () => void;
  onDismiss: () => void;
  onViewPortfolio?: () => void;
}

export function ScoutReadyBanner({
  isVisible,
  totalShares,
  playerCount,
  onView,
  onDismiss,
  onViewPortfolio,
}: ScoutReadyBannerProps) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (isVisible) {
      setProgress(100);
      const duration = 5000; // 5 seconds
      const interval = 100; // Update every 100ms
      const step = 100 / (duration / interval);

      const timer = setInterval(() => {
        setProgress((prev) => {
          const next = prev - step;
          if (next <= 0) {
            clearInterval(timer);
            onDismiss();
            return 0;
          }
          return next;
        });
      }, interval);

      return () => clearInterval(timer);
    }
  }, [isVisible, onDismiss]);

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-96"
      >
        <div className="relative overflow-hidden rounded-lg border bg-card shadow-lg"
        >
          {/* Progress bar */}
          <div
            className="absolute bottom-0 left-0 h-1 bg-amber-500 transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />

          <div className="p-4 flex items-center gap-3"
          >
            {/* Icon */}
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center"
            >
              <Binoculars className="w-5 h-5 text-amber-500" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0"
            >
              <p className="text-sm font-medium">
                Scout shares ready!
              </p>
              <p className="text-xs text-muted-foreground"
              >
                {totalShares.toFixed(2)} shares from {playerCount} players
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap justify-end"
            >
              <Button
                size="sm"
                variant="outline"
                onClick={onView}
                className="h-8 text-xs bg-amber-500/10 border-amber-500/20 text-amber-500 hover:bg-amber-500/20"
              >
                View
              </Button>
              {onViewPortfolio && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onViewPortfolio}
                  className="h-8 text-xs gap-1"
                >
                  <Wallet className="w-3 h-3" />
                  Portfolio
                </Button>
              )}
              <button
                onClick={onDismiss}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

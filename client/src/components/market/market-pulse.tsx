import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { resolveApiUrl } from "@/lib/native-runtime";

interface MarketPulseProps {
  children: React.ReactNode;
}

interface MarketActivity {
  activityLevel: number;
  tradeCount: number;
  timestamp: string;
}

export function MarketPulse({ children }: MarketPulseProps) {
  const [activityLevel, setActivityLevel] = useState(0);
  const [isEvening, setIsEvening] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if evening (6pm-11pm ET)
    const checkTime = () => {
      const et = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      const hour = new Date(et).getHours();
      setIsEvening(hour >= 18 && hour <= 23);
    };

    // Fetch market activity level
    const fetchActivity = async () => {
      try {
        const res = await fetch(resolveApiUrl("/api/market/activity-level"));
        if (res.ok) {
          const data: MarketActivity = await res.json();
          setActivityLevel(data.activityLevel);
        }
      } catch (error) {
        console.error("Failed to fetch market activity:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkTime();
    fetchActivity();

    const timeInterval = setInterval(checkTime, 60000); // Check every minute
    const activityInterval = setInterval(fetchActivity, 30000); // Update every 30s

    return () => {
      clearInterval(timeInterval);
      clearInterval(activityInterval);
    };
  }, []);

  // Calculate pulse speed based on activity (0-100)
  // Higher activity = faster pulse (lower duration)
  const pulseDuration = isLoading ? 3 : Math.max(1.5, 3 - activityLevel / 50);
  const pulseOpacity = isLoading ? 0.1 : 0.1 + activityLevel / 500;

  return (
    <div className="relative min-h-screen">
      {/* Animated background gradient - changes based on time */}
      <motion.div
        className="fixed inset-0 pointer-events-none z-0"
        animate={{
          background: isEvening
            ? "radial-gradient(ellipse at top, rgba(15, 23, 42, 0.9), transparent 70%)"
            : "radial-gradient(ellipse at top, rgba(16, 185, 129, 0.03), transparent 70%)",
        }}
        transition={{ duration: 2 }}
      />

      {/* Activity pulse overlay */}
      <motion.div
        className="fixed inset-0 pointer-events-none z-0"
        animate={{
          opacity: [pulseOpacity * 0.5, pulseOpacity, pulseOpacity * 0.5],
        }}
        transition={{
          duration: pulseDuration,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          background: isEvening
            ? "radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.1), transparent 60%)"
            : "radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.1), transparent 60%)",
        }}
      />

      {/* Subtle grid pattern */}
      <div
        className={cn(
          "fixed inset-0 pointer-events-none z-0 opacity-[0.02]",
          isEvening ? "bg-chart-4/10" : "bg-market-positive/10",
        )}
        style={{
          backgroundImage: `
            linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px)
          `,
          backgroundSize: "50px 50px",
        }}
      />

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// Activity indicator component for use in headers
interface ActivityIndicatorProps {
  className?: string;
}

export function ActivityIndicator({ className }: ActivityIndicatorProps) {
  const [activityLevel, setActivityLevel] = useState(0);

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const res = await fetch(resolveApiUrl("/api/market/activity-level"));
        if (res.ok) {
          const data: MarketActivity = await res.json();
          setActivityLevel(data.activityLevel);
        }
      } catch (error) {
        console.error("Failed to fetch market activity:", error);
      }
    };

    fetchActivity();
    const interval = setInterval(fetchActivity, 30000);
    return () => clearInterval(interval);
  }, []);

  const getActivityColor = () => {
    if (activityLevel < 20) return "bg-market-positive";
    if (activityLevel < 50) return "bg-chart-2";
    if (activityLevel < 80) return "bg-chart-4";
    return "bg-status-warning";
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <motion.div
        className={cn("h-2 w-2 rounded-compact", getActivityColor())}
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.7, 1, 0.7],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      <span className="text-xs text-muted-foreground">
        {activityLevel < 20 && "Quiet"}
        {activityLevel >= 20 && activityLevel < 50 && "Active"}
        {activityLevel >= 50 && activityLevel < 80 && "Busy"}
        {activityLevel >= 80 && "Hot"}
      </span>
    </div>
  );
}

/**
 * Scout Live Ticker
 *
 * 15-second micro-accumulation widget that makes scout earnings visible
 * in real time. Every 15s a "+0.023" popup floats up showing which player
 * earned it, and a running total marches toward the next hourly settlement.
 *
 * Architecture: frontend-only projection. The rate is calculated from the
 * same /api/scouts data the dashboard already fetches, and the counter
 * resets at the top of the hour when the real distribution arrives.
 */

import { useState, useEffect, useRef } from "react";
import { Binoculars, TrendingUp } from "lucide-react";

const TICK_MS = 15_000; // 15 seconds
const TICKS_PER_HOUR = 240; // 240 ticks in an hour
const HOURLY_SHARES = 60;

interface TickerProps {
  assignments: Array<{
    playerId: string;
    scoutCount: number;
    globalScoutCount: number;
    player?: { firstName: string; lastName: string } | null;
  }>;
  totalScouts: number;
  maxScouts: number;
}

interface PopupAnim {
  id: number;
  /** Format like "Y. Alvarez" */
  shortLabel: string;
  amount: number;
  x: number;
}

/**
 * Get a short label like "A. Judge" from firstName + lastName.
 * Falls back to last name only if first name is missing, or the ID itself.
 */
function shortPlayerLabel(
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string,
): string {
  if (firstName && lastName) {
    return `${firstName.charAt(0)}. ${lastName}`;
  }
  if (lastName) return lastName;
  if (firstName) return firstName;
  return fallback ?? "Unknown";
}

export function ScoutLiveTicker({ assignments, totalScouts, maxScouts }: TickerProps) {
  const [accumulator, setAccumulator] = useState(0);
  const [popups, setPopups] = useState<PopupAnim[]>([]);
  const popupIdRef = useRef(0);

  // Calculate rates for each assignment
  const activeAssignments = assignments
    .filter((a) => a.scoutCount > 0 && a.globalScoutCount > 0)
    .map((a) => ({
      playerId: a.playerId,
      firstName: a.player?.firstName ?? null,
      lastName: a.player?.lastName ?? null,
      yourScouts: a.scoutCount,
      globalScouts: a.globalScoutCount,
    }));

  const totalSharesPerHour = activeAssignments.reduce((sum, a) => {
    return sum + (a.yourScouts / a.globalScouts) * HOURLY_SHARES;
  }, 0);

  const tickAmount = totalSharesPerHour / TICKS_PER_HOUR;

  // Reset at top of the hour
  useEffect(() => {
    const now = new Date();
    const msToNextHour =
      (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();

    const resetTimer = setTimeout(() => {
      setAccumulator(0);
      setPopups([]);
    }, msToNextHour);

    return () => clearTimeout(resetTimer);
  }, []);

  // The 15-second tick
  useEffect(() => {
    if (activeAssignments.length === 0) return;

    const interval = setInterval(() => {
      setAccumulator((prev) => {
        const next = prev + tickAmount;
        const id = popupIdRef.current++;
        const newPopups = activeAssignments.map((a, i) => ({
          id: id + i,
          shortLabel: shortPlayerLabel(a.firstName, a.lastName, a.playerId),
          amount: ((a.yourScouts / a.globalScouts) * HOURLY_SHARES) / TICKS_PER_HOUR,
          x: (i / Math.max(activeAssignments.length - 1, 1)) * 80 + 10,
        }));
        setPopups((prev) => [...prev, ...newPopups].slice(-20));

        setTimeout(() => {
          setPopups((prev) => prev.filter((p) => !newPopups.find((np) => np.id === p.id)));
        }, 3000);

        return next;
      });
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [activeAssignments, tickAmount]);

  // Time until next distribution
  const [timeUntil, setTimeUntil] = useState("");
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const min = 59 - now.getMinutes();
      const sec = 59 - now.getSeconds();
      setTimeUntil(`${min}:${sec.toString().padStart(2, "0")}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  if (activeAssignments.length === 0) {
    return null;
  }

  return (
    <div className="relative border border-border/60 rounded-sm bg-muted/30 p-3 overflow-hidden">
      {/* Floating popup animations */}
      <div className="absolute inset-0 pointer-events-none">
        {popups.map((popup) => (
          <div
            key={popup.id}
            className="absolute text-amber-500 font-mono font-semibold text-[10px] whitespace-nowrap"
            style={{
              left: `${popup.x}%`,
              bottom: "20%",
              animation: "ticker-float-up 2.5s ease-out forwards",
            }}
          >
            +{popup.amount.toFixed(3)} {popup.shortLabel}
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-xs font-semibold text-foreground">Live Share Earnings</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Binoculars className="h-3 w-3" />
              {totalScouts}/{maxScouts}
            </span>
            <span className="tabular-nums">{timeUntil}</span>
          </div>
        </div>

        {/* Running total */}
        <div className="text-center py-2">
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-500">
            {accumulator.toFixed(2)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">shares this hour</div>
        </div>

        {/* Progress bar to next distribution */}
        <div className="space-y-1 mb-2">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{totalSharesPerHour.toFixed(2)} / hr</span>
            <span className="tabular-nums">
              {accumulator.toFixed(2)} / {totalSharesPerHour.toFixed(2)}
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500/70 to-amber-400 rounded-full transition-all duration-1000 ease-linear"
              style={{
                width: `${Math.min((accumulator / Math.max(totalSharesPerHour, 0.01)) * 100, 100)}%`,
              }}
            />
          </div>
        </div>

        {/* Per-player breakdown */}
        {activeAssignments.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-border/50">
            {activeAssignments.map((a) => {
              const rate = (a.yourScouts / a.globalScouts) * HOURLY_SHARES;
              return (
                <div key={a.playerId} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/40" />
                    <span className="truncate max-w-[120px] text-foreground/80">
                      {shortPlayerLabel(a.firstName, a.lastName, a.playerId)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[10px]">
                    <span className="text-muted-foreground tabular-nums">
                      {a.yourScouts}/{a.globalScouts}
                    </span>
                    <span className="text-amber-500 font-semibold tabular-nums w-16 text-right">
                      {rate.toFixed(2)}/hr
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline keyframes for the float-up animation */}
      <style>{`
        @keyframes ticker-float-up {
          0% {
            opacity: 1;
            transform: translateY(0);
          }
          50% {
            opacity: 0.8;
            transform: translateY(-20px);
          }
          100% {
            opacity: 0;
            transform: translateY(-36px);
          }
        }
      `}</style>
    </div>
  );
}

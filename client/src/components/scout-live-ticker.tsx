/**
 * Scout Live Ticker
 *
 * 15-second micro-accumulation widget that makes scout earnings visible
 * in real time. Every 15s a "+0.023 ✨" popup floats up for each assigned
 * scout, and a running total marches toward the next hourly settlement.
 *
 * Architecture: frontend-only projection. The rate is calculated from the
 * same /api/scouts data the dashboard already fetches, and the counter
 * resets at the top of the hour when the real distribution arrives.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Binoculars, TrendingUp } from "lucide-react";

const TICK_MS = 15_000; // 15 seconds
const TICKS_PER_HOUR = 240; // 240 ticks in an hour
const HOURLY_SHARES = 60;

interface TickerAssignment {
  playerId: string;
  playerName: string;
  yourScouts: number;
  globalScouts: number;
}

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
  playerName: string;
  amount: number;
  x: number;
}

export function ScoutLiveTicker({ assignments, totalScouts, maxScouts }: TickerProps) {
  const [runningTotal, setRunningTotal] = useState(0);
  const [accumulator, setAccumulator] = useState(0);
  const [popups, setPopups] = useState<PopupAnim[]>([]);
  const popupIdRef = useRef(0);
  const tickerRef = useRef<HTMLDivElement>(null);

  // Calculate rates for each assignment
  const activeAssignments: TickerAssignment[] = assignments
    .filter((a) => a.scoutCount > 0 && a.globalScoutCount > 0)
    .map((a) => ({
      playerId: a.playerId,
      playerName: a.player ? `${a.player.firstName} ${a.player.lastName}` : a.playerId,
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
      setRunningTotal(0);
      setAccumulator(0);
      setPopups([]);
    }, msToNextHour);

    return () => clearTimeout(resetTimer);
  }, []);

  // The 15-second tick
  useEffect(() => {
    if (activeAssignments.length === 0) return;

    const interval = setInterval(() => {
      const perAssignment = tickAmount / Math.max(activeAssignments.length, 1);

      setAccumulator((prev) => {
        const next = prev + tickAmount;
        // Sparkle animation duration: 3 seconds to float up and fade
        // We spawn a popup for each active assignment
        const id = popupIdRef.current++;
        const newPopups = activeAssignments.map((a, i) => ({
          id: id + i,
          playerName: a.playerName.split(" ").pop() || a.playerName, // short last name
          amount: ((a.yourScouts / a.globalScouts) * HOURLY_SHARES) / TICKS_PER_HOUR,
          x: (i / Math.max(activeAssignments.length - 1, 1)) * 80 + 10, // spread across width
        }));
        setPopups((prev) => [...prev, ...newPopups].slice(-20)); // keep max 20

        // Clean up popups after animation
        setTimeout(() => {
          setPopups((prev) => prev.filter((p) => !newPopups.find((np) => np.id === p.id)));
        }, 3000);

        return next;
      });

      setRunningTotal((prev) => prev + tickAmount);
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
    <div
      ref={tickerRef}
      className="relative border border-amber-500/20 rounded-sm bg-amber-500/5 p-3 overflow-hidden"
    >
      {/* Floating popup animations */}
      <div className="absolute inset-0 pointer-events-none">
        {popups.map((popup) => (
          <div
            key={popup.id}
            className="absolute animate-float-up text-amber-400 font-mono font-bold text-[10px] whitespace-nowrap"
            style={{
              left: `${popup.x}%`,
              bottom: "20%",
              animation: "float-up 2.5s ease-out forwards",
            }}
          >
            +{popup.amount.toFixed(3)} ✨ {popup.playerName}
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-xs font-semibold text-amber-100">Live Earnings</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Binoculars className="h-3 w-3" />
              {totalScouts}/{maxScouts}
            </span>
            <span>Next: {timeUntil}</span>
          </div>
        </div>

        {/* Running total */}
        <div className="text-center py-2">
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-600">
            {accumulator.toFixed(2)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">shares earned this hour</div>
        </div>

        {/* Progress bar to next distribution */}
        <div className="space-y-1 mb-2">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Rate: {totalSharesPerHour.toFixed(2)} / hr</span>
            <span>
              {accumulator.toFixed(2)} / {totalSharesPerHour.toFixed(2)} (est.)
            </span>
          </div>
          <div className="h-1.5 bg-amber-900/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-1000 ease-linear"
              style={{
                width: `${Math.min((accumulator / Math.max(totalSharesPerHour, 0.01)) * 100, 100)}%`,
              }}
            />
          </div>
        </div>

        {/* Per-player breakdown */}
        {activeAssignments.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-amber-500/10">
            {activeAssignments.map((a) => {
              const rate = (a.yourScouts / a.globalScouts) * HOURLY_SHARES;
              return (
                <div key={a.playerId} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
                    <span className="truncate max-w-[120px] text-amber-100/80">{a.playerName}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[10px]">
                    <span className="text-muted-foreground">
                      {a.yourScouts} / {a.globalScouts}
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
        @keyframes float-up {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          60% {
            opacity: 0.8;
            transform: translateY(-24px) scale(1.05);
          }
          100% {
            opacity: 0;
            transform: translateY(-40px) scale(0.8);
          }
        }
      `}</style>
    </div>
  );
}

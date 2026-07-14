/**
 * Scout Live Ticker (compact)
 *
 * 15-second micro-accumulation widget that makes scout earnings visible
 * in real time. Every 15s a "+0.023" popup floats up showing which player
 * earned it, and a running total marches toward the next hourly settlement.
 *
 * Layout: the total + progress bar sit on the left; player attribution
 * pills stack on the right. This halves the vertical footprint compared
 * to the old stacked layout while preserving every data point.
 */

import { useState, useEffect, useMemo } from "react";
import { Binoculars, TrendingUp } from "lucide-react";
import { openPlayerModal } from "@/lib/player-modal-events";

const TICK_MS = 15_000;
const TICKS_PER_HOUR = 240;
const HOURLY_SHARES = 60;

export function getInitialHourProgress(totalSharesPerHour: number): number {
  const now = new Date();
  const msIntoHour = now.getMinutes() * 60_000 + now.getSeconds() * 1000 + now.getMilliseconds();
  return (msIntoHour / 3_600_000) * totalSharesPerHour;
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

function shortPlayerLabel(
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string,
): string {
  if (firstName && lastName) return `${firstName.charAt(0)}. ${lastName}`;
  if (lastName) return lastName;
  if (firstName) return firstName;
  return fallback ?? "Unknown";
}

export function ScoutLiveTicker({ assignments, totalScouts, maxScouts }: TickerProps) {
  const activeAssignments = useMemo(
    () =>
      assignments
        .filter((a) => a.scoutCount > 0 && a.globalScoutCount > 0)
        .map((a) => ({
          playerId: a.playerId,
          firstName: a.player?.firstName ?? null,
          lastName: a.player?.lastName ?? null,
          yourScouts: a.scoutCount,
          globalScouts: a.globalScoutCount,
          rate: (a.scoutCount / a.globalScoutCount) * HOURLY_SHARES,
        })),
    [assignments],
  );

  const totalSharesPerHour = useMemo(
    () => activeAssignments.reduce((sum, a) => sum + a.rate, 0),
    [activeAssignments],
  );

  const [accumulator, setAccumulator] = useState(() => getInitialHourProgress(totalSharesPerHour));
  const tickAmount = totalSharesPerHour / TICKS_PER_HOUR;

  useEffect(() => {
    if (totalSharesPerHour <= 0) return;
    setAccumulator((prev) => Math.max(prev, getInitialHourProgress(totalSharesPerHour)));
  }, [totalSharesPerHour]);

  // Reset at top of the hour
  useEffect(() => {
    const now = new Date();
    const msToNextHour =
      (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
    const resetTimer = setTimeout(() => {
      setAccumulator(getInitialHourProgress(totalSharesPerHour));
    }, msToNextHour);
    return () => clearTimeout(resetTimer);
  }, [totalSharesPerHour]);

  // 15-second tick
  useEffect(() => {
    if (tickAmount <= 0) return;
    const interval = setInterval(() => {
      setAccumulator((prev) => prev + tickAmount);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [tickAmount]);

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

  if (activeAssignments.length === 0) return null;

  const maxSharesPerHour = activeAssignments.length * HOURLY_SHARES; // 60 per player
  const progressPct = Math.min((totalSharesPerHour / Math.max(maxSharesPerHour, 0.01)) * 100, 100);

  return (
    <div className="relative border border-border/60 rounded-compact bg-muted/30 p-2.5 overflow-hidden">
      <div className="relative z-10 flex gap-3">
        {/* LEFT: total + progress */}
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-category-scout" />
              <span className="text-[10px] font-semibold text-foreground">Live Earnings</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
              <Binoculars className="h-2.5 w-2.5" />
              <span>
                {totalScouts}/{maxScouts}
              </span>
              <span className="tabular-nums">{timeUntil}</span>
            </div>
          </div>

          {/* Accumulator — shares earned so far this hour */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono tabular-nums text-category-scout leading-none">
              {accumulator.toFixed(2)}
            </span>
            <span className="text-[9px] text-muted-foreground">earned this hour</span>
          </div>

          {/* Competition gauge: current rate vs max possible */}
          <div className="mt-1.5 space-y-0.5">
            <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums">
              <span>{totalSharesPerHour.toFixed(2)}/hr est.</span>
              <span>{maxSharesPerHour.toFixed(0)} max</span>
            </div>
            <div className="h-1 bg-muted rounded-pill overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-category-scout/70 to-category-scout rounded-pill transition-all duration-1000 ease-linear"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* RIGHT: player attribution pills */}
        <div className="flex flex-col justify-center gap-1 shrink-0">
          {activeAssignments.map((a) => (
            <button
              key={a.playerId}
              type="button"
              onClick={() => openPlayerModal(a.playerId)}
              className="flex items-center gap-1.5 text-[9px] bg-card/60 border border-border/40 rounded-compact px-1.5 py-0.5 hover:bg-card hover:border-border/70 active:scale-[0.98] transition-colors text-left"
            >
              <span className="text-category-scout font-mono font-semibold tabular-nums w-[38px] text-right shrink-0">
                {a.rate.toFixed(2)}
              </span>
              <span className="h-2 w-px bg-border/60 shrink-0" />
              <span className="truncate text-foreground/80 hover:text-foreground transition-colors">
                {shortPlayerLabel(a.firstName, a.lastName, a.playerId)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

export const SCOUT_LIVE_SHARE_POPUP_EVENT = "scout-live-share-popup";

const TICK_MS = 15_000;
const TICKS_PER_HOUR = 240;
const HOURLY_SHARES = 60;
const STAGGER_MS = 1_000; // 1s between each popup in a batch
const MAX_VISIBLE = 3;

export interface ScoutLiveSharePopupDetail {
  id: number;
  shortLabel: string;
  amount: number;
}

interface ScoutAssignment {
  playerId: string;
  scoutCount: number;
  globalScoutCount: number;
  player?: { firstName: string; lastName: string } | null;
}

interface ScoutData {
  assignments?: ScoutAssignment[];
  totalScouts?: number;
  maxScouts?: number;
}

const POPUP_LIFETIME_MS = 3000;

export function getMsUntilNextShareTick(now = new Date()): number {
  const msIntoMinute = now.getSeconds() * 1000 + now.getMilliseconds();
  const remainder = msIntoMinute % TICK_MS;
  return remainder === 0 ? TICK_MS : TICK_MS - remainder;
}

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

function buildPopupDetails(
  assignments: ScoutAssignment[],
  firstPopupId: number,
): ScoutLiveSharePopupDetail[] {
  const activeAssignments = assignments.filter((a) => a.scoutCount > 0 && a.globalScoutCount > 0);

  if (activeAssignments.length === 0) return [];

  return activeAssignments.map((assignment, index) => ({
    id: firstPopupId + index,
    shortLabel: shortPlayerLabel(
      assignment.player?.firstName ?? null,
      assignment.player?.lastName ?? null,
      assignment.playerId,
    ),
    amount:
      ((assignment.scoutCount / assignment.globalScoutCount) * HOURLY_SHARES) / TICKS_PER_HOUR,
  }));
}

export function ScoutLiveSharePopupEngine() {
  const { isAuthenticated } = useAuth();

  const { data: scoutData } = useQuery<ScoutData>({
    queryKey: ["/api/scouts"],
    refetchInterval: TICK_MS,
    staleTime: 5000,
    enabled: isAuthenticated,
  });

  const assignments = useMemo(() => scoutData?.assignments ?? [], [scoutData?.assignments]);
  const assignmentsRef = useRef(assignments);
  const nextPopupIdRef = useRef(0);

  useEffect(() => {
    assignmentsRef.current = assignments;
  }, [assignments]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const dispatchPopups = () => {
      const popups = buildPopupDetails(assignmentsRef.current, nextPopupIdRef.current);
      nextPopupIdRef.current += popups.length;

      // Stagger dispatch so popups appear one at a time
      popups.forEach((popup, i) => {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent(SCOUT_LIVE_SHARE_POPUP_EVENT, {
              detail: popup,
            }),
          );
        }, i * STAGGER_MS);
      });
    };

    const hasAssignments = () =>
      assignmentsRef.current.some((a) => a.scoutCount > 0 && a.globalScoutCount > 0);

    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        if (hasAssignments()) {
          dispatchPopups();
        }
        intervalId = setInterval(() => {
          if (hasAssignments()) {
            dispatchPopups();
          }
        }, TICK_MS);
      }, getMsUntilNextShareTick());
    };

    if (isAuthenticated) {
      scheduleNext();
    }

    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, [isAuthenticated]);

  return null;
}

interface QueuedPopup extends ScoutLiveSharePopupDetail {
  removeAt: number; // timestamp when this popup should be removed
  enterAt: number; // timestamp when this popup entered the visible queue
}

export function ScoutLiveSharePopupHost() {
  const [queue, setQueue] = useState<QueuedPopup[]>([]);
  const timerIdsRef = useRef<number[]>([]);

  const handlePopup = useCallback((event: Event) => {
    const customEvent = event as CustomEvent<ScoutLiveSharePopupDetail>;
    const popup = customEvent.detail;
    if (!popup) return;

    const now = Date.now();

    setQueue((prev) => {
      // Evict expired entries first
      const live = prev.filter((p) => p.removeAt > now);
      // If at max visible, skip (don't add more than MAX_VISIBLE at once)
      if (live.length >= MAX_VISIBLE) return live;
      return [...live, { ...popup, enterAt: now, removeAt: now + POPUP_LIFETIME_MS }];
    });

    const timerId = window.setTimeout(() => {
      setQueue((prev) => prev.filter((item) => item.id !== popup.id));
      timerIdsRef.current = timerIdsRef.current.filter((id) => id !== timerId);
    }, POPUP_LIFETIME_MS);

    timerIdsRef.current.push(timerId);
  }, []);

  useEffect(() => {
    window.addEventListener(SCOUT_LIVE_SHARE_POPUP_EVENT, handlePopup as EventListener);

    return () => {
      window.removeEventListener(SCOUT_LIVE_SHARE_POPUP_EVENT, handlePopup as EventListener);
      timerIdsRef.current.forEach((timerId) => window.clearTimeout(timerId));
      timerIdsRef.current = [];
    };
  }, [handlePopup]);

  if (typeof document === "undefined" || queue.length === 0) {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed left-1/2 -translate-x-1/2 z-[55] flex flex-col items-center gap-1.5 sm:bottom-4"
      // On mobile: position just above the bottom nav (h-16 = 4rem)
      // If the cash balance pill is showing, popups sit above it (4.5rem pill + ~2rem)
      style={{ bottom: "calc(4.5rem + 2.75rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {queue.slice(0, MAX_VISIBLE).map((popup) => (
        <div
          key={popup.id}
          className="flex items-center gap-1.5 rounded-pill border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))]/90 px-3 py-1.5 shadow-[0_4px_14px_rgba(0,0,0,0.35)] backdrop-blur-sm"
          style={{
            animation:
              "scout-popup-enter 0.3s ease-out, scout-popup-exit 0.6s ease-in 2.4s forwards",
          }}
        >
          <span className="text-category-scout font-mono font-semibold text-[11px] tabular-nums whitespace-nowrap drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
            +{popup.amount.toFixed(3)}
          </span>
          <span className="h-3 w-px bg-[hsl(var(--border-strong))]" />
          <span className="text-[11px] font-medium text-[hsl(var(--text))] whitespace-nowrap">
            {popup.shortLabel}
          </span>
        </div>
      ))}

      <style>{`
        @keyframes scout-popup-enter {
          0% {
            opacity: 0;
            transform: translateY(8px) scale(0.95);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes scout-popup-exit {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-6px) scale(0.96);
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}

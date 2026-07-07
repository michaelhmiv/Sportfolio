import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";

export const SCOUT_LIVE_SHARE_POPUP_EVENT = "scout-live-share-popup";

const TICK_MS = 15_000;
const TICKS_PER_HOUR = 240;
const HOURLY_SHARES = 60;

export interface ScoutLiveSharePopupDetail {
  id: number;
  shortLabel: string;
  amount: number;
  x: number;
}

interface ScoutAssignment {
  playerId: string;
  scoutCount: number;
  globalScoutCount: number;
  player?: { firstName: string; lastName: string } | null;
}

interface ScoutData {
  assignments?: ScoutAssignment[];
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

  return activeAssignments.map((assignment, index) => ({
    id: firstPopupId + index,
    shortLabel: shortPlayerLabel(
      assignment.player?.firstName ?? null,
      assignment.player?.lastName ?? null,
      assignment.playerId,
    ),
    amount:
      ((assignment.scoutCount / assignment.globalScoutCount) * HOURLY_SHARES) / TICKS_PER_HOUR,
    x: (index / Math.max(activeAssignments.length - 1, 1)) * 80 + 10,
  }));
}

export function ScoutLiveSharePopupEngine() {
  const { data: scoutData } = useQuery<ScoutData>({
    queryKey: ["/api/scouts"],
    refetchInterval: TICK_MS,
    staleTime: 5000,
  });

  const assignments = useMemo(() => scoutData?.assignments ?? [], [scoutData?.assignments]);
  const assignmentsRef = useRef(assignments);
  const nextPopupIdRef = useRef(0);

  useEffect(() => {
    assignmentsRef.current = assignments;
  }, [assignments]);

  useEffect(() => {
    let intervalId: number | undefined;

    const dispatchPopups = () => {
      const popups = buildPopupDetails(assignmentsRef.current, nextPopupIdRef.current);
      nextPopupIdRef.current += popups.length;

      popups.forEach((popup) => {
        window.dispatchEvent(
          new CustomEvent(SCOUT_LIVE_SHARE_POPUP_EVENT, {
            detail: popup,
          }),
        );
      });
    };

    const timeoutId = window.setTimeout(() => {
      dispatchPopups();
      intervalId = window.setInterval(dispatchPopups, TICK_MS);
    }, getMsUntilNextShareTick());

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  return null;
}

export function ScoutLiveSharePopupHost() {
  const [popups, setPopups] = useState<ScoutLiveSharePopupDetail[]>([]);
  const timeoutIdsRef = useRef<number[]>([]);

  useEffect(() => {
    const handlePopup = (event: Event) => {
      const customEvent = event as CustomEvent<ScoutLiveSharePopupDetail>;
      const popup = customEvent.detail;

      if (!popup) return;

      setPopups((prev) => [...prev, popup].slice(-20));

      const timeoutId = window.setTimeout(() => {
        setPopups((prev) => prev.filter((item) => item.id !== popup.id));
        timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== timeoutId);
      }, POPUP_LIFETIME_MS);

      timeoutIdsRef.current.push(timeoutId);
    };

    window.addEventListener(SCOUT_LIVE_SHARE_POPUP_EVENT, handlePopup as EventListener);

    return () => {
      window.removeEventListener(SCOUT_LIVE_SHARE_POPUP_EVENT, handlePopup as EventListener);
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIdsRef.current = [];
    };
  }, []);

  if (typeof document === "undefined" || popups.length === 0) {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[70] px-3 sm:top-20">
      <div className="relative mx-auto h-[60vh] max-w-6xl">
        {popups.map((popup) => (
          <div
            key={popup.id}
            className="absolute text-amber-500 font-mono font-semibold text-[10px] whitespace-nowrap drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)]"
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

      <style>{`
        @keyframes ticker-float-up {
          0% {
            opacity: 1;
            transform: translateY(0);
          }
          50% {
            opacity: 0.85;
            transform: translateY(-20px);
          }
          100% {
            opacity: 0;
            transform: translateY(-36px);
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}

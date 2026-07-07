import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const SCOUT_LIVE_SHARE_POPUP_EVENT = "scout-live-share-popup";

export interface ScoutLiveSharePopupDetail {
  id: number;
  shortLabel: string;
  amount: number;
  x: number;
}

const POPUP_LIFETIME_MS = 3000;

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

/**
 * Pull-to-refresh hook.
 *
 * Returns a ref to attach to the scrollable container and a boolean `isRefreshing`
 * to show a loading indicator.  When the user drags down far enough, `onRefresh`
 * is called and haptic feedback fires at the trigger point.
 *
 * Works purely with pointer/touch events — no extra library needed.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { hapticRefreshTrigger } from "@/lib/haptics";

const TRIGGER_DISTANCE = 72; // px of drag before triggering

interface PullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  enabled?: boolean;
}

export function usePullToRefresh<T extends HTMLElement>({
  onRefresh,
  enabled = true,
}: PullToRefreshOptions) {
  const containerRef = useRef<T>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef<number | null>(null);
  const triggered = useRef(false);
  const isRefreshingRef = useRef(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    await hapticRefreshTrigger();
    try {
      await onRefresh();
    } finally {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
      setPullDistance(0);
      triggered.current = false;
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      triggered.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      if (el.scrollTop > 0) {
        startY.current = null;
        return;
      }
      const delta = e.touches[0].clientY - startY.current;
      if (delta < 0) return;
      // Damp the pull so it feels resistive
      const damped = Math.min(delta * 0.45, TRIGGER_DISTANCE * 1.1);
      setPullDistance(damped);

      if (damped >= TRIGGER_DISTANCE && !triggered.current) {
        triggered.current = true;
      }
    };

    const onTouchEnd = () => {
      if (triggered.current && !isRefreshingRef.current) {
        void handleRefresh();
      } else {
        setPullDistance(0);
        triggered.current = false;
      }
      startY.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, handleRefresh]);

  return { containerRef, isRefreshing, pullDistance };
}

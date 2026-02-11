import { useState, useEffect, useCallback } from "react";

/**
 * Hook to track app visibility, network status, and provide smart polling intervals.
 * Helps prevent mobile hanging by:
 * 1. Pausing polling when app is backgrounded
 * 2. Pausing polling when offline
 * 3. Reducing polling frequency on mobile devices
 */

export interface AppState {
  isVisible: boolean;
  isOnline: boolean;
  isMobile: boolean;
  isPWA: boolean;
  shouldPoll: boolean;
}

export function useAppState(): AppState {
  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";

  const [isVisible, setIsVisible] = useState(() => (hasDOM ? !document.hidden : true));
  const [isOnline, setIsOnline] = useState(() => (hasNavigator ? navigator.onLine : true));
  const [isMobile, setIsMobile] = useState(false);
  const [isPWA, setIsPWA] = useState(false);

  useEffect(() => {
    if (!hasDOM || !hasNavigator) return;

    // Detect mobile
    const checkMobile = () => {
      const mobile =
        window.innerWidth < 768 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);

    // Detect PWA (standalone mode)
    const checkPWA = () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true;
      setIsPWA(standalone);
    };
    checkPWA();

    // Visibility change
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Network status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("resize", checkMobile);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const shouldPoll = isVisible && isOnline;

  return { isVisible, isOnline, isMobile, isPWA, shouldPoll };
}

/**
 * Returns a polling interval that's aware of app state.
 * Returns `false` to disable polling when app is backgrounded or offline.
 * On mobile, doubles the interval to reduce battery/network usage.
 */
export function useSmartPollingInterval(
  baseInterval: number | false,
  options?: { disableOnMobile?: boolean; mobileMultiplier?: number },
): number | false {
  const { shouldPoll, isMobile } = useAppState();
  const { disableOnMobile = false, mobileMultiplier = 2 } = options || {};

  if (!shouldPoll || baseInterval === false) {
    return false;
  }

  if (isMobile) {
    if (disableOnMobile) {
      return false;
    }
    return baseInterval * mobileMultiplier;
  }

  return baseInterval;
}

/**
 * Provides app state context for use in query configurations.
 * Call once at app root and use the returned values in query options.
 */
export function useAppStateForQueries() {
  const appState = useAppState();

  const getPollingInterval = useCallback(
    (baseInterval: number | false, mobileMultiplier = 2): number | false => {
      if (!appState.shouldPoll || baseInterval === false) {
        return false;
      }
      if (appState.isMobile) {
        return baseInterval * mobileMultiplier;
      }
      return baseInterval;
    },
    [appState.shouldPoll, appState.isMobile],
  );

  return {
    ...appState,
    getPollingInterval,
  };
}

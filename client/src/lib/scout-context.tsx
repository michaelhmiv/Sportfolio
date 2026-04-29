/**
 * Scout Context
 * 
 * Provides global access to scout dashboard modal state.

 */

import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";

interface ScoutContextType {
  isScoutDashboardOpen: boolean;
  openScoutDashboard: () => void;
  closeScoutDashboard: () => void;
}

const ScoutContext = createContext<ScoutContextType | null>(null);

export function ScoutProvider({ children }: { children: ReactNode }) {
  const [isScoutDashboardOpen, setIsScoutDashboardOpen] = useState(false);
  const openScoutDashboard = useCallback(() => setIsScoutDashboardOpen(true), []);
  const closeScoutDashboard = useCallback(() => setIsScoutDashboardOpen(false), []);
  const value = useMemo(
    () => ({
      isScoutDashboardOpen,
      openScoutDashboard,
      closeScoutDashboard,
    }),
    [closeScoutDashboard, isScoutDashboardOpen, openScoutDashboard],
  );

  return <ScoutContext.Provider value={value}>{children}</ScoutContext.Provider>;
}

export function useScout() {
  const context = useContext(ScoutContext);
  if (!context) {
    throw new Error("useScout must be used within a ScoutProvider");
  }
  return context;
}

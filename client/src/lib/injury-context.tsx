import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export interface InjuryInfo {
  id: string;
  injuryStatus: string;
  injuryDescription: string | null;
  injuryReturnDate: string | null;
}

interface InjuryContextValue {
  injuries: Map<string, InjuryInfo>;
  isLoading: boolean;
  getInjury: (playerId: string) => InjuryInfo | undefined;
  isInjured: (playerId: string) => boolean;
}

const InjuryContext = createContext<InjuryContextValue | null>(null);

export function InjuryProvider({ children }: { children: ReactNode }) {
  const {
    data: injuredPlayers,
    isLoading,
    error,
  } = useQuery<InjuryInfo[]>({
    queryKey: ["/api/players/injuries"],
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
  });

  // Debug logging
  if (error) {
    console.error("[InjuryProvider] Error fetching injuries:", error);
  }
  if (injuredPlayers) {
    console.log("[InjuryProvider] Loaded", injuredPlayers.length, "injuries");
  }

  // Build a map for O(1) lookup
  const injuries = new Map<string, InjuryInfo>();
  if (injuredPlayers) {
    for (const player of injuredPlayers) {
      injuries.set(player.id, player);
    }
  }

  const getInjury = (playerId: string) => injuries.get(playerId);
  const isInjured = (playerId: string) => injuries.has(playerId);

  return (
    <InjuryContext.Provider value={{ injuries, isLoading, getInjury, isInjured }}>
      {children}
    </InjuryContext.Provider>
  );
}

export function useInjuries() {
  const context = useContext(InjuryContext);
  if (!context) {
    throw new Error("useInjuries must be used within InjuryProvider");
  }
  return context;
}

/**
 * Get injury status severity for styling/sorting
 * Higher number = more severe
 */
export function getInjurySeverity(status: string | null | undefined): number {
  if (!status) return 0;
  const s = status.toLowerCase();
  if (s === "out") return 4;
  if (s === "doubtful") return 3;
  if (s === "questionable") return 2;
  if (s === "probable" || s === "day-to-day") return 1;
  return 1; // Unknown status treated as minor
}

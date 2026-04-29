/**
 * Sport Context Provider
 *
 * Provides global sport selection state across the application.
 * Persists selection to localStorage for user convenience.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  useMemo,
  ReactNode,
} from "react";

export type Sport = "NBA" | "NFL" | "MLB" | "NASCAR" | "ALL";

export const SPORTS: Sport[] = ["NBA", "NFL", "MLB", "NASCAR", "ALL"];

interface SportContextValue {
  /** Currently selected sport */
  sport: Sport;
  /** Set the active sport */
  setSport: (sport: Sport) => void;
  /** Check if a sport is currently selected */
  isSport: (sport: Sport) => boolean;
}

const SportContext = createContext<SportContextValue | null>(null);

const STORAGE_KEY = "sportfolio_selected_sport";

/**
 * Provider component that wraps the app to provide sport context
 */
export function SportProvider({ children }: { children: ReactNode }) {
  const [sport, setSportState] = useState<Sport>(() => {
    // Initialize from localStorage, default to ALL for new visitors
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (
        stored === "NBA" ||
        stored === "NFL" ||
        stored === "MLB" ||
        stored === "NASCAR" ||
        stored === "ALL"
      ) {
        return stored;
      }
    }
    return "ALL";
  });

  // Persist to localStorage whenever sport changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, sport);
  }, [sport]);

  const setSport = useCallback((newSport: Sport) => {
    if (SPORTS.includes(newSport)) {
      setSportState(newSport);
    }
  }, []);

  const isSport = useCallback((checkSport: Sport) => sport === checkSport, [sport]);
  const value = useMemo(() => ({ sport, setSport, isSport }), [isSport, setSport, sport]);

  return <SportContext.Provider value={value}>{children}</SportContext.Provider>;
}

/**
 * Hook to access sport context
 * @throws Error if used outside SportProvider
 */
export function useSport(): SportContextValue {
  const context = useContext(SportContext);
  if (!context) {
    throw new Error("useSport must be used within a SportProvider");
  }
  return context;
}

/**
 * Hook to get sport config for current sport
 */
export function useSportConfig() {
  const { sport } = useSport();

  const configs = {
    NBA: {
      name: "NBA",
      fullName: "National Basketball Association",
      icon: "🏀",
      positions: ["PG", "SG", "SF", "PF", "C"],
      positionLabels: {
        PG: "Point Guard",
        SG: "Shooting Guard",
        SF: "Small Forward",
        PF: "Power Forward",
        C: "Center",
      } as Record<string, string>,
    },
    NFL: {
      name: "NFL",
      fullName: "National Football League",
      icon: "🏈",
      positions: ["QB", "RB", "WR", "TE", "K", "DEF"],
      positionLabels: {
        QB: "Quarterback",
        RB: "Running Back",
        WR: "Wide Receiver",
        TE: "Tight End",
        K: "Kicker",
        DEF: "Defense",
      } as Record<string, string>,
    },
    MLB: {
      name: "MLB",
      fullName: "Major League Baseball",
      icon: "⚾",
      positions: ["P", "C", "1B", "2B", "3B", "SS", "OF", "DH", "UTIL"],
      positionLabels: {
        P: "Pitcher",
        C: "Catcher",
        "1B": "First Base",
        "2B": "Second Base",
        "3B": "Third Base",
        SS: "Shortstop",
        OF: "Outfield",
        DH: "Designated Hitter",
        UTIL: "Utility",
      } as Record<string, string>,
    },
    NASCAR: {
      name: "NASCAR",
      fullName: "NASCAR Cup Series",
      icon: "🏎️",
      positions: ["DRV"],
      positionLabels: {
        DRV: "Driver",
      } as Record<string, string>,
    },
    ALL: {
      name: "All Sports",
      fullName: "All Sports Market",
      icon: "🌎",
      positions: [],
      positionLabels: {} as Record<string, string>,
    },
  };

  return configs[sport];
}

export default SportProvider;

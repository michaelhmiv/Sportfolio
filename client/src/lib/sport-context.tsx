/** Global public-sport selection, derived from the canonical shared configuration. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ENABLED_SPORTS, SPORT_CONFIGS, type Sport as SharedSport } from "@shared/sport-config";

export type Sport = SharedSport | "ALL";
export const ALL_SPORTS: Sport[] = [...(Object.keys(SPORT_CONFIGS) as SharedSport[]), "ALL"];
export const SPORTS: Sport[] = [...ENABLED_SPORTS, "ALL"];
export const DEFAULT_SPORT: Sport = "MLB";

interface SportContextValue {
  sport: Sport;
  setSport: (sport: Sport) => void;
  isSport: (sport: Sport) => boolean;
}
const SportContext = createContext<SportContextValue | null>(null);
const STORAGE_KEY = "sportfolio_selected_sport";

export function SportProvider({ children }: { children: ReactNode }) {
  const [sport, setSportState] = useState<Sport>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY) as Sport | null;
      if (stored && SPORTS.includes(stored)) return stored;
    }
    return DEFAULT_SPORT;
  });
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, sport);
  }, [sport]);
  const setSport = useCallback((newSport: Sport) => {
    if (SPORTS.includes(newSport)) setSportState(newSport);
  }, []);
  const isSport = useCallback((checkSport: Sport) => sport === checkSport, [sport]);
  const value = useMemo(() => ({ sport, setSport, isSport }), [isSport, setSport, sport]);
  return <SportContext.Provider value={value}>{children}</SportContext.Provider>;
}

export function useSport(): SportContextValue {
  const context = useContext(SportContext);
  if (!context) throw new Error("useSport must be used within SportProvider");
  return context;
}

/** Shared configuration is the sole source of sport names, icons, and positions. */
export function useSportConfig() {
  const { sport } = useSport();
  if (sport === "ALL")
    return {
      name: "All Sports",
      fullName: "All Sports Market",
      icon: "🌎",
      emoji: "🌎",
      positions: [],
      positionLabels: {} as Record<string, string>,
    };
  return SPORT_CONFIGS[sport];
}

export default SportProvider;

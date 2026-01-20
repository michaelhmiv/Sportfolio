/**
 * Scout Context
 * 
 * Provides global access to scout dashboard modal state.

 */

import { createContext, useContext, useState, ReactNode } from "react";

interface ScoutContextType {
    isScoutDashboardOpen: boolean;
    openScoutDashboard: () => void;
    closeScoutDashboard: () => void;
}

const ScoutContext = createContext<ScoutContextType | null>(null);

export function ScoutProvider({ children }: { children: ReactNode }) {
    const [isScoutDashboardOpen, setIsScoutDashboardOpen] = useState(false);

    return (
        <ScoutContext.Provider
            value={{
                isScoutDashboardOpen,
                openScoutDashboard: () => setIsScoutDashboardOpen(true),
                closeScoutDashboard: () => setIsScoutDashboardOpen(false),
            }}
        >
            {children}
        </ScoutContext.Provider>
    );
}

export function useScout() {
    const context = useContext(ScoutContext);
    if (!context) {
        throw new Error("useScout must be used within a ScoutProvider");
    }
    return context;
}

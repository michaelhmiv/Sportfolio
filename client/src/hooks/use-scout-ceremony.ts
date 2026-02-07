import { useState, useEffect, useCallback } from "react";

interface ScoutDistribution {
  playerId: string;
  playerName: string;
  playerTeam: string;
  playerPosition: string;
  sport: string;
  sharesEarned: number;
  scoutMinutes: number;
  globalMinutes: number;
  efficiency: number;
}

interface ScoutCeremonyData {
  distributions: ScoutDistribution[];
  totalShares: number;
  totalPlayers: number;
  highlight: ScoutDistribution;
  hourTimestamp: string;
}

interface CeremonyState {
  isReady: boolean;
  isShowing: boolean;
  data: ScoutCeremonyData | null;
  startTime: number | null;
}

export function useScoutCeremony() {
  const [state, setState] = useState<CeremonyState>({
    isReady: false,
    isShowing: false,
    data: null,
    startTime: null,
  });

  // Handle scout_ready event from WebSocket
  const handleScoutReady = useCallback((data: ScoutCeremonyData) => {
    setState({
      isReady: true,
      isShowing: false,
      data,
      startTime: null,
    });
  }, []);

  // Show the ceremony
  const showCeremony = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isReady: false,
      isShowing: true,
      startTime: Date.now(),
    }));
  }, []);

  // Close the ceremony
  const closeCeremony = useCallback(() => {
    setState((prev) => {
      // Track analytics if we have a start time
      if (prev.startTime && prev.data) {
        const duration = Date.now() - prev.startTime;
        // Send analytics to server
        fetch("/api/scouts/ceremony-viewed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            totalShares: prev.data.totalShares,
            playerCount: prev.data.totalPlayers,
            durationMs: duration,
            highlightPlayerId: prev.data.highlight?.playerId,
            highlightShares: prev.data.highlight?.sharesEarned,
          }),
        }).catch(console.error);
      }

      return {
        isReady: false,
        isShowing: false,
        data: null,
        startTime: null,
      };
    });
  }, []);

  // Dismiss the ready notification without viewing
  const dismissReady = useCallback(() => {
    setState((prev) => {
      // Track as skipped
      if (prev.data) {
        fetch("/api/scouts/ceremony-viewed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            totalShares: prev.data.totalShares,
            playerCount: prev.data.totalPlayers,
            skipped: true,
          }),
        }).catch(console.error);
      }

      return {
        isReady: false,
        isShowing: false,
        data: null,
        startTime: null,
      };
    });
  }, []);

  return {
    ...state,
    handleScoutReady,
    showCeremony,
    closeCeremony,
    dismissReady,
  };
}

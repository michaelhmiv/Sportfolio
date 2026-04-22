import { useState, useCallback } from "react";

export interface BoostSettleCeremonyData {
  playerName: string;
  playerTeam: string;
  slotTier: number;
  shareMultiplier: number;
  totalMultiplier: number;
  sharesBurned: number;
  payout: string;
  fantasyPoints: number;
}

interface CeremonyState {
  isShowing: boolean;
  data: BoostSettleCeremonyData | null;
}

/**
 * Hook for the global boost-settle ceremony.
 *
 * Call `handleBoostSettled(wsPayload)` when the WebSocket delivers a
 * `boost_settled` event. The hook opens the ceremony overlay only when
 * the payload includes a player name (i.e. the server enriched it).
 */
export function useBoostSettleCeremony() {
  const [state, setState] = useState<CeremonyState>({ isShowing: false, data: null });

  const handleBoostSettled = useCallback((payload: {
    payout: string;
    fantasyPoints: number;
    multiplier: number;
    slotTier?: number;
    shareMultiplier?: number;
    sharesBurned?: number;
    playerFirstName?: string;
    playerLastName?: string;
    playerTeam?: string;
  }) => {
    const playerFirstName = payload.playerFirstName?.trim() ?? "";
    const playerLastName = payload.playerLastName?.trim() ?? "";
    const playerName = [playerFirstName, playerLastName].filter(Boolean).join(" ");

    // Only show the overlay if we have enough data
    if (!playerName && !payload.payout) return;

    setState({
      isShowing: true,
      data: {
        playerName: playerName || "your player",
        playerTeam: payload.playerTeam ?? "",
        slotTier: payload.slotTier ?? payload.multiplier,
        shareMultiplier: payload.shareMultiplier ?? 1,
        totalMultiplier: payload.multiplier,
        sharesBurned: payload.sharesBurned ?? 1,
        payout: payload.payout,
        fantasyPoints: payload.fantasyPoints,
      },
    });
  }, []);

  const closeCeremony = useCallback(() => {
    setState({ isShowing: false, data: null });
  }, []);

  return {
    ...state,
    handleBoostSettled,
    closeCeremony,
  };
}

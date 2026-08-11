import { useCallback, useState } from "react";

export interface BoostSettleCeremonyData {
  playerName: string;
  playerTeam: string;
  slotTier: number;
  effectiveMultiplier: number;
  sharesBurned: number;
  payout: string;
  boostBonus: string;
  baseComponent: string;
  gameEps: string;
  fantasyPoints: number;
}

interface CeremonyState {
  isShowing: boolean;
  data: BoostSettleCeremonyData | null;
}

export function useBoostSettleCeremony() {
  const [state, setState] = useState<CeremonyState>({ isShowing: false, data: null });

  const handleBoostSettled = useCallback(
    (payload: {
      payout: string;
      boostBonus?: string;
      baseComponent?: string;
      gameEps?: string;
      fantasyPoints: number;
      multiplier: number;
      slotTier?: number;
      sharesBurned?: number;
      playerFirstName?: string;
      playerLastName?: string;
      playerTeam?: string;
    }) => {
      const playerName = [payload.playerFirstName?.trim(), payload.playerLastName?.trim()]
        .filter(Boolean)
        .join(" ");
      if (!playerName && !payload.payout) return;
      setState({
        isShowing: true,
        data: {
          playerName: playerName || "your player",
          playerTeam: payload.playerTeam ?? "",
          slotTier: payload.slotTier ?? payload.multiplier,
          effectiveMultiplier: payload.multiplier,
          sharesBurned: payload.sharesBurned ?? 0,
          payout: payload.payout,
          boostBonus: payload.boostBonus ?? "0.00",
          baseComponent: payload.baseComponent ?? "0.00",
          gameEps: payload.gameEps ?? "0.00000000",
          fantasyPoints: payload.fantasyPoints,
        },
      });
    },
    [],
  );

  const closeCeremony = useCallback(() => setState({ isShowing: false, data: null }), []);
  return { ...state, handleBoostSettled, closeCeremony };
}

export const OPEN_PLAYER_MODAL_EVENT = "open-player-modal";

type OpenPlayerModalDetail = {
  playerId: string;
};

export function openPlayerModal(playerId: string | null | undefined) {
  const normalizedPlayerId = String(playerId || "").trim();
  if (!normalizedPlayerId || typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<OpenPlayerModalDetail>(OPEN_PLAYER_MODAL_EVENT, {
      detail: { playerId: normalizedPlayerId },
    }),
  );
}

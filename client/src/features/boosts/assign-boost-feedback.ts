export interface BoostPlayerLike {
  firstName?: string | null;
  lastName?: string | null;
  team?: string | null;
}

export interface AssignBoostResponseLike {
  boost?: {
    player?: BoostPlayerLike | null;
    shareMultiplier?: string | null;
  } | null;
}

export interface AssignBoostEligiblePlayerLike {
  player?: BoostPlayerLike | null;
  communityBoostCount?: number | null;
  bestShareMultiplier?: number | null;
}

export interface AssignBoostFeedback {
  playerName: string;
  playerTeam: string;
  shareMultiplier: number;
  totalMultiplier: number;
}

export function getBoostDisplayPlayerName(player: BoostPlayerLike | null | undefined) {
  return [player?.firstName, player?.lastName].filter(Boolean).join(" ") || "Selected player";
}

export function resolveAssignBoostFeedback({
  response,
  eligiblePlayer,
  slotTier,
}: {
  response?: AssignBoostResponseLike | null;
  eligiblePlayer?: AssignBoostEligiblePlayerLike | null;
  slotTier: number;
}): AssignBoostFeedback {
  const responsePlayer = response?.boost?.player;
  const eligibleSourcePlayer = eligiblePlayer?.player;
  const responsePlayerName = getBoostDisplayPlayerName(responsePlayer);
  const player =
    responsePlayerName !== "Selected player"
      ? responsePlayer
      : (eligibleSourcePlayer ?? responsePlayer);
  const parsedShareMultiplier = Number.parseFloat(
    response?.boost?.shareMultiplier || String(eligiblePlayer?.bestShareMultiplier || 1),
  );

  return {
    playerName: getBoostDisplayPlayerName(player),
    playerTeam: player?.team || responsePlayer?.team || eligibleSourcePlayer?.team || "",
    shareMultiplier: Number.isFinite(parsedShareMultiplier) ? parsedShareMultiplier : 1,
    totalMultiplier: slotTier + (eligiblePlayer?.communityBoostCount || 0),
  };
}

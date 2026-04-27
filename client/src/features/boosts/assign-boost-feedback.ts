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

export interface BoostPayoutLike {
  status?: string | null;
  slotTier?: number | null;
  communityBoostCount?: number | null;
  shareMultiplier?: string | number | null;
  payout?: string | number | null;
  liveFantasyPoints?: number | null;
}

export function getBoostDisplayPlayerName(player: BoostPlayerLike | null | undefined) {
  return [player?.firstName, player?.lastName].filter(Boolean).join(" ") || "Selected player";
}

export function getBoostEstimatedPayout(boost: BoostPayoutLike | null | undefined) {
  if (!boost) {
    return 0;
  }

  const settledPayout = Number.parseFloat(String(boost.payout ?? ""));
  if (boost.status === "processed" && Number.isFinite(settledPayout)) {
    return settledPayout;
  }

  const liveFantasyPoints = Number(boost.liveFantasyPoints ?? NaN);
  if (!Number.isFinite(liveFantasyPoints)) {
    return 0;
  }

  const shareMultiplier = Number.parseFloat(String(boost.shareMultiplier ?? 1));
  const slotTier = Number(boost.slotTier ?? 0);
  const communityBoostCount = Number(boost.communityBoostCount ?? 0);
  const totalMultiplier = slotTier + communityBoostCount;
  const estimatedPayout = shareMultiplier * liveFantasyPoints * totalMultiplier;

  return Number.isFinite(estimatedPayout) ? estimatedPayout : 0;
}

export function getTotalEstimatedBoostPayout(boosts: BoostPayoutLike[] | null | undefined) {
  return (boosts || []).reduce((sum, boost) => sum + getBoostEstimatedPayout(boost), 0);
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
